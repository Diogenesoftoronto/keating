"""Source-grounded starting states for the real runtime; no generated outcomes.

Uses benchmark_sources' pinned, checksum-verified cache. Build outputs contain
private source answers and must stay under the repository's ignored .keating/.
Reference materialization is not a pristine release holdout or an official score.
"""
import argparse
from collections import Counter, defaultdict
from copy import deepcopy
from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unicodedata

import benchmark_sources as sources

ROOT = sources.ROOT
REGISTRY = Path(__file__).with_name('native_family_registry.json')
SCHEMA = Path(__file__).with_suffix('.schema.json')
EXPOSURE_LEDGER = ROOT / '.keating/native-learning/scenarios/exposure-ledger.json'
DATASETS = ('mathdial', 'bridge', 'mrbench', 'mathtutorbench', 'tutormoments')
SPLITS = {
    'mathdial': {'train.jsonl': 'train', 'test.jsonl': 'test'},
    'bridge': {'train.json': 'train', 'validation.json': 'validation', 'test.json': 'test'},
    'mrbench': {'BEA_Shared_Task_2025_Datasets/mrbench_v3_devset.json': 'dev',
                'BEA_Shared_Task_2025_Datasets/mrbench_v3_testset.json': 'test'},
    'mathtutorbench': {'datasets/mathdial_bridge.json': 'benchmark',
                       'datasets/mathdial_bridge_hard.json': 'benchmark'},
    'tutormoments': {'moments.jsonl': 'benchmark'},
}
PROTECTED_SPLITS = {'test', 'validation', 'benchmark'}
VISUAL = re.compile(
    r'\b(?:image|picture|diagram|pictograph|screenshot|worksheet|graph|chart|'
    r'whiteboard|highlighted|shaded|pictured)\b|'
    r'\bfigure\b(?!\s+out)|<img\b', re.I)
ROLE = re.compile(r'(?:^|\n)[^\S\n]*(Tutor|Teacher|Student):\s*', re.I)


class Rejected(ValueError):
    """A stable rejection code, deliberately excluding private source content."""


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def normalized(text):
    """Identity matching only; original text is retained in scenario evidence."""
    text = unicodedata.normalize('NFKC', text).casefold()
    text = text.translate(str.maketrans({'’': "'", '‘': "'", '“': '"', '”': '"'}))
    # Preserve numbers, mathematical operators and token boundaries. In
    # particular, 2+3 and 2-3 must never compare as the same problem.
    return ' '.join(text.split())


def require_text(value, reason='invalid_source_text'):
    if not isinstance(value, str) or not value.strip():
        raise Rejected(reason)
    return value


@dataclass(frozen=True)
class SourceRecord:
    dataset: str
    revision: str
    license: str
    original_split: str
    asset: str
    asset_sha256: str
    record_id: str
    sha256: str
    value: dict

    @property
    def key(self):
        return f'{self.dataset}/{self.revision}/{self.record_id}'


def load_source_records(cache=sources.CACHE, catalog=None):
    """Read ALL collections before source selection so joins see held-out rows."""
    catalog = sources.source_catalog() if catalog is None else catalog
    selected = {s['id']: s for s in catalog if s['id'] in DATASETS}
    if set(selected) != set(DATASETS):
        raise ValueError('All five source snapshots are required for overlap checks')
    records = []
    for dataset in DATASETS:
        source = selected[dataset]
        assets = {a['path']: a for a in source['files']}
        if not set(SPLITS[dataset]).issubset(assets):
            raise ValueError(f'Missing overlap assets: {dataset}')
        for path, split in SPLITS[dataset].items():
            asset = assets[path]
            for index, row in enumerate(sources.original_records(source, asset, cache)):
                if not isinstance(row, dict):
                    raise ValueError(f'Expected object: {dataset}/{path}#{index}')
                records.append(SourceRecord(dataset, source['revision'], source['license'],
                    split, path, asset['sha256'], f'{path}#row={index}', digest(row), row))
    return records


def load_registry(path=REGISTRY):
    registry = json.loads(Path(path).read_text())
    validate_registry(registry)
    return registry


