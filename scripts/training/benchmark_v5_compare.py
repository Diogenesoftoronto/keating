#!/usr/bin/env python3
"""Side-by-side comparison of tutors on the same v5 instances.

Usage: benchmark_v5_compare.py OUT.json NAME=RUN_DIR [NAME=RUN_DIR ...]
Each RUN_DIR must already have report.json (benchmark_v5.py report). Writes per-tutor summaries, a per-step
speak/pass map for group instances (how often each tutor spoke at each step across repeats), and per-instance
scores, so differences in behaviour, not only in score, are visible.
"""
import json
import sys
from pathlib import Path


def load(run):
    rep = json.loads(Path(run, 'report.json').read_text())
    eps = {}
    for p in sorted(Path(run, 'episodes').glob('r*/*/episode.json')):
        eps.setdefault(p.parent.name, []).append(json.loads(p.read_text()))
    return rep, eps


def main():
    out = Path(sys.argv[1])
    tutors = dict(a.split('=', 1) for a in sys.argv[2:])
    result = {'schema': 'keating-teaching-v5-comparison/v1', 'tutors': {}, 'instances': {}}
    for name, run in tutors.items():
        rep, eps = load(run)
        o = rep['overall']
        spoken = sum(s.get('tutor_action') == 'speak' for es in eps.values() for e in es for s in e['steps'])
        steps = sum(len(e['steps']) for es in eps.values() for e in es)
        result['tutors'][name] = {k: o.get(k) for k in ('episodes', 'completed', 'scored', 'family_macro_score', 'family_macro_ci95',
                                                         'pass_rate', 'pass_all_repeats', 'turn_taking', 'action_claim_violations',
                                                         'output_tokens', 'reasoning_tokens')}
        result['tutors'][name]['share_of_messages_answered'] = round(spoken / steps, 4) if steps else None
        result['tutors'][name]['by_split'] = {s: (v and {k: v[k] for k in ('family_macro_score', 'pass_rate')}) for s, v in rep['by_split'].items()}
        for iid, es in eps.items():
            row = result['instances'].setdefault(iid, {})
            n = len(es)
            row[name] = {
                'scores': [x['score'] for x in rep['episodes'] if x['instance_id'] == iid],
                'speak_rate_by_step': [round(sum(e['steps'][i].get('tutor_action') == 'speak' for e in es if i < len(e['steps'])) / n, 2)
                                       for i in range(max(len(e['steps']) for e in es))],
                'mean_words_per_post': round(sum(len(s['visible_text'].split()) for e in es for s in e['steps'] if s.get('tutor_action') == 'speak')
                                             / max(1, sum(s.get('tutor_action') == 'speak' for e in es for s in e['steps'])), 1),
            }
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1) + '\n')
    for name, t in result['tutors'].items():
        tt = t['turn_taking'] or {}
        print(f"{name:12s} score {t['family_macro_score']} CI {t['family_macro_ci95']} pass {t['pass_rate']} "
              f"turn-taking {tt.get('accuracy')} (missed {tt.get('missed_speak')}, intruded {tt.get('spoke_when_should_pass')}) "
              f"answered {t['share_of_messages_answered']} claims {t['action_claim_violations']}")


if __name__ == '__main__':
    main()
