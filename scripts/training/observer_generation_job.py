"""Sealed generation worker over an unchanged readout job; no controller/provider imports.

Only explicit bootstrap/materialize commands may fetch the base job's pinned
assets. Execution is offline, full-backbone, no-cache greedy generation.
"""
import argparse
from copy import deepcopy
import hashlib
import io
import json
import math
import os
from pathlib import Path
import tarfile
import time

import observer_core as core
import observer_experiment_job as base
import observer_generation as generation

SOURCE_NAMES = (*base.SOURCE_NAMES, 'observer_generation.py', 'observer_generation_job.py')
IMAGE_PROOF = base.IMAGE_PROOF
OVERLAY_LOCK = base.OVERLAY_LOCK
ARTIFACTS = base.ARTIFACTS
MAX_INPUT, MAX_FILE, MAX_ARCHIVE = base.MAX_INPUT, base.MAX_FILE, base.MAX_ARCHIVE
require, seal, check_seal = base.require, base.seal, base.check_seal
CONDITIONS = ('baseline', 'selected_positive', 'selected_negative', 'random', 'unrelated')
SPEC_KEYS = {'schema_version', 'layer', 'selected_feature', 'unrelated_feature', 'selected_review',
             'unrelated_review', 'control_semantic_status', 'selected_semantic_status', 'epsilon', 'seed', 'max_new_tokens', 'calibration_record_ids', 'generation_record_ids'}
MIRRORS = ('experiment', 'join_sha256', 'source_plan_sha256', 'inventory', 'limits', 'dependency_profile', 'software')
JOB_KEYS = {'schema_version', 'kind', 'mode', 'base_job', 'generation_spec', 'source_files_sha256',
            'forward_passes', 'job_sha256', *MIRRORS}


def exact(value, keys, name):
    require(isinstance(value, dict) and set(value) == set(keys), 'Exact ' + name + ' schema required')


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def finite(value, low=0, high=float('inf')):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


def check_join(job, join):
    check_seal(join, 'join_sha256')
    require(join['join_sha256'] == job['join_sha256'] and join['source_plan_sha256'] == job['source_plan_sha256']
            and join['uploaded_plan_sha256'] == job['experiment']['plan_sha256'], 'Join/source binding mismatch')


def prompt_view(record):
    """Only a contiguous public learner pre-action prefix, never any actor gold.

    Deliberately reject multi-turn/mixed-role sources instead of guessing which
    assistant text is history versus the withheld completion.
    """
    core.boundary_view(record)
    prefix = []
    for event in record['events']:
        if event['phase'] != 'pre_action':
            break
        require(event['visibility'] == 'public' and event['kind'] == 'learner_message',
                'Generation requires only public learner messages in its pre-action prefix')
        prefix.append(event)
    require(prefix, 'Missing learner generation prefix')
    text = ''.join('[learner_message]\n' + e['text'] + '\n' for e in prefix) + '[actor_message]\n'
    return {'text': text, 'included_event_ids': [e['event_id'] for e in prefix], 'text_sha256': hashlib.sha256(text.encode()).hexdigest()}


def validate_spec(base_job, spec):
    exact(spec, SPEC_KEYS, 'generation_spec')
    require(type(spec['schema_version']) is int and spec['schema_version'] == 1
            and type(spec['layer']) is int and spec['layer'] == 12
            and type(spec['selected_feature']) is int and spec['selected_feature'] == 31497,
            'Generation candidate is fixed to layer 12 decoder column 31497')
    require(integer(spec['unrelated_feature'], 0, 65535) and spec['unrelated_feature'] != 31497, 'Distinct unrelated column required')
    require(finite(spec['epsilon'], 0, 1) and spec['epsilon'] > 0 and integer(spec['seed'], 0, 2**31-1)
            and integer(spec['max_new_tokens'], 1, 512), 'Invalid epsilon/seed/new-token bound')
    for key in ('selected_review', 'unrelated_review'):
        review = spec[key]
        exact(review, {'status', 'review_id', 'reviewer', 'evidence_sha256'}, key)
        require(review['status'] in ('approved', 'reviewed') and base.experiment.identity(review['evidence_sha256'])
                and all(isinstance(review[k], str) and 0 < len(review[k].strip()) <= 256 for k in ('review_id', 'reviewer')),
                'Approved review reference required')
    require(spec['selected_review']['review_id'] != spec['unrelated_review']['review_id'], 'Distinct direction review references required')
    require(spec['control_semantic_status'] == 'unverified_low_association_comparator'
            and spec['selected_semantic_status'] == 'candidate_from_probe', 'Only exploratory candidate/comparator semantics are supported')
    records = {r['record_id']: r for r in base_job['experiment']['records']}
    roles = []
    for key, split in (('calibration_record_ids', 'calibration'), ('generation_record_ids', 'test')):
        ids = spec[key]
        require(isinstance(ids, list) and 1 <= len(ids) <= 32 and all(isinstance(i, str) and i in records for i in ids)
                and len(set(ids)) == len(ids), 'Bounded unique uploaded record IDs required')
        rows = [records[i] for i in ids]
        require(all(r['split'] == split for r in rows), 'Calibration/test record role mismatch')
        roles.append(({r['family_id'] for r in rows}, {g for r in rows for g in r['group_ids']}))
        if split == 'test':
            for row in rows: prompt_view(row)
    require(not (set(spec['calibration_record_ids']) & set(spec['generation_record_ids']))
            and not roles[0][0] & roles[1][0] and not roles[0][1] & roles[1][1], 'Calibration/generation family/group overlap')
    require(len(roles[0][0] | roles[1][0]) <= 32, 'At most 32 source families per generation job')
    return len(spec['calibration_record_ids']) + len(spec['generation_record_ids']) * 5 * spec['max_new_tokens']


