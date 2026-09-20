# /// script
# requires-python = ">=3.11"
# dependencies = ["matplotlib==3.10.*"]
# ///
"""Render actual v4 runtime coverage; incomplete trials never become quality zeros."""
import hashlib
import json
from pathlib import Path

import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.keating/native-learning/v4-checkpoint-pilot-v1'
plan = json.loads((WORK / 'plan.json').read_text())
result = json.loads((WORK / 'results.json').read_text())
assert result['plan_hash'] == plan['plan_hash'] and result['status'] == 'complete_with_failures'
rows = []
for scheduled, summary in zip(plan['schedule'], result['rows'], strict=True):
    case_id, arm = scheduled
    path = WORK / arm / case_id / 'result.json'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == summary['result_sha256']
    receipt = json.loads(path.read_text())
    case = next(c for c in plan['cases'] if c['id'] == case_id)
    expected = sum(s['kind'] == 'message' for s in case['steps'])
    completed = sum(s['kind'] == 'message' and s['status'] == 'completed' for s in receipt['steps'])
    rows.append({'case_id': case_id, 'arm': arm, 'completed_learner_turns': completed,
                 'planned_learner_turns': expected, 'runtime_status': receipt['status'],
                 'error_code': receipt.get('error_code'), 'result_sha256': summary['result_sha256'],
                 'quality': None, 'quality_status': 'independent_review_separate'})
public = {'benchmark_id': plan['benchmark_id'], 'manifest_sha256': plan['manifest_sha256'],
          'plan_hash': plan['plan_hash'], 'case_count': 2, 'family_count': 1, 'checkpoints': 2,
          'rows': rows, 'scope': 'One context-flip family, one run per case/checkpoint, no fixed sampler seed.',
          'no_paired_quality_estimate': True,
          'failure_diagnosis': {'F-only': 'Malformed generated completion halted the bridge; the later case made no new Tinker sample.',
                               'F+S': 'Hint-first completed; worked-first exhausted the 8-call limit in tool handling.'}}
out = ROOT / 'docs/generated/teaching-v4-pilot.json'
out.write_text(json.dumps(public, indent=2) + '\n')
plt.rcParams.update({'font.family': 'DejaVu Sans', 'svg.hashsalt': 'teaching-v4-pilot-v1',
                     'text.color': '#254e63', 'axes.labelcolor': '#536570', 'xtick.color': '#536570', 'ytick.color': '#254e63'})
fig, ax = plt.subplots(figsize=(10, 4.5), facecolor='#fcfcf9')
ax.set_facecolor('#fcfcf9')
labels = [f"{'Hint → worked' if r['case_id'].startswith('help-hint') else 'Worked → hint'} · {r['arm']}" for r in rows]
ax.barh(range(4), [6] * 4, color='#eef3f5', height=.48)
ax.barh(range(4), [r['completed_learner_turns'] for r in rows], color=['#0072B2' if r['arm']=='F-only' else '#00836B' for r in rows], height=.48)
for i, row in enumerate(rows):
    ax.text(6.13, i, f"{row['completed_learner_turns']}/6", va='center', fontsize=11)
ax.set_yticks(range(4), labels)
ax.invert_yaxis()
ax.set_xlim(0, 6.8)
ax.set_xticks(range(7))
ax.set_xlabel('Learner turns with completed tutor output', labelpad=12)
ax.set_title('V4 exposes failures before a paired quality comparison', loc='left', fontsize=14, fontweight='bold', pad=18)
ax.spines[['top', 'right', 'left']].set_visible(False)
ax.spines['bottom'].set_color('#dce4e8')
ax.tick_params(axis='y', length=0, pad=12)
fig.text(.025, .035, 'F-only = feature reward update · F+S = feature reward + hindsight update\nRuntime coverage, not teaching quality. No missing episode is assigned a zero quality score.', color='#536570', fontsize=9)
fig.tight_layout(rect=(0, .13, 1, 1))
fig.savefig(ROOT / 'docs/assets/teaching-v4-pilot.svg', facecolor=fig.get_facecolor())
fig.savefig(WORK / 'coverage.png', dpi=140, facecolor=fig.get_facecolor())
print(out)