def validate_registry(registry):
    if registry.get('schema_version') != 1 or registry.get('default') != 'deny':
        raise ValueError('Registry must be version 1 and default deny')
    if set(registry.get('sources', {})) != set(DATASETS):
        raise ValueError('Registry must explicitly pin all five sources')
    for dataset, policy in registry['sources'].items():
        if not re.fullmatch(r'[0-9a-f]{40}', policy.get('revision', '')):
            raise ValueError('Invalid registry revision')
        if set(policy.get('assets', {})) != set(SPLITS[dataset]):
            raise ValueError('Registry must pin every overlap asset')
        if any(not re.fullmatch(r'[0-9a-f]{64}', x) for x in policy['assets'].values()):
            raise ValueError('Invalid registry asset hash')
        if set(policy.get('split_purposes', {})) != set(SPLITS[dataset].values()):
            raise ValueError('Registry must explicitly authorize each source split')
        for split, purposes in policy['split_purposes'].items():
            if not isinstance(purposes, list) or not set(purposes) <= {'development', 'reference'}:
                raise ValueError('Invalid registry purposes')
            if split in PROTECTED_SPLITS and 'development' in purposes:
                raise ValueError('Cannot authorize a protected source split for development')
    exposed = registry.get('development_exposed', [])
    if not isinstance(exposed, list) or any(
            not x.get('family') or not x.get('source_record_ids') or not x.get('evidence')
            for x in exposed):
        raise ValueError('Exposure records require family, source IDs and evidence')
    if not isinstance(registry.get('protected_families'), list):
        raise ValueError('Registry requires a protected-family list')


def list_turns(turns, role_key='user'):
    if not isinstance(turns, list) or not turns:
        raise Rejected('missing_prefix')
    projected = []
    for turn in turns:
        if not isinstance(turn, dict):
            raise Rejected('invalid_source_turn')
        role = str(turn.get(role_key, '')).casefold()
        if role not in ('tutor', 'teacher', 'student', 'learner'):
            raise Rejected('unknown_source_role')
        projected.append({'role': 'learner' if role in ('student', 'learner') else 'tutor',
                          'text': require_text(turn.get('text'))})
    return projected


def mrbench_turns(history):
    history = require_text(history)
    matches = list(ROLE.finditer(history))
    if not matches or history[:matches[0].start()].strip():
        raise Rejected('unparseable_history')
    result = []
    for i, match in enumerate(matches):
        text = history[match.end():matches[i + 1].start() if i + 1 < len(matches) else len(history)].strip()
        # An unknown speaker marker must not be swallowed as another speaker's text.
        if re.search(r'(?m)^\s*(?:Turor|Assistant|User):', text, re.I):
            raise Rejected('unknown_source_role')
        result.append({'role': 'learner' if match[1].casefold() == 'student' else 'tutor',
                       'text': require_text(text)})
    return result


class OriginIndex:
    """Conservative joins to original qids / Bridge conversation IDs.

    No dataset-specific UUID in a repack becomes a new independent family.
    Ambiguous joins and absent identity are quarantined, never hashed into a
    fictitious independent holdout. Equal questions merge MathDial qid aliases.
    """

    def __init__(self, records):
        self.questions = defaultdict(set)
        self.qid_questions = defaultdict(set)
        self.bridge_anchors = defaultdict(set)
        self.bridge_ids = defaultdict(set)
        self.aliases = {}
        for record in records:
            row = record.value
            if record.dataset == 'mathdial':
                qid = row.get('qid')
                if type(qid) not in (str, int) or not re.fullmatch(r'\d+', str(qid)):
                    continue
                if not isinstance(row.get('question'), str) or not normalized(row['question']):
                    continue
                family = f'mathdial-qid-{qid}'
                question = normalized(row['question'])
                self.questions[question].add(family)
                self.qid_questions[family].add(question)
            if record.dataset == 'bridge':
                identity = row.get('c_id', '')
                if not isinstance(identity, str) or not re.fullmatch(r'\d+_\d+', identity):
                    continue
                try:
                    turns = list_turns(row.get('c_h'))
                except Rejected:
                    continue
                family = 'bridge-conversation-' + identity.rsplit('_', 1)[0]
                self.bridge_ids[identity].add(digest(turns))
                for turn in turns:
                    anchor = normalized(turn['text'])
                    # Generic short learner replies cannot establish source identity.
                    if turn['role'] == 'learner' and len(anchor) >= 24:
                        self.bridge_anchors[anchor].add(family)
        for aliases in self.questions.values():
            representative = min(aliases)
            for alias in aliases:
                self.aliases[alias] = representative

    def mathdial_match(self, question, contains=False):
        text = normalized(question)
        matches = set()
        for candidate, families in self.questions.items():
            if candidate == text or (contains and len(candidate) >= 24 and candidate in text):
                matches.update(families)
        if any(len(self.qid_questions[f]) != 1 for f in matches):
            raise Rejected('origin_identity_collision')
        return matches

    def bridge_match(self, turns):
        hits = [self.bridge_anchors[normalized(t['text'])] for t in turns
                if t['role'] == 'learner' and normalized(t['text']) in self.bridge_anchors]
        if not hits:
            return set()
        # Every matching informative utterance must agree on one conversation.
        common = set.intersection(*map(set, hits))
        if len(common) != 1:
            raise Rejected('ambiguous_origin')
        return common


