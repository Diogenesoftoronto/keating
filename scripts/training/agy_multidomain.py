"""Bounded agy/Crush queue with frozen per-phase models; never trains a policy.

All outputs need successful process receipts AND structural and semantic review.
An interrupted output is archived and cannot be promoted merely because it exists.
"""
import argparse
from datetime import datetime, timezone, timedelta
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import multidomain_corpus as corpus

PROMPTS = Path(__file__).parent / 'prompts'


def timestamp():
    return datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')


def update_status(directory, status):
    value = {'updated_at': datetime.now(timezone.utc).isoformat(), **status}
    temporary = directory / '.status.tmp'
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    os.replace(temporary, directory / 'status.json')


def quota_delay(log):
    """Use the reported reset; absent a reset, stop rather than hammer the service."""
    if not re.search(r'quota (?:reached|exceeded)|rate.limit', log, re.I):
        return None
    match = re.search(r'Resets? in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?', log, re.I)
    if not match or not any(match.groups()):
        return -1
    hours, minutes, seconds = (int(x or 0) for x in match.groups())
    return max(60, hours * 3600 + minutes * 60 + seconds + 30)


def validate_phase(value, phase, packet, draft=None, expected_model=corpus.MODEL):
    if phase == 'draft':
        corpus.validate_multidomain_draft(value, packet)
        corpus.validate_native_documents([corpus.question_document(f['task'], f['id'])
                                         for f in value['families'] if f['status'] == 'ready'])
    else:
        corpus.validate_multidomain_review(value, draft, packet, expected_model)


