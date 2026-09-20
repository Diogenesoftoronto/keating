# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["torch==2.8.0+cpu", "transformers==5.3.0", "numpy==2.2.6"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Declare frozen-observer sweeps; execute explicit local residual interventions.

prepare is pure and imports no tensor runtime. execute uses cached weights only.
No providers, downloads, policy updates, dynamic code loading or behavioral judge.
"""
import argparse
from copy import deepcopy
import hashlib
import json
import math
import os
from pathlib import Path
import re
from types import SimpleNamespace

import observer_core as core
import observer_extract as extract

POOLINGS = ('mean_of_unique_selected_tokens', 'last_selected_token', 'per_span_mean')
CONTROLS = ('feature', 'opposite', 'random', 'unrelated')
PARTITIONS = ('train', 'calibration', 'test')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identity(value, length=64):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{' + str(length) + '}', value) is not None


def text(value):
    return isinstance(value, str) and bool(value.strip())


def declaration(config, records, concept_card, split_manifest):
    """Validate domain contracts and construct the exact forward-trial matrix."""
    require(config.get('schema_version') == 1 and type(config['schema_version']) is int, 'Unsupported experiment schema')
    mode = config.get('mode', 'intervention')
    require(mode in ('readout', 'intervention'), 'Explicit readout or intervention mode required')
    observer = config['observer']
    require(observer['model'] == extract.MODEL and observer['sae_model'] == extract.DICTIONARY,
            'Only the matching Qwen observer/dictionary pair is supported')
    for key in ('model_revision', 'tokenizer_revision', 'sae_revision'):
        require(identity(observer[key], 40), 'Immutable observer/tokenizer/SAE revisions required')
    require(observer['device'] in ('cpu', 'cuda') and observer['dtype'] in ('float32', 'bfloat16'), 'Unsupported local runtime')
    require(type(observer['max_tokens']) is int and 1 <= observer['max_tokens'] <= 32768, 'Bounded untruncated token limit required')
    require('allow_download' not in observer and 'trust_remote_code' not in observer, 'Download/remote-code options are not accepted')
    layers = observer['layers']
    require(isinstance(layers, list) and 1 <= len(layers) <= 32, 'Declare one to 32 exact layers')
    require(len({l['layer'] for l in layers}) == len(layers), 'Duplicate layer')
    for layer in layers:
        n = layer['layer']
        require(type(n) is int and 0 <= n < 32 and layer['module'] == f'language_model.layers.{n}', 'Exact residual block/layer required')
        require(identity(layer['sae_sha256']), 'Layer-specific SAE file SHA256 required')
        if mode == 'intervention':
            for key in ('feature', 'unrelated_feature'):
                require(type(layer[key]) is int and 0 <= layer[key] < 65536, 'Feature outside declared dictionary')
            require(layer['feature'] != layer['unrelated_feature'], 'Unrelated control must be a different reviewed feature')
    poolings, epsilons, seeds = config['poolings'], config.get('epsilons', [0]), config['seeds']
    require(isinstance(poolings, list) and poolings and len(set(poolings)) == len(poolings)
            and set(poolings) <= set(POOLINGS), 'Explicit unique supported pooling rules required')
    if mode == 'intervention':
        require(isinstance(epsilons, list) and 3 <= len(epsilons) <= 11 and all(type(e) in (int, float)
                and math.isfinite(e) and abs(e) <= 1 for e in epsilons), 'Finite bounded epsilon sweep required')
        require(len(set(epsilons)) == len(epsilons) and 0 in epsilons and set(epsilons) == {-e for e in epsilons}, 'Sweep must include zero and paired positive/negative epsilon')
    else:
        require(core.canonical(epsilons) == '[0]', 'Readout mode has no nonzero interventions')
    require(isinstance(seeds, list) and 1 <= len(seeds) <= 16 and len(set(seeds)) == len(seeds)
            and all(type(s) is int and 0 <= s < 2**31 for s in seeds), 'Unique bounded deterministic seeds required')
    if mode == 'intervention':
        require(type(config.get('calibration_seed')) is int and 0 <= config['calibration_seed'] < 2**31, 'Explicit calibration seed required')
    require(split_manifest.get('schema_version') == 1 and identity(split_manifest['source_manifest_sha256']), 'Pinned source split manifest required')
    groups = {}
    for family, item in split_manifest['families'].items():
        require(text(family) and item['split'] in PARTITIONS and isinstance(item['group_ids'], list), 'Invalid family split')
        for group in ['family:' + family, *item['group_ids']]:
            require(text(group), 'Nonempty connected-group identity required')
            require(group not in groups or groups[group] == item['split'], 'Connected source families cross partitions')
            groups[group] = item['split']
    require(concept_card.get('schema_version') == 1 and text(concept_card.get('target'))
            and text(concept_card.get('definition')), 'Operational concept card required')
    review = concept_card['source_review']
    require(review.get('status') == 'approved' and text(review.get('reviewer')) and text(review.get('review_id'))
            and identity(review.get('evidence_sha256'))
            and review.get('source_manifest_sha256') == split_manifest['source_manifest_sha256'], 'Source-reviewed concept card must bind this source manifest')
    require(concept_card.get('boundary') in core.PHASES, 'Concept requires a temporal boundary')
    binding = {k: observer[k] for k in ('model', 'model_revision', 'tokenizer_revision', 'sae_model', 'sae_revision')}
    binding['layer_sha256'] = {str(l['layer']): l['sae_sha256'] for l in layers}
    require(core.canonical(concept_card.get('observer_binding')) == core.canonical(binding), 'Reviewed feature basis must match observer/SAE pins')
    for layer in layers:
        if mode == 'readout':
            continue
        feature = concept_card['feature_reviews'][str(layer['layer'])]
        require(feature['feature'] == layer['feature'] and feature['unrelated_feature'] == layer['unrelated_feature']
                and identity(feature.get('evidence_sha256')) and text(feature.get('unrelated_rationale'))
                and feature.get('selection_split') == 'train', 'Selected and unrelated directions require matching train-only review evidence')
    require(records and len(records) <= 256 and len({r['record_id'] for r in records}) == len(records), 'Nonempty unique bounded records required')
    for record in records:
        require(record['boundary'] == concept_card['boundary'], 'Record/concept boundary mismatch')
        require(isinstance(record.get('group_ids'), list), 'Explicit source group identities required (empty if unknown)')
        core.boundary_view(record)
        family = split_manifest['families'].get(record['family_id'])
        require(family is not None and record.get('split') == family['split']
                and sorted(record.get('group_ids', [])) == sorted(family['group_ids']), 'Record must match its exact admitted family split')
    by_id = {r['record_id']: r for r in records}
    calibration, evaluation = config.get('calibration_record_ids', []), config['evaluation_record_ids']
    require(evaluation and len(set(calibration)) == len(calibration)
            and len(set(evaluation)) == len(evaluation) and not set(calibration).intersection(evaluation)
            and set(calibration + evaluation) == set(by_id), 'Declare disjoint calibration and evaluation records covering input')
    if mode == 'intervention':
        require(calibration and all(by_id[i]['split'] == 'calibration' for i in calibration), 'Residual scale uses calibration records only')
        require(all(by_id[i]['split'] in ('train', 'test') for i in evaluation), 'Evaluation cannot reuse residual-scale calibration records')
    else:
        require(not calibration, 'Readout mode does not estimate an intervention scale; include all partitions as evaluation records')
    trials = []
    for layer in layers:
        for record_id in evaluation:
            for seed in seeds:
                conditions = [('baseline', 0)] + [(c, e) for c in CONTROLS for e in epsilons if e != 0]
                for control, epsilon in conditions:
                    trial = {'layer': layer['layer'], 'record_id': record_id, 'seed': seed,
                             'control': control, 'epsilon': epsilon, 'poolings': poolings}
                    trials.append({'trial_id': core.digest(trial), **trial})
    require(len(trials) <= 4096, 'Serial experiment exceeds 4096 declared forward trials')
    return trials


def prepare(config, records, concept_card, split_manifest):
    """Pure preparation: no torch, files, providers or model loading."""
    trials = declaration(config, records, concept_card, split_manifest)
    public, source_hashes = [], {}
    for record in records:
        view = core.boundary_view(record)
        safe = {k: deepcopy(record[k]) for k in ('record_id', 'family_id', 'boundary', 'latest_allowed_event_id', 'spans', 'split', 'group_ids')}
        safe['events'] = [{k: deepcopy(event[k]) for k in ('event_id', 'phase', 'visibility', 'kind', 'text', 'receipt_id') if k in event}
                          for event in record['events'] if event['event_id'] in view['included_event_ids']]
        public.append(safe)
        source_hashes[record['record_id']] = core.digest(record)
    plan = {'schema_version': 1, 'kind': 'observer_experiment_declaration',
            'config': deepcopy(config), 'records': public, 'source_record_sha256': source_hashes,
            'concept_card': deepcopy(concept_card), 'concept_card_sha256': core.digest(concept_card),
            'split_manifest': deepcopy(split_manifest), 'split_manifest_sha256': core.digest(split_manifest),
            'trials': trials, 'trial_count': len(trials),
            'claims': {'readout_quality': None, 'causal_behavior_effect': None, 'human_learning': None}}
    plan['plan_sha256'] = core.digest(plan)
    return plan


def validate_plan(plan):
    unsigned = deepcopy(plan)
    claimed = unsigned.pop('plan_sha256', None)
    require(identity(claimed) and core.digest(unsigned) == claimed, 'Experiment plan hash mismatch')
    require(plan['kind'] == 'observer_experiment_declaration' and plan['schema_version'] == 1, 'Invalid experiment plan')
    require(plan['concept_card_sha256'] == core.digest(plan['concept_card'])
            and plan['split_manifest_sha256'] == core.digest(plan['split_manifest']), 'Concept/split binding mismatch')
    require(set(plan['source_record_sha256']) == {r['record_id'] for r in plan['records']}
            and all(identity(h) for h in plan['source_record_sha256'].values()), 'Source record hash bindings required')
    trials = declaration(plan['config'], plan['records'], plan['concept_card'], plan['split_manifest'])
    require(core.canonical(trials) == core.canonical(plan['trials']) and plan['trial_count'] == len(trials), 'Declared trial matrix mismatch')
    return plan


def tensor_hash(value):
    import torch
    data = value.detach().cpu().contiguous()
    return {'shape': list(data.shape), 'dtype': str(data.dtype),
            'sha256': hashlib.sha256(data.view(torch.uint8).numpy().tobytes()).hexdigest()}


def tokenize_record(model, tokenizer, record, max_tokens):
    view = core.boundary_view(record)
    encoded = tokenizer(view['text'], return_tensors='pt', return_offsets_mapping=True,
                        add_special_tokens=False, truncation=False)
    offsets = encoded.pop('offset_mapping')[0].tolist()
    require(encoded['input_ids'].shape[0] == 1 and len(offsets) <= max_tokens, 'One untruncated bounded record per trial')
    require('attention_mask' in encoded, 'Attention mask required')
    selected = core.token_spans(view['text'], offsets, view['spans'], encoded['attention_mask'][0].tolist())
    device = next(model.parameters()).device
    return {k: v.to(device) for k, v in encoded.items()}, view, offsets, selected


def forward_intervention(model, block, batch, direction, *, epsilon, scale, token_mask, seed):
    """Actually patch one post-block invocation; preserve batch, flags and RNG.