def resolve_origin(record, index):
    row = record.value
    if record.dataset == 'mathdial':
        qid = row.get('qid')
        if type(qid) not in (str, int) or not re.fullmatch(r'\d+', str(qid)):
            raise Rejected('missing_origin_identity')
        aliases = index.mathdial_match(require_text(row.get('question')))
        if f'mathdial-qid-{qid}' not in aliases:
            raise Rejected('origin_identity_collision')
        return min(aliases), sorted(aliases), 'original-qid-and-exact-question'
    if record.dataset == 'bridge':
        identity = row.get('c_id', '')
        if not isinstance(identity, str) or not re.fullmatch(r'\d+_\d+', identity):
            raise Rejected('missing_origin_identity')
        if len(index.bridge_ids[identity]) != 1:
            raise Rejected('origin_identity_collision')
        family = 'bridge-conversation-' + identity.rsplit('_', 1)[0]
        return family, [family], 'original-conversation-id'
    if record.dataset == 'tutormoments':
        identity = row.get('provenance', {}).get('conv_id', '')
        # Released conv_id ends in the stable session UUID used by our v1 suite.
        uuid = identity.rsplit('_', 1)[-1] if isinstance(identity, str) else ''
        if not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', uuid):
            raise Rejected('missing_origin_identity')
        family = 'tm-' + uuid
        return family, [family], 'original-conversation-id'
    if record.dataset == 'mathtutorbench':
        problem = row.get('problem')
        if not isinstance(problem, str):
            raise Rejected('missing_problem_context')
        turns = list_turns(row.get('dialog_history'))
        matches = index.mathdial_match(problem) if problem.strip() else index.bridge_match(turns)
        method = 'exact-normalized-problem' if problem.strip() else 'unique-learner-utterance-match'
    elif record.dataset == 'mrbench':
        turns = mrbench_turns(row.get('conversation_history'))
        matches = index.mathdial_match('\n'.join(t['text'] for t in turns), contains=True)
        method = 'exact-normalized-problem-in-prefix'
        if not matches:
            matches = index.bridge_match(turns)
            method = 'unique-learner-utterance-match'
    else:
        raise Rejected('unauthorized_source')
    representatives = {index.aliases.get(f, f) for f in matches}
    if not matches:
        raise Rejected('unresolved_origin')
    if len(representatives) != 1:
        raise Rejected('ambiguous_origin')
    return min(representatives), sorted(matches), method


