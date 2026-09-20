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
"""Authored transport fixtures and real CPU mechanics; no Hub weights or provider."""
from copy import deepcopy
from contextlib import contextmanager
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

import observer_core as core
import observer_experiment as exp
import observer_experiment_job as worker
from test_observer_experiment import bundle


class Tokens:
    def __call__(self, text, **kwargs):
        assert kwargs['truncation'] is False and kwargs['add_special_tokens'] is False
        return {'input_ids': [ord(c) for c in text], 'offset_mapping': [(i, i+1) for i in range(len(text))], 'attention_mask': [1]*len(text)}


def fixture(mode='readout', layers=(12,)):
    config, records, card, splits = bundle(layers=layers)
    config['observer'].update(device='cuda', dtype='bfloat16')
    config['poolings'] = [exp.POOLINGS[0]]
    if mode == 'readout':
        config.update(mode='readout', epsilons=[0], calibration_record_ids=[], evaluation_record_ids=[r['record_id'] for r in records])
    bodies = {'config.json': b'{}', 'tokenizer.json': b'{"authored":true}', 'tokenizer_config.json': b'{}',
              'model.safetensors': b'AUTHORED NOT WEIGHTS'}
    bodies.update({f'layer{n}.sae.pt': f'AUTHORED SAE {n}'.encode() for n in layers})
    for layer in config['observer']['layers']:
        h = hashlib.sha256(bodies[f'layer{layer["layer"]}.sae.pt']).hexdigest()
        layer['sae_sha256'] = h; card['observer_binding']['layer_sha256'][str(layer['layer'])] = h
    plan = exp.prepare(config, records, card, splits)
    docs = {}
    for key, roles in worker.repository_roles(plan).items():
        siblings = []
        for name, body in bodies.items():
            if ('sae' in roles) != name.endswith('.sae.pt'): continue
            item = {'rfilename': name, 'size': len(body), 'blobId': hashlib.sha1(f'blob {len(body)}\0'.encode()+body).hexdigest()}
            if name.endswith(('.sae.pt', '.safetensors')):
                item['lfs'] = {'sha256': hashlib.sha256(body).hexdigest(), 'size': len(body)}
            siblings.append(item)
        docs[key] = {'id': key[0], 'sha': key[1], 'siblings': siblings}
    inventory = worker.inventory_from_metadata(plan, docs)
    limits = {'max_tokens': 512, 'max_forward_passes': 4096, 'max_forward_tokens': 4096*512,
        'max_asset_bytes': 60*1024**3, 'max_result_bytes': worker.MAX_FILE-1, 'max_log_bytes': 1024**2,
        'cost_cap_usd': '1.50', 'hour_cap': '.75', 'hourly_cap_usd': '1.20'}
    job, join = worker.prepare_job(plan, inventory, limits, records)
    return job, join, plan, inventory, limits, records, docs, bodies


@contextmanager
def authored_overlay():
    """Synthetic metadata only. Production pins are patched solely in this test context."""
    proofs = {n: '{}\n' for n in worker.IMAGE_PROOF}
    pins = {n: hashlib.sha256(b.encode()).hexdigest() for n, b in proofs.items()}
    lock = worker.seal({'wheels': [{'name': f'fixture{i}', 'version': '1.0',
        'filename': f'fixture{i}-1.0-py3-none-any.whl',
        'url': f'https://files.pythonhosted.org/packages/fixture{i}-1.0-py3-none-any.whl',
        'bytes': 1, 'sha256': 'a'*64} for i in range(27)],
        'wheel_count': 27, 'total_wheel_bytes': 40871731}, 'manifest_sha256')
    profile = worker.seal({'schema_version': 1, 'kind': 'image-python312-overlay-v1',
        'lock': lock, 'image_proof': proofs}, 'profile_sha256')
    with patch.object(worker, 'OVERLAY_LOCK', lock['manifest_sha256']), patch.object(worker, 'IMAGE_PROOF', pins):
        yield profile


def image_runtime(prefix=None):
    return {'python': [3, 12, 11], 'machine': 'x86_64', 'torch': '2.8.0+cu128', 'cuda': '12.8',
        'executable': str(Path(prefix)/'bin/python') if prefix else worker.IMAGE_PYTHON,
        'prefix': str(prefix) if prefix else '/usr', 'base_prefix': '/usr',
        'torch_file': '/usr/local/lib/python3.12/dist-packages/torch/__init__.py',
        'cuda_available': True, 'bf16_supported': True, 'bf16_matmul': True,
        'device': 'AUTHORED GPU PROBE FIXTURE', 'capability': [8, 9]}


