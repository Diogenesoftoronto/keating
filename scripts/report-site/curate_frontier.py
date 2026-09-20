"""Publish an explicit projection of authored pilot outputs and one attributed activity."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/training'))
import benchmark_v4 as v4
from benchmark_diagnostics import diagnose
from observer_core import digest


def curate():
    private = ROOT / '.keating/native-learning'
    source = ROOT / 'docs/research-story'
    # Published pilot evidence belongs to the original prompts and rubric.
    suite = v4.load_suite(v4.HISTORICAL_SUITE)
    case = next(c for c in suite['cases'] if c['id'] == 'help-hint-then-flip')
    result = v4.read_json(private / 'v4-checkpoint-pilot-v1/F+S/help-hint-then-flip/result.json')
    review = v4.read_json(private / 'v4-review-v1/review.json')
    diagnostics = diagnose(case, result, review=review, benchmark_version=suite['manifest']['version'])
    # This is an authored benchmark. Only learner prompts, visible assistant text,
    # independent ratings, and hashes cross into the public report.
    episodes = {'case_id': case['id'], 'family': case['family'], 'arm': 'F+S',
                'result_sha256': digest(result), 'diagnostics_hash': diagnostics['diagnostics_hash'],
                'review': diagnostics['independent_rubric'], 'responses': []}
    for r in diagnostics['responses']:
        episodes['responses'].append({k: r[k] for k in ('step_index', 'message_index', 'text',
            'text_sha256', 'response_hash', 'probe_status', 'probe_signals')})
        episodes['responses'][-1]['learner_text'] = case['steps'][r['step_index']]['text']
    assert len(episodes['responses']) == 6
    assert sum(r['score'] for r in review['ratings']) == 4
    scenario = v4.read_json(private / 'scenarios/openui-source-v1/adapted/tutormoments-46d551920c69b5df894d2baf.json')
    proof = v4.read_json(private / 'curated-source-offline-8Soqqv/verification.json')
    assert proof['real_choice_receipt_completed'] and proof['source_unchanged'] and proof['paid_model_calls'] == 0
    activity = {'document': scenario['initial_document'], 'source': scenario['source'],
                'source_url': 'https://huggingface.co/datasets/allenai/tutormoments-preview',
                'attribution': 'TutorMoments, Ai2 and collaborators',
                'ready_moments': 8, 'deferred_moments': 4,
                'runtime_proof': proof, 'scenario_hash': digest(scenario)}
    probe = v4.read_json(private / 'probe-span-inspection-v1/example.json')
    # Local paths are operational metadata. Keep their content hashes only.
    probe['pins']['source_files'] = {k: {'sha256': v['sha256']} for k, v in probe['pins']['source_files'].items()}
    for name, data in [('frontier-example.json', {'episode': episodes, 'activity': activity}),
                       ('benchmark-diagnostics.json', diagnostics), ('probe-spans.json', probe)]:
        body = json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + '\n'
        assert not any(s in body for s in ('/home/diogenes/', 'tinker://', 'Bearer ', 'api_key'))
        (source / name).write_text(body)
    print(json.dumps({'visible_responses': 6, 'review_score': '4/8', 'probe_tokens': probe['selected_tokens'],
                      'probe_probability': probe['pooled_probability'], 'private_paths_published': False}))


if __name__ == '__main__':
    curate()