def source_prefix(record):
    """Allowlist the information that existed before the next tutor decision."""
    row = record.value
    problem = None
    if record.dataset == 'mathdial':
        problem = require_text(row.get('question'), 'missing_problem_context')
        attempt = require_text(row.get('student_incorrect_solution'), 'missing_learner_attempt')
        turns = [{'role': 'learner', 'text': attempt}]
        cut = {'field': 'student_incorrect_solution', 'policy': 'before-original-conversation'}
    elif record.dataset == 'bridge':
        turns = list_turns(row.get('c_h'))
        cut = {'field': 'c_h', 'turns': len(turns)}
    elif record.dataset == 'mrbench':
        turns = mrbench_turns(row.get('conversation_history'))
        cut = {'field': 'conversation_history', 'turns': len(turns)}
    elif record.dataset == 'mathtutorbench':
        problem = row.get('problem') or None
        turns = list_turns(row.get('dialog_history'))
        original_count = len(turns)
        # Bundled tasks end in the candidate tutor response. Do not show it.
        while turns and turns[-1]['role'] == 'tutor':
            turns.pop()
        cut = {'field': 'dialog_history', 'turns': len(turns),
               'withheld_trailing_tutor_turns': original_count - len(turns)}
    else:
        provenance = row.get('provenance', {})
        bound = provenance.get('cut_turn')
        if type(bound) is not int or bound < 1:
            raise Rejected('invalid_cut_boundary')
        previous = 0
        for turn in row.get('context', []):
            number = turn.get('turn_number')
            if type(number) is not int or not max(1, previous) <= number <= bound:
                raise Rejected('post_cut_or_unordered_context')
            previous = number
        context = row.get('context', [])
        # The release transcribes many unrelated earlier screens. Restrict a
        # native task to the latest explicit source problem boundary, retaining
        # its text and all intervening learner evidence. Do not guess a task
        # from an answer or use student.reference to fill missing context.
        starts = [i for i, t in enumerate(context)
                  if re.search(r'\[PROBLEM_CHANGE:.*\(start\)\]', str(t.get('text', '')))]
        start = starts[-1] if starts else 0
        turns = list_turns(context[start:], 'role')
        cut = {'field': 'context', 'cut_turn': bound, 'turns': len(turns),
               'start_index': start, 'policy': 'latest-explicit-problem-boundary-or-full-prefix'}
    if not turns or turns[-1]['role'] != 'learner':
        raise Rejected('prefix_not_at_learner_decision')
    return problem, turns, cut


def check_context(problem, turns):
    text = '\n'.join(([problem] if problem else []) + [t['text'] for t in turns])
    if VISUAL.search(text):
        raise Rejected('missing_visual_context')
    if problem:
        require_text(problem, 'missing_problem_context')
        return
    # Conservative sufficiency screen for sources without a standalone task.
    # Passing this is not an independent semantic suitability review.
    for turn in turns:
        text = turn['text']
        if turn['role'] != 'tutor':
            continue
        numbers = re.findall(r'\d+(?:\.\d+)?', text)
        prompt = '?' in text or re.search(r'\b(?:solve|round|compute|calculate|simplify|evaluate|convert)\b', text, re.I)
        if prompt and (len(numbers) >= 2 or (numbers and re.search(r'\b(?:sides|round|place|decimal|percent)\b', text, re.I))):
            return
    raise Rejected('missing_problem_context')


def admission(family, aliases, members, registry, purpose, materialized=()):
    exposed = {e['family'] for e in registry['development_exposed']}
    explicit_protected = set(registry['protected_families'])
    if purpose == 'development' and explicit_protected.intersection(aliases):
        raise Rejected('protected_family')
    for member in members:
        policy = registry['sources'].get(member.dataset, {})
        if (policy.get('revision') != member.revision
                or policy.get('assets', {}).get(member.asset) != member.asset_sha256
                or SPLITS.get(member.dataset, {}).get(member.asset) != member.original_split):
            raise Rejected('unapproved_snapshot')
        permitted = policy.get('split_purposes', {}).get(member.original_split, [])
        # Existing development exposures are reusable only for TutorMoments;
        # they cannot authorize a MathDial/Bridge test-family overlap.
        exposure_exception = (purpose == 'development' and family in exposed
                              and member.dataset == 'tutormoments')
        if purpose not in permitted and not exposure_exception:
            raise Rejected('protected_source_split' if member.original_split in PROTECTED_SPLITS
                           else 'unauthorized_family')
    return {'purpose': purpose,
            'exposure': 'development-exposed' if family in exposed or purpose == 'development'
                        or set(aliases).intersection(materialized)
                        else 'reference-materialized-not-sealed-holdout',
            'source_splits': sorted({f'{r.dataset}:{r.original_split}' for r in members}),
            'protected': bool(explicit_protected.intersection(aliases)) or
                         any(r.original_split in PROTECTED_SPLITS for r in members)}


