"""Offline checkpoint lineage, replay selection and retention measurements.

Consumes real updater acknowledgments; never resumes an optimizer, changes a
serving alias, or treats missing measurements as zero. All hashes bind content,
not independent proof of the declarations made by the input producer.
"""
import argparse
from copy import deepcopy
import json
from pathlib import Path

import native_training as nt
from native_tinker_update import checkpoint, digest, need, number, sealed, text, validate_config, validate_splits


def checkpoint_lineage(root, updates):
    """Topologically ordered actual update plans/results, including ablation forks."""
    need(type(root) is dict and set(root) == {'id', 'model', 'training_checkpoint', 'sampler_checkpoint'}, 'lineage_root_fields')
    need(text(root['id']) and text(root['model']) and checkpoint(root['training_checkpoint'])
         and checkpoint(root['sampler_checkpoint'], 'sampler_weights'), 'lineage_root_identity')
    nodes = {root['id']: {**deepcopy(root), 'parent': None, 'depth': 0,
                         'method': 'initial', 'result_hash': None, 'optimizer_state': 'external_root'}}
    plan_ids, weights, samplers = set(), {root['training_checkpoint']}, {root['sampler_checkpoint']}
    need(type(updates) is list, 'lineage_updates_collection')
    for item in updates:
        need(type(item) is dict and set(item) == {'id', 'parent', 'plan', 'result'}, 'lineage_update_fields')
        identity, parent, plan, result = (item[k] for k in ('id', 'parent', 'plan', 'result'))
        need(text(identity) and identity not in nodes and parent in nodes, 'lineage_unique_topological_identity')
        sealed(plan, 'plan_hash'); sealed(result, 'result_hash')
        need(plan.get('schema_version') == result.get('schema_version') == 1, 'lineage_updater_schema')
        need(plan['plan_hash'] not in plan_ids and result.get('plan_hash') == plan['plan_hash']
             and result.get('export_hash') == plan.get('export_hash'), 'lineage_plan_binding_or_duplicate_update')
        need(plan.get('consumer') == result.get('consumer') == 'native-tinker-update/v1'
             and plan.get('updates') == 1 and plan.get('optimizer_state') == 'reset_from_pinned_weights',
             'unsupported_update_semantics')
        need(result.get('status') == 'complete' and result.get('optimizer_acknowledged') is True
             and result.get('last_dispatched') == 'save_sampler', 'unacknowledged_or_incomplete_update')
        config = plan.get('config'); ancestor = nodes[parent]
        # Rehashing an outer plan cannot turn a stale/invalid nested config into
        # a different acknowledged method or parent checkpoint.
        validate_config(config)
        need(config['model']['id'] == root['model'] and config['model']['revision'] == ancestor['training_checkpoint'],
             'lineage_wrong_parent_weights')
        trained, sampled = result.get('training_checkpoint'), result.get('sampler_checkpoint')
        need(checkpoint(trained) and checkpoint(sampled, 'sampler_weights')
             and trained not in weights and sampled not in samplers, 'lineage_reused_or_invalid_checkpoint')
        client_id = result.get('training_client_id')
        saved_name = 'native-' + plan['plan_hash'][:24] + '-updated'
        # This is the exact save convention in native-tinker-update/v1. Both
        # artifacts must belong to get_info.model_id and the same plan's save;
        # a teacher snapshot or an unrelated sampler is not its actor checkpoint.
        need(text(client_id) and trained == f'tinker://{client_id}/weights/{saved_name}'
             and sampled == f'tinker://{client_id}/sampler_weights/{saved_name}', 'lineage_checkpoint_pair_identity')
        nodes[identity] = {'id': identity, 'model': root['model'], 'parent': parent,
            'depth': ancestor['depth'] + 1, 'training_checkpoint': trained, 'sampler_checkpoint': sampled,
            'method': config['method'], 'plan_hash': plan['plan_hash'], 'result_hash': result['result_hash'],
            'config_hash': config['config_hash'], 'training_client_id': client_id,
            'optimizer_state': plan['optimizer_state'], 'export_hash': plan['export_hash']}
        plan_ids.add(plan['plan_hash']); weights.add(trained); samplers.add(sampled)
    return nt.seal({'schema_version': 1, 'kind': 'native-checkpoint-lineage/v1', 'root': root['id'],
        'nodes': nodes, 'restoration_verified': False,
        'scope': 'acknowledgment lineage; no independent provider restoration or efficacy proof'}, 'lineage_hash')


