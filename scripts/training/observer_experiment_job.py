"""Standalone experiment transport/worker; never imports the live Runpod manager.

prepare is pure. metadata reads public Hub metadata only. materialize is the
explicit weight-download stage for a later authorized worker; execute is cached
only. No cloud API, credential, pod lifecycle or shared-budget mutation exists.
"""
import argparse
from contextlib import contextmanager
from copy import deepcopy
from decimal import Decimal
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request

import observer_core as core
import observer_extract as extract
import observer_experiment as experiment

MAX_INPUT = 2 * 1024**2
MAX_FILE = 64 * 1024**2  # Exclusive upper bound, matching current EXPORT.
MAX_ARCHIVE = 128 * 1024**2
MAX_TOKENS = 4096
CLEANUP_SECONDS = 180
RUNNING_STORAGE_RATE = Decimal(9) / Decimal(672)
SOURCE_NAMES = ('observer_core.py', 'observer_extract.py', 'observer_models.py',
                'observer_experiment.py', 'observer_experiment_job.py')
GPU_SOFTWARE = {'torch': '2.8.0+cu128', 'transformers': '5.3.0', 'numpy': '2.2.6'}
ARTIFACTS = {'receipt.json', 'experiment.log', 'materialization.json', 'preflight.json', 'results.json',
             'progress.json', 'trials.jsonl', 'partial.json', 'context.json', 'environment.json'}
OVERLAY_LOCK = '6cd5bacc3bc3004e70cb1de113798127881ff0d95f5919817a3ab8f2086f4d90'
IMAGE_PROOF = {
    'image-index.json': '0a360022e8de4375af99430f84e8b38951acc397252163a37ceac7204d01be35',
    'image-manifest.json': '4d1721e62b56d345c83b4fd6090664be6daf9312caab5b2e76f23d8231941851',
    'image-config.json': '02b731f844d2fbc4dd0de87253081363864327c7931b1ae2b5daa60abc600c51'}
IMAGE_PYTHON = '/usr/bin/python3.12'
OVERLAY_PYTHON = '.keating/outputs/overlay/runtime-env/bin/python'
require = experiment.require


def seal(value, field):
    value[field] = core.digest(value)
    return value


def check_seal(value, field):
    unsigned = dict(value)
    claimed = unsigned.pop(field, None)
    require(experiment.identity(claimed) and core.digest(unsigned) == claimed, field + ' mismatch')


def dependency_profile(directory):
    """Read already verified metadata; this operation never fetches anything."""
    directory = Path(directory)
    profile = seal({'schema_version': 1, 'kind': 'image-python312-overlay-v1',
        'lock': json.loads(regular_bytes(directory / 'overlay-lock.json', MAX_INPUT)),
        'image_proof': {n: regular_bytes(directory / n, MAX_INPUT).decode() for n in IMAGE_PROOF}}, 'profile_sha256')
    validate_dependency_profile(profile)
    return profile


def validate_dependency_profile(profile):
    check_seal(profile, 'profile_sha256')
    require(profile['schema_version'] == 1 and profile['kind'] == 'image-python312-overlay-v1', 'Unknown dependency profile')
    lock = profile['lock']; check_seal(lock, 'manifest_sha256')
    require(lock['manifest_sha256'] == OVERLAY_LOCK, 'Unapproved overlay lock')
    require(set(profile['image_proof']) == set(IMAGE_PROOF), 'Missing exact image proof')
    for name, expected in IMAGE_PROOF.items():
        require(hashlib.sha256(profile['image_proof'][name].encode()).hexdigest() == expected, 'Image proof changed')
    require(lock['wheel_count'] == len(lock['wheels']) == 27 and lock['total_wheel_bytes'] == 40871731,
        'Overlay inventory changed')
    for wheel in lock['wheels']:
        name = wheel['name'].lower().replace('_', '-')
        require(name not in ('torch', 'torchvision', 'torchaudio', 'triton') and not name.startswith('nvidia-'),
            'GPU package download forbidden')
        url = urllib.parse.urlsplit(wheel['url'])
        require(url.scheme == 'https' and url.netloc == 'files.pythonhosted.org' and not url.query
            and not url.fragment and url.path.endswith('/' + wheel['filename']), 'Unapproved wheel URL')
        require(re.fullmatch(r'[A-Za-z0-9_.+-]+\.whl', wheel['filename']) and
            0 < wheel['bytes'] <= 32 * 1024**2 and experiment.identity(wheel['sha256']), 'Invalid wheel pin')


# Executed only by the pinned image interpreter or its system-site-packages
# overlay. It performs a tiny actual GPU operation before any wheel download.
IMAGE_PROBE = '''import importlib.metadata as md,json,pathlib,platform,sys,torch
assert sys.version_info[:2]==(3,12), "Image Python must be 3.12"
assert platform.system()=="Linux" and platform.machine()=="x86_64"
assert torch.__version__=="2.8.0+cu128" and torch.version.cuda=="12.8", "Image Torch/CUDA mismatch"
assert torch.cuda.is_available() and torch.cuda.is_bf16_supported(), "CUDA BF16 unavailable"
x=torch.ones((2,2),device="cuda",dtype=torch.bfloat16); y=x@x; torch.cuda.synchronize()
assert y.dtype==torch.bfloat16 and torch.isfinite(y).all().item() and y[0,0].item()==2.0
print(json.dumps({"python":list(sys.version_info[:3]),"executable":sys.executable,
 "prefix":sys.prefix,"base_prefix":sys.base_prefix,"machine":platform.machine(),
 "torch":torch.__version__,"cuda":torch.version.cuda,"torch_file":str(pathlib.Path(torch.__file__).resolve()),
 "cuda_available":True,"bf16_supported":True,"bf16_matmul":True,
 "device":torch.cuda.get_device_name(0),"capability":list(torch.cuda.get_device_capability(0))}))
'''


def validate_image_runtime(report, *, overlay_prefix=None):
    require(report['python'][:2] == [3, 12] and report['machine'] == 'x86_64'
        and report['torch'] == GPU_SOFTWARE['torch'] and report['cuda'] == '12.8', 'Image Python/Torch/CUDA mismatch')
    require(all(report[k] is True for k in ('cuda_available', 'bf16_supported', 'bf16_matmul'))
        and isinstance(report['device'], str) and report['device'], 'Actual CUDA BF16 proof required')
    require(Path(report['torch_file']).is_absolute() and Path(report['executable']).is_absolute(), 'Runtime paths required')
    if overlay_prefix is None:
        require(report['prefix'] == report['base_prefix'] and report['executable'] == IMAGE_PYTHON, 'Unexpected image interpreter')
    else:
        require(report['prefix'] == str(overlay_prefix) and report['base_prefix'] != report['prefix']
            and report['executable'] == str(Path(overlay_prefix) / 'bin/python')
            and not Path(report['torch_file']).is_relative_to(overlay_prefix), 'Overlay must reuse image Torch')


def overlay_environment():
    # No ambient pip indices/config, alternate venv, Python path or user site.
    env = {k: v for k, v in os.environ.items() if not k.startswith(('PIP_', 'PYTHON', 'UV_')) and k != 'VIRTUAL_ENV'}
    env.update(PYTHONNOUSERSITE='1', PIP_CONFIG_FILE=os.devnull, HF_HUB_DISABLE_IMPLICIT_TOKEN='1')
    return env


def overlay_process(command, deadline, *, capture=False):
    remaining = deadline - time.monotonic()
    require(remaining > 0, 'Overlay 300-second deadline exhausted')
    # Share the bootstrap process group so the manager kills pip/probes too.
    child = subprocess.Popen(command, env=overlay_environment(), stdout=subprocess.PIPE if capture else None)
    try:
        output, _ = child.communicate(timeout=remaining)
        require(child.returncode == 0, 'Overlay child failed: ' + str(child.returncode))
        return json.loads(output) if capture else None
    finally:
        if child.poll() is None:
            child.kill(); child.wait()


class WheelNoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Wheel redirects forbidden')


def download_overlay_wheels(lock, wheelhouse, deadline, *, opener=None):
    """Serial bounded fetch; retry bytes count toward the same 64 MiB budget."""
    opener = opener or urllib.request.build_opener(WheelNoRedirect()).open
    wheelhouse = Path(wheelhouse); wheelhouse.mkdir(mode=0o700, parents=True, exist_ok=False)
    transferred = 0
    for wheel in lock['wheels']:
        target = wheelhouse / wheel['filename']; partial = target.with_suffix('.part')
        for attempt in range(2):
            try:
                remaining = deadline - time.monotonic()
                require(remaining > 0, 'Overlay 300-second deadline exhausted')
                with opener(wheel['url'], timeout=min(30, remaining)) as response, partial.open('xb') as stream:
                    os.chmod(partial, 0o600)
                    require(response.geturl() == wheel['url'], 'Wheel redirect refused')
                    size = 0; actual = hashlib.sha256()
                    while True:
                        require(time.monotonic() < deadline, 'Overlay 300-second deadline exhausted')
                        room = min(wheel['bytes'] - size, 64 * 1024**2 - transferred)
                        chunk = response.read(min(65536, room + 1))
                        if not chunk: break
                        size += len(chunk); transferred += len(chunk)
                        require(size <= wheel['bytes'] and transferred <= 64 * 1024**2, 'Wheel transfer byte cap exceeded')
                        actual.update(chunk); stream.write(chunk)
                    require(size == wheel['bytes'] and actual.hexdigest() == wheel['sha256'], 'Wheel size/hash mismatch')
                    stream.flush(); os.fsync(stream.fileno())
                os.replace(partial, target); break
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                if attempt == 1: raise
            finally:
                partial.unlink(missing_ok=True)
    return transferred


def overlay_install_command(python, wheelhouse, requirements):
    return [str(python), '-m', 'pip', '--isolated', '--disable-pip-version-check', 'install',
        '--no-index', '--no-deps', '--ignore-installed', '--require-hashes', '--only-binary=:all:',
        '--no-compile', '--find-links', str(wheelhouse), '-r', str(requirements)]