This executes the model forward. Downstream tensors are measurements, not
generated learner behavior or independent outcome scores.
"""
    import torch
    require(any(m is block for m in model.modules()), 'Block must belong to model')
    require(type(seed) is int and 0 <= seed < 2**31, 'Valid actual forward seed required')
    require(token_mask.dtype == torch.bool and bool(token_mask.any()), 'Nonempty boolean intervention mask required')
    require(tuple(token_mask.shape) == tuple(batch['input_ids'].shape), 'Mask/input batch shape mismatch')
    require('attention_mask' in batch and not bool((token_mask.to(batch['attention_mask'].device)
            & ~batch['attention_mask'].bool()).any()), 'Intervention cannot target padding')
    before, after = [], []
    flags = [(m, m.training) for m in model.modules()]
    def capture_before(_module, _args, output):
        before.append(core.residual_tensor(output).detach().to('cpu', copy=True))
    def capture_after(_module, _args, output):
        after.append(core.residual_tensor(output).detach().to('cpu', copy=True))
    devices = list(range(torch.cuda.device_count())) if torch.cuda.is_available() else []
    first = block.register_forward_hook(capture_before)
    last = None
    try:
        model.eval()
        with torch.random.fork_rng(devices=devices), torch.inference_mode():
            torch.manual_seed(seed)
            with core.intervene(block, direction, epsilon=epsilon, scale=scale, token_mask=token_mask):
                last = block.register_forward_hook(capture_after)
                output = model(**{**batch, 'use_cache': False})
        require(len(before) == len(after) == 1, 'Expected one post-block invocation; generation loops are a separate executor')
        downstream = output if isinstance(output, torch.Tensor) else (output[0] if isinstance(output, tuple) and output else
                     output.get('last_hidden_state') if isinstance(output, dict) else getattr(output, 'last_hidden_state', None))
        summary = tensor_hash(downstream) if isinstance(downstream, torch.Tensor) else None
        return before[0], after[0], summary
    finally:
        first.remove()
        if last is not None:
            last.remove()
        for module, flag in flags:
            module.training = flag


def pool_measurements(residual, selected, offsets, view, attention, state, spec, poolings):
    require(tuple(residual.shape[:2]) == (1, len(offsets)) and residual.shape[-1] == spec.hidden,
            'Residual/tokenizer/SAE dimensions disagree')
    tokens = residual[0, selected].float()
    indices, values = core.encode_topk(tokens, state, spec)
    positions = {token: index for index, token in enumerate(selected)}
    result = []
    for pooling in poolings:
        selections = ([selected] if pooling == 'mean_of_unique_selected_tokens' else
                      [[selected[-1]]] if pooling == 'last_selected_token' else
                      [core.token_spans(view['text'], offsets, [s], attention) for s in view['spans']])
        for span_index, selection in enumerate(selections):
            positions_here = [positions[t] for t in selection]
            pooled = {}
            for pos in positions_here:
                for idx, val in zip(indices[pos].tolist(), values[pos].tolist()):
                    pooled[str(idx)] = pooled.get(str(idx), 0.0) + val / len(selection)
            result.append({'pooling': pooling, 'span_index': span_index if pooling == 'per_span_mean' else None,
                           'token_indices': selection, 'raw': tokens[positions_here].mean(dim=0).tolist(), 'sae': pooled})
    return result


def validate_loaded(manifest, observer, layer, spec, injected):
    expected = {'observer_model': observer['model'], 'observer_revision': observer['model_revision'],
                'tokenizer_revision': observer['tokenizer_revision'], 'sae_model': observer['sae_model'],
                'sae_revision': observer['sae_revision'], 'sae_sha256': layer['sae_sha256'],
                'layer': layer['layer'], 'module': layer['module'], 'hook': 'residual_post_block',
                'dtype': observer['dtype'], 'device': observer['device'],
                'dimensions': {'hidden': spec.hidden, 'width': spec.width, 'top_k': spec.top_k}}
    require(all(manifest.get(k) == v for k, v in expected.items()), 'Loaded observer does not match declared trial')
    if not injected:
        require(manifest.get('evidence') == 'model_extraction', 'Real extraction manifest required')
        for key in ('model_files_sha256', 'tokenizer_files_sha256'):
            require(manifest.get(key) and all(identity(h) for h in manifest[key].values()), 'Actual local weight/tokenizer hashes required')


def execute(plan, *, loader=None, spec=core.SAESpec()):
    """Serial local execution; injected loader is a Python test seam, never a CLI import path."""
    validate_plan(plan)  # No runtime import or load before validation.
    import torch
    injected = loader is not None
    loader = loader or extract.load_observer
    config = plan['config']; observer = config['observer']
    mode = config.get('mode', 'intervention')
    records = {r['record_id']: r for r in plan['records']}
    rows, calibrations, manifests = [], [], []
    for layer in observer['layers']:
        args = SimpleNamespace(**{k: observer[k] for k in ('model_revision', 'tokenizer_revision', 'sae_revision', 'dtype', 'device', 'max_tokens')},
                               layer=layer['layer'], module=layer['module'], sae_sha256=layer['sae_sha256'], allow_download=False)
        model, tokenizer, block, state, manifest = loader(args)
        validate_loaded(manifest, observer, layer, spec, injected)
        core.validate_sae(state, spec)
        if mode == 'intervention':
            require(layer['feature'] < spec.width and layer['unrelated_feature'] < spec.width, 'Feature outside actual loaded dictionary')
        calibration_vectors, provenance = [], []
        for record_id in config.get('calibration_record_ids', []):
            batch, view, offsets, selected = tokenize_record(model, tokenizer, records[record_id], observer['max_tokens'])
            devices = list(range(torch.cuda.device_count())) if torch.cuda.is_available() else []
            with torch.random.fork_rng(devices=devices):
                torch.manual_seed(config['calibration_seed'])
                h = core.capture_residual(model, block, batch)
            require(tuple(h.shape) == (1, len(offsets), spec.hidden), 'Calibration residual dimensions disagree')
            calibration_vectors.append(h[0, selected].float())
            provenance.append({'record_id': record_id, 'split': 'calibration', 'view_sha256': core.digest(view),
                               'selected_token_indices': selected, 'input_token_ids': batch['input_ids'][0].tolist(),
                               'residual': tensor_hash(h[0, selected])})
        scale, calibration = None, None
        if mode == 'intervention':
            scale = core.residual_scale(torch.cat(calibration_vectors))
            calibration = {'layer': layer['layer'], 'scale': scale, 'seed': config['calibration_seed'],
                           'rule': 'median_selected_calibration_vector_l2_norm',
                           'records': provenance, 'observer_manifest_sha256': core.digest(manifest)}
            calibrations.append(calibration)
            del h
        manifests.append(manifest)
        del calibration_vectors
        for trial in (t for t in plan['trials'] if t['layer'] == layer['layer']):
            record = records[trial['record_id']]
            batch, view, offsets, selected = tokenize_record(model, tokenizer, record, observer['max_tokens'])
            if mode == 'intervention':
                directions = core.intervention_directions(state, layer['feature'], spec, seed=trial['seed'])
                directions['unrelated'] = core.intervention_directions(state, layer['unrelated_feature'], spec, seed=trial['seed'])['feature']
                direction = directions['feature' if trial['control'] == 'baseline' else trial['control']]
                direction_record = {**tensor_hash(direction), 'unit_vector': direction.tolist(),
                    'feature': layer['unrelated_feature'] if trial['control'] == 'unrelated' else
                               None if trial['control'] == 'random' else layer['feature']}
            else:
                # Zero-epsilon forward capture; no feature direction or
                # calibrated scale is claimed in readout results.
                direction, direction_record = torch.ones(spec.hidden), None
            mask = torch.zeros_like(batch['input_ids'], dtype=torch.bool); mask[0, selected] = True
            before, after, downstream = forward_intervention(model, block, batch, direction, epsilon=trial['epsilon'],
                                                             scale=scale if scale is not None else 1., token_mask=mask, seed=trial['seed'])
            delta = (after.float() - before.float()).norm(dim=-1); cpu_mask = mask.cpu()
            actual = delta[cpu_mask]
            rows.append({**trial, 'family_id': record['family_id'], 'group_ids': record['group_ids'], 'split': record['split'],
                'boundary': record['boundary'], 'source_record_sha256': plan['source_record_sha256'][record['record_id']],
                'view_sha256': core.digest(view), 'latest_allowed_event_id': view['latest_allowed_event_id'],
                'spans': view['spans'], 'input_token_ids': batch['input_ids'][0].tolist(),
                'selected_token_indices': selected, 'selected_offsets': [offsets[t] for t in selected],
                'direction': direction_record,
                'scale': scale, 'calibration_sha256': core.digest(calibration) if calibration else None,
                'requested_delta_norm': abs(trial['epsilon']) * scale if scale is not None else 0.,
                'actual_selected_delta_norm': {'min': actual.min().item(), 'max': actual.max().item(), 'mean': actual.mean().item()},
                'unselected_delta_norm_max': delta[~cpu_mask].max().item() if (~cpu_mask).any() else 0.0,
                'residual_before': tensor_hash(before), 'residual_after': tensor_hash(after),
                'downstream_tensor': downstream, 'observer_manifest_sha256': core.digest(manifest),
                'settings': {'seed': trial['seed'], 'use_cache': False, 'model_mode': 'eval',
                             'deterministic_algorithms': torch.are_deterministic_algorithms_enabled()},
                'measurements': pool_measurements(after, selected, offsets, view, batch['attention_mask'][0].tolist(), state, spec, trial['poolings']),
                'independent_behavior_review': {'status': 'unknown', 'outcome': None, 'review_id': None},
                'readout_quality': None, 'causal_behavior_effect': None})
        del model, tokenizer, block, state
    result = {'schema_version': 1, 'evidence': 'injected_local_runtime_not_published_model' if injected else 'local_pinned_model_forward_experiment',
              'plan_sha256': plan['plan_sha256'], 'concept_card_sha256': plan['concept_card_sha256'],
              'split_manifest_sha256': plan['split_manifest_sha256'], 'observer_manifests': manifests,
              'measurement_contract': {'mode': mode, 'poolings': config['poolings'], 'hook': 'residual_post_block'},
              'calibrations': calibrations, 'rows': rows, 'completed_trials': len(rows),
              'implementation_files_sha256': {p.name: extract.file_hash(p) for p in
                   (Path(__file__), Path(core.__file__), Path(extract.__file__))},
              'limitations': ['Forward tensor measurements do not establish a causal behavioral or human learning effect.',
                              'No text generation, independent behavioral review, probe fitting or provider execution is performed.',
                              'Declared seeds do not guarantee bitwise reproducibility across hardware/software.']}
    result['result_sha256'] = core.digest(result)
    return result


def output_path(value):
    root = Path(__file__).resolve().parents[2]
    path = Path(value).resolve()
    require(any(path.is_relative_to(root / r) for r in ('.keating/outputs', '.keating/native-learning')), 'Output must be explicitly inside an ignored research directory')
    if path.exists():
        raise FileExistsError(path)
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'execute'))
    parser.add_argument('input', type=Path, help='Declaration bundle or sealed prepared plan')
    parser.add_argument('output', type=Path, help='New ignored JSON output')
    args = parser.parse_args(argv)
    path = output_path(args.output)  # Refuse overwrite before loading any weights.
    data = json.loads(args.input.read_text())
    result = prepare(data['config'], data['records'], data['concept_card'], data['split_manifest']) if args.command == 'prepare' else execute(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(core.canonical(result) + '\n')
    print(core.canonical({'output': str(path), 'sha256': result.get('plan_sha256', result.get('result_sha256'))}))


if __name__ == '__main__':
    main()