def ancestor_distance(lineage, ancestor_sampler, current):
    sealed(lineage, 'lineage_hash')
    need(current in lineage['nodes'], 'unknown_current_checkpoint')
    node, distance, visited = lineage['nodes'][current], 0, set()
    while True:
        need(node['id'] not in visited, 'cyclic_checkpoint_lineage'); visited.add(node['id'])
        if node['sampler_checkpoint'] == ancestor_sampler:
            return distance
        if node['parent'] is None:
            return None  # sibling ablations are not stale ancestors
        need(node['parent'] in lineage['nodes'], 'missing_lineage_parent')
        node = lineage['nodes'][node['parent']]; distance += 1


def select_replay(bundle, manifest, lineage, current, assignment, quotas, *, revoked_aliases=(), max_updates=2, seed=42):
    """Fixed explicit bucket counts; no replacement or silent quota redistribution.

The returned capture selection must still pass prepare_update and its actual
log-ratio freshness check before spending. Update distance is not probability
correction. Bucket rationales are declarations, not an automatic hard-case judge.
"""
    sealed(bundle, 'export_hash')
    families = validate_splits(bundle, manifest)
    need(type(max_updates) is int and max_updates >= 0 and type(seed) is int, 'replay_settings')
    need(set(quotas) == {'recent', 'reservoir', 'hard'}
         and all(type(n) is int and n >= 0 for n in quotas.values()) and 0 < sum(quotas.values()) <= 256,
         'explicit_bounded_replay_quotas')
    need(type(assignment) is dict, 'replay_assignment_required')
    need(type(revoked_aliases) in (list, tuple)
         and all(text(alias) and alias == alias.strip() for alias in revoked_aliases)
         and len(set(revoked_aliases)) == len(revoked_aliases), 'revoked_alias_collection')
    candidates = bundle.get('policy_segments', bundle['sft'])
    pools = {name: [] for name in quotas}; excluded = []; seen = set()
    revoked = set(revoked_aliases)
    for row in candidates:
        segment = row['segment']; identity = segment['capture_hash']; family = families[row['family']]
        need(digest(identity) and identity not in seen, 'duplicate_replay_capture'); seen.add(identity)
        if identity not in assignment:
            continue
        decision = assignment[identity]
        need(set(decision) == {'bucket', 'rationale', 'evidence_hash'} and decision['bucket'] in pools
             and text(decision['rationale']) and digest(decision['evidence_hash']), 'replay_bucket_evidence')
        distance = ancestor_distance(lineage, segment['actor']['revision'], current)
        reason = ('ineligible_family' if family['split'] != 'train' or family['protected'] else
                  'revoked_family' if revoked.intersection(family['aliases']) else
                  'nonancestor_behavior' if distance is None else
                  'stale_update_distance' if distance > max_updates else None)
        if reason:
            excluded.append({'capture_hash': identity, 'reason': reason}); continue
        pools[decision['bucket']].append({'capture_hash': identity, 'family': row['family'],
            'update_distance': distance, 'bucket': decision['bucket'], 'evidence_hash': decision['evidence_hash']})
    need(set(assignment) <= seen, 'assignment_for_missing_capture')
    selected = []
    for bucket, count in quotas.items():
        ordered = sorted(pools[bucket], key=lambda r: (nt.native_hash([seed, r['capture_hash']]), r['capture_hash']))
        need(len(ordered) >= count, 'insufficient_eligible_replay_' + bucket)
        selected.extend(ordered[:count])
    return nt.seal({'schema_version': 1, 'kind': 'native-replay-selection/v1', 'export_hash': bundle['export_hash'],
        'split_hash': manifest['split_hash'], 'lineage_hash': lineage['lineage_hash'], 'current': current,
        'seed': seed, 'max_updates': max_updates, 'quotas': deepcopy(quotas), 'selected': selected,
        'excluded': excluded, 'revoked_aliases': sorted(revoked), 'dispatches': False}, 'selection_hash')