def bootstrap_overlay(job, output_dir, *, remaining_seconds=300):
    validate_job(job, check_code=True)
    require('dependency_profile' in job and sys.version_info[:2] == (3, 12)
        and sys.executable == IMAGE_PYTHON, 'Overlay bootstrap requires exact image Python 3.12; no fallback')
    started = time.monotonic(); deadline = started + min(300, remaining_seconds)
    profile = job['dependency_profile']; lock = profile['lock']
    output_dir = Path(output_dir).resolve(); output_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
    with deadline_guard(deadline - time.monotonic()):
        base = overlay_process([IMAGE_PYTHON, '-c', IMAGE_PROBE], deadline, capture=True)
        validate_image_runtime(base)  # Before downloading even the first wheel.
        prefix = output_dir / 'runtime-env'; python = prefix / 'bin/python'
        overlay_process([IMAGE_PYTHON, '-m', 'venv', '--system-site-packages', str(prefix)], deadline)
        wheelhouse = output_dir / 'wheelhouse'
        transferred = download_overlay_wheels(lock, wheelhouse, deadline)
        requirements = output_dir / 'requirements.txt'
        requirements.write_text(''.join(f"{w['name']}=={w['version']} --hash=sha256:{w['sha256']}\n" for w in lock['wheels']))
        overlay_process(overlay_install_command(python, wheelhouse, requirements), deadline)
        actual = overlay_process([str(python), '-c', IMAGE_PROBE], deadline, capture=True)
        validate_image_runtime(actual, overlay_prefix=prefix)
        require(actual['torch_file'] == base['torch_file'] and actual['base_prefix'] == base['base_prefix'], 'Image Torch replaced')
        packages = overlay_process([str(python), '-c',
            'import importlib.metadata as m,json,pathlib; from transformers import AutoTokenizer,Qwen3_5ForConditionalGeneration; '
            'print(json.dumps({n:{"version":m.version(n),"path":str(pathlib.Path(m.distribution(n).locate_file("")).resolve())}'
            ' for n in ' + repr([w['name'] for w in lock['wheels']]) + '}))'], deadline, capture=True)
        report = seal({'schema_version': 1, 'evidence': 'actual_image_overlay_runtime', 'job_sha256': job['job_sha256'],
            'profile_sha256': profile['profile_sha256'], 'overlay_lock_sha256': lock['manifest_sha256'],
            'image_proof_sha256': IMAGE_PROOF, 'installer_sha256': job['source_files_sha256']['observer_experiment_job.py'],
            'base': base, 'runtime': actual, 'packages': packages,
            'verified_wheels': {w['filename']: w['sha256'] for w in lock['wheels']},
            'transferred_bytes_including_retries': transferred, 'elapsed_seconds': time.monotonic() - started}, 'environment_sha256')
        validate_environment(job, report)
        write_bounded(output_dir / 'environment.json', report, MAX_INPUT)
    return report


def validate_environment(job, report):
    check_seal(report, 'environment_sha256'); profile = job['dependency_profile']; lock = profile['lock']
    require(report['schema_version'] == 1 and report['evidence'] == 'actual_image_overlay_runtime'
        and report['job_sha256'] == job['job_sha256'] and report['profile_sha256'] == profile['profile_sha256']
        and report['overlay_lock_sha256'] == OVERLAY_LOCK and report['image_proof_sha256'] == IMAGE_PROOF
        and report['installer_sha256'] == job['source_files_sha256']['observer_experiment_job.py'], 'Environment binding mismatch')
    validate_image_runtime(report['base'])
    prefix = Path(report['runtime']['prefix']); validate_image_runtime(report['runtime'], overlay_prefix=prefix)
    require(prefix.is_absolute() and report['runtime']['torch_file'] == report['base']['torch_file']
        and report['runtime']['base_prefix'] == report['base']['base_prefix'], 'Image Torch/base changed')
    expected = {w['name']: w['version'] for w in lock['wheels']}
    require({n: p['version'] for n, p in report['packages'].items()} == expected
        and all(Path(p['path']).is_relative_to(prefix) for p in report['packages'].values()), 'Overlay package version/path mismatch')
    require(report['verified_wheels'] == {w['filename']: w['sha256'] for w in lock['wheels']}
        and type(report['transferred_bytes_including_retries']) is int
        and lock['total_wheel_bytes'] <= report['transferred_bytes_including_retries'] <= 64 * 1024**2
        and type(report['elapsed_seconds']) in (int, float) and 0 <= report['elapsed_seconds'] <= 300, 'Overlay byte/time/hash evidence mismatch')


def check_overlay_process(job, report):
    validate_environment(job, report)
    require(sys.executable == report['runtime']['executable'] and sys.version_info[:2] == (3, 12), 'Worker interpreter mismatch')
    # Recheck imported code/runtime without trusting the earlier report alone.
    import importlib.metadata as metadata
    import torch
    require(torch.__version__ == GPU_SOFTWARE['torch'] and torch.version.cuda == '12.8'
        and str(Path(torch.__file__).resolve()) == report['base']['torch_file']
        and torch.cuda.is_available() and torch.cuda.is_bf16_supported(), 'Worker Torch/CUDA changed')
    for name, package in report['packages'].items():
        require(metadata.version(name) == package['version']
            and str(Path(metadata.distribution(name).locate_file('')).resolve()) == package['path'], 'Worker overlay changed')


def alias(kind, value):
    return kind + '-' + core.digest(value)  # Full digest; no collision-prone truncation.


def project_experiment_input(plan, source_records=None):
    """Alias the *full* closure; keep private metadata and original identities local."""
    experiment.validate_plan(plan)
    originals = {r['record_id']: r for r in source_records or []}
    require(len(originals) == len(source_records or []), 'Duplicate original record')
    require(not originals or set(originals) == set(plan['source_record_sha256']), 'Original source set mismatch')
    config = {k: deepcopy(plan['config'][k]) for k in ('schema_version', 'mode', 'poolings', 'epsilons',
        'seeds', 'calibration_seed') if k in plan['config']}
    observer = plan['config']['observer']
    config['observer'] = {k: deepcopy(observer[k]) for k in ('model', 'model_revision', 'tokenizer_revision',
        'sae_model', 'sae_revision', 'device', 'dtype', 'max_tokens')}
    config['observer']['layers'] = [{k: l[k] for k in ('layer', 'module', 'sae_sha256', 'feature',
        'unrelated_feature') if k in l} for l in observer['layers']]
    for key in ('calibration_record_ids', 'evaluation_record_ids'):
        config[key] = [alias('record', r) for r in plan['config'].get(key, [])]
    splits = {'schema_version': 1, 'source_manifest_sha256': plan['split_manifest']['source_manifest_sha256'],
        'families': {alias('family', f): {'split': s['split'], 'group_ids': [alias('group', g) for g in s['group_ids']]}
            for f, s in plan['split_manifest']['families'].items()}}
    card = {k: deepcopy(plan['concept_card'][k]) for k in ('schema_version', 'target', 'definition',
        'boundary', 'observer_binding')}
    review = plan['concept_card']['source_review']
    card['source_review'] = {k: review[k] for k in ('status', 'evidence_sha256', 'source_manifest_sha256')}
    card['source_review'].update(reviewer=alias('reviewer', review['reviewer']), review_id=alias('review', review['review_id']))
    if config.get('mode', 'intervention') == 'intervention':
        card['feature_reviews'] = {str(l['layer']): {k: plan['concept_card']['feature_reviews'][str(l['layer'])][k]
            for k in ('feature', 'unrelated_feature', 'evidence_sha256', 'selection_split', 'unrelated_rationale')}
            for l in config['observer']['layers']}
    public, local = [], {}
    for record in plan['records']:
        rid = record['record_id']; view = core.boundary_view(record)
        if originals:
            require(core.digest(originals[rid]) == plan['source_record_sha256'][rid], 'Original source hash mismatch')
        clean = {'record_id': alias('record', rid), 'family_id': alias('family', record['family_id']),
            'group_ids': [alias('group', g) for g in record['group_ids']], 'split': record['split'],
            'boundary': record['boundary'], 'latest_allowed_event_id': alias('event', record['latest_allowed_event_id']),
            'spans': [{**{k: s[k] for k in ('start', 'end')}, 'event_id': alias('event', s['event_id'])} for s in record['spans']],
            'events': []}
        for event in record['events']:
            if event['event_id'] not in view['included_event_ids']:
                continue
            item = {k: event[k] for k in ('phase', 'visibility', 'kind', 'text')}
            item['event_id'] = alias('event', event['event_id'])
            if 'receipt_id' in event:
                item['receipt_id'] = alias('receipt', event['receipt_id'])
            clean['events'].append(item)
        require(core.boundary_view(clean)['text'] == view['text'], 'Transport changed observer text')
        public.append(clean)
        local[clean['record_id']] = {'record_id': rid, 'family_id': record['family_id'],
            'group_ids': record['group_ids'], 'split': record['split'], 'original_record_sha256': plan['source_record_sha256'][rid],
            'metadata': {k: deepcopy(originals[rid][k]) for k in ('labels', 'label_provenance', 'source')
                         if originals and k in originals[rid]}}
    uploaded = experiment.prepare(config, public, card, splits)
    join = {'schema_version': 1, 'source_plan_sha256': plan['plan_sha256'],
        'source_concept_card_sha256': plan['concept_card_sha256'], 'source_split_manifest_sha256': plan['split_manifest_sha256'],
        'uploaded_plan_sha256': uploaded['plan_sha256'], 'records': local,
        'families': {alias('family', f): deepcopy(s) | {'family_id': f} for f, s in plan['split_manifest']['families'].items()}}
    return uploaded, seal(join, 'join_sha256')


def metadata_url(repo, revision):
    require(repo in (extract.MODEL, extract.DICTIONARY) and experiment.identity(revision, 40), 'Pinned official repository required')
    return f'https://huggingface.co/api/models/{repo}/revision/{revision}?blobs=true'


def repository_roles(plan):
    observer = plan['config']['observer']
    roles = {}
    for role, repo, revision in [('model', observer['model'], observer['model_revision']),
            ('tokenizer', observer['model'], observer['tokenizer_revision']),
            ('sae', observer['sae_model'], observer['sae_revision'])]:
        roles.setdefault((repo, revision), []).append(role)
    return roles


