"""Reviewed source screens -> unanswered canonical OpenUI questions.

Mappings are curated from the allowed prefix, not inferred from answer keys.
Keep source-derived mappings and outputs in the ignored local dataset directory.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

VERSION = 'source-screen-openui-v1'
FIELDS = {'id', 'source_sha256', 'status', 'reason', 'source_indices', 'kind',
          'prompt_parts', 'choices'}


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def validate_mapping(scenario, mapping):
    """Mechanical grounding; semantic completeness still needs the named review."""
    if not isinstance(mapping, dict) or set(mapping) != FIELDS:
        raise ValueError('Invalid screen mapping fields')
    if mapping['id'] != scenario['id'] or mapping['source_sha256'] != scenario['source']['sha256']:
        raise ValueError('Screen mapping source mismatch')
    if mapping['status'] not in ('ready', 'review') or not isinstance(mapping['reason'], str) or not mapping['reason'].strip():
        raise ValueError('Screen mapping requires a review reason')
    if mapping['kind'] not in ('choice', 'text') or not isinstance(mapping['prompt_parts'], list) or not isinstance(mapping['choices'], list):
        raise ValueError('Unsupported screen component')
    private = scenario['evaluation_only']
    context = private['original'].get('context', [])
    cut = private['cut']
    indices = mapping['source_indices']
    if not isinstance(indices, list) or not indices or any(type(i) is not int for i in indices) or indices != sorted(set(indices)):
        raise ValueError('Screen mapping requires ordered source indices')
    if any(not cut['start_index'] <= i < len(context) or context[i]['turn_number'] > cut['cut_turn'] for i in indices):
        raise ValueError('Screen mapping crosses the task or future boundary')
    evidence = '\n'.join(context[i]['text'] for i in indices)
    if mapping['status'] == 'review':
        if mapping['prompt_parts'] or mapping['choices']:
            raise ValueError('Unresolved screen cannot carry a runnable question')
        return
    if not mapping['prompt_parts'] or any(not isinstance(s, str) or not s.strip() or s not in evidence for s in mapping['prompt_parts']):
        raise ValueError('Question text must be verbatim pre-cut evidence')
    if mapping['kind'] == 'choice':
        choices = mapping['choices']
        if not 2 <= len(choices) <= 26:
            raise ValueError('Choice screen needs all labeled options')
        cursor = 0
        for index, choice in enumerate(choices):
            if not isinstance(choice, dict) or set(choice) != {'id', 'label'} or choice['id'] != chr(65 + index):
                raise ValueError('Preserve consecutive original option labels and order')
            if not isinstance(choice['label'], str) or not choice['label'].strip():
                raise ValueError('Empty choice')
            marker = re.compile(r'(?<!\w)(?:Option\s+)?' + choice['id'] + r'\s*[:)]\s*', re.I)
            match = marker.search(evidence, cursor)
            if not match or not evidence[match.end():].startswith(choice['label']):
                raise ValueError('Choice text or ordering differs from its source label')
            cursor = match.end() + len(choice['label'])
            if not re.match(r'''^(?:\s*$|\s*[,;]|\.(?!\d)|\s*["'”]|\n(?:Option\s+)?[A-Z]\s*[:)])''', evidence[cursor:]):
                raise ValueError('Choice label is only a fragment of the source option')
        # A later E/F/etc cannot silently disappear from an otherwise valid map.
        if re.search(r'(?<!\w)(?:Option\s+)?' + chr(65 + len(choices)) + r'\s*[:)]\s*', evidence[cursor:], re.I):
            raise ValueError('Source options omitted')
    elif mapping['choices'] or not re.search(r'\b(?:input|answer|text|entry)\s+(?:box|field)\b|\b(?:types?|enters?)\b', evidence, re.I):
        raise ValueError('Text entry needs an explicit source input affordance')


def make_document(mapping, created_at):
    datetime.fromisoformat(created_at.replace('Z', '+00:00'))
    node = {'type': 'question', 'id': 'source-question', 'kind': mapping['kind'],
            'prompt': '\n'.join(mapping['prompt_parts'])}
    if mapping['kind'] == 'choice':
        node['choices'] = deepcopy(mapping['choices'])
        node['allowText'] = False
    return {'schemaVersion': 1, 'id': 'source-' + digest(mapping)[:24], 'revision': 0,
            'lifecycle': 'ready', 'retention': 'ephemeral',
            'supportedSurfaces': ['web', 'desktop', 'mobile', 'terminal'],
            'nodes': [node], 'createdAt': created_at, 'updatedAt': created_at}


def adapt_scenario(scenario, mapping, created_at, reviewer):
    import native_scenarios as native
    native.validate_native_scenario(scenario)
    if scenario['source']['dataset'] != 'tutormoments' or 'initial_document' in scenario:
        raise ValueError('Expected an original admitted TutorMoments scenario')
    validate_mapping(scenario, mapping)
    if mapping['status'] != 'ready' or not reviewer.strip():
        raise ValueError('Screen needs a completed mapping review')
    result = deepcopy(scenario)
    result['initial_document'] = make_document(mapping, created_at)
    result['source']['transformations'].append(VERSION)
    result['evaluation_only']['activity_adaptation'] = {
        'version': VERSION, 'mapping': deepcopy(mapping), 'mapping_sha256': digest(mapping),
        'reviewer': reviewer, 'created_at': created_at,
        'initial_document_sha256': digest(result['initial_document']),
        'state_policy': 'fresh-unanswered-attempt; historical-actions-remain-prefix-evidence',
        'assessment': 'unavailable; no-source-answer-key-in-document',
    }
    native.validate_native_scenario(result)
    return result


def validate_adaptation(scenario):
    review = scenario['evaluation_only'].get('activity_adaptation', {})
    if review.get('version') == 'native-practice-openui-v1':
        from native_practice_activities import validate_practice
        validate_practice(scenario)
        return
    mapping = review.get('mapping')
    if review.get('version') != VERSION or VERSION not in scenario['source']['transformations'] or not review.get('reviewer'):
        raise ValueError('Initial document requires versioned source review')
    validate_mapping(scenario, mapping)
    if mapping['status'] != 'ready' or review.get('mapping_sha256') != digest(mapping):
        raise ValueError('Screen mapping review mismatch')
    expected = make_document(mapping, review['created_at'])
    if scenario['initial_document'] != expected or review.get('initial_document_sha256') != digest(expected):
        raise ValueError('Initial document differs from reviewed evidence')


def build_activities(bundle, mappings, created_at, reviewer):
    ids = [s['id'] for s in bundle['scenarios']]
    if not isinstance(mappings, list) or len(mappings) != len(ids) or {m['id'] for m in mappings} != set(ids):
        raise ValueError('Every admitted scenario needs exactly one mapping decision')
    by_id = {m['id']: m for m in mappings}
    adapted, deferred = [], []
    for scenario in bundle['scenarios']:
        mapping = by_id[scenario['id']]
        validate_mapping(scenario, mapping)
        if mapping['status'] == 'ready':
            adapted.append(adapt_scenario(scenario, mapping, created_at, reviewer))
        else:
            deferred.append({'id': scenario['id'], 'family': scenario['family'], 'reason': mapping['reason']})
    return {'schema_version': 1, 'adapter': VERSION, 'parent_bundle_sha256': digest(bundle),
            'mapping_sha256': digest(mappings), 'reviewer': reviewer, 'created_at': created_at,
            'purpose': bundle['purpose'], 'registry_sha256': bundle['registry_sha256'],
            'families': deepcopy(bundle['families']), 'scenarios': adapted, 'deferred': deferred,
            'counts': {'admitted': len(ids), 'adapted': len(adapted), 'deferred': len(deferred),
                       'adapted_families': len({s['family'] for s in adapted})}}


def main():
    import native_scenarios as native
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('mappings', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--reviewer', required=True)
    args = parser.parse_args()
    bundle = json.loads(args.bundle.read_text())
    # Replay complete source grounding and split admission before adding controls.
    expected = native.build_native_scenarios(native.load_source_records(), native.load_registry(),
        bundle['source'], bundle['purpose'], native.read_exposure_ledger()['families'])
    if bundle != expected:
        raise ValueError('Original bundle failed source/admission replay')
    mappings = json.loads(args.mappings.read_text())
    result = build_activities(bundle, mappings, datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'), args.reviewer)
    output = native.output_directory(args.output)
    output.mkdir(parents=True, exist_ok=False)
    (output / 'activities.json').write_text(canonical(result) + '\n')
    for scenario in result['scenarios']:
        (output / (scenario['id'] + '.json')).write_text(canonical(scenario) + '\n')
    print(json.dumps(result['counts']))


if __name__ == '__main__':
    main()