def retention_report(lineage, schedule, observations):
    """R[k,j] on a declared linear curriculum; incomplete contrasts stay unknown."""
    sealed(lineage, 'lineage_hash'); sealed(schedule, 'schedule_hash')
    need(schedule.get('lineage_hash') == lineage['lineage_hash'], 'retention_lineage_pin')
    checkpoints, slices = schedule['checkpoints'], schedule['slices']
    need(type(checkpoints) is list and type(slices) is list and len(checkpoints) == len(slices) + 1
         and len(slices) > 0 and len(set(checkpoints)) == len(checkpoints) and len(set(slices)) == len(slices),
         'retention_schedule_dimensions')
    need(all(c in lineage['nodes'] for c in checkpoints) and all(text(s) for s in slices), 'retention_schedule_identity')
    need(all(lineage['nodes'][child]['parent'] == parent for parent, child in zip(checkpoints, checkpoints[1:])),
         'sibling_ablations_are_not_a_continual_sequence')
    rows = {}
    for row in observations:
        need(set(row) == {'checkpoint', 'sampler_checkpoint', 'slice', 'score', 'assessment_count',
                         'measurement', 'assessment_hash', 'schedule_hash'}, 'retention_observation_fields')
        key = (row['checkpoint'], row['slice'])
        need(key not in rows and key[0] in checkpoints and key[1] in slices, 'retention_duplicate_or_unknown_cell')
        need(row['schedule_hash'] == schedule['schedule_hash'] and row['sampler_checkpoint'] ==
             lineage['nodes'][key[0]]['sampler_checkpoint'], 'retention_observation_pin')
        need(type(row['assessment_count']) is int and row['assessment_count'] >= 0
             and row['measurement'] == schedule['measurement'] and digest(row['assessment_hash']), 'retention_evidence')
        need(row['score'] is None or (number(row['score'], 0, 1) and row['assessment_count'] > 0), 'retention_score')
        rows[key] = deepcopy(row)
    matrix = [[rows.get((c, s), {}).get('score') for s in slices] for c in checkpoints]
    learning = []
    for k in range(1, len(checkpoints)):
        previous, after = matrix[k - 1][k - 1], matrix[k][k - 1]
        plasticity = None if previous is None or after is None else after - previous
        forgetting = []
        for j in range(k - 1):
            history = [matrix[r][j] for r in range(k)]
            forgetting.append(None if None in history or matrix[k][j] is None else max(history) - matrix[k][j])
        mean_forgetting = None if not forgetting or None in forgetting else sum(forgetting) / len(forgetting)
        learning.append({'checkpoint': checkpoints[k], 'plasticity': plasticity, 'forgetting': mean_forgetting,
                         'previous_slice_count': k - 1, 'available_forgetting_slices': sum(x is not None for x in forgetting)})
    return nt.seal({'schema_version': 1, 'kind': 'native-retention-report/v1', 'schedule_hash': schedule['schedule_hash'],
        'measurement': schedule['measurement'], 'checkpoints': checkpoints, 'slices': slices, 'matrix': matrix,
        'learning': learning, 'observed_cells': len(rows), 'expected_cells': len(checkpoints) * len(slices),
        'assessment_count': sum(r['assessment_count'] for r in rows.values()),
        'limitations': ['Point estimates; no uncertainty or promotion decision inferred.',
                        'Model or authored scores do not establish human learning.',
                        'Absent assessments remain unknown; repeated messages are not independent people.']}, 'report_hash')