def prepare_job(base_job, base_join, generation_spec):
    base.validate_job(base_job, check_code=True)
    require('dependency_profile' in base_job, 'Pinned dependency overlay required')
    check_join(base_job, base_join)
    spec = deepcopy(generation_spec)
    job = {'schema_version': 1, 'kind': 'observer_generation_job', 'mode': 'generation',
           'base_job': deepcopy(base_job), 'generation_spec': spec,
           **{k: deepcopy(base_job[k]) for k in MIRRORS},
           'forward_passes': validate_spec(base_job, spec),
           'source_files_sha256': {n: base.extract.file_hash(Path(__file__).with_name(n)) for n in SOURCE_NAMES}}
    seal(job, 'job_sha256'); validate_job(job, check_code=True)
    return job, deepcopy(base_join)


def validate_job(job, *, check_code=False):
    exact(job, JOB_KEYS, 'generation job'); check_seal(job, 'job_sha256')
    b = job['base_job']; base.validate_job(b, check_code=check_code)
    require(type(job['schema_version']) is int and job['schema_version'] == 1
            and job['kind'] == 'observer_generation_job' and job['mode'] == 'generation'
            and b['mode'] == 'readout' and 'dependency_profile' in b, 'Unchanged readout overlay base job required')
    require(all(job[k] == b[k] for k in MIRRORS), 'Mirrored base fields changed')
    layers = b['experiment']['config']['observer']['layers']
    require(len(layers) == 1 and layers[0]['layer'] == 12 and layers[0]['module'] == 'language_model.layers.12', 'Exactly layer 12 required')
    require(integer(job['forward_passes'], 1, job['limits']['max_forward_passes'])
            and job['forward_passes'] == validate_spec(b, job['generation_spec']), 'Aggregate forward cap includes calibration and all five controls')
    pins = job['source_files_sha256']
    require(isinstance(pins, dict) and set(pins) == set(SOURCE_NAMES)
            and all(base.experiment.identity(v) for v in pins.values())
            and all(pins[n] == b['source_files_sha256'][n] for n in base.SOURCE_NAMES), 'Exact extended source pins required')
    if check_code:
        require(pins == {n: base.extract.file_hash(Path(__file__).with_name(n)) for n in SOURCE_NAMES}, 'Generation worker source changed')
    require(len(core.canonical(job).encode()) <= MAX_INPUT, 'Sealed generation input exceeds 2 MiB')


def bootstrap_overlay(job, output_dir, *, remaining_seconds=300):
    validate_job(job, check_code=True)
    return base.bootstrap_overlay(job['base_job'], output_dir, remaining_seconds=remaining_seconds)


def materialize(job, cache_dir, runtime, *, allow_download=False, fetcher=None):
    validate_job(job, check_code=True)
    return base.materialize(job['base_job'], cache_dir, runtime, allow_download=allow_download, fetcher=fetcher)


def cached_tokenizer(job, materialization, cache_dir):
    validate_job(job)
    return base.cached_tokenizer(job['base_job'], materialization, cache_dir)


def views(job):
    records = {r['record_id']: r for r in job['experiment']['records']}
    spec = job['generation_spec']
    return [(rid, 'calibration', core.boundary_view(records[rid])) for rid in spec['calibration_record_ids']] + [
        (rid, 'generation', prompt_view(records[rid])) for rid in spec['generation_record_ids']]


