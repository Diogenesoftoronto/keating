"""Authored practice-surface adapter for canonical OpenUI text questions.

Accepts admitted development scenarios and creates a new text input affordance
for the same public task (not claiming the source had a text field).
No invented multiple-choice distractors, no preset answers or answer keys.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

VERSION = 'native-practice-openui-v1'
FIELDS = {'id', 'source_sha256', 'status', 'reason', 'prompt'}
PROTECTED_SPLITS = {'test', 'validation', 'benchmark'}
FORBIDDEN_DOC_KEYS = {
    'choices', 'allowText', 'correctAnswer', 'answer', 'hint',
    'rubric', 'explanation', 'solution',
}


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def validate_mapping(scenario, mapping):
    """Validate mapping against scenario context and affordance constraints."""
    if not isinstance(mapping, dict) or set(mapping) != FIELDS:
        raise ValueError('Invalid practice mapping fields')
    if not isinstance(scenario, dict) or mapping['id'] != scenario.get('id') or mapping['source_sha256'] != scenario.get('source', {}).get('sha256'):
        raise ValueError('Practice mapping source mismatch')
    if mapping['status'] not in ('ready', 'deferred'):
        raise ValueError('Invalid practice mapping status')
    if not isinstance(mapping['reason'], str) or not mapping['reason'].strip():
        raise ValueError('Practice mapping requires a review reason')

    if mapping['status'] == 'deferred':
        if mapping['prompt'] is not None and mapping['prompt'] != '':
            raise ValueError('Deferred practice mapping cannot carry a prompt')
        return

    prompt = mapping['prompt']
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError('Ready prompt must be a nonempty string')

    actor = scenario.get('actor', {})
    opening = actor.get('opening_message') if isinstance(actor, dict) else None
    if not isinstance(opening, str) or prompt not in opening:
        raise ValueError('Ready prompt must be an exact substring of actor.opening_message')


def make_document(mapping, created_at):
    """Create a canonical single-node OpenUI text question document."""
    datetime.fromisoformat(created_at.replace('Z', '+00:00'))
    node = {
        'type': 'question',
        'id': 'source-question',
        'kind': 'text',
        'prompt': mapping['prompt'],
    }
    return {
        'schemaVersion': 1,
        'id': 'source-' + digest(mapping)[:24],
        'revision': 0,
        'lifecycle': 'ready',
        'retention': 'ephemeral',
        'supportedSurfaces': ['web', 'desktop', 'mobile', 'terminal'],
        'nodes': [node],
        'createdAt': created_at,
        'updatedAt': created_at,
    }


def adapt_practice(scenario, mapping, created_at, reviewer):
    """Adapt an admitted development scenario with a ready practice mapping."""
    import native_scenarios as native
    native.validate_native_scenario(scenario)

    if 'initial_document' in scenario or 'activity_adaptation' in scenario.get('evaluation_only', {}):
        raise ValueError('Scenario is already adapted')
    if VERSION in scenario.get('source', {}).get('transformations', []):
        raise ValueError('Scenario already has practice transformation')

    admission = scenario.get('evaluation_only', {}).get('admission', {})
    if not isinstance(admission, dict) or admission.get('purpose') != 'development':
        raise ValueError('Expected an admitted development scenario')
    if admission.get('protected') is True:
        raise ValueError('Protected scenarios cannot be adapted for practice')
    if scenario.get('source', {}).get('original_split') in PROTECTED_SPLITS:
        raise ValueError('Protected split cannot be adapted for practice')

    validate_mapping(scenario, mapping)
    if mapping['status'] != 'ready':
        raise ValueError('Only ready mappings can be adapted')
    if not isinstance(reviewer, str) or not reviewer.strip():
        raise ValueError('Practice adaptation requires a reviewer')
    datetime.fromisoformat(created_at.replace('Z', '+00:00'))

    result = deepcopy(scenario)
    result['initial_document'] = make_document(mapping, created_at)
    result['source']['transformations'].append(VERSION)
    result['evaluation_only']['activity_adaptation'] = {
        'version': VERSION,
        'mapping': deepcopy(mapping),
        'mapping_sha256': digest(mapping),
        'reviewer': reviewer,
        'created_at': created_at,
        'initial_document_sha256': digest(result['initial_document']),
        'actor_sha256': digest(result['actor']),
        'provenance': 'authored-practice-surface; new-canonical-text-input-not-source-asserted',
        'affordance': 'new-text-input-for-public-task; no-invented-multiple-choice-distractors',
        'state_policy': 'fresh-unanswered-attempt; historical-actions-remain-prefix-evidence',
        'assessment': 'unavailable; no-source-answer-key-in-document',
    }
    validate_practice(result)
    native.validate_native_scenario(result)
    return result


def validate_practice(scenario):
    """Reconstruct exact document, mapping hash, and ensure recognized transformation.

    Does not import parent native_scenarios to avoid recursion when coordinator
    dispatches from validate_native_scenario to validate_practice.
    """
    if not isinstance(scenario, dict):
        raise ValueError('Invalid scenario envelope')

    if 'initial_document' not in scenario:
        raise ValueError('Scenario is missing initial_document')

    eval_only = scenario.get('evaluation_only')
    if not isinstance(eval_only, dict):
        raise ValueError('Scenario is missing evaluation_only')

    review = eval_only.get('activity_adaptation')
    if not isinstance(review, dict):
        raise ValueError('Initial document requires versioned practice review')

    # Recognized transformation
    if review.get('version') != VERSION:
        raise ValueError('Initial document requires versioned practice review')
    transformations = scenario.get('source', {}).get('transformations', [])
    if not isinstance(transformations, list) or VERSION not in transformations:
        raise ValueError('Missing practice transformation in source')

    reviewer = review.get('reviewer')
    if not isinstance(reviewer, str) or not reviewer.strip():
        raise ValueError('Practice review requires a reviewer')

    # Development admission
    admission = eval_only.get('admission', {})
    if not isinstance(admission, dict) or admission.get('purpose') != 'development':
        raise ValueError('Expected an admitted development scenario')
    if admission.get('protected') is True:
        raise ValueError('Protected scenarios cannot be practice adapted')
    original_split = scenario.get('source', {}).get('original_split')
    if original_split in PROTECTED_SPLITS:
        raise ValueError('Protected split cannot be practice adapted')

    # Scenario identity / source hash
    mapping = review.get('mapping')
    validate_mapping(scenario, mapping)
    if mapping['status'] != 'ready':
        raise ValueError('Practice mapping must be ready')
    if mapping['id'] != scenario.get('id'):
        raise ValueError('Practice mapping scenario ID mismatch')
    if mapping['source_sha256'] != scenario.get('source', {}).get('sha256'):
        raise ValueError('Practice mapping source hash mismatch')
    if digest(eval_only.get('original')) != scenario.get('source', {}).get('sha256'):
        raise ValueError('Original record hash mismatch')

    # Mapping hash
    if review.get('mapping_sha256') != digest(mapping):
        raise ValueError('Practice mapping review hash mismatch')

    # Exact document reconstruction & document hash
    created_at = review.get('created_at')
    if not isinstance(created_at, str):
        raise ValueError('Practice review requires created_at')
    expected_doc = make_document(mapping, created_at)
    if scenario.get('initial_document') != expected_doc:
        raise ValueError('Initial document differs from reviewed practice mapping')
    if review.get('initial_document_sha256') != digest(expected_doc):
        raise ValueError('Initial document hash mismatch')

    # Unchanged source-view binding
    actor = scenario.get('actor')
    if digest(actor) != review.get('actor_sha256'):
        raise ValueError('Actor view mutated after review')

    # Native result stays unassessed
    if eval_only.get('native_assessment') != {'status': 'unassessed', 'outcome': None}:
        raise ValueError('Native result must stay unassessed')

    # Document contains no preset answers, answer keys, or hints
    doc = scenario['initial_document']
    nodes = doc.get('nodes', [])
    if len(nodes) != 1 or nodes[0].get('type') != 'question' or nodes[0].get('kind') != 'text':
        raise ValueError('Invalid practice document shape')
    for forbidden in FORBIDDEN_DOC_KEYS:
        if forbidden in nodes[0]:
            raise ValueError(f'Document contains forbidden preset answer/key: {forbidden}')

    # Explicit authored-affordance provenance
    provenance = review.get('provenance')
    if not isinstance(provenance, str) or not provenance.strip():
        raise ValueError('Practice review requires explicit authored affordance provenance')

    return scenario


def build_activities(bundle, mappings, created_at, reviewer):
    """Build practice activities bundle from admitted scenarios and mappings."""
    ids = [s['id'] for s in bundle['scenarios']]
    if not isinstance(mappings, list) or len(mappings) != len(ids) or {m['id'] for m in mappings} != set(ids):
        raise ValueError('Every admitted scenario needs exactly one mapping decision')
    by_id = {m['id']: m for m in mappings}
    adapted, deferred = [], []
    for scenario in bundle['scenarios']:
        mapping = by_id[scenario['id']]
        validate_mapping(scenario, mapping)
        if mapping['status'] == 'ready':
            adapted.append(adapt_practice(scenario, mapping, created_at, reviewer))
        else:
            deferred.append({'id': scenario['id'], 'family': scenario['family'], 'reason': mapping['reason']})
    return {
        'schema_version': 1,
        'adapter': VERSION,
        'parent_bundle_sha256': digest(bundle),
        'mapping_sha256': digest(mappings),
        'reviewer': reviewer,
        'created_at': created_at,
        'purpose': bundle['purpose'],
        'registry_sha256': bundle['registry_sha256'],
        'families': deepcopy(bundle['families']),
        'scenarios': adapted,
        'deferred': deferred,
        'counts': {
            'admitted': len(ids),
            'adapted': len(adapted),
            'deferred': len(deferred),
            'adapted_families': len({s['family'] for s in adapted}),
        },
    }


def main():
    import native_scenarios as native
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('mappings', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--reviewer', required=True)
    args = parser.parse_args()
    bundle = json.loads(args.bundle.read_text())
    expected = native.build_native_scenarios(
        native.load_source_records(),
        native.load_registry(),
        bundle['source'],
        bundle['purpose'],
        native.read_exposure_ledger()['families'],
    )
    if bundle != expected:
        raise ValueError('Original bundle failed source/admission replay')
    mappings = json.loads(args.mappings.read_text())
    stamp = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    result = build_activities(bundle, mappings, stamp, args.reviewer)
    output = native.output_directory(args.output)
    output.mkdir(parents=True, exist_ok=False)
    (output / 'activities.json').write_text(canonical(result) + '\n')
    for scenario in result['scenarios']:
        (output / (scenario['id'] + '.json')).write_text(canonical(scenario) + '\n')
    print(json.dumps(result['counts']))


if __name__ == '__main__':
    main()