def inventory_from_metadata(plan, documents):
    """Derive exact loader file selection from official revision metadata, no weights."""
    experiment.validate_plan(plan)
    roles = repository_roles(plan)
    require(set(documents) == set(roles), 'Missing or extra metadata revisions')
    assets, sources = [], []
    layers = {f'layer{l["layer"]}.sae.pt': l['sae_sha256'] for l in plan['config']['observer']['layers']}
    for (repo, revision), jobs in roles.items():
        data = documents[(repo, revision)]
        require(data['sha'] == revision and data['id'] == repo, 'Official metadata revision/repository mismatch')
        sources.append({'repo': repo, 'revision': revision, 'url': metadata_url(repo, revision), 'metadata_sha256': core.digest(data)})
        names = set()
        for item in data['siblings']:
            name = item['rfilename']
            require(name not in names, 'Duplicate Hub filename'); names.add(name)
            # Existing loader consumes only root-level weights/config/tokenizer files.
            if '/' in name or '\\' in name or name in ('.', '..'):
                continue
            needed = []
            if 'model' in jobs and name.endswith(('.safetensors', '.json')): needed.append('model')
            if 'tokenizer' in jobs and name.endswith(('.json', '.txt', '.model', '.jinja')): needed.append('tokenizer')
            if 'sae' in jobs and name in layers: needed.append('sae')
            if not needed: continue
            size = item['size']; lfs = item.get('lfs')
            require(type(size) is int and size > 0, 'Exact positive asset byte size required')
            oid = {'algorithm': 'sha256', 'value': lfs['sha256']} if lfs else {'algorithm': 'git_blob_sha1', 'value': item['blobId']}
            require(experiment.identity(oid['value'], 64 if lfs else 40), 'Exact asset object hash required')
            if lfs: require(lfs['size'] == size, 'Hub LFS size mismatch')
            if 'sae' in needed:
                require(lfs and oid['value'] == layers[name], 'Declared SAE hash disagrees with official pinned metadata')
            assets.append({'repo': repo, 'revision': revision, 'filename': name, 'size': size, 'oid': oid, 'roles': needed})
        if 'sae' in jobs: require(set(layers) <= names, 'Missing selected layer in pinned release')
        if 'model' in jobs: require('config.json' in names and any(n.endswith('.safetensors') for n in names), 'Missing model assets')
        if 'tokenizer' in jobs: require('tokenizer.json' in names and 'tokenizer_config.json' in names, 'Missing fast tokenizer assets')
    return seal({'schema_version': 1, 'kind': 'pinned_hub_asset_inventory', 'sources': sources,
        'assets': sorted(assets, key=lambda a: (a['repo'], a['revision'], a['filename'])),
        'total_bytes': sum(a['size'] for a in assets)}, 'inventory_sha256')


def fetch_metadata(plan, *, opener=None):
    experiment.validate_plan(plan)
    opener = opener or urllib.request.urlopen
    documents = {}
    for repo, revision in repository_roles(plan):
        url = metadata_url(repo, revision)
        with opener(url, timeout=30) as response:
            require(response.geturl() == url, 'Unexpected metadata redirect')
            body = response.read(MAX_INPUT + 1)
        require(len(body) <= MAX_INPUT, 'Hub metadata exceeds bound')
        documents[(repo, revision)] = json.loads(body)
    return inventory_from_metadata(plan, documents)


def validate_inventory(plan, inventory):
    check_seal(inventory, 'inventory_sha256')
    require(inventory['schema_version'] == 1 and inventory['kind'] == 'pinned_hub_asset_inventory', 'Invalid inventory')
    roles = repository_roles(plan); keys = set(); groups = {key: [] for key in roles}
    sources = {(s['repo'], s['revision']): s for s in inventory['sources']}
    require(len(sources) == len(inventory['sources']) and set(sources) == set(roles), 'Inventory revision set mismatch')
    for key, source in sources.items():
        require(source['url'] == metadata_url(*key) and experiment.identity(source['metadata_sha256']), 'Inventory source mismatch')
    for asset in inventory['assets']:
        key = (asset['repo'], asset['revision']); name = asset['filename']
        require(key in roles and re.fullmatch(r'[A-Za-z0-9_.-]+', name) and name not in ('.', '..'), 'Unsafe inventory asset')
        require((key, name) not in keys, 'Duplicate inventory asset'); keys.add((key, name)); groups[key].append(asset)
        require(type(asset['size']) is int and asset['size'] > 0, 'Invalid asset size')
        oid = asset['oid']; algorithm = oid['algorithm']
        require(algorithm in ('sha256', 'git_blob_sha1') and experiment.identity(oid['value'], 64 if algorithm == 'sha256' else 40), 'Invalid asset hash')
        expected_roles = [r for r in roles[key] if (r == 'model' and name.endswith(('.json', '.safetensors')))
            or (r == 'tokenizer' and name.endswith(('.json', '.txt', '.model', '.jinja')))
            or (r == 'sae' and name in {f'layer{l["layer"]}.sae.pt' for l in plan['config']['observer']['layers']})]
        require(asset['roles'] == expected_roles and expected_roles, 'Unapproved inventory file/role')
    observer = plan['config']['observer']
    for key, group in groups.items():
        names = {a['filename'] for a in group}
        if 'model' in roles[key]: require('config.json' in names and any(n.endswith('.safetensors') for n in names), 'Missing model assets')
        if 'tokenizer' in roles[key]: require({'tokenizer.json', 'tokenizer_config.json'} <= names, 'Missing tokenizer assets')
        if 'sae' in roles[key]:
            require(names == {f'layer{l["layer"]}.sae.pt' for l in observer['layers']}, 'SAE layer set mismatch')
            for layer in observer['layers']:
                a = next(a for a in group if a['filename'] == f'layer{layer["layer"]}.sae.pt')
                require(a['oid'] == {'algorithm': 'sha256', 'value': layer['sae_sha256']}, 'SAE hash mismatch')
    require(inventory['total_bytes'] == sum(a['size'] for a in inventory['assets']), 'Inventory byte total mismatch')


def validate_limits(limits):
    for key, ceiling in [('max_tokens', MAX_TOKENS), ('max_forward_passes', 4096),
            ('max_forward_tokens', 4096 * MAX_TOKENS), ('max_asset_bytes', 70 * 1024**3),
            ('max_result_bytes', MAX_FILE - 1), ('max_log_bytes', 8 * 1024**2)]:
        require(type(limits.get(key)) is int and 0 < limits[key] <= ceiling, 'Invalid explicit limit: ' + key)
    for key in ('cost_cap_usd', 'hour_cap', 'hourly_cap_usd'):
        require(type(limits.get(key)) in (str, int, float), 'Numeric cost limit required')
        value = Decimal(str(limits[key]))
        require(value.is_finite() and value > 0, 'Invalid finite positive cost limit')
    hours, rate, cap = [Decimal(str(limits[k])) for k in ('hour_cap', 'hourly_cap_usd', 'cost_cap_usd')]
    require(Decimal('.1') <= hours <= 2 and cap >= hours * rate + Decimal('.10'), 'Cost/hour caps lack preservation reserve')


def prepare_job(plan, inventory, limits, source_records=None, *, dependencies=None):
    uploaded, join = project_experiment_input(plan, source_records)
    validate_inventory(uploaded, inventory); validate_limits(limits)
    observer = uploaded['config']['observer']
    require(observer['device'] == 'cuda' and observer['dtype'] == 'bfloat16', 'Worker requires declared CUDA BF16 observer')
    require(observer['max_tokens'] <= limits['max_tokens'], 'Record token limit exceeds worker cap')
    passes = uploaded['trial_count'] + len(observer['layers']) * len(uploaded['config'].get('calibration_record_ids', []))
    require(passes <= limits['max_forward_passes'], 'Forward pass limit includes calibration')
    require(inventory['total_bytes'] <= limits['max_asset_bytes'], 'Asset byte cap exceeded')
    by_id = {r['record_id']: r for r in uploaded['records']}
    raw_allowance = sum(4096 * 32 * sum(len(by_id[t['record_id']]['spans']) if p == 'per_span_mean' else 1
        for p in t['poolings']) for t in uploaded['trials'])
    require(raw_allowance <= limits['max_result_bytes'], 'Raw-vector JSON allowance exceeds per-file cap; split the declared job')
    job = {'schema_version': 1, 'kind': 'observer_experiment_job', 'mode': uploaded['config'].get('mode', 'intervention'),
        'experiment': uploaded, 'source_plan_sha256': plan['plan_sha256'], 'join_sha256': join['join_sha256'],
        'inventory': deepcopy(inventory), 'limits': deepcopy(limits), 'forward_passes': passes, 'raw_json_allowance_bytes': raw_allowance,
        'source_files_sha256': {name: extract.file_hash(Path(__file__).with_name(name)) for name in SOURCE_NAMES},
        'software': GPU_SOFTWARE}
    if dependencies is not None:
        validate_dependency_profile(dependencies)
        job['dependency_profile'] = deepcopy(dependencies)
    seal(job, 'job_sha256')
    require(len(core.canonical(job).encode()) <= MAX_INPUT, 'Prepared upload exceeds 2 MiB')
    return job, join


