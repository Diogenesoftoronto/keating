"""Curate five small source/native comparisons from existing local artifacts.

Offline and read-only unless --write is supplied; only dataset-examples.json is
written. No runtime, admission, download, model, or training modules are imported.
Run from any directory with Python 3.10+:
  rtk proxy python3 scripts/report-site/curate_dataset_examples.py --check

Source record hashes use sorted-key, compact, non-ASCII-escaped UTF-8 JSON.
Asset/text hashes use exact UTF-8 bytes. JSON pointers are relative to one source
record. Excerpt labels are editorial; text following each label is verbatim.
"""

import argparse
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'docs/research-story/dataset-examples.json'
ADAPTER = 'scripts/training/native_scenarios.py'
CATALOG = 'scripts/training/benchmark_sources.json'
VERIFY = 'rtk proxy python3 scripts/report-site/curate_dataset_examples.py --check'
DEV = '.keating/native-learning/scenarios/adapters-development-verified'
REF = '.keating/native-learning/scenarios/adapters-reference-verified'
HEADER = 'Conversation available before your next tutoring response:\n'

# Only these source fields may enter the public excerpts. No original object,
# source persona, annotation, candidate answer, or participant identifier is copied.
SELECTIONS = [
    {
        'id': 'tutormoments-place-value-pause', 'dataset': 'tutormoments',
        'title': 'A pause before multiplying by ten', 'pack': DEV,
        'record': 'moments.jsonl#row=6', 'indices': [115, 116, 117, 118],
        'finding': 'The learner has paused without offering a mathematical attempt. The native opening preserves that decision point.',
        'limitations': ['The screen is represented by source text, not a delivered native multiple-choice activity.'],
    },
    {
        'id': 'tutormoments-tripling-explanation', 'dataset': 'tutormoments',
        'title': 'A correct answer with an explanation', 'pack': DEV,
        'record': 'moments.jsonl#row=8', 'indices': [142, 144, 146, 147],
        'finding': 'The learner explains both multiplications after selecting 18. The native state includes the explanation, not just the answer choice.',
        'limitations': ['The checkmark belongs to the source screen description; it is not a Keating activity receipt.'],
    },
    {
        'id': 'tutormoments-unmarked-task-change', 'dataset': 'tutormoments',
        'title': 'An admitted prefix with a missing task boundary', 'pack': DEV,
        'record': 'moments.jsonl#row=3', 'indices': [115, 131, 136, 140, 141, 142, 143],
        'finding': 'The retained prefix begins with 103 x 10, then switches to negative-number arrows without another explicit problem-start marker. The final reply is to four plus five.',
        'limitations': [
            'Curator review: the selected arrow and the full new task are unclear from the retained text; review before using this starting state.',
            'The adapter admitted this record. This is a context-review finding, not a recorded adapter rejection.',
            'This moment and the pause example come from the same source conversation; they are not independent learners.',
        ],
    },
    {
        'id': 'mathdial-aquarium-extra-addition', 'dataset': 'mathdial',
        'title': 'An extra addition after tripling', 'pack': REF,
        'record': 'train.jsonl#row=0',
        'finding': 'The attempt computes 18 x 3 = 54, then adds the original 18 again. The native opening retains the problem and that exact attempt before any source tutoring.',
        'limitations': ['Reference-only admission: this train question also appears in a protected benchmark family.'],
    },
    {
        'id': 'mrbench-pie-cost-units', 'dataset': 'mrbench',
        'title': 'A cost-per-pie error inside a short dialogue', 'pack': REF,
        'record': 'BEA_Shared_Task_2025_Datasets/mrbench_v3_devset.json#row=166',
        'finding': 'The attempt multiplies the stated per-pie cost by three pieces. The native state ends after the learner confirms that 12 pies were made.',
        'limitations': ['Reference-only admission: the matched family spans MathDial train/test, MathTutorBench benchmark, and MRBench dev.'],
    },
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


@lru_cache(maxsize=None)
def read_bytes(path):
    return (ROOT / path).read_bytes()


@lru_cache(maxsize=None)
def read_json(path):
    return json.loads(read_bytes(path))


def source_asset(dataset, asset):
    catalog = next(s for s in read_json(CATALOG)['sources'] if s['id'] == dataset)
    entry = next(f for f in catalog['files'] if f['path'] == asset)
    path = f".keating/datasets/sources/{dataset}/{catalog['revision']}/{asset}"
    require(sha256(read_bytes(path)) == entry['sha256'], f'Pinned asset changed: {path}')
    return catalog, entry, path


@lru_cache(maxsize=None)
def source_rows(path):
    data = read_bytes(path)
    return [json.loads(line) for line in data.splitlines() if line.strip()] if path.endswith('.jsonl') else json.loads(data)


def pointer(value, path):
    for part in path.lstrip('/').split('/'):
        part = part.replace('~1', '/').replace('~0', '~')
        value = value[int(part)] if isinstance(value, list) else value[part]
    return value


def reconstruct(dataset, original, cut):
    """Independent check of the three selected adapters, without importing them."""
    prefix = ''
    if dataset == 'tutormoments':
        context = original['context']
        starts = [i for i, turn in enumerate(context)
                  if re.search(r'\[PROBLEM_CHANGE:.*\(start\)\]', turn['text'])]
        start = starts[-1] if starts else 0
        require(start == cut['start_index'], 'TutorMoments boundary changed')
        numbers = [t['turn_number'] for t in context]
        require(numbers == sorted(numbers) and min(numbers) >= 1
                and max(numbers) <= cut['cut_turn'], 'Invalid frozen cut')
        turns = [('Learner' if t['role'] == 'student' else 'Tutor', t['text'])
                 for t in context[start:]]
    elif dataset == 'mathdial':
        prefix = 'Task supplied in the source:\n' + original['question'] + '\n\n'
        turns = [('Learner', original['student_incorrect_solution'])]
    else:
        history = original['conversation_history']
        markers = list(re.finditer(r'(?:^|\n)[^\S\n]*(Tutor|Teacher|Student):\s*', history, re.I))
        require(bool(markers) and not history[:markers[0].start()].strip(), 'Unparsed history')
        turns = [('Learner' if m[1].lower() == 'student' else 'Tutor',
                  history[m.end():markers[i + 1].start() if i + 1 < len(markers) else len(history)].strip())
                 for i, m in enumerate(markers)]
    require(turns[-1][0] == 'Learner', 'Not a learner decision boundary')
    if 'turns' in cut:
        require(len(turns) == cut['turns'], 'Turn count changed')
    return prefix + HEADER + '\n\n'.join(f'{role}: {text}' for role, text in turns)


def curate(selection):
    dataset = selection['dataset']
    asset, offset = selection['record'].rsplit('#row=', 1)
    row_number = int(offset)
    catalog, asset_info, source_path = source_asset(dataset, asset)
    original = source_rows(source_path)[row_number]
    pack_path = selection['pack'] + '/scenarios.json'
    pack = read_json(pack_path)
    native_index, scenario = next((i, s) for i, s in enumerate(pack['scenarios'])
                                  if s['source']['dataset'] == dataset
                                  and s['source']['record_id'] == selection['record'])
    source = scenario['source']
    private = scenario['evaluation_only']
    require(source['sha256'] == sha256(canonical(original)), 'Source record hash mismatch')
    require(source['revision'] == catalog['revision'] and source['license'] == catalog['license'], 'Source metadata mismatch')
    require(private['original'] == original, 'Saved original differs from cache')
    native_text = reconstruct(dataset, original, private['cut'])
    require(native_text == scenario['actor']['opening_message'], 'Native opening differs from source reconstruction')
    actor_path = selection['pack'] + '/actor.json'
    actor_index, actor = next((i, a) for i, a in enumerate(read_json(actor_path)) if a['id'] == scenario['id'])
    require(actor == {'id': scenario['id'], 'opening_message': native_text}, 'Actor projection differs')
    require(private['native_assessment'] == {'status': 'unassessed', 'outcome': None}, 'Assessment status changed')

    if dataset == 'tutormoments':
        parts = [{'pointer': f'/context/{i}/text',
                  'label': f"context[{i}] | {original['context'][i]['role']} | turn {original['context'][i]['turn_number']}"}
                 for i in selection['indices']]
        cut = private['cut']
        changes = [
            f"Keep context[{cut['start_index']}:{len(original['context'])}]: {cut['turns']} entries through source cut turn {cut['cut_turn']}; omit {cut['start_index']} earlier entries.",
            'Add the native opening header and speaker labels; map student to Learner. Preserve every retained text entry and its order.',
            'Keep source pauses, screen descriptions, and already-observed feedback as text.',
            'Withhold the source persona, future continuation, dimension, and rubric. Add no future learner replies.',
        ]
        withheld = ['student (including trait and reference)', 'dimension', 'rubric (including gold and hint)', 'participant and annotator provenance']
        unit = 'One frozen moment; selected pre-cut context entries, indexed from zero.'
        attribution = 'Ai2 / TutorMoments Preview contributors, pinned preview release.'
    elif dataset == 'mathdial':
        parts = [{'pointer': '/' + name, 'label': name} for name in ['question', 'student_incorrect_solution']]
        changes = [
            'Copy question under the native task header and student_incorrect_solution after Learner:; preserve both strings exactly.',
            'Start before the original conversation; copy none of its tutor moves or later learner replies.',
            'Withhold the solution key, source persona, teacher confusion label, and source ratings.',
        ]
        withheld = ['ground_truth', 'student_profile', 'teacher_described_confusion', 'conversation', 'self-correctness', 'self-typical-confusion', 'self-typical-interactions']
        unit = 'One MathDial row; problem qid 5000012; question and initial attempt fields.'
        attribution = 'MathDial dataset, ETH Zurich NLP / Language, Reasoning and Education contributors.'
    else:
        parts = [{'pointer': '/conversation_history', 'label': 'conversation_history'}]
        changes = [
            'Parse the four source history turns; add the native opening header, map Student to Learner, and separate turns with blank lines.',
            'Trim whitespace at parsed turn boundaries, including nonbreaking spaces. Preserve internal text and internal nonbreaking spaces.',
            'Keep the two tutor history turns and two learner turns; withhold all eight candidate tutor responses and their annotations.',
            'Retain the MathDial origin family (qid 5000043) instead of treating this repack as an independent task.',
        ]
        withheld = ['tutor_responses (all candidate response text and annotations)', 'conversation_id']
        unit = 'One MRBench / BEA v3 dev row; its four-turn conversation_history field.'
        attribution = 'MRBench / BEA v3, Maurya et al.; underlying problem and attempt from MathDial.'

    excerpt = '\n\n'.join(p['label'] + '\n' + pointer(original, p['pointer']) for p in parts)
    _, readme_info, readme_path = source_asset(dataset, 'README.md')
    license_url = 'https://creativecommons.org/licenses/' + ('by-sa' if dataset == 'mrbench' else 'by') + '/4.0/'
    evidence = {
        'source_path': source_path,
        'source_row_zero_based': row_number,
        'source_asset_sha256': asset_info['sha256'],
        'source_excerpt_parts': parts,
        'source_excerpt_sha256': sha256(excerpt.encode('utf-8')),
        'native_path': pack_path,
        'native_pointer': f'/scenarios/{native_index}/actor/opening_message',
        'native_pack_sha256': sha256(read_bytes(pack_path)),
        'native_scenario_sha256': sha256(canonical(scenario)),
        'native_text_sha256': sha256(native_text.encode('utf-8')),
        'actor_path': actor_path,
        'actor_pointer': f'/{actor_index}/opening_message',
        'adapter_path': ADAPTER,
        'adapter_sha256': sha256(read_bytes(ADAPTER)),
        'adapter_documentation_path': 'docs/native-scenario-adapters.md',
        'comparison_notebook_path': 'analysis/native_scenarios.py',
        'license_path': readme_path,
        'license_asset_sha256': readme_info['sha256'],
        'verifier': VERIFY,
        'verification_method': 'Check pinned asset bytes, canonical original-record hash, excerpt JSON pointers, independent native reconstruction, and saved actor projection; compare the regenerated public JSON byte for byte.',
    }
    if dataset == 'tutormoments':
        evidence['authored_pilot_notebook_path'] = 'analysis/tutormoments_comparison.py'
    if dataset == 'mrbench':
        _, _, origin_path = source_asset('mathdial', 'train.jsonl')
        origin = source_rows(origin_path)[814]
        require(origin['qid'] == 5000043 and origin['question'] in original['conversation_history'], 'MathDial origin mismatch')
        require(scenario['family'] == 'mathdial-qid-5000043', 'Saved origin family mismatch')
        evidence.update({'origin_path': origin_path, 'origin_record_id': 'train.jsonl#row=814',
                         'origin_revision': 'acc3878459e0bd8c04ab840056572f0b8b1abe1f',
                         'origin_record_sha256': sha256(canonical(origin))})

    return {
        'id': selection['id'], 'dataset': dataset, 'title': selection['title'],
        'source': {
            'record_id': selection['record'], 'revision': source['revision'],
            'sha256': source['sha256'], 'url': asset_info['url'],
            'license': source['license'], 'license_url': license_url,
            'license_evidence_url': readme_info['url'], 'attribution': attribution,
            'excerpt': excerpt, 'unit': unit,
        },
        'native': {'id': scenario['id'], 'text': native_text,
                   'artifact_status': 'saved-starting-state', 'license': source['license']},
        'changes': changes,
        'review': {
            'finding': selection['finding'],
            'context_review': private['context_review'],
            'admission': private['admission']['purpose'],
            'exposure': private['admission']['exposure'],
            'private_fields_withheld': withheld,
            'limitations': selection['limitations'] + [
                'Native text is the saved tutor-actor opening, not a delivered learner activity. Execution receipts were not examined; native assessment is unassessed.',
                'Source answers and annotations do not establish native learning outcomes.',
            ],
            'privacy': 'Excerpt and opening reviewed: no participant names, contact details, or participant IDs exported. Dataset row offsets identify records.' + (' Nancy is a character in the word problem.' if dataset == 'mathdial' else ''),
            'reuse': ('This MRBench example and its adaptation retain CC-BY-SA-4.0 with MathDial attribution. The license applies to this example; Bridge-derived material is not included.'
                      if dataset == 'mrbench' else 'Source excerpts and adaptations retain CC-BY-4.0 attribution; changes are listed above.'),
        },
        'evidence': evidence,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true', help='Read-only exact verification')
    mode.add_argument('--write', action='store_true', help='Write only the curated report JSON')
    args = parser.parse_args()
    result = {'schema_version': 1, 'examples': [curate(s) for s in SELECTIONS]}
    encoded = (json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')
    if args.write:
        OUTPUT.write_bytes(encoded)
    else:
        require(OUTPUT.read_bytes() == encoded, 'Public examples differ; inspect changes before regenerating')
    print(f"{'Wrote' if args.write else 'Verified'} 5 source/native pairs: 3 TutorMoments, 1 MathDial, 1 MRBench.")
    print('Pinned source hashes, excerpt text, full native openings, and actor projections match.')
    print('No inference, admissions, runtime artifacts, or network access used.')


if __name__ == '__main__':
    main()