def workload(job, rows):
    expected = views(job); spec = job['generation_spec']; limits = job['limits']
    require(isinstance(rows, list) and len(rows) == len(expected), 'Preflight record count mismatch')
    tokens = 0; estimate = 1024**2; n = spec['max_new_tokens']
    for row, (rid, role, view) in zip(rows, expected):
        exact(row, {'record_id', 'role', 'view_sha256', 'input_token_ids', 'attention_mask', 'offsets', 'selected_token_indices'}, 'preflight row')
        ids, mask, offsets = row['input_token_ids'], row['attention_mask'], row['offsets']
        require(row['record_id'] == rid and row['role'] == role and row['view_sha256'] == core.digest(view), 'Preflight role/source/prefix mismatch')
        require(isinstance(ids, list) and 1 <= len(ids) <= limits['max_tokens']
                and all(integer(t, 0, 2**31-1) for t in ids) and mask == [1]*len(ids)
                and all(type(t) is int for t in mask) and len(offsets) == len(ids), 'Invalid unpadded token/attention bounds')
        require(all(isinstance(o, list) and len(o) == 2 and all(type(t) is int for t in o)
                    and 0 <= o[0] <= o[1] <= len(view['text']) for o in offsets), 'Invalid exact tokenizer offsets')
        selected = core.token_spans(view['text'], offsets, view['spans'], mask) if role == 'calibration' else []
        require(row['selected_token_indices'] == selected, 'Selected calibration tokens changed')
        if role == 'calibration': tokens += len(ids)
        else:
            require(len(ids) + n <= limits['max_tokens'], 'Prefix plus all new tokens exceeds context; no truncation')
            tokens += 5 * (n*len(ids) + n*(n-1)//2)
            estimate += 5 * (n*2048 + len(ids)*128 + 4096*32) + 65536
        estimate += len(core.canonical(row).encode()) * 2
    require(tokens <= limits['max_forward_tokens'], 'Aggregate full-prefix forward-token cap exceeded')
    require(estimate <= limits['max_result_bytes'], 'Conservative generation result allowance exceeds cap')
    return {'forward_passes': job['forward_passes'], 'forward_tokens': tokens, 'estimated_result_bytes_upper': estimate}


def preflight(job, tokenizer):
    validate_job(job); rows = []
    for rid, role, view in views(job):
        enc = tokenizer(view['text'], return_offsets_mapping=True, add_special_tokens=False, truncation=False)
        ids, mask = enc['input_ids'], enc['attention_mask']
        offsets = [list(o) for o in enc['offset_mapping']]
        rows.append({'record_id': rid, 'role': role, 'view_sha256': core.digest(view), 'input_token_ids': ids,
                     'attention_mask': mask, 'offsets': offsets,
                     'selected_token_indices': core.token_spans(view['text'], offsets, view['spans'], mask) if role == 'calibration' else []})
    eos, pad = tokenizer.eos_token_id, tokenizer.pad_token_id
    require(eos is None or integer(eos, 0, 2**31-1), 'Single EOS or no EOS required')
    pad = pad if pad is not None else eos
    require(integer(pad, 0, 2**31-1), 'Pinned tokenizer needs a pad or EOS token ID')
    return seal({'schema_version': 1, 'job_sha256': job['job_sha256'], 'records': rows,
                 'pad_token_id': pad, 'eos_token_id': eos, **workload(job, rows)}, 'preflight_sha256')


def validate_preflight(job, report):
    validate_job(job)
    exact(report, {'schema_version', 'job_sha256', 'records', 'pad_token_id', 'eos_token_id', 'forward_passes',
                   'forward_tokens', 'estimated_result_bytes_upper', 'preflight_sha256'}, 'preflight')
    check_seal(report, 'preflight_sha256')
    require(report['schema_version'] == 1 and report['job_sha256'] == job['job_sha256']
            and integer(report['pad_token_id'], 0, 2**31-1)
            and (report['eos_token_id'] is None or integer(report['eos_token_id'], 0, 2**31-1)), 'Preflight identity/tokenizer mismatch')
    require(all(type(report[k]) is int and report[k] == v for k, v in workload(job, report['records']).items()), 'Preflight workload mismatch')


def verified_paths(job, materialization, cache_dir):
    """Rehash every cached asset BEFORE any model/head deserialization."""
    from huggingface_hub import hf_hub_download, constants
    b = job['base_job']; base.validate_materialization(b, materialization)
    cache = Path(cache_dir).resolve()
    require(Path(constants.HF_HUB_CACHE).resolve() == cache, 'Set HF_HUB_CACHE before importing Hub')
    paths = {}; actual = []
    for asset in b['inventory']['assets']:
        # Hub snapshots link to blobs; retain the verified target for strict artifact readers.
        path = Path(hf_hub_download(asset['repo'], asset['filename'], revision=asset['revision'], cache_dir=str(cache), local_files_only=True, token=False)).resolve()
        require(path.is_relative_to(cache), 'Asset escaped pinned cache')
        actual.append(base.verify_asset(path, asset)); paths[base.asset_key(asset)] = path
    require(actual == materialization['assets'], 'Cache differs from materialization')
    return paths


def verify_loaded_files(job, manifest, materialization):
    obs = job['experiment']['config']['observer']; layer = obs['layers'][0]
    base.experiment.validate_loaded(manifest, obs, layer, core.SAESpec(), False)
    assets = {base.asset_key(a): a for a in materialization['assets']}
    def hashes(role, predicate=lambda _n: True):
        return {a['filename']: assets[base.asset_key(a)]['sha256'] for a in job['inventory']['assets']
                if role in a['roles'] and predicate(a['filename'])}
    require(manifest['model_files_sha256'] == hashes('model', lambda n: n.endswith('.safetensors'))
            and manifest['tokenizer_files_sha256'] == hashes('tokenizer')
            and manifest['config_sha256'] == hashes('model')['config.json'], 'Loaded full-shard/config/tokenizer pins changed')
    require(manifest['implementation_files_sha256'] == {n: job['source_files_sha256'][n] for n in ('observer_core.py', 'observer_extract.py', 'observer_models.py')}, 'Loaded implementation pins changed')


def load_head(job, model, manifest, paths):
    """Load the actual uninitialized-by-AutoModel checkpoint head, never nn.Linear."""
    import torch
    from safetensors import safe_open
    obs = job['experiment']['config']['observer']; found = []; shards = {}
    config = getattr(model.config, 'text_config', model.config)
    require(config.model_type == 'qwen3_5_text' and config.hidden_size == 4096 and config.vocab_size > 0, 'Unsupported output-head architecture')
    for key in ('logit_scale', 'logits_scaling', 'final_logit_softcapping'):
        require(getattr(config, key, None) in (None, 1, False), 'Unsupported checkpoint logit transform')
    for asset in job['inventory']['assets']:
        if 'model' not in asset['roles'] or not asset['filename'].endswith('.safetensors'): continue
        require(asset['repo'] == obs['model'] and asset['revision'] == obs['model_revision'], 'Head must use same checkpoint')
        path = paths[base.asset_key(asset)]; evidence = base.verify_asset(path, asset)
        require(evidence['sha256'] == manifest['model_files_sha256'].get(asset['filename']), 'Head full-shard pin mismatch')
        shards[asset['filename']] = evidence['sha256']
        with safe_open(path, framework='pt', device='cpu') as f:
            keys = f.keys(); require('lm_head.bias' not in keys, 'Biased head unsupported')
            if 'lm_head.weight' in keys:
                found.append((asset, f.get_tensor('lm_head.weight')))
    require(shards == manifest['model_files_sha256'] and len(found) == 1, 'Exactly one verified full-checkpoint lm_head.weight required')
    asset, weight = found[0]
    require(tuple(weight.shape) == (config.vocab_size, config.hidden_size) and weight.is_floating_point()
            and bool(torch.isfinite(weight).all()), 'Corrupt lm_head shape/dtype/values')
    for asset_index in job['inventory']['assets']:
        if 'model' in asset_index['roles'] and asset_index['filename'] == 'model.safetensors.index.json':
            index = json.loads(base.regular_bytes(paths[base.asset_key(asset_index)], MAX_FILE-1))
            require(index['weight_map'].get('lm_head.weight') == asset['filename'], 'Head shard/index mismatch')
    param = next(model.parameters())
    weight = weight.to(device=param.device, dtype=param.dtype).detach()
    return weight, {'tensor': 'lm_head.weight', 'filename': asset['filename'], 'shard_sha256': shards[asset['filename']],
                    'model_files_sha256': shards, 'shape': list(weight.shape), 'dtype': str(weight.dtype),
                    'projection': 'F.linear(final_last_hidden_state, lm_head.weight); no bias; no cache'}


def last_token_logits(model, weight, **inputs):
    import torch
    require(set(inputs) == {'input_ids', 'attention_mask', 'position_ids', 'use_cache'} and inputs['use_cache'] is False,
            'Only causal prefix inputs; no labels or cache')
    output = model(**inputs, return_dict=True)
    hidden = getattr(output, 'last_hidden_state', None)
    require(isinstance(hidden, torch.Tensor) and hidden.ndim == 3 and hidden.shape[:2] == inputs['input_ids'].shape
            and hidden.shape[-1] == weight.shape[1] and bool(torch.isfinite(hidden[:, -1, :]).all()), 'Full backbone final hidden state required')
    return torch.nn.functional.linear(hidden[:, -1, :], weight)


class ForwardMeter:
    """Count attempts before calling the backbone, including failed forwards."""
    def __init__(self, job, flight, runtime):
        self.job, self.flight, self.runtime = job, flight, runtime
        self.passes = self.tokens = 0

    def before(self, _model, _args, kwargs):
        base.check_runtime(self.job, self.runtime)
        ids = kwargs['input_ids']
        require(kwargs.get('use_cache') is False and ids.ndim == 2 and ids.shape[0] == 1, 'Single-record no-cache forwards only')
        require(self.passes + 1 <= self.flight['forward_passes'] and self.tokens + ids.numel() <= self.flight['forward_tokens'], 'Actual forward budget exhausted')
        self.passes += 1; self.tokens += ids.numel()

    def usage(self):
        return {'forward_passes': self.passes, 'forward_tokens': self.tokens}


def stream_execute(job, flight, materialization, paths, runtime, result, append, checkpoint):
    import torch
    spec = job['generation_spec']; obs = job['experiment']['config']['observer']
    model, tokenizer, block, state, manifest = base.load_layer_reusing_model(job['base_job'], obs['layers'][0])
    verify_loaded_files(job, manifest, materialization)
    require(preflight(job, tokenizer) == flight, 'Loaded tokenizer changed; no forward permitted')
    head, head_proof = load_head(job, model, manifest, paths)
    result.update(observer_manifest=manifest, head=head_proof)
    selected = state['W_dec'][:, spec['selected_feature']].detach().float().cpu()
    unrelated = state['W_dec'][:, spec['unrelated_feature']].detach().float().cpu()
    # Validate before calibration or any generation forward.
    selected, unrelated = generation._unit(selected), generation._unit(unrelated)
    require(not torch.allclose(selected, unrelated) and not torch.allclose(selected, -unrelated), 'Unrelated decoder direction duplicates candidate')
    result['directions'] = {'selected': selected.tolist(), 'unrelated': unrelated.tolist(),
                            'selected_feature': spec['selected_feature'], 'unrelated_feature': spec['unrelated_feature'],
                            'random': generation._unit(torch.randn(selected.numel(), generator=torch.Generator(device='cpu').manual_seed(spec['seed']))).tolist()}
    device = next(model.parameters()).device
    meter = ForwardMeter(job, flight, runtime); handle = model.register_forward_pre_hook(meter.before, with_kwargs=True)
    try:
        for row in flight['records']:
            if row['role'] != 'calibration': continue
            ids = torch.tensor([row['input_token_ids']], dtype=torch.long, device=device)
            batch = {'input_ids': ids, 'attention_mask': torch.ones_like(ids)}
            residual = core.capture_residual(model, block, batch)
            norms = residual[0, row['selected_token_indices']].float().norm(dim=-1).tolist()
            require(norms and all(finite(n, 0) for n in norms), 'Invalid selected-token calibration norms')
            result['calibrations'].append({'record_id': row['record_id'], 'selected_token_indices': row['selected_token_indices'], 'norms': norms})
            del residual
            result['usage'] = meter.usage(); checkpoint()
        norms = sorted(n for c in result['calibrations'] for n in c['norms'])
        scale = norms[(len(norms)-1)//2]
        require(finite(scale) and scale > 0, 'Positive actual calibration median required')
        result['scale'] = scale; checkpoint()
        for row in flight['records']:
            if row['role'] != 'generation': continue
            ids = torch.tensor([row['input_token_ids']], dtype=torch.long, device=device)
            config = generation.GenerationConfig(max_new_tokens=spec['max_new_tokens'], max_context_tokens=job['limits']['max_tokens'],
                max_forward_passes=5*spec['max_new_tokens'], max_forward_tokens=job['limits']['max_forward_tokens'],
                pad_token_id=flight['pad_token_id'], eos_token_id=flight['eos_token_id'], seed=spec['seed'], overflow='reject')
            controls = generation.generate_controls(model, block, {'input_ids': ids, 'attention_mask': torch.ones_like(ids)}, config=config,
                selected_direction=selected, unrelated_direction=unrelated, unrelated_review=core.digest(spec['unrelated_review']),
                epsilon=spec['epsilon'], scale=scale, random_seed=spec['seed'],
                forward=lambda m, **kw: last_token_logits(m, head, **kw))
            # Token evidence is primary; text is deliberately not decoded/imported as an authoritative outcome.
            append({'trial_id': row['record_id'], 'record_id': row['record_id'], 'controls': controls})
    finally:
        handle.remove(); result['usage'] = meter.usage(); checkpoint()


def equivalent(actual, expected):
    return (isinstance(actual, list) and len(actual) == len(expected)
            and all(finite(a, -1, 1) and abs(a-b) <= 1e-6 for a,b in zip(actual, expected))
            and abs(sum(a*a for a in actual)-1) < 1e-5)


def calibration_context(job, result):
    return seal({'schema_version': 1, 'job_sha256': job['job_sha256'], 'fit_eligible': False,
                 'calibrations': deepcopy(result['calibrations']), 'scale': result.get('scale'),
                 'usage': deepcopy(result['usage'])}, 'context_sha256')


def join_result(job, join, result):
    check_join(job, join); check_seal(result, 'result_sha256')
    require(result['job_sha256'] == job['job_sha256'], 'Generation local join job mismatch')
    return seal({'schema_version': 1, 'kind': 'observer_generation_local_join',
        'job_sha256': job['job_sha256'], 'join_sha256': join['join_sha256'],
        'source_plan_sha256': job['source_plan_sha256'], 'remote_result_sha256': result['result_sha256'],
        'rows': [{'generation_record_id': row['record_id'], 'remote_row_sha256': core.digest(row),
                  'local': deepcopy(join['records'][row['record_id']])} for row in result['rows']]}, 'local_joined_sha256')


def validate_result(job, result, flight, materialization, *, partial=False):
    required = {'schema_version', 'evidence', 'job_sha256', 'plan_sha256', 'implementation_files_sha256',
                'fit_eligible', 'behavior_evaluated', 'control_semantic_status', 'selected_semantic_status',
                'comparator_interpretation', 'calibrations', 'rows', 'completed_trials', 'usage', 'result_sha256'}
    optional = {'observer_manifest', 'head', 'directions', 'scale'}
    require(isinstance(result, dict) and required <= set(result) <= required | optional, 'Exact generation result schema required')
    check_seal(result, 'result_sha256')
    require(result['job_sha256'] == job['job_sha256'] and result['plan_sha256'] == job['experiment']['plan_sha256']
            and result['implementation_files_sha256'] == job['source_files_sha256'] and result['fit_eligible'] is False
            and result['behavior_evaluated'] is False
            and result['control_semantic_status'] == 'unverified_low_association_comparator'
            and result['selected_semantic_status'] == 'candidate_from_probe'
            and result['comparator_interpretation'] == 'unrelated is a helper identifier for a low-association SAE comparator, not semantic independence', 'Generation result provenance/claim mismatch')
    require(result['evidence'] == ('incomplete_local_pinned_generation' if partial else 'local_pinned_generation'), 'Result completion evidence mismatch')
    rows = result['rows']; spec = job['generation_spec']
    expected = spec['generation_record_ids']
    require(isinstance(rows, list) and [r['record_id'] for r in rows] == expected[:len(rows)]
            and len(rows) <= len(expected) and (partial or len(rows) == len(expected))
            and type(result['completed_trials']) is int and result['completed_trials'] == len(rows), 'Result frozen order/count mismatch')
    if flight is None:
        require(partial and not rows and not result['calibrations'] and result['usage'] == {'forward_passes': 0, 'forward_tokens': 0}, 'No preflight means no forward evidence')
        return
    validate_preflight(job, flight)
    usage = result['usage']
    exact(usage, {'forward_passes', 'forward_tokens'}, 'usage')
    require(integer(usage['forward_passes'], 0, flight['forward_passes']) and integer(usage['forward_tokens'], 0, flight['forward_tokens']), 'Result forward cap exceeded')
    by_id = {r['record_id']: r for r in flight['records']}
    calibrations = result['calibrations']
    require([c['record_id'] for c in calibrations] == spec['calibration_record_ids'][:len(calibrations)]
            and len(calibrations) <= len(spec['calibration_record_ids']), 'Calibration order/role mismatch')
    cal_passes = len(calibrations); cal_tokens = 0; norms = []
    for c in calibrations:
        exact(c, {'record_id', 'selected_token_indices', 'norms'}, 'calibration')
        source = by_id[c['record_id']]
        require(c['selected_token_indices'] == source['selected_token_indices'] and isinstance(c['norms'], list)
                and len(c['norms']) == len(source['selected_token_indices']) and all(finite(n) for n in c['norms']), 'Calibration norm/span mismatch')
        norms.extend(c['norms']); cal_tokens += len(source['input_token_ids'])
    if rows or not partial:
        require(cal_passes == len(spec['calibration_record_ids']) and norms, 'Actual calibration required before generation')
        require(result['scale'] == sorted(norms)[(len(norms)-1)//2] and result['scale'] > 0, 'Calibration scale is not measured median')
    if result.get('observer_manifest') is not None:
        verify_loaded_files(job, result['observer_manifest'], materialization)
        head = result['head']; manifest = result['observer_manifest']
        require(head['tensor'] == 'lm_head.weight' and head['model_files_sha256'] == manifest['model_files_sha256']
                and head['shard_sha256'] == manifest['model_files_sha256'].get(head['filename'])
                and len(head['shape']) == 2 and integer(head['shape'][0], 1, 2**31-1) and head['shape'][1] == 4096
                and head['dtype'] == 'torch.bfloat16'
                and head['projection'] == 'F.linear(final_last_hidden_state, lm_head.weight); no bias; no cache', 'Head/checkpoint evidence mismatch')
    if rows or cal_passes:
        require(result.get('observer_manifest') is not None and result.get('head') is not None, 'Verified backbone and head required')
    directions = result.get('directions')
    if directions is not None:
        exact(directions, {'selected', 'unrelated', 'random', 'selected_feature', 'unrelated_feature'}, 'direction evidence')
        require(directions['selected_feature'] == spec['selected_feature'] and directions['unrelated_feature'] == spec['unrelated_feature'], 'Direction feature mismatch')
        for key in ('selected', 'unrelated', 'random'):
            vector = directions[key]
            require(isinstance(vector, list) and len(vector) == 4096 and all(finite(v, -1, 1) for v in vector)
                    and abs(sum(v*v for v in vector)-1) < 1e-5, 'Direction must be finite unit decoder-width vector')
        require(not equivalent(directions['selected'], directions['unrelated'])
                and not equivalent([-v for v in directions['selected']], directions['unrelated']), 'Comparator direction duplicates candidate')
    if rows or cal_passes: require(directions is not None, 'Missing direction evidence')
    total_passes, total_tokens = cal_passes, cal_tokens
    for row in rows:
        exact(row, {'trial_id', 'record_id', 'controls'}, 'result row')
        require(row['trial_id'] == row['record_id'], 'Trial ID mismatch')
        controls = row['controls']
        exact(controls, {'schema_version','evidence','random_seed','unrelated_review','norm_rule','upper_bound','usage','conditions','behavior_evaluated'}, 'controls')
        require(controls['schema_version'] == 1 and controls['norm_rule'] == 'unit_direction_times_epsilon_times_fixed_calibration_scale', 'Control norm rule changed')
        prompt = by_id[row['record_id']]['input_token_ids']
        require(controls['evidence'] == 'controlled_local_autoregressive_tokens' and set(controls['conditions']) == set(CONDITIONS)
                and controls['random_seed'] == spec['seed'] and controls['unrelated_review'] == core.digest(spec['unrelated_review'])
                and controls['behavior_evaluated'] is False, 'Control review/seed/evidence mismatch')
        n = spec['max_new_tokens']; bound = {'forward_passes': n, 'forward_tokens': n*len(prompt)+n*(n-1)//2}
        require(controls['upper_bound'] == {k: 5*v for k,v in bound.items()}, 'Aggregate upper bound changed')
        passes = tokens = 0
        for name in CONDITIONS:
            item = controls['conditions'][name]
            exact(item, {'schema_version','evidence','decoding','intervention_scope','intervention_timing','config','epsilon','scale','direction',
                         'input_ids','attention_mask','rows','usage','steps','upper_bound','behavior_evaluated'}, 'condition')
            require(item['schema_version'] == 1 and item['upper_bound'] == bound
                    and item['intervention_scope'] == 'last_active_token_each_forward'
                    and item['intervention_timing'] == 'post_block_before_next_token_logits; prior_history_recomputed_without_patch', 'Intervention scope/timing/bounds changed')
            expected_direction = {'baseline': None, 'selected_positive': directions['selected'],
                'selected_negative': [-v for v in directions['selected']], 'random': directions['random'], 'unrelated': directions['unrelated']}[name]
            require((item['direction'] is None if expected_direction is None else equivalent(item['direction'], expected_direction)), 'Control direction changed')
            config = item['config']
            require(config == {'max_new_tokens': spec['max_new_tokens'], 'max_context_tokens': job['limits']['max_tokens'],
                'max_forward_passes': 5*spec['max_new_tokens'], 'max_forward_tokens': job['limits']['max_forward_tokens'],
                'pad_token_id': flight['pad_token_id'], 'eos_token_id': flight['eos_token_id'], 'seed': spec['seed'], 'overflow': 'reject'}, 'Generation config changed')
            require(item['input_ids'] == [prompt] and item['attention_mask'] == [[1]*len(prompt)] and len(item['rows']) == 1
                    and item['epsilon'] == (0 if name == 'baseline' else spec['epsilon']) and item['scale'] == result['scale']
                    and item['decoding'] == 'greedy_no_cache' and item['evidence'] == 'local_autoregressive_tokens'
                    and item['behavior_evaluated'] is False, 'Generation prompt/intervention mismatch')
            out = item['rows'][0]
            exact(out, {'prompt_ids','used_prompt_ids','dropped_prompt_ids','generated_ids','sequence_ids','stop_reason'}, 'generated sequence')
            generated = out['generated_ids']; count = len(generated)
            require(1 <= count <= spec['max_new_tokens'] and all(integer(t, 0, result['head']['shape'][0]-1) for t in generated)
                    and out['prompt_ids'] == prompt and out['used_prompt_ids'] == prompt and out['dropped_prompt_ids'] == []
                    and out['sequence_ids'] == prompt+generated, 'Generated token sequence mismatch')
            eos = flight['eos_token_id']
            require((out['stop_reason'] == 'eos' and eos is not None and generated[-1] == eos and eos not in generated[:-1])
                or (out['stop_reason'] == 'max_new_tokens' and count == spec['max_new_tokens'] and eos not in generated), 'Stop/EOS mismatch')
            require(len(item['steps']) == count, 'Step count mismatch')
            for i, step in enumerate(item['steps']):
                pos = len(prompt)+i-1
                require(step == {'step': i, 'batch_width': pos+1, 'prefix_lengths': [pos+1], 'decision_positions': [pos],
                    'intervention_positions': [None if name == 'baseline' else pos], 'emitted_ids': [generated[i]]}, 'Generation frontier trace mismatch')
            actual = {'forward_passes': count, 'forward_tokens': count*len(prompt)+count*(count-1)//2}
            require(item['usage'] == actual, 'Control forward usage mismatch')
            passes += count; tokens += actual['forward_tokens']
        require(controls['usage'] == {'forward_passes': passes, 'forward_tokens': tokens}, 'Aggregate control accounting mismatch')
        total_passes += passes; total_tokens += tokens
    require(total_passes <= usage['forward_passes'] and total_tokens <= usage['forward_tokens'], 'Attempt accounting omits committed forwards')
    if not partial: require(usage == {'forward_passes': total_passes, 'forward_tokens': total_tokens}, 'Complete forward accounting mismatch')


def execute_job(job, materialization, cache_dir, output_dir, runtime, *, environment=None, expected_preflight=None):
    validate_job(job, check_code=True)
    out = Path(output_dir); out.mkdir(parents=True, mode=0o700, exist_ok=False)
    result = {'schema_version': 1, 'evidence': 'local_pinned_generation', 'job_sha256': job['job_sha256'],
        'plan_sha256': job['experiment']['plan_sha256'], 'implementation_files_sha256': job['source_files_sha256'],
        'fit_eligible': False, 'behavior_evaluated': False, 'control_semantic_status': 'unverified_low_association_comparator', 'selected_semantic_status': 'candidate_from_probe',
        'comparator_interpretation': 'unrelated is a helper identifier for a low-association SAE comparator, not semantic independence',
        'calibrations': [], 'rows': [], 'completed_trials': 0,
        'usage': {'forward_passes': 0, 'forward_tokens': 0}}
    error, code, flight = None, 0, None
    def progress(stage):
        base.write_bounded(out/'progress.json', {'schema_version': 1, 'job_sha256': job['job_sha256'],
            'stage': stage, 'completed_trials': len(result['rows']), 'planned_trials': len(job['generation_spec']['generation_record_ids']),
            'fit_eligible': False, 'updated_at': time.time()}, MAX_INPUT, replace=True)
    def checkpoint():
        base.write_bounded(out/'context.json', calibration_context(job, result), job['limits']['max_result_bytes'], replace=True)
    def append(row):
        result['rows'].append(row); result['completed_trials'] = len(result['rows'])
        # Atomic bounded checkpoint of the committed prefix, with no partially written JSON line.
        body = ''.join(core.canonical(r)+'\n' for r in result['rows']).encode()
        require(len(body) <= job['limits']['max_result_bytes'], 'Generation journal byte cap exceeded')
        temp = out/'trials.jsonl.tmp'
        with temp.open('xb') as stream:
            os.chmod(temp, 0o600); stream.write(body); stream.flush(); os.fsync(stream.fileno())
        os.replace(temp, out/'trials.jsonl'); progress('generation_record_complete')
    base.write_bounded(out/'materialization.json', materialization)
    if environment is not None: base.write_bounded(out/'environment.json', environment, MAX_INPUT)
    with (out/'trials.jsonl').open('xb') as stream: os.chmod(stream.name, 0o600)
    try:
        progress('admission')
        base.validate_materialization(job['base_job'], materialization)
        require(environment is not None and expected_preflight is not None, 'Overlay environment and expected preflight required')
        base.check_overlay_process(job['base_job'], environment); validate_preflight(job, expected_preflight)
        seconds = base.check_runtime(job, runtime)
        with base.deadline_guard(max(.001, seconds-10)):
            progress('tokenizer_preflight')
            flight = preflight(job, cached_tokenizer(job, materialization, cache_dir))
            require(flight == expected_preflight, 'Remote tokenizer preflight differs; no model forward permitted')
            base.write_bounded(out/'preflight.json', flight)
            paths = verified_paths(job, materialization, cache_dir)
            progress('loading_and_calibrating')
            stream_execute(job, flight, materialization, paths, runtime, result, append, checkpoint)
            seal(result, 'result_sha256'); validate_result(job, result, flight, materialization)
            base.write_bounded(out/'results.json', result, job['limits']['max_result_bytes'])
    except (Exception, KeyboardInterrupt) as failure:
        error = type(failure).__name__ + ': ' + str(failure)[:1000]
        code = 124 if isinstance(failure, TimeoutError) else 1
    if code:
        result.pop('result_sha256', None); result['evidence'] = 'incomplete_local_pinned_generation'
        # Only the durable committed prefix is eligible for diagnostic import.
        result['rows'] = [json.loads(line) for line in (out/'trials.jsonl').read_bytes().splitlines()]
        result['completed_trials'] = len(result['rows']); seal(result, 'result_sha256')
        partial = seal({'schema_version': 1, 'job_sha256': job['job_sha256'], 'fit_eligible': False, 'error': error,
            'result_header': {k:v for k,v in result.items() if k != 'rows'},
            'rows_sha256': base.extract.file_hash(out/'trials.jsonl')}, 'partial_sha256')
        base.write_bounded(out/'partial.json', partial, job['limits']['max_result_bytes'])
    progress('incomplete' if code else 'complete')
    log = ((error or 'Completed bounded generation; behavior and learning outcomes not evaluated.')+'\n').encode()
    require(len(log) <= job['limits']['max_log_bytes'], 'Log exceeds declared cap')
    with (out/'experiment.log').open('xb') as stream: os.chmod(stream.name, 0o600); stream.write(log)
    names = {'materialization.json','progress.json','experiment.log'}
    if environment is not None: names.add('environment.json')
    if (out/'context.json').exists(): names.add('context.json')
    if (out/'preflight.json').exists(): names.add('preflight.json')
    names |= {'partial.json','trials.jsonl'} if code else {'results.json'}
    receipt = {'schema_version': 1, 'evidence': 'local_worker_process_not_pod_receipt', 'job_sha256': job['job_sha256'],
        'exit_code': code, 'complete': code == 0, 'fit_eligible': False, 'completed_trials': result['completed_trials'],
        'files': {n:base.extract.file_hash(out/n) for n in sorted(names)}}
    base.write_bounded(out/'receipt.json', receipt, MAX_INPUT)
    return receipt


def import_outputs(job, join, body):
    validate_job(job); check_join(job, join)
    require(isinstance(body, bytes) and len(body) <= MAX_ARCHIVE, 'Archive exceeds bound')
    files = {}; total = 0
    with tarfile.open(fileobj=io.BytesIO(body), mode='r:') as archive:
        for member in archive:
            require(member.name in ARTIFACTS and member.name not in files and member.isfile()
                    and 0 <= member.size < MAX_FILE, 'Unsafe/duplicate archive member')
            total += member.size; require(total <= MAX_ARCHIVE, 'Expanded archive cap exceeded')
            files[member.name] = archive.extractfile(member).read()
    require('receipt.json' in files and len(files['receipt.json']) <= MAX_INPUT, 'Missing bounded receipt')
    receipt = json.loads(files['receipt.json']); complete = receipt['exit_code'] == 0
    require(type(receipt['exit_code']) is int and receipt['job_sha256'] == job['job_sha256']
            and receipt['schema_version'] == 1 and receipt['evidence'] == 'local_worker_process_not_pod_receipt'
            and receipt['complete'] is complete and receipt['fit_eligible'] is False
            and integer(receipt['completed_trials'], 0, len(job['generation_spec']['generation_record_ids']))
            and receipt['files'] == {n:hashlib.sha256(b).hexdigest() for n,b in files.items() if n != 'receipt.json'}, 'Receipt identity/hash/claims mismatch')
    require('experiment.log' in files and len(files['experiment.log']) <= job['limits']['max_log_bytes'], 'Missing/oversized log')
    environment_files = {'environment.json'} if 'environment.json' in files else set()
    if environment_files: base.validate_environment(job['base_job'], json.loads(files['environment.json']))
    if 'materialization.json' not in files:
        require(not complete and set(files) == {'receipt.json','experiment.log'} | environment_files
                and receipt['completed_trials'] == 0 and receipt.get('transport_exit_code') == receipt['exit_code']
                and receipt.get('transport_failure_stage') in ('bootstrap','materialization'), 'Unbound pre-model diagnostic')
        return {'complete': False, 'fit_eligible': False, 'diagnostic_only': True, 'validated_completed_trials': 0,
                'local_join': None, 'result': None, 'archive_sha256': hashlib.sha256(body).hexdigest(), 'diagnostic': {**receipt, 'failure_stage': receipt['transport_failure_stage']}}
    mat = json.loads(files['materialization.json']); base.validate_materialization(job['base_job'], mat)
    require(environment_files, 'Overlay proof required')
    progress = json.loads(files['progress.json'])
    require(progress['job_sha256'] == job['job_sha256'] and progress['completed_trials'] == receipt['completed_trials'], 'Progress count mismatch')
    flight = json.loads(files['preflight.json']) if 'preflight.json' in files else None
    common = {'receipt.json','experiment.log','materialization.json','environment.json','progress.json'}
    if 'context.json' in files: common.add('context.json')
    if complete:
        require(flight is not None and set(files) == common | {'results.json','preflight.json'}, 'Complete file set mismatch')
        require(len(files['results.json']) <= job['limits']['max_result_bytes'], 'Result byte cap exceeded')
        result = json.loads(files['results.json'])
    else:
        require(set(files) == common | {'partial.json','trials.jsonl'} | ({'preflight.json'} if flight else set()), 'Partial file set mismatch')
        require(len(files['trials.jsonl']) + len(files['partial.json']) <= job['limits']['max_result_bytes'], 'Partial byte cap exceeded')
        partial = json.loads(files['partial.json']); check_seal(partial, 'partial_sha256')
        require(partial['job_sha256'] == job['job_sha256'] and partial['fit_eligible'] is False
                and partial['rows_sha256'] == hashlib.sha256(files['trials.jsonl']).hexdigest(), 'Partial hash/provenance mismatch')
        result = dict(partial['result_header']); result['rows'] = [json.loads(line) for line in files['trials.jsonl'].splitlines()]
    validate_result(job, result, flight, mat, partial=not complete)
    require(result['completed_trials'] == receipt['completed_trials'], 'Receipt/result count mismatch')
    if result['calibrations'] or result['rows']:
        require('context.json' in files and json.loads(files['context.json']) == calibration_context(job, result), 'Durable calibration context differs from result')
    return {'complete': complete, 'fit_eligible': False, 'validated_completed_trials': len(result['rows']),
            'result': result, 'local_join': join_result(job, join, result), 'archive_sha256': hashlib.sha256(body).hexdigest()}


archive_outputs = base.archive_outputs


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__); commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('bootstrap-overlay'); p.add_argument('job', type=Path); p.add_argument('output', type=Path)
    p.add_argument('--remaining-seconds', required=True, type=float)
    p = commands.add_parser('preflight'); p.add_argument('job', type=Path); p.add_argument('output', type=Path); p.add_argument('--cache-dir', required=True, type=Path)
    for name in ('materialize','execute'):
        p = commands.add_parser(name); p.add_argument('job', type=Path)
        if name == 'execute': p.add_argument('materialization', type=Path)
        p.add_argument('output', type=Path); p.add_argument('--cache-dir', required=True, type=Path); p.add_argument('--environment', type=Path, required=True)
        if name == 'execute': p.add_argument('--expected-preflight', type=Path, required=True)
        for key in ('creation-started-at','rate-observed-at','observed-gpu-hourly-rate'): p.add_argument('--'+key, type=float, required=True)
        if name == 'materialize': p.add_argument('--allow-download', action='store_true')
    args = parser.parse_args(argv)
    read = lambda p: json.loads(base.regular_bytes(p, MAX_FILE-1))
    job = read(args.job); validate_job(job, check_code=True)
    output = base.experiment.output_path(args.output)
    if args.command == 'bootstrap-overlay':
        bootstrap_overlay(job, output, remaining_seconds=args.remaining_seconds); return 0
    os.environ['HF_HUB_CACHE'] = str(args.cache_dir.resolve()); os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
    if args.command != 'materialize':
        os.environ['HF_HUB_OFFLINE'] = '1'; os.environ['TRANSFORMERS_OFFLINE'] = '1'
    if args.command == 'preflight': value = preflight(job, cached_tokenizer(job, None, args.cache_dir))
    else:
        env = read(args.environment); base.check_overlay_process(job['base_job'], env)
        runtime = {k:getattr(args,k) for k in ('creation_started_at','rate_observed_at','observed_gpu_hourly_rate')}
        if args.command == 'execute':
            return execute_job(job, read(args.materialization), args.cache_dir, output, runtime,
                environment=env, expected_preflight=read(args.expected_preflight))['exit_code']
        value = materialize(job, args.cache_dir, runtime, allow_download=args.allow_download)
    output.parent.mkdir(parents=True, exist_ok=True); base.write_bounded(output, value)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