def environment_fixture(job, prefix='/authored/runtime-env'):
    profile = job['dependency_profile']; lock = profile['lock']
    return worker.seal({'schema_version': 1, 'evidence': 'actual_image_overlay_runtime',
        'job_sha256': job['job_sha256'], 'profile_sha256': profile['profile_sha256'],
        'overlay_lock_sha256': worker.OVERLAY_LOCK, 'image_proof_sha256': worker.IMAGE_PROOF,
        'installer_sha256': job['source_files_sha256']['observer_experiment_job.py'],
        'base': image_runtime(), 'runtime': image_runtime(prefix),
        'packages': {w['name']: {'version': w['version'], 'path': prefix+'/lib/python3.12/site-packages'} for w in lock['wheels']},
        'verified_wheels': {w['filename']: w['sha256'] for w in lock['wheels']},
        'transferred_bytes_including_retries': 40871731, 'elapsed_seconds': 10}, 'environment_sha256')


def materialization(job, bodies):
    assets = [{k: a[k] for k in ('repo', 'revision', 'filename', 'size')} |
        {'sha256': hashlib.sha256(bodies[a['filename']]).hexdigest(),
         'git_blob_sha1': hashlib.sha1(f'blob {a["size"]}\0'.encode()+bodies[a['filename']]).hexdigest()} for a in job['inventory']['assets']]
    return worker.seal({'schema_version': 1, 'job_sha256': job['job_sha256'], 'inventory_sha256': job['inventory']['inventory_sha256'],
        'assets': assets, 'total_bytes': sum(a['size'] for a in assets), 'missing_before_materialization': []}, 'materialization_sha256')


def result_fixture(job, flight, mat):
    """Large-dimension authored protocol record; never executed/published weights."""
    plan = job['experiment']; obs = plan['config']['observer']; config = plan['config']
    manifests = []
    assets = {worker.asset_key(a): a for a in mat['assets']}
    for layer in obs['layers']:
        m = {'evidence': 'model_extraction', 'observer_model': obs['model'], 'observer_revision': obs['model_revision'],
            'tokenizer_revision': obs['tokenizer_revision'], 'sae_model': obs['sae_model'], 'sae_revision': obs['sae_revision'],
            'sae_sha256': layer['sae_sha256'], 'layer': layer['layer'], 'module': layer['module'], 'hook': 'residual_post_block',
            'dtype': 'bfloat16', 'device': 'cuda', 'dimensions': {'hidden': 4096, 'width': 65536, 'top_k': 50},
            'sae_file': f'layer{layer["layer"]}.sae.pt', 'max_tokens': obs['max_tokens'], 'truncation': False,
            'encoding': 'affine_then_signed_topk_no_relu_no_centering', 'software': worker.GPU_SOFTWARE,
            'implementation_files_sha256': {n: job['source_files_sha256'][n] for n in worker.SOURCE_NAMES[:3]},
            'config_sha256': assets[(obs['model'], obs['model_revision'], 'config.json')]['sha256']}
        for role, field in [('model', 'model_files_sha256'), ('tokenizer', 'tokenizer_files_sha256')]:
            m[field] = {a['filename']: assets[worker.asset_key(a)]['sha256'] for a in job['inventory']['assets']
                       if role in a['roles'] and (role != 'model' or a['filename'].endswith('.safetensors'))}
        manifests.append(m)
    by_layer = {m['layer']: m for m in manifests}; by_id = {r['record_id']: r for r in flight['records']}
    original = {r['record_id']: r for r in plan['records']}
    fp = lambda shape: {'shape': shape, 'dtype': 'torch.bfloat16', 'sha256': 'f'*64}
    calibrations = []
    if job['mode'] == 'intervention':
        for layer in obs['layers']:
            calibrations.append({'layer': layer['layer'], 'scale': 4., 'seed': config['calibration_seed'],
                'rule': 'median_selected_calibration_vector_l2_norm', 'observer_manifest_sha256': core.digest(by_layer[layer['layer']]),
                'records': [{k: by_id[rid][k] for k in ('record_id', 'view_sha256', 'selected_token_indices', 'input_token_ids')} |
                           {'split': 'calibration', 'residual': fp([len(by_id[rid]['selected_token_indices']), 4096])} for rid in config['calibration_record_ids']]})
    rows = []
    for trial in plan['trials']:
        r = original[trial['record_id']]; t = by_id[trial['record_id']]; view = core.boundary_view(r)
        vec = [0.]*4096; vec[2 if trial['control'] == 'random' else 1 if trial['control'] == 'unrelated' else 0] = -1. if trial['control'] == 'opposite' else 1.
        direction = {'shape': [4096], 'dtype': 'torch.float32', 'sha256': hashlib.sha256(struct.pack('<4096f', *vec)).hexdigest(),
            'unit_vector': vec, 'feature': None if trial['control'] == 'random' else 1 if trial['control'] == 'unrelated' else 0} if job['mode'] == 'intervention' else None
        cal = next((c for c in calibrations if c['layer'] == trial['layer']), None)
        delta = abs(trial['epsilon']) * 4
        row = {**trial, **{k: r[k] for k in ('family_id', 'group_ids', 'split', 'boundary')},
            'source_record_sha256': plan['source_record_sha256'][r['record_id']], 'view_sha256': core.digest(view),
            'spans': view['spans'], 'latest_allowed_event_id': view['latest_allowed_event_id'],
            'input_token_ids': t['input_token_ids'], 'selected_token_indices': t['selected_token_indices'],
            'selected_offsets': [t['offsets'][i] for i in t['selected_token_indices']],
            'observer_manifest_sha256': core.digest(by_layer[trial['layer']]),
            'settings': {'seed': trial['seed'], 'use_cache': False, 'model_mode': 'eval', 'deterministic_algorithms': False},
            'independent_behavior_review': {'status': 'unknown', 'outcome': None, 'review_id': None}, 'readout_quality': None, 'causal_behavior_effect': None,
            'residual_before': fp([1, len(t['input_token_ids']), 4096]), 'residual_after': fp([1, len(t['input_token_ids']), 4096]),
            'downstream_tensor': fp([1, len(t['input_token_ids']), 4096]), 'actual_selected_delta_norm': {'min': delta, 'mean': delta, 'max': delta},
            'unselected_delta_norm_max': 0., 'direction': direction, 'scale': 4. if cal else None, 'calibration_sha256': core.digest(cal) if cal else None,
            'requested_delta_norm': delta, 'measurements': []}
        for pooling in trial['poolings']:
            selections = [t['selected_token_indices']] if pooling == exp.POOLINGS[0] else [[t['selected_token_indices'][-1]]] if pooling == exp.POOLINGS[1] else t['span_token_indices']
            for i, selected in enumerate(selections):
                row['measurements'].append({'pooling': pooling, 'span_index': i if pooling == exp.POOLINGS[2] else None,
                    'token_indices': selected, 'raw': [0.]*4096, 'sae': {'0': .25}})
        rows.append(row)
    return worker.seal({'schema_version': 1, 'evidence': 'local_pinned_model_forward_experiment',
        'plan_sha256': plan['plan_sha256'], 'concept_card_sha256': plan['concept_card_sha256'], 'split_manifest_sha256': plan['split_manifest_sha256'],
        'measurement_contract': {'mode': job['mode'], 'poolings': config['poolings'], 'hook': 'residual_post_block'},
        'observer_manifests': manifests, 'calibrations': calibrations, 'rows': rows, 'completed_trials': len(rows),
        'implementation_files_sha256': {n: job['source_files_sha256'][n] for n in worker.SOURCE_NAMES[:-1]}}, 'result_sha256')