def promotion_decision(protocol, evidence, lineage):
    """Report a scoped independent gate decision; never mutates a serving pointer."""
    sealed(protocol, 'protocol_hash'); sealed(lineage, 'lineage_hash')
    need(protocol.get('lineage_hash') == lineage['lineage_hash'], 'promotion_lineage_pin')
    candidate, rollback = protocol['candidate'], protocol['rollback']
    need(candidate in lineage['nodes'] and rollback in lineage['nodes'] and candidate != rollback, 'promotion_checkpoints')
    pins = {role: {key: lineage['nodes'][name][key] for key in ('training_checkpoint', 'sampler_checkpoint')}
            for role, name in (('candidate', candidate), ('rollback', rollback))}
    need(protocol.get('checkpoint_pins') == pins, 'promotion_checkpoint_pin')
    need(number(protocol['minimum_gain'], 0, 1) and number(protocol['maximum_forgetting'], 0, 1)
         and protocol['measurement'] in {'model_episode', 'human_learning', 'authored_fixture'}
         and type(protocol['development_authors']) is list and bool(protocol['development_authors'])
         and all(text(author) for author in protocol['development_authors']), 'promotion_thresholds')
    reasons = []
    gates = ('quality', 'retention', 'safety_format', 'calibration', 'restore')
    need(type(evidence) is dict and set(evidence) <= set(gates), 'promotion_gate_fields')
    for gate in gates:
        row = evidence.get(gate)
        if row is None:
            reasons.append(gate + '_missing'); continue
        fields = {'protocol_hash', 'lineage_hash', 'checkpoint_pins', 'candidate', 'rollback',
                  'measurement', 'reviewer', 'independent', 'artifact_hash', 'passed'}
        if gate in ('quality', 'retention'):
            fields |= {'interval_95', 'unit'}
        need(type(row) is dict and set(row) <= fields, 'promotion_gate_fields')
        need(row.get('protocol_hash') == protocol['protocol_hash'] and row.get('candidate') == candidate
             and row.get('rollback') == rollback and row.get('measurement') == protocol['measurement']
             and row.get('lineage_hash') == lineage['lineage_hash'] and row.get('checkpoint_pins') == pins,
             'promotion_evidence_pin')
        need(text(row.get('reviewer')) and row['reviewer'] not in protocol['development_authors']
             and row.get('independent') is True and digest(row.get('artifact_hash')), 'independent_promotion_evidence_required')
        need('passed' not in row or type(row['passed']) is bool, 'promotion_passed_boolean')
        if row.get('passed') is not True:
            reasons.append(gate + '_not_passed')
        if gate in ('quality', 'retention'):
            interval = row.get('interval_95')
            if interval is None:
                reasons.append(gate + '_uncertainty_missing'); continue
            need(type(interval) is list and len(interval) == 2 and all(number(v, -1, 1) for v in interval)
                 and interval[0] <= interval[1] and row.get('unit') == 'source_family', 'promotion_interval')
            if gate == 'quality' and interval[0] <= protocol['minimum_gain']:
                reasons.append('quality_gain_not_established')
            if gate == 'retention' and interval[1] > protocol['maximum_forgetting']:
                reasons.append('retention_budget_exceeded')
    return nt.seal({'schema_version': 1, 'kind': 'native-promotion-decision/v1',
        'protocol_hash': protocol['protocol_hash'], 'lineage_hash': lineage['lineage_hash'],
        'evidence_hash': nt.native_hash(evidence), 'candidate': candidate, 'rollback': rollback,
        'checkpoint_pins': deepcopy(pins),
        'measurement': protocol['measurement'], 'eligible': not reasons, 'reasons': reasons,
        'deployed': False, 'scope': 'decision from supplied independent attestations; no serving change'}, 'decision_hash')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['lineage', 'retention', 'promotion'])
    parser.add_argument('input', type=Path)
    args = parser.parse_args(); value = json.loads(args.input.read_text())
    result = (checkpoint_lineage(value['root'], value['updates']) if args.command == 'lineage' else
              retention_report(value['lineage'], value['schedule'], value['observations']) if args.command == 'retention' else
              promotion_decision(value['protocol'], value['evidence'], value['lineage']))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