def validate_job(job, *, check_code=False):
    check_seal(job, 'job_sha256'); experiment.validate_plan(job['experiment'])
    require(job['schema_version'] == 1 and job['kind'] == 'observer_experiment_job', 'Invalid worker job')
    require(job['mode'] == job['experiment']['config'].get('mode', 'intervention'), 'Worker mode mismatch')
    validate_inventory(job['experiment'], job['inventory']); validate_limits(job['limits'])
    require(experiment.identity(job['source_plan_sha256']) and experiment.identity(job['join_sha256']), 'Source/join hashes required')
    require(job['software'] == GPU_SOFTWARE and set(job['source_files_sha256']) == set(SOURCE_NAMES)
            and all(experiment.identity(v) for v in job['source_files_sha256'].values()), 'Exact worker dependencies required')
    if 'dependency_profile' in job: validate_dependency_profile(job['dependency_profile'])
    observer = job['experiment']['config']['observer']
    require(observer['device'] == 'cuda' and observer['dtype'] == 'bfloat16'
            and observer['max_tokens'] <= job['limits']['max_tokens'], 'Worker runtime/token cap mismatch')
    passes = job['experiment']['trial_count'] + len(observer['layers']) * len(job['experiment']['config'].get('calibration_record_ids', []))
    require(job['forward_passes'] == passes <= job['limits']['max_forward_passes'], 'Worker forward count/cap mismatch')
    require(job['inventory']['total_bytes'] <= job['limits']['max_asset_bytes'], 'Worker asset cap mismatch')
    by_id = {r['record_id']: r for r in job['experiment']['records']}
    raw_allowance = sum(4096 * 32 * sum(len(by_id[t['record_id']]['spans']) if p == 'per_span_mean' else 1
        for p in t['poolings']) for t in job['experiment']['trials'])
    require(job['raw_json_allowance_bytes'] == raw_allowance <= job['limits']['max_result_bytes'], 'Raw-vector result cap mismatch')
    require(len(core.canonical(job).encode()) <= MAX_INPUT, 'Worker input exceeds 2 MiB')
    if check_code:
        require(job['source_files_sha256'] == {n: extract.file_hash(Path(__file__).with_name(n)) for n in SOURCE_NAMES}, 'Worker source code changed')


def check_runtime(job, runtime, *, now=None, fresh=False):
    """Check parent-supplied rate observation/deadline; never query a provider."""
    now = time.time() if now is None else now
    for key in ('creation_started_at', 'rate_observed_at', 'observed_gpu_hourly_rate'):
        require(type(runtime.get(key)) in (int, float) and math.isfinite(runtime[key]), 'Finite runtime evidence required')
    require(runtime['observed_gpu_hourly_rate'] >= 0 and runtime['creation_started_at'] <= now, 'Invalid runtime evidence')
    require(runtime['creation_started_at'] <= runtime['rate_observed_at'] <= now, 'Invalid rate timestamp')
    if fresh: require(now - runtime['rate_observed_at'] <= 900, 'Initial rate observation expired')
    observed = Decimal(str(runtime['observed_gpu_hourly_rate'])) + RUNNING_STORAGE_RATE
    require(observed <= Decimal(str(job['limits']['hourly_cap_usd'])), 'Observed GPU plus storage exceeds hourly cap')
    deadline = runtime['creation_started_at'] + float(job['limits']['hour_cap']) * 3600 - CLEANUP_SECONDS
    require(now < deadline, 'Work deadline exhausted; cleanup reserve cannot be used')
    return deadline - now


@contextmanager
def deadline_guard(seconds):
    """Unix worker alarm; parent must still kill the process group/cloud job."""
    def expired(_signum, _frame):
        raise TimeoutError('Worker deadline exhausted')
    require(seconds > 0 and hasattr(signal, 'setitimer'), 'Positive Unix worker deadline required')
    previous = signal.getsignal(signal.SIGALRM); timer = signal.getitimer(signal.ITIMER_REAL)
    require(timer == (0.0, 0.0), 'Do not replace an existing deadline')
    signal.signal(signal.SIGALRM, expired); signal.setitimer(signal.ITIMER_REAL, seconds)
    try: yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0); signal.signal(signal.SIGALRM, previous)


def asset_key(asset):
    return (asset['repo'], asset['revision'], asset['filename'])


def verify_asset(path, asset):
    path = Path(path)
    require(path.is_file() and path.stat().st_size == asset['size'], 'Materialized asset byte size mismatch')
    sha256 = hashlib.sha256(); git = hashlib.sha1(f'blob {asset["size"]}\0'.encode())
    count = 0
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024**2), b''):
            count += len(chunk); require(count <= asset['size'], 'Asset grew while hashing')
            sha256.update(chunk); git.update(chunk)
    require(count == asset['size'], 'Asset changed while hashing')
    hashes = {'sha256': sha256.hexdigest(), 'git_blob_sha1': git.hexdigest()}
    require(hashes[asset['oid']['algorithm']] == asset['oid']['value'], 'Materialized asset object hash mismatch')
    return {k: asset[k] for k in ('repo', 'revision', 'filename', 'size')} | hashes


def materialize(job, cache_dir, runtime, *, allow_download=False, fetcher=None):
    """Explicit later-worker materialization; injected fetcher is an offline test seam."""
    validate_job(job, check_code=True)
    seconds = check_runtime(job, runtime, fresh=True)
    cache_dir = Path(cache_dir).resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)
    missing_errors = (FileNotFoundError,)
    if fetcher is None:
        from huggingface_hub import hf_hub_download
        from huggingface_hub.errors import LocalEntryNotFoundError
        fetcher = hf_hub_download
        missing_errors += (LocalEntryNotFoundError,)
    paths, missing = {}, []
    with deadline_guard(seconds):
        for asset in job['inventory']['assets']:
            try:
                paths[asset_key(asset)] = fetcher(asset['repo'], asset['filename'], revision=asset['revision'],
                    cache_dir=str(cache_dir), local_files_only=True, token=False)
            except missing_errors:
                missing.append(asset)
        require(allow_download or not missing, 'Pinned cache is incomplete; materialize requires explicit --allow-download')
        if missing:
            # Allow a complete staged copy plus package/runtime headroom.
            needed = 2 * sum(a['size'] for a in missing) + 8 * 1024**3
            require(shutil.disk_usage(cache_dir).free >= needed, 'Insufficient cache/staging disk headroom')
        for asset in missing:
            check_runtime(job, runtime)
            paths[asset_key(asset)] = fetcher(asset['repo'], asset['filename'], revision=asset['revision'],
                cache_dir=str(cache_dir), local_files_only=False, token=False)
        actual = []
        for asset in job['inventory']['assets']:
            check_runtime(job, runtime)
            path = Path(paths[asset_key(asset)]).resolve()
            require(path.is_relative_to(cache_dir), 'Hub asset resolved outside declared cache')
            actual.append(verify_asset(path, asset))
    return seal({'schema_version': 1, 'job_sha256': job['job_sha256'], 'inventory_sha256': job['inventory']['inventory_sha256'],
        'assets': actual, 'total_bytes': sum(a['size'] for a in actual),
        'missing_before_materialization': [list(asset_key(a)) for a in missing]}, 'materialization_sha256')


def validate_materialization(job, report):
    check_seal(report, 'materialization_sha256')
    require(report['job_sha256'] == job['job_sha256'] and report['inventory_sha256'] == job['inventory']['inventory_sha256'], 'Materialization binding mismatch')
    expected = {asset_key(a): a for a in job['inventory']['assets']}
    actual = {asset_key(a): a for a in report['assets']}
    require(len(actual) == len(report['assets']) and set(actual) == set(expected), 'Materialization asset set mismatch')
    for key, asset in actual.items():
        pin = expected[key]
        require(asset['size'] == pin['size'] and asset[pin['oid']['algorithm']] == pin['oid']['value']
            and experiment.identity(asset['sha256']) and experiment.identity(asset['git_blob_sha1'], 40), 'Materialization hash/size mismatch')
    require(report['total_bytes'] == job['inventory']['total_bytes'], 'Materialization byte total mismatch')


def workload(job, records):
    plan = job['experiment']; config = plan['config']; limits = job['limits']
    by_id = {r['record_id']: r for r in records}
    require(len(by_id) == len(records) and set(by_id) == {r['record_id'] for r in plan['records']}, 'Preflight record set mismatch')
    for source in plan['records']:
        row = by_id[source['record_id']]; view = core.boundary_view(source)
        ids, offsets, attention = row['input_token_ids'], row['offsets'], row['attention_mask']
        require(row['view_sha256'] == core.digest(view) and 1 <= len(ids) <= limits['max_tokens'], 'Preflight view/token bound mismatch')
        require(all(type(t) is int and t >= 0 for t in ids) and len(offsets) == len(attention) == len(ids)
            and all(type(t) is int and t in (0, 1) for t in attention), 'Invalid preflight tokens/attention')
        require(all(isinstance(o, (list, tuple)) and len(o) == 2 and all(type(v) is int for v in o)
            and 0 <= o[0] <= o[1] <= len(view['text']) for o in offsets), 'Invalid character offsets')
        selected = core.token_spans(view['text'], offsets, view['spans'], attention)
        spans = [core.token_spans(view['text'], offsets, [s], attention) for s in view['spans']]
        require(row['selected_token_indices'] == selected and row['span_token_indices'] == spans, 'Preflight selected span mismatch')
    cal = config.get('calibration_record_ids', [])
    tokens = sum(len(by_id[t['record_id']]['input_token_ids']) for t in plan['trials'])
    tokens += len(config['observer']['layers']) * sum(len(by_id[r]['input_token_ids']) for r in cal)
    require(tokens <= limits['max_forward_tokens'], 'Aggregate forward-token limit exceeded (including calibration)')
    # Deliberately conservative JSON upper estimate; enforce actual bytes too.
    estimate = 8 * 1024**2 + sum(len(core.canonical(r).encode()) for r in records) * len(config['observer']['layers'])
    for trial in plan['trials']:
        row = by_id[trial['record_id']]
        estimate += len(core.canonical(row).encode()) + 8192 + (4096 * 32 if job['mode'] == 'intervention' else 0)
        estimate += len(row['selected_token_indices']) * (50 * 48 + 256)
        for pooling in trial['poolings']:
            subsets = [row['selected_token_indices']] if pooling == experiment.POOLINGS[0] else \
                [[row['selected_token_indices'][-1]]] if pooling == experiment.POOLINGS[1] else row['span_token_indices']
            for selection in subsets:
                estimate += 4096 * 32 + min(65536, len(selection) * 50) * 48 + len(selection) * 8 + 4096
    require(estimate <= limits['max_result_bytes'], 'Projected result exceeds per-file cap; split the declared job')
    return {'forward_passes': job['forward_passes'], 'forward_tokens': tokens, 'estimated_result_bytes_upper': estimate}