def make_scenario(record, origin, decision):
    problem, turns, cut = source_prefix(record)
    check_context(problem, turns)
    prefix = ('Task supplied in the source:\n' + problem + '\n\n') if problem else ''
    prefix += 'Conversation available before your next tutoring response:\n'
    prefix += '\n\n'.join(f"{t['role'].title()}: {t['text']}" for t in turns)
    family, aliases, method = origin
    result = {
        'schema_version': 1,
        'id': record.dataset + '-' + digest(record.key)[:24],
        'family': family,
        'source': {'dataset': record.dataset, 'revision': record.revision,
                   'record_id': record.record_id, 'sha256': record.sha256,
                   'license': record.license, 'original_split': record.original_split,
                   'transformations': ['native-starting-state-v1', 'allowlisted-pre-action-evidence',
                                       'private-original-retained', 'no-scripted-future', method]},
        'actor': {'opening_message': prefix},
        'learner': {'profile_evidence': [
            {'kind': 'observed_learner_utterance', 'text': t['text']}
            for t in turns if t['role'] == 'learner'], 'assumptions': []},
        'evaluation_only': {
            'original': deepcopy(record.value),
            'asset': {'path': record.asset, 'sha256': record.asset_sha256},
            'cut': cut, 'origin': {'aliases': aliases, 'method': method},
            'admission': decision,
            'context_review': 'heuristic-pass-independent-review-required',
            'native_assessment': {'status': 'unassessed', 'outcome': None},
        },
    }
    validate_native_scenario(result)
    return result


def validate_native_scenario(scenario):
    """Strict public shape and source hash. Full grounding uses bundle replay."""
    keys = {'schema_version', 'id', 'family', 'source', 'actor', 'learner', 'evaluation_only'}
    if not isinstance(scenario, dict) or set(scenario) not in (keys, keys | {'initial_document'}) or type(scenario['schema_version']) is not int or scenario['schema_version'] != 1:
        raise ValueError('Invalid scenario envelope')
    for key in ('id', 'family'):
        require_text(scenario[key])
    source = scenario['source']
    if not isinstance(source, dict) or set(source) != {'dataset', 'revision', 'record_id', 'sha256', 'license', 'original_split', 'transformations'}:
        raise ValueError('Invalid source contract')
    if source['dataset'] not in DATASETS or source['original_split'] not in set(SPLITS[source['dataset']].values()):
        raise ValueError('Invalid dataset or split')
    if not re.fullmatch(r'[0-9a-f]{40}', source['revision']) or not re.fullmatch(r'[0-9a-f]{64}', source['sha256']):
        raise ValueError('Invalid source hashes')
    for key in ('record_id', 'license'):
        require_text(source[key])
    if not isinstance(source['transformations'], list) or not source['transformations'] or any(not isinstance(t, str) or not t for t in source['transformations']):
        raise ValueError('Invalid transformations')
    actor, learner = scenario['actor'], scenario['learner']
    if not isinstance(actor, dict) or set(actor) != {'opening_message'}:
        raise ValueError('Actor view must contain only opening_message')
    require_text(actor['opening_message'])
    if not isinstance(learner, dict) or set(learner) != {'profile_evidence', 'assumptions'}:
        raise ValueError('Invalid learner view')
    for field in learner.values():
        if not isinstance(field, list):
            raise ValueError('Learner fields must be lists')
        for evidence in field:
            if not isinstance(evidence, dict) or set(evidence) != {'kind', 'text'}:
                raise ValueError('Learner evidence must be allowlisted kind/text')
            require_text(evidence['kind'])
            require_text(evidence['text'])
    private = scenario['evaluation_only']
    if not isinstance(private, dict) or digest(private.get('original')) != source['sha256']:
        raise ValueError('Original record hash mismatch')
    if private.get('native_assessment') != {'status': 'unassessed', 'outcome': None}:
        raise ValueError('Adapter must not invent a native result')
    if 'initial_document' in scenario:
        from native_source_activities import validate_adaptation
        validate_adaptation(scenario)
    return scenario


