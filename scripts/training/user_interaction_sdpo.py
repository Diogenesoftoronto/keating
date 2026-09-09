"""Logged-response hindsight SDPO surrogate; never fabricates behavior logprobs."""
import math
from pathlib import Path
import json
from evaluate_interactions import native_prefix
from prepare_user_interactions import digest,validate_history

METHOD='logged-user-interaction-sdpo-surrogate'

def load_dataset(directory):
    manifest=json.loads((directory/'manifest.json').read_text())
    if manifest['method']!=METHOD or manifest['synthetic_hints']!=0:raise ValueError('Use the observed-interaction dataset')
    for name,expected in manifest['files'].items():
        if Path(name).name!=name or digest((directory/name).read_bytes())!=expected:raise ValueError('Dataset hash mismatch')
    splits={s:json.loads((directory/f'{s}.json').read_text()) for s in ['train','validation']}
    if not all(splits.values()):raise ValueError('Both splits required')
    if {r['family'] for r in splits['train']}&{r['family'] for r in splits['validation']}:raise ValueError('Family leakage')
    ids=set();context_families={}
    for split,rows in splits.items():
        for row in rows:
            if row['split']!=split or row['response']['role']!='assistant' or row['next_user']['role']!='user':raise ValueError('Malformed interaction')
            if not row['response']['content'] or not row['next_user']['content'] or row['response'].get('tool_calls'):raise ValueError('Text response and observed reply required')
            source=row['source']
            if source['next_user_index']!=source['assistant_index']+1 or source['history_start_index']>=source['assistant_index']:raise ValueError('Noncausal source indices')
            if source['next_user_timestamp']<source['assistant_timestamp']:raise ValueError('Noncausal source timestamps')
            if source['behavior_logprobs_available'] is not False:raise ValueError('This route is explicitly for unavailable behavior probabilities')
            validate_history(row['history'])
            if row['id']!=digest([row['history'],row['response'],row['next_user']]) or row['id'] in ids:raise ValueError('Duplicate or changed interaction')
            ids.add(row['id']);key=digest([row['history'],row['response']])
            if key in context_families and context_families[key]!=row['family']:raise ValueError('Copied context crosses families')
            context_families[key]=row['family']
    return splits,manifest

def hindsight_context(row):
    # Fixed framing only: no authored critique, reference answer, judge label or summary.
    return ('The following is a future user message from this same recorded conversation. '
            'Use the information it reveals to guide your response to the original user prompt. '
            'It is hindsight context, not a new task to answer.\n'+row['next_user']['content'])

def encode_interaction(renderer,row,prompt,tools):
    from tinker_cookbook import renderers
    student_native=native_prefix(row['history'],prompt,tools)
    teacher_native=[*student_native[:2],{'role':'user','content':hindsight_context(row)},*student_native[2:]]
    student=renderer.build_generation_prompt(student_native,effort=.1)
    teacher=renderer.build_generation_prompt(teacher_native,effort=.1)
    full,weights=renderer.build_supervised_example([*student_native,row['response']],train_on_what=renderers.TrainOnWhat.LAST_ASSISTANT_MESSAGE,effort=.1)
    teacher_full,_=renderer.build_supervised_example([*teacher_native,row['response']],train_on_what=renderers.TrainOnWhat.LAST_ASSISTANT_MESSAGE,effort=.1)
    st=student.to_ints();tt=teacher.to_ints();all_tokens=full.to_ints();completion=all_tokens[len(st):]
    if not completion or all_tokens[:len(st)]!=st or teacher_full.to_ints()!=tt+completion:raise ValueError('Native teacher/student completion alignment failed')
    w=weights.tolist()
    if any(w[:len(st)]) or any(v!=1 for v in w[len(st):]):raise ValueError('Only the observed assistant completion may receive gradient')
    return {'student_tokens':st,'teacher_tokens':tt,'completion_tokens':completion,'history_messages':len(row['history'])}

def logged_token_loss(logprobs,advantages,prompt_length):
    """Detached signed token weights on logged y; not on-policy PPO or exact full KL."""
    import torch
    if prompt_length<1 or not advantages or any(not math.isfinite(a) for a in advantages):raise ValueError('Invalid advantages')
    if logprobs.ndim!=1 or len(logprobs)!=prompt_length+len(advantages)-1:raise ValueError('Causal target alignment mismatch')
    selected=logprobs[prompt_length-1:]
    if not torch.isfinite(selected).all():raise ValueError('Nonfinite provider log probabilities')
    fixed=torch.tensor(advantages,dtype=selected.dtype,device=selected.device).detach()
    return -(selected*fixed).mean()

def select_diverse(rows,count):
    selected=[];families=set()
    for row in rows:
        if row['family'] not in families:
            selected.append(row);families.add(row['family'])
            if len(selected)==count:return selected
    for row in rows:
        if row not in selected:selected.append(row)
        if len(selected)==count:return selected
    raise ValueError('Insufficient eligible interactions')