def preflight(job, tokenizer):
    """Actual exact tokenizer pass, before loading the model or spending forwards."""
    validate_job(job)
    rows = []
    for record in job['experiment']['records']:
        view = core.boundary_view(record)
        encoded = tokenizer(view['text'], return_offsets_mapping=True, add_special_tokens=False, truncation=False)
        ids = encoded['input_ids']; offsets = [list(o) for o in encoded['offset_mapping']]; attention = encoded['attention_mask']
        require(isinstance(ids, list) and isinstance(attention, list), 'Unbatched exact tokenizer lists required')
        rows.append({'record_id': record['record_id'], 'view_sha256': core.digest(view),
            'input_token_ids': ids, 'offsets': offsets, 'attention_mask': attention,
            'selected_token_indices': core.token_spans(view['text'], offsets, view['spans'], attention),
            'span_token_indices': [core.token_spans(view['text'], offsets, [s], attention) for s in view['spans']]})
    counts = workload(job, rows)
    return seal({'schema_version': 1, 'job_sha256': job['job_sha256'], 'records': rows, **counts}, 'preflight_sha256')


def validate_preflight(job, report):
    check_seal(report, 'preflight_sha256')
    require(report['job_sha256'] == job['job_sha256'], 'Preflight job mismatch')
    require(all(report[k] == v for k, v in workload(job, report['records']).items()), 'Preflight workload mismatch')


def cached_tokenizer(job, materialization, cache_dir):
    if materialization is not None: validate_materialization(job, materialization)
    from huggingface_hub import hf_hub_download, constants
    from transformers import AutoTokenizer
    cache_dir = Path(cache_dir).resolve()
    require(Path(constants.HF_HUB_CACHE).resolve() == cache_dir, 'Set HF_HUB_CACHE before starting this process')
    observer = job['experiment']['config']['observer']; folder = None
    for asset in job['inventory']['assets']:
        if 'tokenizer' not in asset['roles']: continue
        path = Path(hf_hub_download(asset['repo'], asset['filename'], revision=asset['revision'], cache_dir=str(cache_dir), local_files_only=True, token=False))
        require(path.resolve().is_relative_to(cache_dir), 'Tokenizer resolved outside pinned cache')
        verify_asset(path, asset); folder = path.parent
    require(folder is not None, 'Missing cached tokenizer')
    tokenizer = AutoTokenizer.from_pretrained(folder, local_files_only=True, trust_remote_code=False, use_fast=True)
    require(tokenizer.is_fast, 'Fast tokenizer offsets required')
    return tokenizer


def finite_numbers(values, length=None):
    return isinstance(values, list) and (length is None or len(values) == length) and all(type(v) in (int, float) and math.isfinite(v) for v in values)


def fingerprint(value, shape=None):
    require(isinstance(value, dict) and experiment.identity(value.get('sha256'))
        and value.get('dtype') in ('torch.float32', 'torch.bfloat16', 'torch.float64', 'torch.float16')
        and isinstance(value.get('shape'), list) and all(type(n) is int and n > 0 for n in value['shape'])
        and (shape is None or value['shape'] == shape), 'Invalid tensor fingerprint')


def validate_experiment_result(job, result, flight, materialization, *, partial=False):
    """Stdlib-only strict import validation; never turns tensor evidence into outcomes."""
    validate_job(job); validate_preflight(job, flight); validate_materialization(job, materialization)
    check_seal(result, 'result_sha256'); core.canonical(result)
    plan = job['experiment']; config = plan['config']; observer = config['observer']
    require(result['evidence'] == ('incomplete_local_pinned_model_forward_experiment' if partial else 'local_pinned_model_forward_experiment'), 'Injected/test evidence cannot be imported as model execution')
    if partial: require(result.get('fit_eligible') is False, 'Incomplete execution cannot be fit eligible')
    require(result['plan_sha256'] == plan['plan_sha256'] and result['concept_card_sha256'] == plan['concept_card_sha256']
        and result['split_manifest_sha256'] == plan['split_manifest_sha256'], 'Experiment source/plan binding mismatch')
    require(result['measurement_contract'] == {'mode': job['mode'], 'poolings': config['poolings'], 'hook': 'residual_post_block'}, 'Measurement mode/pooling mismatch')
    require(result['implementation_files_sha256'] == {n: job['source_files_sha256'][n] for n in SOURCE_NAMES[:-1]}, 'Experiment implementation hash mismatch')
    actual_assets = {asset_key(a): a for a in materialization['assets']}
    manifests = {m['layer']: m for m in result['observer_manifests']}
    expected_layers = {l['layer'] for l in observer['layers']}
    require(len(manifests) == len(result['observer_manifests']) and set(manifests) <= expected_layers
        and (partial or set(manifests) == expected_layers), 'Layer manifest set mismatch')
    for layer in observer['layers']:
        if layer['layer'] not in manifests: continue
        manifest = manifests[layer['layer']]
        experiment.validate_loaded(manifest, observer, layer, core.SAESpec(), False)
        require(manifest['max_tokens'] == observer['max_tokens'] and manifest['truncation'] is False
            and manifest['encoding'] == 'affine_then_signed_topk_no_relu_no_centering'
            and manifest['sae_file'] == f'layer{layer["layer"]}.sae.pt', 'Observer extraction convention mismatch')
        require(manifest['implementation_files_sha256'] == {n: job['source_files_sha256'][n] for n in SOURCE_NAMES[:3]}, 'Loader implementation hash mismatch')
        require(all(manifest['software'].get(n) == v for n, v in GPU_SOFTWARE.items()), 'Worker runtime dependency mismatch')
        for role, category in [('model', 'model_files_sha256'), ('tokenizer', 'tokenizer_files_sha256')]:
            expected = {a['filename']: actual_assets[asset_key(a)]['sha256'] for a in job['inventory']['assets']
                if role in a['roles'] and (role != 'model' or a['filename'].endswith('.safetensors'))}
            require(manifest[category] == expected, 'Actual model/tokenizer file hashes mismatch')
        require(manifest['config_sha256'] == actual_assets[(observer['model'], observer['model_revision'], 'config.json')]['sha256'], 'Model config mismatch')
    records = {r['record_id']: r for r in plan['records']}; tokenized = {r['record_id']: r for r in flight['records']}
    calibrations = {r['layer']: r for r in result['calibrations']}
    require(len(calibrations) == len(result['calibrations']), 'Duplicate calibration layer')
    require(set(calibrations) == (set(manifests) if job['mode'] == 'intervention' else set()), 'Calibration mode/layer mismatch')
    for layer, calibration in calibrations.items():
        require(type(calibration['scale']) in (int, float) and math.isfinite(calibration['scale']) and calibration['scale'] > 0
            and calibration['seed'] == config['calibration_seed'] and calibration['rule'] == 'median_selected_calibration_vector_l2_norm'
            and calibration['observer_manifest_sha256'] == core.digest(manifests[layer]), 'Calibration scale/seed mismatch')
        require([r['record_id'] for r in calibration['records']] == config['calibration_record_ids'], 'Calibration record set/order mismatch')
        for row in calibration['records']:
            source = tokenized[row['record_id']]
            require(records[row['record_id']]['split'] == row['split'] == 'calibration'
                and all(row[k] == source[k] for k in ('view_sha256', 'input_token_ids', 'selected_token_indices')), 'Calibration temporal/token mismatch')
            fingerprint(row['residual'], [len(source['selected_token_indices']), 4096])
    rows = result['rows']; trials = {t['trial_id']: t for t in plan['trials']}
    require(len(rows) == result['completed_trials'] and len({r['trial_id'] for r in rows}) == len(rows)
        and [r['trial_id'] for r in rows] == list(trials)[:len(rows)]
        and len(rows) <= len(trials) and (partial or len(rows) == len(trials)), 'Missing, duplicate or extra trial results')
    directions = {}
    for row in rows:
        trial = trials[row['trial_id']]; record = records[trial['record_id']]; view = core.boundary_view(record); tokens = tokenized[trial['record_id']]
        require(all(row[k] == v for k, v in trial.items()), 'Returned trial differs from exact matrix')
        require(all(row[k] == record[k] for k in ('family_id', 'group_ids', 'split', 'boundary')), 'Result source group/split mismatch')
        require(row['source_record_sha256'] == plan['source_record_sha256'][record['record_id']]
            and row['view_sha256'] == tokens['view_sha256'] and row['spans'] == view['spans']
            and row['latest_allowed_event_id'] == view['latest_allowed_event_id'], 'Result source hash/temporal boundary mismatch')
        require(all(row[k] == tokens[k] for k in ('input_token_ids', 'selected_token_indices'))
            and row['selected_offsets'] == [tokens['offsets'][t] for t in tokens['selected_token_indices']], 'Result exact token/offset mismatch')
        require(row['observer_manifest_sha256'] == core.digest(manifests[trial['layer']]), 'Row/layer manifest mismatch')
        require(row['settings']['seed'] == trial['seed'] and row['settings']['use_cache'] is False
            and row['settings']['model_mode'] == 'eval' and type(row['settings']['deterministic_algorithms']) is bool, 'Actual forward settings mismatch')
        require(row['independent_behavior_review'] == {'status': 'unknown', 'outcome': None, 'review_id': None}
            and row['readout_quality'] is None and row['causal_behavior_effect'] is None, 'Worker cannot invent independent outcomes')
        for key in ('residual_before', 'residual_after'):
            fingerprint(row[key], [1, len(tokens['input_token_ids']), 4096])
        fingerprint(row['downstream_tensor'], [1, len(tokens['input_token_ids']), 4096])
        delta = row['actual_selected_delta_norm']
        require(finite_numbers([delta['min'], delta['mean'], delta['max'], row['unselected_delta_norm_max']])
            and 0 <= delta['min'] <= delta['mean'] <= delta['max'] and row['unselected_delta_norm_max'] == 0, 'Invalid/nonlocal perturbation measurements')
        if job['mode'] == 'readout':
            require(row['direction'] is None and row['scale'] is None and row['calibration_sha256'] is None
                and row['requested_delta_norm'] == 0, 'Readout cannot claim intervention direction/scale')
        else:
            calibration = calibrations[trial['layer']]
            require(row['scale'] == calibration['scale'] and row['calibration_sha256'] == core.digest(calibration)
                and row['requested_delta_norm'] == abs(trial['epsilon']) * row['scale'], 'Intervention scale/hash mismatch')
            direction = row['direction']; fingerprint(direction, [4096])
            vector = direction['unit_vector']
            require(finite_numbers(vector, 4096) and math.isclose(sum(v*v for v in vector), 1, abs_tol=1e-5), 'Non-unit intervention direction')
            import struct
            require(direction['dtype'] == 'torch.float32' and direction['sha256'] == hashlib.sha256(struct.pack('<4096f', *vector)).hexdigest(), 'Direction vector fingerprint mismatch')
            layer = next(l for l in observer['layers'] if l['layer'] == trial['layer'])
            expected_feature = None if trial['control'] == 'random' else layer['unrelated_feature'] if trial['control'] == 'unrelated' else layer['feature']
            require(direction['feature'] == expected_feature, 'Direction target mismatch')
            control = 'feature' if trial['control'] == 'baseline' else trial['control']
            key = (trial['layer'], trial['seed'], control)
            require(key not in directions or directions[key] == vector, 'Direction changed across paired trials')
            directions[key] = vector
        if trial['epsilon'] == 0:
            require(row['residual_before'] == row['residual_after'] and delta['max'] == 0, 'Baseline unexpectedly perturbed')
        expected_measurements = []
        for pooling in trial['poolings']:
            selections = [tokens['selected_token_indices']] if pooling == experiment.POOLINGS[0] else [[tokens['selected_token_indices'][-1]]] if pooling == experiment.POOLINGS[1] else tokens['span_token_indices']
            for index, selection in enumerate(selections):
                expected_measurements.append((pooling, index if pooling == experiment.POOLINGS[2] else None, selection))
        require(len(row['measurements']) == len(expected_measurements), 'Pooling measurement count mismatch')
        for measurement, expected in zip(row['measurements'], expected_measurements):
            require((measurement['pooling'], measurement['span_index'], measurement['token_indices']) == expected
                and finite_numbers(measurement['raw'], 4096), 'Raw pooling shape/target mismatch')
            sparse = measurement['sae']
            require(isinstance(sparse, dict) and 1 <= len(sparse) <= min(65536, 50 * len(expected[2]))
                and all(isinstance(k, str) and re.fullmatch(r'0|[1-9][0-9]*', k) and int(k) < 65536 for k in sparse)
                and finite_numbers(list(sparse.values())), 'Invalid sparse pooled features')
    for (layer, seed, control), vector in directions.items():
        if control == 'opposite': require(vector == [-v for v in directions[(layer, seed, 'feature')]], 'Opposite control mismatch')


