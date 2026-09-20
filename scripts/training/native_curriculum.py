"""Frozen native curriculum, with injected drivers and a fail-closed local journal.

The CLI only inspects. Driver receipts are attestations, not provider restoration
or evidence of human learning. See docs/native-curriculum.md for the API.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from copy import deepcopy
import fcntl
import json
import os
from pathlib import Path

import native_continual as nc
import native_training as nt
import native_tinker_update as nu


def validate_curriculum(spec):
    nu.sealed(spec, 'curriculum_hash')
    nu.need(spec.get('schema_version') == 1 and spec.get('kind') == 'native-curriculum/v1', 'curriculum_schema')
    nu.need(spec.get('update_consumer') == nu.VERSION, 'combined_custom_update_not_implemented')
    nc.checkpoint_lineage(spec['root'], [])
    measurement = spec['measurement']
    nu.need(set(measurement) == {'observer_model', 'observer_manifest_hash', 'probe_card_hashes',
                                'simulator_revision', 'metric_revision'}, 'measurement_fields')
    # Roles and immutable measurement artifacts separate observer from actor;
    # both roles may legitimately start from the same base-model identity.
    nu.need(nu.text(measurement['observer_model'])
            and nu.digest(measurement['observer_manifest_hash'])
            and nu.text(measurement['simulator_revision']) and nu.text(measurement['metric_revision']),
            'frozen_observer_required')
    probes = measurement['probe_card_hashes']
    nu.need(type(probes) is dict and probes and all(nu.text(k) and nu.digest(v) for k, v in probes.items()),
            'frozen_probe_cards_required')
    owner = spec['owner']
    nu.need(set(owner) == {'account_id', 'project_selection', 'project_id'} and nu.text(owner['account_id'])
            and ((owner['project_selection'] == 'explicit' and nu.text(owner['project_id']))
                 or (owner['project_selection'] == 'account_default' and owner['project_id'] is None)),
            'account_project_identity_required')
    nu.need(nu.text(spec['registry_revision']) and type(spec['families']) is list and spec['families'],
            'frozen_family_registry_required')
    families, aliases = {}, set()
    for family in spec['families']:
        name, ids = family['family'], family['aliases']
        nu.need(nu.text(name) and name not in families and type(ids) is list and name in ids
                and all(nu.text(i) for i in ids) and len(set(ids)) == len(ids) and not aliases.intersection(ids)
                and family['split'] in {'train', 'validation', 'test', 'reference'}
                and type(family['protected']) is bool, 'curriculum_family_identity')
        families[name] = family
        aliases.update(ids)
    protected, v4 = spec['protected_evaluation_families'], spec['benchmark_v4_families']
    for values in (protected, v4):
        nu.need(type(values) is list and values and all(nu.text(v) for v in values)
                and len(set(values)) == len(values) and set(values) <= families.keys(), 'protected_family_inventory')
    nu.need(set(v4) <= set(protected), 'benchmark_v4_must_be_protected')
    nu.need(all(families[f]['protected'] and families[f]['split'] != 'train' for f in protected),
            'protected_family_training')
    stages = spec['stages']
    nu.need(type(stages) is list and stages, 'ordered_stages_required')
    stage_ids, scenario_ids, evaluated = {spec['root']['id']}, set(), set()
    for stage in stages:
        nu.need(nu.text(stage['id']) and stage['id'] not in stage_ids and nu.text(stage['topic']), 'stage_identity')
        stage_ids.add(stage['id'])
        for mode in ('train', 'evaluate'):
            refs = stage[mode]
            nu.need(type(refs) is list and refs, 'stage_scenarios_required')
            for ref in refs:
                nu.need(set(ref) == {'scenario_id', 'family_id'} and nu.text(ref['scenario_id'])
                        and ref['scenario_id'] not in scenario_ids and ref['family_id'] in families,
                        'scenario_identity')
                scenario_ids.add(ref['scenario_id'])
                family = families[ref['family_id']]
                if mode == 'train':
                    nu.need(family['split'] == 'train' and not family['protected']
                            and ref['family_id'] not in protected, 'protected_family_training')
                else:
                    nu.need(ref['family_id'] in protected, 'evaluation_family_not_protected')
                    evaluated.add(ref['family_id'])
        quotas = stage['quotas']
        nu.need(type(quotas) is dict and set(quotas) == {'recent', 'reservoir', 'hard'}
                and all(type(v) is int and v >= 0 for v in quotas.values())
                and quotas['recent'] > 0 and sum(quotas.values()) <= 8, 'curriculum_replay_quotas')
    nu.need(set(protected) <= evaluated, 'protected_families_missing_evaluation')
    policy = spec['replay_policy']
    nu.need(set(policy) == {'max_updates', 'seed', 'revoked_aliases'}
            and type(policy['max_updates']) is int and policy['max_updates'] >= 0
            and type(policy['seed']) is int, 'curriculum_replay_policy')
    revoked = policy['revoked_aliases']
    nu.need(type(revoked) is list and all(nu.text(v) and v == v.strip() for v in revoked)
            and len(set(revoked)) == len(revoked), 'revoked_alias_collection')
    nu.need(not any(set(families[r['family_id']]['aliases']).intersection(revoked)
                    for stage in stages for r in stage['train']), 'revoked_training_scenario')
    return spec


class _State:
    """Derived by replaying journal receipts through the same validators."""

    def __init__(self, spec):
        self.spec = spec
        self.updates, self.collections, self.evaluations, self.receipts = [], [], [], []
        self.pending = None

    def lineage(self):
        return nc.checkpoint_lineage(self.spec['root'], self.updates)

    def next_work(self):
        spec, n = self.spec, len(self.updates)
        parent = self.lineage()['nodes'][self.updates[-1]['id'] if n else spec['root']['id']]
        work = {'schema_version': 1, 'curriculum_hash': spec['curriculum_hash'],
                'owner': spec['owner'], 'measurement': spec['measurement'], 'parent': parent}
        observed = {(r['checkpoint'], r['slice']) for r in self.evaluations}
        for stage in spec['stages']:
            if (parent['id'], stage['id']) not in observed:
                return nt.seal({**work, 'operation': 'evaluate', 'slice': stage['id'],
                                'topic': stage['topic'], 'scenarios': stage['evaluate']}, 'work_hash')
        if n == len(spec['stages']):
            return None
        stage = spec['stages'][n]
        work.update(stage_id=stage['id'], topic=stage['topic'])
        if len(self.collections) == n:
            work.update(operation='collect', scenarios=stage['train'], quotas=stage['quotas'],
                        replay_policy=spec['replay_policy'],
                        replay_exports=[c['inputs']['bundle']['export_hash'] for c in self.collections])
        else:
            collection = self.collections[-1]
            work.update(operation='update', **collection)
        return nt.seal(work, 'work_hash')

    def collection(self, work, value):
        nu.need(set(value) == {'bundle', 'splits', 'config', 'signals', 'assignment'}, 'collection_fields')
        bundle, splits, config = value['bundle'], value['splits'], value['config']
        nu.sealed(bundle, 'export_hash')
        nu.need(splits['registry_revision'] == self.spec['registry_revision']
                and splits['families'] == self.spec['families'], 'family_registry_changed')
        nu.validate_splits(bundle, splits)
        nu.validate_config(config)
        owner = self.spec['owner']
        nu.need(config.get('project_selection', 'explicit') == owner['project_selection']
                and config.get('project_id') == owner['project_id'], 'curriculum_account_project_changed')
        nu.need(config['model']['id'] == work['parent']['model']
                and config['model']['revision'] == work['parent']['training_checkpoint'], 'curriculum_wrong_parent')
        stage = self.spec['stages'][len(self.updates)]
        selection = nc.select_replay(bundle, splits, self.lineage(), work['parent']['id'],
                                     value['assignment'], stage['quotas'], **self.spec['replay_policy'])
        selected = {r['capture_hash'] for r in selection['selected']}
        nu.need(set(config['capture_hashes']) == selected, 'update_must_use_exact_replay_selection')
        projection = 'policy_segments' if config['method'] == 'ppo' and 'policy_segments' in bundle else 'sft'
        rows = {r['segment']['capture_hash']: r for r in bundle[projection]}
        previous = {item['record']['segment']['capture_hash']: item['record']
                    for c in self.collections for item in c['plan']['rows']}
        current_refs = {(r['scenario_id'], r['family_id']) for r in stage['train']}
        covered = set()
        for chosen in selection['selected']:
            identity = chosen['capture_hash']
            nu.need(identity in rows, 'replay_projection_mismatch')
            row = rows[identity]
            ref = (row['episode_id'], row['family'])
            fresh = ref in current_refs and row['segment']['actor']['revision'] == work['parent']['sampler_checkpoint']
            historical = identity in previous and previous[identity] == row
            nu.need(fresh or historical, 'capture_outside_curriculum')
            nu.need(chosen['bucket'] != 'recent' or fresh, 'recent_requires_current_stage_and_actor')
            nu.need(chosen['bucket'] != 'reservoir' or historical, 'reservoir_requires_prior_collection')
            if fresh:
                covered.add(ref)
        nu.need(covered == current_refs, 'missing_current_training_scenario')
        # Full existing admission/token/review validation, before any update driver.
        plan = nu.prepare_update(bundle, splits, config, value['signals'])
        return {'inputs': deepcopy(value), 'selection': selection, 'plan': plan}

    def accept(self, receipt):
        work = self.pending
        nu.need(work is not None and type(receipt) is dict
                and set(receipt) == {'work_hash', 'measurement', 'value'}
                and receipt['work_hash'] == work['work_hash'], 'receipt_work_binding')
        nu.need(receipt['measurement'] == self.spec['measurement'], 'measurement_changed')
        value = receipt['value']
        if work['operation'] == 'collect':
            self.collections.append(self.collection(work, value))
        elif work['operation'] == 'update':
            entry = {'id': work['stage_id'], 'parent': work['parent']['id'], 'plan': work['plan'], 'result': value}
            nc.checkpoint_lineage(self.spec['root'], self.updates + [entry])
            nu.need(value.get('project_selection') == self.spec['owner']['project_selection']
                    and value.get('project_id') == self.spec['owner']['project_id'], 'update_account_project_changed')
            self.updates.append(entry)
        else:
            nu.need(type(value) is dict and set(value) == {'score', 'assessment_count', 'assessment_hash'},
                    'evaluation_fields')
            nu.need(type(value['assessment_count']) is int and value['assessment_count'] >= 0
                    and nu.digest(value['assessment_hash']) and (value['score'] is None or
                    (nu.number(value['score'], 0, 1) and value['assessment_count'] > 0)), 'evaluation_evidence')
            self.evaluations.append({**deepcopy(value), 'checkpoint': work['parent']['id'],
                'sampler_checkpoint': work['parent']['sampler_checkpoint'], 'slice': work['slice'],
                'measurement': receipt['measurement']})
        self.receipts.append(deepcopy(receipt))
        self.pending = None

    def inspect(self):
        lineage = self.lineage()
        checkpoints = [self.spec['root']['id']] + [u['id'] for u in self.updates]
        slices = [s['id'] for s in self.spec['stages']]
        rows = {(r['checkpoint'], r['slice']): r['score'] for r in self.evaluations}
        retention = None
        if self.updates:
            schedule = nt.seal({'lineage_hash': lineage['lineage_hash'], 'checkpoints': checkpoints,
                'slices': slices[:len(self.updates)], 'measurement': self.spec['measurement']}, 'schedule_hash')
            retention = nc.retention_report(lineage, schedule,
                [{**r, 'schedule_hash': schedule['schedule_hash']} for r in self.evaluations if r['slice'] in schedule['slices']])
        work = self.pending or self.next_work()
        return {'curriculum_hash': self.spec['curriculum_hash'],
                'status': 'needs_reconcile' if self.pending else 'ready' if work else 'complete',
                'next_work': deepcopy(work), 'acknowledged_updates': len(self.updates),
                'lineage': lineage, 'checkpoints': checkpoints, 'slices': slices,
                'matrix': [[rows.get((c, s)) for s in slices] for c in checkpoints],
                'evaluations': deepcopy(self.evaluations), 'retention': retention, 'dispatches': False}


class Curriculum:
    """One synchronous driver call per step; no driver loading or dispatch in CLI."""

    def __init__(self, journal, spec):
        self.path = Path(journal)
        self.spec = deepcopy(validate_curriculum(spec))

    @contextmanager
    def _locked(self, write=False):
        if not write and not self.path.exists():
            yield None
            return
        flags = os.O_RDWR | os.O_CREAT | os.O_APPEND if write else os.O_RDONLY
        fd = os.open(self.path, flags, 0o600)
        with os.fdopen(fd, 'a+' if write else 'r', encoding='utf-8') as stream:
            try:
                fcntl.flock(stream, (fcntl.LOCK_EX if write else fcntl.LOCK_SH) | fcntl.LOCK_NB)
            except BlockingIOError:
                raise nu.UpdateError('curriculum_busy') from None
            yield stream

    def _load(self, stream):
        state, head = _State(self.spec), None
        if stream is None:
            return state, head
        stream.seek(0)
        content = stream.read()
        nu.need(not content or content.endswith('\n'), 'journal_truncated_needs_reconcile')
        for line in content.splitlines():
            event = json.loads(line)
            nu.sealed(event, 'event_hash')
            nu.need(event['previous_hash'] == head, 'journal_chain_broken')
            kind, value = event['kind'], event['value']
            if head is None:
                nu.need(kind == 'init' and value == self.spec, 'curriculum_changed')
            elif kind == 'dispatch':
                nu.need(state.pending is None and value == state.next_work() and value is not None,
                        'journal_dispatch_order')
                state.pending = value
            else:
                nu.need(kind == 'receipt', 'journal_event_kind')
                state.accept(value)
            head = event['event_hash']
        return state, head

    def _append(self, stream, head, kind, value):
        event = nt.seal({'previous_hash': head, 'kind': kind, 'value': value}, 'event_hash')
        stream.write(nt.native_json(event) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
        # Persist the directory entry too, before a newly created journal permits dispatch.
        fd = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        return event['event_hash']

    def inspect(self):
        with self._locked() as stream:
            state, _ = self._load(stream)
            return state.inspect()

    def step(self, *, collect=None, update=None, evaluate=None):
        """Execute one explicitly injected driver after durable dispatch intent."""
        with self._locked(write=True) as stream:
            state, head = self._load(stream)
            nu.need(state.pending is None, 'needs_reconcile')
            work = state.next_work()
            if work is None:
                return state.inspect()
            driver = {'collect': collect, 'update': update, 'evaluate': evaluate}[work['operation']]
            nu.need(callable(driver), 'missing_' + work['operation'] + '_driver')
            if head is None:
                head = self._append(stream, head, 'init', self.spec)
            head = self._append(stream, head, 'dispatch', work)
            state.pending = work
            try:
                receipt = driver(deepcopy(work))
            except Exception:
                raise nu.UpdateError('driver_failed_needs_reconcile') from None
            state.accept(receipt)
            self._append(stream, head, 'receipt', receipt)
            return state.inspect()

    def reconcile(self, receipt):
        """Record recovered evidence for the pending operation, without dispatch."""
        with self._locked(write=True) as stream:
            state, head = self._load(stream)
            if receipt in state.receipts:
                return state.inspect()  # identical completion replay is a no-op
            nu.need(state.pending is not None, 'no_pending_work')
            state.accept(deepcopy(receipt))
            self._append(stream, head, 'receipt', receipt)
            return state.inspect()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('curriculum', type=Path, help='sealed native-curriculum/v1 JSON')
    parser.add_argument('--journal', type=Path, required=True, help='existing or future JSONL path; never created by CLI')
    args = parser.parse_args(argv)
    try:
        result = Curriculum(args.journal, nt.load_json(args.curriculum)).inspect()
    except (ValueError, KeyError, TypeError, OSError):
        parser.exit(2, 'Invalid curriculum or journal; inspect inputs and reconcile externally. No dispatch.\n')
    print(json.dumps(result, indent=2, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