def public_views(scenario):
    """Only these projections may be sent to actor / learner providers."""
    validate_native_scenario(scenario)
    return {'actor': deepcopy(scenario['actor']), 'learner': deepcopy(scenario['learner'])}


def build_native_scenarios(records, registry, source='all', purpose='development', exposed_families=()):
    """Deterministic pure builder. No provider, source download or state mutation."""
    validate_registry(registry)
    if source not in ('all', *DATASETS) or purpose not in ('development', 'reference'):
        raise ValueError('Unknown source or purpose')
    index = OriginIndex(records)
    origins, failures = {}, {}
    members, all_aliases = defaultdict(list), defaultdict(set)
    for record in records:
        if record.key in origins or record.key in failures:
            raise ValueError('Duplicate source record identity')
        if digest(record.value) != record.sha256:
            raise ValueError('Source record mutated after verification')
        try:
            origin = resolve_origin(record, index)
            origins[record.key] = origin
            members[origin[0]].append(record)
            all_aliases[origin[0]].update(origin[1])
        except Rejected as error:
            failures[record.key] = str(error)
            # Even an unusable original with a well-formed source identity
            # reserves its family. A malformed/colliding TEST prefix must not
            # disappear from the admission census and free its TRAIN siblings.
            raw = record.value
            claimed = None
            if record.dataset == 'mathdial' and type(raw.get('qid')) in (str, int) and re.fullmatch(r'\d+', str(raw['qid'])):
                claimed = index.aliases.get(f"mathdial-qid-{raw['qid']}", f"mathdial-qid-{raw['qid']}")
            if record.dataset == 'bridge' and isinstance(raw.get('c_id'), str) and re.fullmatch(r'\d+_\d+', raw['c_id']):
                claimed = 'bridge-conversation-' + raw['c_id'].rsplit('_', 1)[0]
            if claimed:
                members[claimed].append(record)
                all_aliases[claimed].add(claimed)
    scenarios, rejected, audit = [], [], []
    decisions = {}
    for family, related in sorted(members.items()):
        try:
            decisions[family] = admission(family, all_aliases[family], related, registry, purpose, exposed_families)
        except Rejected as error:
            decisions[family] = str(error)
        audit.append({'family': family, 'aliases': sorted(all_aliases[family]),
                      'members': [{'dataset': r.dataset, 'record_id': r.record_id,
                                   'original_split': r.original_split, 'sha256': r.sha256}
                                  for r in related], 'decision': decisions[family]})
    for record in records:
        if source not in ('all', record.dataset):
            continue
        try:
            if record.key in failures:
                raise Rejected(failures[record.key])
            decision = decisions[origins[record.key][0]]
            if isinstance(decision, str):
                raise Rejected(decision)
            scenarios.append(make_scenario(record, origins[record.key], decision))
        except (Rejected, KeyError, TypeError) as error:
            reason = str(error) if isinstance(error, Rejected) else 'invalid_source_shape'
            rejected.append({'dataset': record.dataset, 'record_id': record.record_id,
                             'sha256': record.sha256, 'reason': reason,
                             'family': origins.get(record.key, (None,))[0]})
    counts = {d: {'eligible': sum(s['source']['dataset'] == d for s in scenarios),
                  'rejected': dict(sorted(Counter(r['reason'] for r in rejected if r['dataset'] == d).items()))}
              for d in DATASETS if source in ('all', d)}
    return {'schema_version': 1, 'source': source, 'purpose': purpose,
            'registry_sha256': digest(registry),
            'summary': {'eligible': len(scenarios), 'rejected': len(rejected), 'by_source': counts},
            'scenarios': scenarios, 'rejected': rejected, 'families': audit}