def join_result(job, join, result):
    check_seal(join, 'join_sha256')
    require(join['join_sha256'] == job['join_sha256'] and join['source_plan_sha256'] == job['source_plan_sha256']
        and join['uploaded_plan_sha256'] == job['experiment']['plan_sha256'], 'Local join/source binding mismatch')
    check_seal(result, 'result_sha256')
    require(result['plan_sha256'] == join['uploaded_plan_sha256'], 'Local join result mismatch')
    # Never mutate a remote artifact and retain its old result hash.
    return seal({'schema_version': 1, 'remote_result_sha256': result['result_sha256'],
        'join_sha256': join['join_sha256'], 'source_plan_sha256': job['source_plan_sha256'],
        'rows': [{'trial_id': r['trial_id'], 'uploaded_record_id': r['record_id'], 'local': deepcopy(join['records'][r['record_id']])}
                 for r in result['rows']]}, 'local_joined_sha256')


def write_bounded(path, value, limit=MAX_FILE - 1, *, replace=False):
    """Stream JSON to a private temporary file; overflow never publishes success."""
    require(type(limit) is int and 0 < limit < MAX_FILE, 'Invalid per-file bound')
    path = Path(path)
    require(not path.is_symlink() and (replace or not path.exists()), 'Refusing artifact overwrite/symlink')
    temporary = path.with_name(path.name + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    count = 0
    try:
        with os.fdopen(fd, 'wb') as out:
            for text in json.JSONEncoder(sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(',', ':')).iterencode(value):
                body = text.encode(); count += len(body)
                require(count <= limit, 'Artifact exceeds per-file bound')
                out.write(body)
            out.flush(); os.fsync(out.fileno())
        if replace: os.replace(temporary, path)
        else:
            os.link(temporary, path); temporary.unlink()
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if temporary.exists(): temporary.unlink()


class TrialJournal:
    """One durable prefix; progress is updated only after a complete row is fsynced."""
    def __init__(self, directory, job):
        self.directory, self.job, self.count = Path(directory), job, 0
        self.path = self.directory / 'trials.jsonl'
        self.fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        self.byte_count = 0

    def stage(self, stage, **details):
        write_bounded(self.directory / 'progress.json', {'schema_version': 1, 'job_sha256': self.job['job_sha256'],
            'stage': stage, 'completed_trials': self.count, 'planned_trials': self.job['experiment']['trial_count'],
            'fit_eligible': False, 'updated_at': time.time(), **details}, MAX_INPUT, replace=True)

    def append(self, row):
        require(self.count < self.job['experiment']['trial_count'] and row['trial_id'] == self.job['experiment']['trials'][self.count]['trial_id'], 'Checkpoint must follow the frozen trial order')
        body = (core.canonical(row) + '\n').encode()
        require(self.byte_count + len(body) <= self.job['limits']['max_result_bytes'], 'Checkpoint exceeds per-file bound')
        # A timeout cannot interrupt the write/commit of an individual row. A
        # hard process kill can still tear the last line; import never fits it.
        previous = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGALRM})
        try:
            view = memoryview(body)
            while view:
                written = os.write(self.fd, view); require(written > 0, 'Short checkpoint write'); view = view[written:]
            os.fsync(self.fd); self.count += 1; self.byte_count += len(body)
            self.stage('forward_complete', latest_trial_id=row['trial_id'])
        finally: signal.pthread_sigmask(signal.SIG_SETMASK, previous)

    def close(self):
        os.close(self.fd)


def load_layer_reusing_model(job, layer, resident=None):
    """Load the base once, then only the pinned next SAE and residual block.

    Every subsequent layer retains the first load's verified model/tokenizer
    hashes. This job never updates model weights or imports a policy adapter.
    """
    from types import SimpleNamespace
    observer = job['experiment']['config']['observer']
    args = SimpleNamespace(**{k: observer[k] for k in ('model_revision', 'tokenizer_revision', 'sae_revision', 'dtype', 'device', 'max_tokens')},
        layer=layer['layer'], module=layer['module'], sae_sha256=layer['sae_sha256'], allow_download=False)
    if resident is None:
        model, tokenizer, block, state, manifest = extract.load_observer(args)
        manifest['model_reused'] = False
    else:
        import torch
        from huggingface_hub import hf_hub_download
        model, tokenizer, base_manifest = resident
        path = Path(hf_hub_download(observer['sae_model'], f'layer{layer["layer"]}.sae.pt',
            revision=observer['sae_revision'], local_files_only=True, token=False))
        asset = next(a for a in job['inventory']['assets'] if 'sae' in a['roles'] and a['filename'] == path.name)
        verify_asset(path, asset)
        state = torch.load(path, map_location='cpu', weights_only=True); core.validate_sae(state, core.SAESpec())
        block = model.get_submodule(layer['module'])
        require(type(block).__name__ == 'Qwen3_5DecoderLayer', 'Selected reused block must be a Qwen residual decoder')
        state = {k: v.to(device=args.device, dtype=getattr(torch, args.dtype)) for k, v in state.items()}
        manifest = deepcopy(base_manifest)
        manifest.update(layer=layer['layer'], module=layer['module'], sae_file=path.name,
            sae_sha256=layer['sae_sha256'], model_reused=True)
    manifest['layer_selection_implementation_sha256'] = job['source_files_sha256']['observer_experiment_job.py']
    experiment.validate_loaded(manifest, observer, layer, core.SAESpec(), False)
    return model, tokenizer, block, state, manifest


def sparse_token_measurements(residual, selected, offsets, state, spec):
    """Retain actual signed TopK coordinates so pooled rewards can be replayed."""
    indices, values = core.encode_topk(residual[0, selected].float(), state, spec)
    return [{'token_index': token, 'indices': indices[i].tolist(),
             'values': values[i].tolist(), 'character_offsets': list(offsets[token])}
            for i, token in enumerate(selected)]


