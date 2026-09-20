"""Inspect or cache pinned benchmark originals. Never execute downloaded code.

License metadata records publisher declarations, not a commercial-use approval.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
CATALOG = Path(__file__).with_suffix('.json')
CACHE = ROOT / '.keating/datasets/sources'


def source_catalog():
    return json.loads(CATALOG.read_text())['sources']


def original_path(source, asset, cache=CACHE):
    root = Path(cache).resolve()
    path = (root / source['id'] / source['revision'] / asset['path']).resolve()
    if not path.is_relative_to(root):
        raise ValueError('Source path escapes cache')
    return path


def checked_bytes(source, asset, cache=CACHE):
    body = original_path(source, asset, cache).read_bytes()
    if len(body) != asset['bytes'] or hashlib.sha256(body).hexdigest() != asset['sha256']:
        raise ValueError(f"Original checksum mismatch: {source['id']}/{asset['path']}")
    return body


def cache_source(source, cache=CACHE):
    for asset in source['files']:
        destination = original_path(source, asset, cache)
        if destination.exists():
            checked_bytes(source, asset, cache)
            continue
        with urllib.request.urlopen(asset['url'], timeout=120) as response:
            body = response.read(asset['bytes'] + 1)
        if len(body) != asset['bytes'] or hashlib.sha256(body).hexdigest() != asset['sha256']:
            raise ValueError(f"Download checksum mismatch: {asset['path']}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        # Publish only verified complete bytes; never replace a user's cached file.
        with tempfile.NamedTemporaryFile(dir=destination.parent) as temporary:
            temporary.write(body)
            temporary.flush()
            try:
                destination.hardlink_to(temporary.name)
            except FileExistsError:
                checked_bytes(source, asset, cache)


def original_records(source, asset, cache=CACHE):
    body = checked_bytes(source, asset, cache)
    if asset['path'].endswith('.jsonl'):
        return [json.loads(line) for line in body.splitlines() if line.strip()]
    if asset['path'].endswith('.json'):
        records = json.loads(body)
        if not isinstance(records, list):
            raise ValueError('Expected a list of original records')
        return records
    return []


def inventory(cache=CACHE):
    rows = []
    for source in source_catalog():
        for asset in source['files']:
            count = None
            status = 'not downloaded'
            if original_path(source, asset, cache).exists():
                try:
                    records = original_records(source, asset, cache)
                    count = len(records) if asset['path'].endswith(('.json', '.jsonl')) else None
                    status = 'verified'
                except (ValueError, OSError) as error:
                    status = f'invalid: {error}'
            rows.append(dict(source=source['id'], file=asset['path'], rows=count,
                             status=status, license=source['license'],
                             reuse_status=source['reuse_status'], revision=source['revision']))
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['list', 'fetch', 'verify'])
    parser.add_argument('--source', choices=['all', *[s['id'] for s in source_catalog()]], default='all')
    parser.add_argument('--cache', type=Path, default=CACHE)
    args = parser.parse_args()
    selected = [s for s in source_catalog() if args.source in ('all', s['id'])]
    if args.command == 'fetch':
        for source in selected:
            cache_source(source, args.cache)
    rows = [r for r in inventory(args.cache) if args.source in ('all', r['source'])]
    print(json.dumps(rows, indent=2))
    if args.command in ('fetch', 'verify') and any(r['status'] != 'verified' for r in rows):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