def output_directory(path):
    path = Path(path).resolve()
    roots = [(ROOT / '.keating/outputs').resolve(),
             (ROOT / '.keating/native-learning/scenarios').resolve()]
    if not any(path.is_relative_to(root) and path != (ROOT / '.keating').resolve() for root in roots):
        raise ValueError('Source-derived outputs must stay under .keating/outputs/ or .keating/native-learning/scenarios/')
    result = subprocess.run(['git', 'check-ignore', '--quiet', '--no-index', str(path)], cwd=ROOT)
    if result.returncode != 0:
        raise ValueError('Output must be gitignored')
    return path


def bundle_files(bundle):
    return {'scenarios.json': bundle,
            'actor.json': [{'id': s['id'], **public_views(s)['actor']} for s in bundle['scenarios']],
            'learner.json': [{'id': s['id'], **public_views(s)['learner']} for s in bundle['scenarios']]}


def read_exposure_ledger(path=None):
    path = EXPOSURE_LEDGER if path is None else Path(path)
    if not path.exists():
        return {'schema_version': 1, 'families': {}}
    value = json.loads(path.read_text())
    if not isinstance(value, dict) or value.get('schema_version') != 1 or not isinstance(value.get('families'), dict):
        raise ValueError('Invalid exposure ledger; refusing to forget prior exposure')
    for family, evidence in value['families'].items():
        if not isinstance(family, str) or not family or not isinstance(evidence, dict) or not evidence.get('first_output'):
            raise ValueError('Invalid exposure evidence')
    return value


def persist_exposures(bundle, directory, ledger, path=None):
    """Caller holds the ledger lock. Record exposure BEFORE publishing payloads.

    This monotonic journal can restrict/label future use, never authorize it.
    A failed publication remains exposed conservatively. No raw data is logged.
    """
    if bundle['purpose'] != 'development':
        return
    path = EXPOSURE_LEDGER if path is None else Path(path)
    for scenario in bundle['scenarios']:
        for family in scenario['evaluation_only']['origin']['aliases']:
            ledger['families'].setdefault(family, {
                'first_output': str(directory), 'registry_sha256': bundle['registry_sha256'],
                'status': 'development-exposed-never-untouched-holdout'})
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', dir=path.parent, delete=False) as temporary:
        temporary.write(canonical(ledger) + '\n')
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('build', 'inspect', 'validate'))
    parser.add_argument('--source', choices=('all', *DATASETS), default='all')
    parser.add_argument('--purpose', choices=('development', 'reference'), default='development')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--cache', type=Path, default=sources.CACHE)
    parser.add_argument('--registry', type=Path, default=REGISTRY)
    args = parser.parse_args()
    if args.command != 'inspect' and args.output is None:
        parser.error('build and validate require --output')
    registry = load_registry(args.registry)
    records = load_source_records(args.cache)
    if args.command == 'build':
        directory = output_directory(args.output)
        directory.mkdir(parents=True, exist_ok=False)
        EXPOSURE_LEDGER.parent.mkdir(parents=True, exist_ok=True)
        with EXPOSURE_LEDGER.with_suffix('.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            ledger = read_exposure_ledger()
            bundle = build_native_scenarios(records, registry, args.source, args.purpose, ledger['families'])
            persist_exposures(bundle, directory, ledger)
            for name, value in bundle_files(bundle).items():
                (directory / name).write_text(canonical(value) + '\n')
    else:
        ledger = read_exposure_ledger()
        bundle = build_native_scenarios(records, registry, args.source, args.purpose, ledger['families'])
        if args.command == 'validate':
            directory = output_directory(args.output)
            for name, expected in bundle_files(bundle).items():
                if json.loads((directory / name).read_text()) != expected:
                    raise ValueError(f'Grounding / admission replay mismatch: {name}')
        elif args.output:
            directory = output_directory(args.output)
            directory.mkdir(parents=True, exist_ok=False)
            report = {k: v for k, v in bundle.items() if k != 'scenarios'}
            (directory / 'inspection.json').write_text(canonical(report) + '\n')
    print(json.dumps({'command': args.command, 'source': args.source, 'purpose': args.purpose,
                      'registry_sha256': bundle['registry_sha256'], **bundle['summary']}, indent=2))


if __name__ == '__main__':
    main()