def stream_execute(job, flight, journal, result):
    """Actual local forwards with shared pooling and durable per-trial progress.

    Uses existing primitives, never rewrites/imports the live manager. One
    model/tokenizer load per job, one selected SAE at a time.
    """
    import torch
    plan = job['experiment']; config = plan['config']; observer = config['observer']; mode = job['mode']
    records = {r['record_id']: r for r in plan['records']}; spec = core.SAESpec()
    tokenized = {r['record_id']: r for r in flight['records']}
    resident = None
    for layer in observer['layers']:
        journal.stage('loading_layer', layer=layer['layer'])
        model, tokenizer, block, state, manifest = load_layer_reusing_model(job, layer, resident)
        if resident is None: resident = (model, tokenizer, manifest)
        experiment.validate_loaded(manifest, observer, layer, spec, False); core.validate_sae(state, spec)
        calibration_vectors, provenance = [], []
        for record_id in config.get('calibration_record_ids', []):
            journal.stage('calibrating', layer=layer['layer'], record_id=record_id)
            batch, view, offsets, selected = experiment.tokenize_record(model, tokenizer, records[record_id], observer['max_tokens'])
            require(batch['input_ids'][0].tolist() == tokenized[record_id]['input_token_ids'], 'Execution tokenizer differs from preflight')
            devices = list(range(torch.cuda.device_count())) if torch.cuda.is_available() else []
            with torch.random.fork_rng(devices=devices):
                torch.manual_seed(config['calibration_seed']); h = core.capture_residual(model, block, batch)
            calibration_vectors.append(h[0, selected].float())
            provenance.append({'record_id': record_id, 'split': 'calibration', 'view_sha256': core.digest(view),
                'selected_token_indices': selected, 'input_token_ids': batch['input_ids'][0].tolist(), 'residual': experiment.tensor_hash(h[0, selected])})
        scale, calibration = None, None
        if mode == 'intervention':
            scale = core.residual_scale(torch.cat(calibration_vectors))
            calibration = {'layer': layer['layer'], 'scale': scale, 'seed': config['calibration_seed'],
                'rule': 'median_selected_calibration_vector_l2_norm', 'records': provenance, 'observer_manifest_sha256': core.digest(manifest)}
            result['calibrations'].append(calibration); del h
        result['observer_manifests'].append(manifest); del calibration_vectors
        # Raw checkpoints remain attributable even if the OS kills the process
        # before its timeout handler can finalize partial.json.
        write_bounded(journal.directory / 'context.json', {'job_sha256': job['job_sha256'],
            'result_header': deepcopy(result), 'fit_eligible': False}, replace=True)
        for trial in (t for t in plan['trials'] if t['layer'] == layer['layer']):
            journal.stage('forward_started', trial_id=trial['trial_id'], layer=layer['layer'])
            record = records[trial['record_id']]
            batch, view, offsets, selected = experiment.tokenize_record(model, tokenizer, record, observer['max_tokens'])
            require(batch['input_ids'][0].tolist() == tokenized[record['record_id']]['input_token_ids'], 'Execution tokenizer differs from preflight')
            if mode == 'intervention':
                directions = core.intervention_directions(state, layer['feature'], spec, seed=trial['seed'])
                directions['unrelated'] = core.intervention_directions(state, layer['unrelated_feature'], spec, seed=trial['seed'])['feature']
                direction = directions['feature' if trial['control'] == 'baseline' else trial['control']]
                direction_record = {**experiment.tensor_hash(direction), 'unit_vector': direction.tolist(),
                    'feature': layer['unrelated_feature'] if trial['control'] == 'unrelated' else None if trial['control'] == 'random' else layer['feature']}
            else: direction, direction_record = torch.ones(spec.hidden), None
            mask = torch.zeros_like(batch['input_ids'], dtype=torch.bool); mask[0, selected] = True
            before, after, downstream = experiment.forward_intervention(model, block, batch, direction,
                epsilon=trial['epsilon'], scale=scale if scale is not None else 1., token_mask=mask, seed=trial['seed'])
            delta = (after.float() - before.float()).norm(dim=-1); cpu_mask = mask.cpu(); actual = delta[cpu_mask]
            row = {**trial, **{k: record[k] for k in ('family_id', 'group_ids', 'split', 'boundary')},
                'source_record_sha256': plan['source_record_sha256'][record['record_id']], 'view_sha256': core.digest(view),
                'latest_allowed_event_id': view['latest_allowed_event_id'], 'spans': view['spans'],
                'input_token_ids': batch['input_ids'][0].tolist(), 'selected_token_indices': selected, 'selected_offsets': [offsets[t] for t in selected],
                'sparse_tokens': sparse_token_measurements(after, selected, offsets, state, spec),
                'direction': direction_record, 'scale': scale, 'calibration_sha256': core.digest(calibration) if calibration else None,
                'requested_delta_norm': abs(trial['epsilon']) * scale if scale is not None else 0.,
                'actual_selected_delta_norm': {'min': actual.min().item(), 'max': actual.max().item(), 'mean': actual.mean().item()},
                'unselected_delta_norm_max': delta[~cpu_mask].max().item() if (~cpu_mask).any() else 0.,
                'residual_before': experiment.tensor_hash(before), 'residual_after': experiment.tensor_hash(after),
                'downstream_tensor': downstream, 'observer_manifest_sha256': core.digest(manifest),
                'settings': {'seed': trial['seed'], 'use_cache': False, 'model_mode': 'eval', 'deterministic_algorithms': torch.are_deterministic_algorithms_enabled()},
                'measurements': experiment.pool_measurements(after, selected, offsets, view, batch['attention_mask'][0].tolist(), state, spec, trial['poolings']),
                'independent_behavior_review': {'status': 'unknown', 'outcome': None, 'review_id': None}, 'readout_quality': None, 'causal_behavior_effect': None}
            journal.append(row)
        del block, state


def execute_job(job, materialization, cache_dir, output_dir, runtime, *, environment=None, expected_preflight=None):
    validate_job(job, check_code=True); validate_materialization(job, materialization)
    if 'dependency_profile' in job:
        require(environment is not None and expected_preflight is not None, 'Overlay environment and prepared tokenizer evidence required')
        check_overlay_process(job, environment); validate_preflight(job, expected_preflight)
    # Materialization checked freshness at job entry. Downloads can take longer
    # than 15 minutes; the parent continues live rate checks throughout them.
    seconds = check_runtime(job, runtime)
    output_dir = Path(output_dir); output_dir.mkdir(parents=True, mode=0o700, exist_ok=False)
    journal = TrialJournal(output_dir, job)
    plan = job['experiment']
    result = {'schema_version': 1, 'evidence': 'local_pinned_model_forward_experiment',
        'plan_sha256': plan['plan_sha256'], 'concept_card_sha256': plan['concept_card_sha256'],
        'split_manifest_sha256': plan['split_manifest_sha256'], 'observer_manifests': [], 'calibrations': [],
        'measurement_contract': {'mode': job['mode'], 'poolings': plan['config']['poolings'], 'hook': 'residual_post_block'},
        'implementation_files_sha256': {n: job['source_files_sha256'][n] for n in SOURCE_NAMES[:-1]}}
    flight, error, code = None, None, 0
    write_bounded(output_dir / 'materialization.json', materialization)
    if environment is not None: write_bounded(output_dir / 'environment.json', environment, MAX_INPUT)
    try:
        with deadline_guard(max(0.001, seconds - 10)):
            journal.stage('tokenizer_preflight')
            flight = preflight(job, cached_tokenizer(job, materialization, cache_dir))
            write_bounded(output_dir / 'preflight.json', flight)
            if expected_preflight is not None:
                require(flight == expected_preflight, 'Remote token IDs/offsets differ from prepared preflight; no forward permitted')
            stream_execute(job, flight, journal, result)
            journal.stage('validating_completed_results')
            result['rows'] = [json.loads(line) for line in journal.path.read_bytes().splitlines()]
            result['completed_trials'] = len(result['rows']); seal(result, 'result_sha256')
            validate_experiment_result(job, result, flight, materialization)
            write_bounded(output_dir / 'results.json', result, job['limits']['max_result_bytes'])
    except (Exception, KeyboardInterrupt) as failure:
        error = type(failure).__name__ + ': ' + str(failure)[:1000]
        code = 124 if isinstance(failure, TimeoutError) else 1
    finally:
        journal.close()
    if code:
        result.pop('result_sha256', None)
        rows = [json.loads(line) for line in journal.path.read_bytes().splitlines()]
        result.update(evidence='incomplete_local_pinned_model_forward_experiment', fit_eligible=False,
                      rows=rows, completed_trials=len(rows))
        seal(result, 'result_sha256'); header = {k: v for k, v in result.items() if k != 'rows'}
        partial = seal({'schema_version': 1, 'job_sha256': job['job_sha256'], 'fit_eligible': False,
            'error': error, 'result_header': header, 'rows_sha256': extract.file_hash(journal.path)}, 'partial_sha256')
        write_bounded(output_dir / 'partial.json', partial)
    journal.stage('incomplete' if code else 'complete', exit_code=code)
    log = ((error or 'Completed declared local forward measurements; independent outcomes remain unknown.') + '\n').encode()
    require(len(log) <= job['limits']['max_log_bytes'], 'Worker log exceeds bound')
    with (output_dir / 'experiment.log').open('xb') as stream:
        os.chmod(stream.name, 0o600); stream.write(log); stream.flush(); os.fsync(stream.fileno())
    names = {'materialization.json', 'progress.json', 'experiment.log'}
    if environment is not None: names.add('environment.json')
    if flight is not None: names.add('preflight.json')
    names |= {'partial.json', 'trials.jsonl'} if code else {'results.json'}
    receipt = {'schema_version': 1, 'evidence': 'local_worker_process_not_pod_receipt', 'job_sha256': job['job_sha256'],
        'exit_code': code, 'complete': code == 0, 'fit_eligible': code == 0,
        'completed_trials': journal.count, 'files': {n: extract.file_hash(output_dir / n) for n in sorted(names)}}
    write_bounded(output_dir / 'receipt.json', receipt)
    return receipt


def regular_bytes(path, limit=MAX_FILE - 1):
    path = Path(path)
    require(not path.is_symlink() and path.is_file() and path.stat().st_size <= limit, 'Expected bounded regular artifact')
    with path.open('rb') as stream: body = stream.read(limit + 1)
    require(len(body) <= limit, 'Artifact grew beyond byte bound')
    return body


def archive_outputs(directory):
    directory = Path(directory)
    receipt = json.loads(regular_bytes(directory / 'receipt.json', MAX_INPUT))
    names = set(receipt['files']) | {'receipt.json'}
    require(names <= ARTIFACTS and 'experiment.log' in names, 'Unexpected worker export members')
    buffer = io.BytesIO(); total = 0
    with tarfile.open(fileobj=buffer, mode='w') as archive:
        for name in sorted(names):
            body = regular_bytes(directory / name); total += len(body) + 1024
            require(total + 10240 <= MAX_ARCHIVE, 'Worker archive exceeds 128 MiB')
            if name != 'receipt.json': require(hashlib.sha256(body).hexdigest() == receipt['files'][name], 'Export receipt hash mismatch')
            info = tarfile.TarInfo(name); info.mode = 0o600; info.size = len(body); info.mtime = 0
            archive.addfile(info, io.BytesIO(body))
    require(buffer.tell() <= MAX_ARCHIVE, 'Worker archive exceeds 128 MiB')
    return buffer.getvalue()