def execute_job(directory, batch, phase, timeout_minutes=15):
    manifest, packet = corpus.load_packet(directory, batch)
    worker = corpus.execution_profile(manifest)[phase]
    target = directory / f'{batch}.{phase}.json'
    draft = corpus.read(directory / f'{batch}.draft.json') if phase == 'review' else None
    if draft is not None:
        corpus.validate_multidomain_draft(draft, packet)
        corpus.accepted_receipt(directory, batch, 'draft', corpus.digest(draft))
    if target.exists():
        try:
            value = corpus.read(target)
            validate_phase(value, phase, packet, draft, worker['model'])
            corpus.accepted_receipt(directory, batch, phase, corpus.digest(value))
            return {'status': 'retained', 'batch': batch, 'phase': phase}
        except (ValueError, KeyError, TypeError):
            target.rename(directory / f'{batch}.{phase}.{timestamp()}.unaccepted.json')
    prompt = (PROMPTS / f'multidomain-{phase}.md').read_text()
    replacements = {'INPUT_PATH': str(directory / f'{batch}.input.json'), 'OUTPUT_PATH': str(target),
                    'DRAFT_PATH': str(directory / f'{batch}.draft.json'),
                    'DRAFT_HASH': corpus.digest(draft) if draft else '',
                    'SOURCE_HASH': packet['source']['text_sha256'], 'WORKER_MODEL': worker['model'],
                    'WORKER_ENGINE': worker['engine']}
    for key, value in replacements.items():
        prompt = prompt.replace(key, value)
    previous = sorted(directory.glob(f'{batch}.{phase}.*.receipt.json'), reverse=True)
    if previous:
        last = corpus.read(previous[0])
        if last.get('validation_error'):
            prompt += '\nPrevious attempt failed validation: ' + last['validation_error'] + '\nCorrect this in the new output.\n'
    stamp = timestamp()
    logs = directory / f'{batch}.{phase}.{stamp}.log'
    started = time.monotonic()
    if worker['engine'] == 'agy':
        command = ['rtk', 'proxy', 'agy', '--model', worker['model'], '--effort', 'high', '--mode', 'accept-edits',
                   '--dangerously-skip-permissions', '--print-timeout', f'{timeout_minutes}m', '-p', prompt]
    else:
        # Crush 0.92's --yolo belongs to the interactive root command, not run.
        command = ['rtk', 'proxy', 'crush', 'run', '--cwd', str(directory), '--quiet',
                   '--model', worker['model'], '--small-model', worker['model'], prompt]
    with logs.open('x') as stream:
        process = subprocess.Popen(command, stdout=stream, stderr=subprocess.STDOUT, cwd=corpus.ROOT,
                                   start_new_session=True)
        try:
            code = process.wait(timeout=timeout_minutes * 60 + 30)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL); process.wait()
            code = 124
    log_text = logs.read_text(errors='replace')
    delay = quota_delay(log_text)
    receipt = {'batch': batch, 'phase': phase, 'model': worker['model'], 'engine': worker['engine'], 'exit_code': code,
               'started_at': stamp, 'elapsed_seconds': round(time.monotonic() - started, 2),
               'input_digest': corpus.digest(packet), 'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
               'log_sha256': hashlib.sha256(logs.read_bytes()).hexdigest(), 'validated': False,
               'quota_delay_seconds': delay, 'output_digest': None}
    if code == 0 and target.exists():
        try:
            value = corpus.read(target)
            validate_phase(value, phase, packet, draft, worker['model'])
            receipt['output_digest'] = corpus.digest(value)
            receipt['validated'] = True
        except (ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
            receipt['validation_error'] = str(error)
    corpus.write(directory / f'{batch}.{phase}.{stamp}.receipt.json', receipt)
    if not receipt['validated'] and target.exists():
        target.rename(directory / f'{batch}.{phase}.{stamp}.unaccepted.json')
    return receipt | {'status': 'complete' if receipt['validated'] else 'quota' if delay is not None else 'failed'}


def run_queue(directory, not_before=None, max_hours=72, timeout_minutes=15):
    directory = Path(directory).resolve()
    with (directory / '.queue.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return run_locked_queue(directory, not_before, max_hours, timeout_minutes)


def run_locked_queue(directory, not_before, max_hours, timeout_minutes):
    manifest = corpus.read(directory / 'manifest.json')
    deadline = time.monotonic() + max_hours * 3600
    if 'batch_order' in manifest:
        order = manifest['batch_order']
        corpus.require(len(order) == len(manifest['batches']) and set(order) == set(manifest['batches']), 'Queue membership changed')
        pilots = manifest['pilot_batches']
    else:
        order = sorted(manifest['batches'], key=lambda b: (int(b.rsplit('-', 1)[1]), corpus.DOMAINS.index(b.rsplit('-', 1)[0])))
        domains = [d for d in corpus.DOMAINS if any(b.rsplit('-', 1)[0] == d for b in order)]
        pilots = {d: [next(b for b in order if b.rsplit('-', 1)[0] == d)] for d in domains}
    first = [b for batches in pilots.values() for b in batches]
    pilot_checked = False
    completed = []
    wake = datetime.fromisoformat(not_before).astimezone(timezone.utc) if not_before else datetime.now(timezone.utc)
    for batch in order:
        for phase in ('draft', 'review'):
            failures = 0
            while time.monotonic() < deadline:
                if (directory / 'STOP').exists():
                    update_status(directory, {'state': 'stopped', 'completed_batches': completed}); return
                remaining = (wake - datetime.now(timezone.utc)).total_seconds()
                if remaining > 0:
                    update_status(directory, {'state': 'waiting_for_quota', 'resume_at': wake.isoformat(),
                                              'batch': batch, 'phase': phase, 'completed_batches': completed})
                    time.sleep(min(60, remaining)); continue
                update_status(directory, {'state': 'running', 'batch': batch, 'phase': phase,
                                          'worker': corpus.execution_profile(manifest)[phase], 'completed_batches': completed})
                result = execute_job(directory, batch, phase, timeout_minutes)
                print(json.dumps({k: v for k, v in result.items() if k in {'batch', 'phase', 'status', 'validation_error', 'quota_delay_seconds'}}), flush=True)
                if result['status'] in {'complete', 'retained'}:
                    break
                if result['status'] == 'quota':
                    if result['quota_delay_seconds'] < 0:
                        update_status(directory, {'state': 'quota_reset_unknown', 'batch': batch, 'phase': phase}); return
                    wake = datetime.now(timezone.utc) + timedelta(seconds=result['quota_delay_seconds'])
                    continue
                failures += 1
                if failures >= 2:
                    update_status(directory, {'state': 'needs_review', 'batch': batch, 'phase': phase, 'reason': result.get('validation_error', 'worker did not finish')}); return
            else:
                update_status(directory, {'state': 'time_limit', 'completed_batches': completed}); return
        completed.append(batch)
        if not pilot_checked and all(b in completed for b in first):
            reviews = {d: [corpus.read(directory / f'{b}.review.json') for b in batches] for d, batches in pilots.items()}
            counts = {d: sum(f['approved'] for r in rows for f in r['families']) for d, rows in reviews.items()}
            accepted = {d: sum(e['approved'] for r in rows for f in r['families'] if f['approved'] for e in f['examples']) for d, rows in reviews.items()}
            if any(counts[d] < 3 or accepted[d] < 50 for d in pilots):
                update_status(directory, {'state': 'pilot_needs_review', 'approved_families': counts, 'approved_examples': accepted}); return
            pilot_checked = True
        if len(completed) == 1 or len(completed) % manifest.get('checkpoint_batches', 1) == 0 or len(completed) == len(order):
            snapshot = directory / 'exports' / f'reviewed-{len(completed):03}-{timestamp()}'
            corpus.compile_multidomain(directory, snapshot)
        update_status(directory, {'state': 'batch_complete', 'completed_batches': completed, 'latest_export': str(snapshot)})
    update_status(directory, {'state': 'complete', 'completed_batches': completed, 'latest_export': str(snapshot)})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--not-before', help='Timezone-qualified ISO time for a known quota reset')
    parser.add_argument('--max-hours', type=float, default=72)
    parser.add_argument('--timeout-minutes', type=int, default=15)
    args = parser.parse_args()
    corpus.require(0 < args.max_hours <= 168 and 1 <= args.timeout_minutes <= 30, 'Bounded run required')
    try:
        run_queue(args.directory, args.not_before, args.max_hours, args.timeout_minutes)
    except Exception as error:
        update_status(args.directory, {'state': 'error', 'reason': str(error)})
        raise