def reseal(value, field):
    value.pop(field, None); return worker.seal(value, field)


def diagnostic_archive(job, *, receipt_changes=None, extras=None):
    """Authored bootstrap/materialization failure, before any helper output."""
    files = {'experiment.log': b'AUTHORED uv dependency download timeout; no weights/model execution\n', **(extras or {})}
    receipt = {'schema_version': 1, 'evidence': 'local_worker_process_not_pod_receipt',
        'job_sha256': job['job_sha256'], 'exit_code': 1, 'transport_exit_code': 1,
        'complete': False, 'fit_eligible': False, 'completed_trials': 0,
        'transport_failure_stage': 'materialization',
        'files': {name: hashlib.sha256(body).hexdigest() for name, body in files.items()}}
    receipt.update(receipt_changes or {})
    files['receipt.json'] = core.canonical(receipt).encode()
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w') as archive:
        for name, body in files.items():
            info = tarfile.TarInfo(name); info.size = len(body); archive.addfile(info, io.BytesIO(body))
    return buffer.getvalue()


class WorkerTests(unittest.TestCase):
    def test_pre_materialization_failure_is_diagnostic_not_partial_measurements(self):
        for mode, stage in (('readout', 'bootstrap'), ('intervention', 'materialization')):
            with self.subTest(mode=mode, stage=stage):
                job, join, *_ = fixture(mode)
                body = diagnostic_archive(job, receipt_changes={'transport_failure_stage': stage})
                imported = worker.import_outputs(job, join, body)
                self.assertTrue(imported['diagnostic_only'])
                self.assertFalse(imported['complete']); self.assertFalse(imported['fit_eligible'])
                self.assertIsNone(imported['result']); self.assertIsNone(imported['local_join'])
                self.assertEqual(imported['validated_completed_trials'], 0)
                self.assertEqual(imported['diagnostic']['failure_stage'], stage)
                self.assertIn('AUTHORED uv dependency', imported['diagnostic']['log_text'])
                self.assertEqual(imported['archive_sha256'], hashlib.sha256(body).hexdigest())
                worker.check_seal(imported['diagnostic'], 'diagnostic_sha256')

    def test_diagnostic_cannot_bypass_receipts_counts_stages_join_or_caps(self):
        job, join, *_ = fixture()
        changes = [ {'exit_code': 0}, {'complete': True}, {'fit_eligible': True},
            {'completed_trials': 1}, {'completed_trials': False}, {'transport_exit_code': 0},
            {'transport_failure_stage': 'execution'}, {'transport_failure_stage': None},
            {'job_sha256': '0'*64}, {'evidence': 'model_extraction'}, {'files': {}} ]
        for changed in changes:
            with self.subTest(change=changed), self.assertRaises(ValueError):
                worker.import_outputs(job, join, diagnostic_archive(job, receipt_changes=changed))
        for name in ('results.json', 'trials.jsonl', 'context.json', 'preflight.json'):
            with self.subTest(extra=name), self.assertRaises(ValueError):
                worker.import_outputs(job, join, diagnostic_archive(job, extras={name: b'{}'}))
        with self.assertRaisesRegex(ValueError, 'log'):
            worker.import_outputs(job, join, diagnostic_archive(job, extras={'experiment.log': b'x'*(job['limits']['max_log_bytes']+1)}))
        changed = deepcopy(join); changed['source_plan_sha256'] = '0'*64; reseal(changed, 'join_sha256')
        with self.assertRaisesRegex(ValueError, 'join'):
            worker.import_outputs(job, changed, diagnostic_archive(job))

    def test_pure_projection_complete_closure_and_exact_private_join(self):
        job, join, plan, inventory, limits, records, _, _ = fixture()
        uploaded, local = worker.project_experiment_input(plan, records)
        self.assertEqual(local, join); self.assertEqual(uploaded, job['experiment'])
        self.assertEqual(len(uploaded['split_manifest']['families']), len(plan['split_manifest']['families']))
        body = core.canonical(uploaded)
        for hidden in ('SECRET', 'AUTHORED TEST REVIEWER', 'person-train', 'family-calibration', '"labels"'):
            self.assertNotIn(hidden, body)
        self.assertIn('labels', next(iter(local['records'].values()))['metadata'])
        altered = deepcopy(records); altered[0]['labels']['concept'] = None
        with self.assertRaisesRegex(ValueError, 'source hash'): worker.project_experiment_input(plan, altered)
        script = 'import sys;sys.path.insert(0,"scripts/training");from test_observer_experiment_job import fixture;fixture();assert "torch" not in sys.modules'
        result = subprocess.run([sys.executable, '-c', script], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_unknown_labels_remain_unknown_and_unselected_groups_stay_together(self):
        _, _, plan, _, _, records, _, _ = fixture()
        records[0]['labels']['concept'] = None
        config = deepcopy(plan['config']); splits = deepcopy(plan['split_manifest']); card = deepcopy(plan['concept_card'])
        splits['families']['unselected-connected'] = {'split': 'train', 'group_ids': ['person-train']}
        plan = exp.prepare(config, records, card, splits)
        remote, join = worker.project_experiment_input(plan, records)
        self.assertIsNone(join['records'][worker.alias('record', 'train')]['metadata']['labels']['concept'])
        self.assertIn(worker.alias('family', 'unselected-connected'), remote['split_manifest']['families'])
        splits['families']['unselected-connected']['split'] = 'test'
        with self.assertRaisesRegex(ValueError, 'cross partitions'): exp.prepare(config, records, card, splits)

    def test_metadata_pins_sizes_sha1_and_missing_layer(self):
        job, _, plan, inv, _, _, docs, bodies = fixture(layers=(3, 12))
        self.assertEqual(inv['total_bytes'], sum(len(v) for v in bodies.values()))
        damaged = deepcopy(docs); next(d for key,d in damaged.items() if 'SAE' in key[0])['sha'] = '0'*40
        with self.assertRaisesRegex(ValueError, 'revision'): worker.inventory_from_metadata(plan, damaged)
        damaged = deepcopy(docs); next(d for key,d in damaged.items() if 'SAE' in key[0])['siblings'].pop()
        with self.assertRaisesRegex(ValueError, 'Missing selected'): worker.inventory_from_metadata(plan, damaged)
        with tempfile.TemporaryDirectory() as directory:
            asset = inv['assets'][0]; path = Path(directory)/'asset'; path.write_bytes(bodies[asset['filename']])
            worker.verify_asset(path, asset); path.write_bytes(b'X'*asset['size'])
            with self.assertRaisesRegex(ValueError, 'hash mismatch'): worker.verify_asset(path, asset)

    def test_metadata_only_opener_is_exact_revision_no_weights(self):
        _, _, plan, _, _, _, docs, _ = fixture()
        urls = []
        def opener(url, timeout):
            urls.append(url); document = next(v for k,v in docs.items() if worker.metadata_url(*k) == url)
            reply = io.BytesIO(json.dumps(document).encode()); reply.geturl = lambda: url; return reply
        inventory = worker.fetch_metadata(plan, opener=opener)
        self.assertTrue(all('/api/models/' in u and '/revision/' in u for u in urls))
        worker.validate_inventory(plan, inventory)

    def test_asset_materialization_is_explicit_bounded_and_pinned(self):
        job, _, _, _, _, _, _, bodies = fixture()
        runtime = {'creation_started_at': time.time()-10, 'rate_observed_at': time.time()-1, 'observed_gpu_hourly_rate': 1.09}
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def fetch(repo, name, **kwargs):
                calls.append(kwargs); path = Path(directory)/name
                if not path.exists():
                    if kwargs['local_files_only']: raise FileNotFoundError()
                    path.write_bytes(bodies[name])
                return path
            with self.assertRaisesRegex(ValueError, 'explicit'): worker.materialize(job, directory, runtime, fetcher=fetch)
            self.assertTrue(all(c['local_files_only'] for c in calls))
            report = worker.materialize(job, directory, runtime, allow_download=True, fetcher=fetch)
            worker.validate_materialization(job, report)
            self.assertTrue(all(c['token'] is False for c in calls))
            self.assertEqual(report['total_bytes'], sum(len(b) for b in bodies.values()))

    def test_forward_accounting_includes_calibration_and_pooling_shares_forwards(self):
        job, _, _, _, _, _, _, _ = fixture('intervention', (3, 12))
        flight = worker.preflight(job, Tokens())
        lens = {r['record_id']: len(r['input_token_ids']) for r in flight['records']}
        expected = sum(lens[t['record_id']] for t in job['experiment']['trials']) + 2*sum(lens[r] for r in job['experiment']['config']['calibration_record_ids'])
        self.assertEqual(flight['forward_tokens'], expected); self.assertEqual(flight['forward_passes'], 38)
        bad = deepcopy(job); bad['limits']['max_forward_tokens'] = expected-1; reseal(bad, 'job_sha256')
        with self.assertRaisesRegex(ValueError, 'Aggregate'): worker.preflight(bad, Tokens())
        c, r, card, splits = bundle(layers=(3, 12)); c.update(mode='readout', epsilons=[0], calibration_record_ids=[], evaluation_record_ids=[x['record_id'] for x in r])
        full = exp.prepare(c, r, card, splits)
        self.assertEqual(full['trial_count'], 6)  # Three poolings, not 18 forwards.

    def test_rate_deadline_and_preservation_reserve(self):
        job = fixture()[0]; now = 10000.
        runtime = {'creation_started_at': now-10, 'rate_observed_at': now-1, 'observed_gpu_hourly_rate': 1.09}
        self.assertGreater(worker.check_runtime(job, runtime, now=now, fresh=True), 0)
        for field, value in [('observed_gpu_hourly_rate', 1.20), ('creation_started_at', now-3600), ('rate_observed_at', now+1)]:
            changed = dict(runtime); changed[field] = value
            with self.assertRaises(ValueError): worker.check_runtime(job, changed, now=now, fresh=True)
        bad = deepcopy(job['limits']); bad['cost_cap_usd'] = '.91'
        with self.assertRaisesRegex(ValueError, 'reserve'): worker.validate_limits(bad)

    def test_result_matrix_hash_temporal_pooling_and_outcomes(self):
        for mode in ('readout', 'intervention'):
            job, _, _, _, _, _, _, bodies = fixture(mode)
            flight = worker.preflight(job, Tokens()); mat = materialization(job, bodies); result = result_fixture(job, flight, mat)
            worker.validate_experiment_result(job, result, flight, mat)
            mutations = [lambda r: r['rows'].pop(), lambda r: r['rows'][0].update(source_record_sha256='0'*64),
                lambda r: r['rows'][0]['input_token_ids'].__setitem__(0, 99),
                lambda r: r['rows'][0].update(causal_behavior_effect=.9),
                lambda r: r['rows'][0]['measurements'][0].update(pooling='entire_transcript'),
                lambda r: r['observer_manifests'][0]['model_files_sha256'].update({'model.safetensors': '0'*64})]
            for mutate in mutations:
                changed = deepcopy(result); mutate(changed); reseal(changed, 'result_sha256')
                with self.assertRaises(ValueError): worker.validate_experiment_result(job, changed, flight, mat)

    def test_bounded_atomic_write_archive_and_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'result.json'
            with self.assertRaisesRegex(ValueError, 'bound'): worker.write_bounded(path, {'large': 'x'*100}, 20)
            self.assertFalse(path.exists()); self.assertFalse(path.with_name('result.json.tmp').exists())
        job, join, *_ = fixture()
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w') as tar:
            info = tarfile.TarInfo('../bad'); info.size = 1; tar.addfile(info, io.BytesIO(b'x'))
        with self.assertRaisesRegex(ValueError, 'Unsafe'): worker.import_outputs(job, join, buffer.getvalue())

    def test_execute_timeout_preserves_validated_prefix_not_fit_eligible(self):
        for timeout in (False, True):
            job, join, _, _, _, _, _, bodies = fixture()
            mat = materialization(job, bodies); flight = worker.preflight(job, Tokens()); fixture_result = result_fixture(job, flight, mat)
            runtime = {'creation_started_at': time.time()-10, 'rate_observed_at': time.time()-1, 'observed_gpu_hourly_rate': 1.09}
            def run(job, flight, journal, result):
                result['observer_manifests'] = fixture_result['observer_manifests']
                for i, row in enumerate(fixture_result['rows']):
                    if timeout and i == 1: raise TimeoutError('authored worker timeout')
                    journal.append(row)
            with tempfile.TemporaryDirectory() as directory, patch.object(worker, 'cached_tokenizer', return_value=Tokens()), patch.object(worker, 'stream_execute', side_effect=run):
                output = Path(directory)/'job'
                receipt = worker.execute_job(job, mat, directory, output, runtime)
                imported = worker.import_outputs(job, join, worker.archive_outputs(output))
                self.assertEqual(receipt['complete'], not timeout)
                self.assertEqual(imported['fit_eligible'], not timeout)
                self.assertEqual(imported['validated_completed_trials'], 1 if timeout else 3)
                self.assertTrue((output/'trials.jsonl').exists())
                self.assertEqual(imported['local_join']['rows'][0]['local']['metadata']['labels'], {'concept': 1})
                if timeout:
                    self.assertFalse((output/'results.json').exists())
                    with self.assertRaises(ValueError): worker.validate_experiment_result(job, imported['result'], flight, mat)

    def test_200_by_four_layer_three_pooling_job_exceeds_file_cap(self):
        job, _, plan, inventory, limits, _, docs, bodies = fixture(layers=(3, 9, 12, 24))
        original = deepcopy(plan['records'][0]); rows = []; splits = deepcopy(plan['split_manifest'])
        splits['families'] = {}
        for i in range(200):
            row = deepcopy(original); row.update(record_id=f'row-{i}', family_id=f'family-{i}', group_ids=[f'group-{i}'])
            rows.append(row); splits['families'][row['family_id']] = {'split': row['split'], 'group_ids': row['group_ids']}
        config = deepcopy(plan['config']); config.update(poolings=list(exp.POOLINGS), evaluation_record_ids=[r['record_id'] for r in rows])
        big = exp.prepare(config, rows, plan['concept_card'], splits)
        self.assertEqual(big['trial_count'], 800)
        self.assertEqual(200*4*3*4096*32, 300*1024**2)
        with self.assertRaisesRegex(ValueError, 'per-file cap'): worker.prepare_job(big, inventory, limits)


@unittest.skipUnless(importlib.util.find_spec('torch'), 'Use the pinned CPU script environment')
class StreamingMechanicsTests(unittest.TestCase):
    def test_actual_tuple_interventions_are_checkpointed_and_poolings_share_forward(self):
        import test_observer_experiment as mechanics
        from types import SimpleNamespace
        toy = mechanics.ExecutionTests(); toy.setUp()
        job = fixture('intervention')[0]
        flight = worker.preflight(job, Tokens()); result = {'observer_manifests': [], 'calibrations': []}
        obs = job['experiment']['config']['observer']; layers_loaded = []
        def injected(_job, layer, resident):
            layers_loaded.append(layer['layer'])
            args = SimpleNamespace(**{k: obs[k] for k in ('model_revision','tokenizer_revision','sae_revision','dtype','device','max_tokens')},
                layer=layer['layer'], module=layer['module'], sae_sha256=layer['sae_sha256'], allow_download=False)
            return toy.loader(args)
        # This test verifies real CPU mechanics, not published-model admission.
        with tempfile.TemporaryDirectory() as directory, patch.object(worker, 'load_layer_reusing_model', side_effect=injected), \
                patch.object(core, 'SAESpec', return_value=toy.spec), patch.object(exp, 'validate_loaded'):
            journal = worker.TrialJournal(directory, job)
            try: worker.stream_execute(job, flight, journal, result)
            finally: journal.close()
            rows = [json.loads(s) for s in journal.path.read_bytes().splitlines()]
            self.assertEqual(len(rows), 18); self.assertEqual(layers_loaded, [12])
            self.assertTrue(any(r['actual_selected_delta_norm']['max'] > 0 for r in rows))
            self.assertTrue(all(r['unselected_delta_norm_max'] == 0 for r in rows))
            self.assertTrue((Path(directory)/'context.json').exists())
            self.assertEqual(json.loads((Path(directory)/'progress.json').read_text())['completed_trials'], 18)
            self.assertTrue(all(not m.block._forward_hooks for m in toy.loaded))

    def test_reusing_model_loads_only_next_local_weights_only_sae(self):
        import torch
        import test_observer_experiment as mechanics
        from types import SimpleNamespace
        toy = mechanics.ExecutionTests(); toy.setUp()
        job = fixture(layers=(12, 13))[0]; obs = job['experiment']['config']['observer']
        obs.update(device='cpu', dtype='float32')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'layer13.sae.pt'; torch.save(toy.state, path); body = path.read_bytes()
            asset = next(a for a in job['inventory']['assets'] if a['filename'] == path.name)
            asset.update(size=len(body), oid={'algorithm':'sha256','value':hashlib.sha256(body).hexdigest()})
            obs['layers'][1]['sae_sha256'] = asset['oid']['value']
            def first_load(args):
                model, tokenizer, block, state, manifest = toy.loader(args)
                block = type('Qwen3_5DecoderLayer', (type(block),), {})(); model.block = block
                manifest.update(evidence='model_extraction', model_files_sha256={'authored':'a'*64}, tokenizer_files_sha256={'authored':'b'*64})
                return model, tokenizer, block, state, manifest
            with patch.object(core, 'SAESpec', return_value=toy.spec), patch.object(exp.extract, 'load_observer', side_effect=first_load) as load, \
                    patch('huggingface_hub.hf_hub_download', return_value=str(path)) as fetch:
                first = worker.load_layer_reusing_model(job, obs['layers'][0])
                with patch.object(first[0], 'get_submodule', return_value=first[2]) as get_block:
                    second = worker.load_layer_reusing_model(job, obs['layers'][1], (first[0], first[1], first[4]))
                self.assertEqual(load.call_count, 1); self.assertIs(first[0], second[0]); self.assertIs(first[1], second[1])
                self.assertTrue(second[4]['model_reused']); self.assertEqual(second[4]['layer'], 13)
                get_block.assert_called_once_with('language_model.layers.13')
                self.assertTrue(fetch.call_args.kwargs['local_files_only']); self.assertFalse(fetch.call_args.kwargs['token'])


class OverlayTests(unittest.TestCase):
    def test_image_mismatch_stops_before_download_and_good_bootstrap_binds_installer(self):
        with authored_overlay() as profile, tempfile.TemporaryDirectory() as temporary:
            job, _, plan, inventory, limits, records, *_ = fixture()
            job, _ = worker.prepare_job(plan, inventory, limits, records, dependencies=profile)
            bad = image_runtime(); bad['python'] = [3, 13, 15]
            with patch.object(worker.sys, 'version_info', (3, 12, 11)), patch.object(worker.sys, 'executable', worker.IMAGE_PYTHON), \
                    patch.object(worker, 'overlay_process', return_value=bad), patch.object(worker, 'download_overlay_wheels') as fetch:
                with self.assertRaisesRegex(ValueError, 'Python/Torch/CUDA'):
                    worker.bootstrap_overlay(job, Path(temporary)/'bad')
                fetch.assert_not_called()
            target = Path(temporary)/'good'; prefix = target/'runtime-env'; calls = []
            def process(command, deadline, capture=False):
                calls.append(command)
                if capture and command[-1] == worker.IMAGE_PROBE:
                    return image_runtime(prefix if 'runtime-env' in command[0] else None)
                if capture:
                    return {w['name']: {'version': w['version'], 'path': str(prefix/'lib/python3.12/site-packages')} for w in profile['lock']['wheels']}
            with patch.object(worker.sys, 'version_info', (3, 12, 11)), patch.object(worker.sys, 'executable', worker.IMAGE_PYTHON), \
                    patch.object(worker, 'overlay_process', side_effect=process), \
                    patch.object(worker, 'download_overlay_wheels', return_value=40871731):
                report = worker.bootstrap_overlay(job, target)
            worker.validate_environment(job, report)
            self.assertEqual(calls[1][1:4], ['-m', 'venv', '--system-site-packages'])
            self.assertTrue({'--no-index', '--no-deps', '--ignore-installed', '--require-hashes'} <= set(calls[2]))
            for change in ('torch', 'cuda', 'bf16_matmul'):
                bad_report = deepcopy(report); bad_report['runtime'][change] = 'wrong'
                bad_report.pop('environment_sha256'); worker.seal(bad_report, 'environment_sha256')
                with self.assertRaises(ValueError): worker.validate_environment(job, bad_report)
            altered = deepcopy(profile); altered['image_proof']['image-config.json'] += ' '
            altered.pop('profile_sha256'); worker.seal(altered, 'profile_sha256')
            with self.assertRaisesRegex(ValueError, 'Image proof'): worker.validate_dependency_profile(altered)

    def test_downloader_pins_redirect_size_hash_retry_and_whole_deadline(self):
        payload = b'authored wheel bytes, never installed'
        wheel = {'filename': 'authored.whl', 'url': 'https://files.pythonhosted.org/packages/authored.whl',
            'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
        class Response(io.BytesIO):
            def geturl(self): return wheel['url']
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def opener(url, timeout):
                self.assertEqual(url, wheel['url']); self.assertLessEqual(timeout, 30)
                return Response(payload)
            count = worker.download_overlay_wheels({'wheels': [wheel]}, root/'ok', time.monotonic()+5, opener=opener)
            self.assertEqual(count, len(payload)); self.assertEqual((root/'ok/authored.whl').read_bytes(), payload)
            for name, data in [('hash', b'x'*len(payload)), ('large', payload+b'x')]:
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'hash|byte cap'):
                    worker.download_overlay_wheels({'wheels': [wheel]}, root/name, time.monotonic()+5,
                        opener=lambda *_args, **_kwargs: Response(data))
                self.assertEqual(list((root/name).iterdir()), [])
            class Redirect(Response):
                def geturl(self): return 'https://example.invalid/elsewhere'
            with self.assertRaisesRegex(ValueError, 'redirect'):
                worker.download_overlay_wheels({'wheels': [wheel]}, root/'redirect', time.monotonic()+5,
                    opener=lambda *_a, **_k: Redirect(payload))
            attempts = []
            class Broken(Response):
                def read(self, n):
                    if self.tell(): raise ConnectionError('authored disconnect')
                    return super().read(n)
            def retry(*args, **kwargs):
                attempts.append(1); return Broken(payload) if len(attempts)==1 else Response(payload)
            count = worker.download_overlay_wheels({'wheels': [wheel]}, root/'retry', time.monotonic()+5, opener=retry)
            self.assertEqual(count, 2*len(payload)); self.assertEqual(len(attempts), 2)
            with self.assertRaisesRegex(ValueError, 'deadline'), patch.object(worker.urllib.request, 'urlopen', side_effect=AssertionError('No network')):
                worker.download_overlay_wheels({'wheels': [wheel]}, root/'expired', time.monotonic()-1, opener=opener)

    def test_remote_token_mismatch_stops_before_first_forward_and_is_incomplete(self):
        with authored_overlay() as profile, tempfile.TemporaryDirectory() as directory:
            _, join, plan, inventory, limits, records, _, bodies = fixture()
            job, join = worker.prepare_job(plan, inventory, limits, records, dependencies=profile)
            environment = environment_fixture(job); expected = worker.preflight(job, Tokens())
            class DifferentTokens(Tokens):
                def __call__(self, *args, **kwargs):
                    row = super().__call__(*args, **kwargs); row['input_ids'][0] += 1; return row
            now = time.time(); runtime = {'creation_started_at': now, 'rate_observed_at': now, 'observed_gpu_hourly_rate': .1}
            with patch.object(worker, 'check_overlay_process'), patch.object(worker, 'cached_tokenizer', return_value=DifferentTokens()), \
                    patch.object(worker, 'stream_execute') as forward:
                receipt = worker.execute_job(job, materialization(job, bodies), directory, Path(directory)/'out', runtime,
                    environment=environment, expected_preflight=expected)
            forward.assert_not_called(); self.assertEqual(receipt['completed_trials'], 0); self.assertFalse(receipt['fit_eligible'])
            self.assertIn('Remote token IDs', (Path(directory)/'out/experiment.log').read_text())


if __name__ == '__main__':
    unittest.main()