def import_outputs(job, join, body):
    """Validate full or explicitly incomplete export. Caller persists original TAR."""
    validate_job(job); require(len(body) <= MAX_ARCHIVE, 'Archive exceeds 128 MiB')
    check_seal(join, 'join_sha256')
    require(join['join_sha256'] == job['join_sha256'] and join['source_plan_sha256'] == job['source_plan_sha256']
        and join['uploaded_plan_sha256'] == job['experiment']['plan_sha256'], 'Local join/source binding mismatch')
    files = {}; total = 0
    with tarfile.open(fileobj=io.BytesIO(body), mode='r:') as archive:
        for member in archive:
            require(member.name in ARTIFACTS and member.name not in files and member.isfile()
                and 0 <= member.size < MAX_FILE, 'Unsafe/duplicate/oversized export member')
            total += member.size; require(total <= MAX_ARCHIVE, 'Export expansion exceeds cap')
            files[member.name] = archive.extractfile(member).read()
    receipt = json.loads(files['receipt.json'])
    require(receipt['job_sha256'] == job['job_sha256'] and type(receipt['exit_code']) is int
        and receipt['files'] == {n: hashlib.sha256(b).hexdigest() for n, b in files.items() if n != 'receipt.json'}, 'Worker receipt/job/hash mismatch')
    require('experiment.log' in files and len(files['experiment.log']) <= job['limits']['max_log_bytes'], 'Missing/oversized worker log')
    complete = receipt['exit_code'] == 0
    require(receipt['complete'] is complete and receipt['fit_eligible'] is complete, 'Completion/eligibility mismatch')
    environment_files = {'environment.json'} if 'environment.json' in files else set()
    if environment_files:
        require('dependency_profile' in job, 'Unexpected overlay evidence')
        validate_environment(job, json.loads(files['environment.json']))
    if 'materialization.json' not in files:
        # uv resolves the worker environment before Python reaches materialize().
        # Bootstrap/download failure can therefore leave only the wrapper's log
        # and receipt. This is diagnostic evidence, never a measurement prefix.
        require(not complete and set(files) == {'receipt.json', 'experiment.log'} | environment_files
            and receipt.get('schema_version') == 1
            and receipt.get('evidence') == 'local_worker_process_not_pod_receipt'
            and type(receipt.get('completed_trials')) is int and receipt['completed_trials'] == 0
            and type(receipt.get('transport_exit_code')) is int
            and receipt['transport_exit_code'] == receipt['exit_code']
            and receipt.get('transport_failure_stage') in ('bootstrap', 'materialization'),
            'Missing materialization: only a bound zero-trial bootstrap/materialization diagnostic is accepted')
        diagnostic = seal({'schema_version': 1, 'evidence': 'worker_transport_failure_not_model_measurements',
            'job_sha256': job['job_sha256'], 'source_plan_sha256': job['source_plan_sha256'],
            'join_sha256': join['join_sha256'], 'archive_sha256': hashlib.sha256(body).hexdigest(),
            'failure_stage': receipt['transport_failure_stage'], 'exit_code': receipt['exit_code'],
            'transport_exit_code': receipt['transport_exit_code'], 'validated_completed_trials': 0,
            'fit_eligible': False, 'log_sha256': hashlib.sha256(files['experiment.log']).hexdigest(),
            'environment_sha256': json.loads(files['environment.json'])['environment_sha256'] if environment_files else None,
            'log_text': files['experiment.log'].decode('utf-8', errors='replace'),
            'reason': 'Worker transport failed before a complete materialization receipt; no validated model measurements'},
            'diagnostic_sha256')
        return {'complete': False, 'fit_eligible': False, 'diagnostic_only': True,
            'validated_completed_trials': 0, 'result': None, 'local_join': None,
            'diagnostic': diagnostic, 'archive_sha256': hashlib.sha256(body).hexdigest()}
    materialization = json.loads(files['materialization.json']); validate_materialization(job, materialization)
    if 'dependency_profile' in job: require(environment_files, 'Missing actual overlay runtime evidence')
    progress = json.loads(files['progress.json'])
    require(progress['job_sha256'] == job['job_sha256'] and progress['completed_trials'] == receipt['completed_trials'], 'Progress/job mismatch')
    flight = json.loads(files['preflight.json']) if 'preflight.json' in files else None
    if flight is not None: validate_preflight(job, flight)
    if complete:
        require(set(files) == {'receipt.json', 'materialization.json', 'progress.json', 'experiment.log', 'preflight.json', 'results.json'} | environment_files, 'Complete export member set mismatch')
        require(len(files['results.json']) <= job['limits']['max_result_bytes'], 'Result exceeds declared byte cap')
        result = json.loads(files['results.json']); validate_experiment_result(job, result, flight, materialization)
    else:
        require(set(files) == {'receipt.json', 'materialization.json', 'progress.json', 'experiment.log', 'partial.json', 'trials.jsonl'} | ({'preflight.json'} if flight is not None else set()) | environment_files, 'Incomplete export member set mismatch')
        require(len(files['trials.jsonl']) <= job['limits']['max_result_bytes'], 'Partial exceeds declared byte cap')
        partial = json.loads(files['partial.json']); check_seal(partial, 'partial_sha256')
        require(partial['job_sha256'] == job['job_sha256'] and partial['fit_eligible'] is False
            and partial['rows_sha256'] == hashlib.sha256(files['trials.jsonl']).hexdigest(), 'Partial provenance/hash mismatch')
        result = dict(partial['result_header']); result['rows'] = [json.loads(line) for line in files['trials.jsonl'].splitlines()]
        check_seal(result, 'result_sha256')
        if flight is not None: validate_experiment_result(job, result, flight, materialization, partial=True)
        else: require(not result['rows'] and result['completed_trials'] == 0 and result['fit_eligible'] is False, 'No preflight means no eligible forward evidence')
    require(result['completed_trials'] == receipt['completed_trials'], 'Completed trial count mismatch')
    return {'complete': complete, 'fit_eligible': complete, 'validated_completed_trials': result['completed_trials'],
        'result': result, 'local_join': join_result(job, join, result), 'archive_sha256': hashlib.sha256(body).hexdigest()}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('metadata', help='Public revision metadata only; no weights')
    p.add_argument('plan', type=Path); p.add_argument('output', type=Path)
    p = commands.add_parser('prepare', help='Offline job and private local join')
    for name in ('plan', 'inventory', 'limits', 'output'): p.add_argument(name, type=Path)
    p.add_argument('--source-records', type=Path)
    p.add_argument('--overlay-metadata', type=Path, help='Already verified overlay lock and raw image proof directory; offline')
    p = commands.add_parser('bootstrap-overlay', help='Later authorized image worker only; bounded wheel fetch and offline installation')
    p.add_argument('job', type=Path); p.add_argument('output', type=Path)
    p.add_argument('--remaining-seconds', type=float, required=True)
    p = commands.add_parser('preflight', help='Local cached-tokenizer workload check; no weights or provider')
    p.add_argument('job', type=Path); p.add_argument('output', type=Path); p.add_argument('--cache-dir', type=Path, required=True)
    for name in ('materialize', 'execute'):
        p = commands.add_parser(name)
        p.add_argument('job', type=Path)
        if name == 'execute': p.add_argument('materialization', type=Path)
        p.add_argument('output', type=Path); p.add_argument('--cache-dir', type=Path, required=True)
        p.add_argument('--environment', type=Path)
        if name == 'execute': p.add_argument('--expected-preflight', type=Path)
        for key in ('creation-started-at', 'rate-observed-at', 'observed-gpu-hourly-rate'):
            p.add_argument('--' + key, type=float, required=True)
        if name == 'materialize': p.add_argument('--allow-download', action='store_true')
    p = commands.add_parser('export'); p.add_argument('directory', type=Path); p.add_argument('output', type=Path)
    p = commands.add_parser('import')
    for name in ('job', 'join', 'archive', 'output'): p.add_argument(name, type=Path)
    args = parser.parse_args(argv)
    output = experiment.output_path(args.output)  # Explicit ignored destination; never overwrite.
    read = lambda path: json.loads(regular_bytes(path, MAX_INPUT))
    if args.command == 'metadata': value = fetch_metadata(read(args.plan))
    elif args.command == 'prepare':
        records = read(args.source_records)['records'] if args.source_records else None
        dependencies = dependency_profile(args.overlay_metadata) if args.overlay_metadata else None
        job, join = prepare_job(read(args.plan), read(args.inventory), read(args.limits), records, dependencies=dependencies)
        output.mkdir(parents=True, mode=0o700)
        write_bounded(output / 'job.json', job, MAX_INPUT); write_bounded(output / 'join.local.json', join)
        print(core.canonical({'job_sha256': job['job_sha256'], 'forward_passes': job['forward_passes']})); return
    elif args.command == 'preflight':
        os.environ['HF_HUB_CACHE'] = str(args.cache_dir.resolve()); os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
        os.environ['HF_HUB_OFFLINE'] = '1'; os.environ['TRANSFORMERS_OFFLINE'] = '1'
        job = read(args.job); validate_job(job, check_code=True)
        value = preflight(job, cached_tokenizer(job, None, args.cache_dir))
    elif args.command == 'bootstrap-overlay':
        value = bootstrap_overlay(read(args.job), output, remaining_seconds=args.remaining_seconds)
        print(core.canonical({'environment_sha256': value['environment_sha256']})); return
    elif args.command in ('materialize', 'execute'):
        runtime = {k: getattr(args, k) for k in ('creation_started_at', 'rate_observed_at', 'observed_gpu_hourly_rate')}
        os.environ['HF_HUB_CACHE'] = str(args.cache_dir.resolve())
        os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
        job = read(args.job)
        environment = read(args.environment) if args.environment else None
        if 'dependency_profile' in job:
            require(environment is not None, 'Overlay environment required before materialization/execution')
            check_overlay_process(job, environment)
        if args.command == 'materialize': value = materialize(job, args.cache_dir, runtime, allow_download=args.allow_download)
        else:
            os.environ['HF_HUB_OFFLINE'] = '1'; os.environ['TRANSFORMERS_OFFLINE'] = '1'
            receipt = execute_job(job, read(args.materialization), args.cache_dir, output, runtime,
                environment=environment, expected_preflight=json.loads(regular_bytes(args.expected_preflight)) if args.expected_preflight else None)
            print(core.canonical({'complete': receipt['complete'], 'completed_trials': receipt['completed_trials']}))
            return receipt['exit_code']
    elif args.command == 'export':
        body = archive_outputs(args.directory); output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('xb') as stream: os.chmod(stream.name, 0o600); stream.write(body)
        return
    else: value = import_outputs(read(args.job), json.loads(regular_bytes(args.join)), regular_bytes(args.archive, MAX_ARCHIVE))
    output.parent.mkdir(parents=True, exist_ok=True); write_bounded(output, value)
    print(core.canonical({'output': str(output)}))


if __name__ == '__main__':
    raise SystemExit(main())
