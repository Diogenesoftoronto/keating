"""Extract observed (history, assistant response, next user message) triples privately."""
from collections import Counter,defaultdict
import hashlib
import json
from pathlib import Path
import zipfile
import typer
from prepare_seed import SECRET,millis,visible
from run_tinker import write_json

ROOT=Path(__file__).resolve().parents[2]
app=typer.Typer(add_completion=False,pretty_exceptions_enable=False)
def digest(value):
    if not isinstance(value,bytes):value=json.dumps(value,sort_keys=True,ensure_ascii=False).encode()
    return hashlib.sha256(value).hexdigest()
def sid_hash(sid):return hashlib.sha256(sid.encode()).hexdigest()

def normalize(message):
    role=message.get('role');content=message.get('content')
    blocks=content if isinstance(content,list) else []
    if any(b.get('type') not in ['text','thinking','toolCall'] for b in blocks):raise ValueError('unsupported_nontext')
    text=visible(content)
    if role in ['user','assistant']:
        m={'role':role,'content':text}
        calls=[b for b in blocks if b.get('type')=='toolCall']
        if calls:
            if role!='assistant':raise ValueError('invalid_tool_call_role')
            m['tool_calls']=[{'id':b['id'],'type':'function','function':{'name':b['name'],'arguments':json.dumps(b['arguments'],ensure_ascii=False)}} for b in calls]
        if not text and not calls:raise ValueError('empty_visible_context')
        return m
    if role=='toolResult':
        if not text:raise ValueError('empty_tool_result')
        return {'role':'tool','content':text,'tool_call_id':message['toolCallId'],'name':message['toolName']}
    raise ValueError('unsupported_role')

def validate_history(history):
    pending={};used=set()
    if not history or history[0]['role']!='user':raise ValueError('history_missing_user_start')
    for m in history:
        if m['role']=='tool':
            if pending.pop(m['tool_call_id'],None)!=m['name']:raise ValueError('orphan_tool_result')
        else:
            if pending:raise ValueError('missing_tool_result')
            for c in m.get('tool_calls',[]):
                if c['id'] in used:raise ValueError('duplicate_tool_id')
                used.add(c['id']);pending[c['id']]=c['function']['name']
    if pending:raise ValueError('missing_tool_result')

def extract(portable,ledger,prior_seed,context_messages=5):
    if not 1<=context_messages<=50:raise ValueError('Invalid context window')
    sessions={e['data']['id']:e['data'] for e in portable['sessions']}
    if len(sessions)!=len(portable['sessions']):raise ValueError('Duplicate source session')
    families={}
    for family in ledger['families']:
        ids=sorted(s for s in sessions if sid_hash(s) in family['sessionHashes'])
        expected=sid_hash('keating-case-study-subject-family-v1\0'+'\0'.join(ids))
        if expected!=family['familyHash']:raise ValueError('Family identity mismatch')
        for s in family['sessionHashes']:
            if s in families:raise ValueError('Duplicate family membership')
            families[s]=family
    if set(families)!={sid_hash(s) for s in sessions}:raise ValueError('Incomplete family coverage')
    for session in sessions.values():
        parent=session.get('parentSessionId')
        if parent and (parent not in sessions or families[sid_hash(parent)]['familyHash']!=families[sid_hash(session['id'])]['familyHash']):raise ValueError('Parent lineage crosses families')
    for join in ledger.get('lineage',{}).get('exactHistoryJoins',[]):
        if families[join['sessionHash']]['familyHash']!=families[join['matchedSessionHash']]['familyHash']:raise ValueError('Copied history crosses families')
    excluded=Counter();rows=[]
    for session in sessions.values():
        family=families[sid_hash(session['id'])];messages=session['messages']
        for i,target in enumerate(messages[:-1]):
            if target['role']!='assistant' or messages[i+1]['role']!='user':continue
            if not family['included']:excluded['excluded_case_study_family']+=1;continue
            if target.get('stopReason')!='stop':excluded['target_not_confirmed_complete']+=1;continue
            # A direct user successor is essential: never attach an old reply to a new rollout.
            try:
                response=normalize(target);followup=normalize(messages[i+1])
                if response.get('tool_calls'):raise ValueError('target_contains_tool_call')
                if followup.get('tool_calls'):raise ValueError('invalid_user_followup')
                start=max(0,i-context_messages)
                # Expand to a real user boundary so no tool execution loses its initiating call.
                while start>0 and messages[start]['role']!='user':start-=1
                history=[normalize(m) for m in messages[start:i]]
                validate_history(history)
                target_time=millis(target.get('timestamp'));next_time=millis(messages[i+1].get('timestamp'))
                if target_time is None or next_time is None or next_time<target_time:raise ValueError('noncausal_or_missing_timestamp')
                if SECRET.search(json.dumps([history,response,followup],ensure_ascii=False)):raise ValueError('possible_secret')
            except (ValueError,KeyError) as error:
                excluded[str(error)]+=1;continue
            row={'id':digest([history,response,followup]),'family':family['familyHash'],'subject':family['subjectId'],
                'history':history,'response':response,'next_user':followup,'hint_source':'observed next user-role message in original session',
                'followup_kind':'structured_submission' if '<keating-' in followup['content'] else 'text',
                'source':{'session_hash':sid_hash(session['id']),'history_start_index':start,'assistant_index':i,'next_user_index':i+1,
                    'assistant_timestamp':target_time,'next_user_timestamp':next_time,'recorded_model':target.get('model'),
                    'recorded_provider':target.get('provider'),'historical_checkpoint_verified':False,'behavior_logprobs_available':False,
                    'hidden_reasoning_omitted':True,'user_role_does_not_prove_manually_typed':True}}
            rows.append(row)
    # Reject duplicates spanning audited families, even if their next-user replies differ.
    memberships=defaultdict(set)
    for r in rows:memberships[digest([r['history'],r['response']])].add(r['family'])
    clean=[];seen=set()
    for row in rows:
        if len(memberships[digest([row['history'],row['response']])])>1:excluded['cross_family_duplicate_context_response']+=1;continue
        if row['id'] in seen:excluded['copied_interaction']+=1;continue
        seen.add(row['id']);clean.append(row)
    old_validation=set(prior_seed['validation_families'])
    old_train=set(prior_seed.get('train_families',[]))
    if old_validation&old_train:raise ValueError('Historical split conflict')
    available={r['family'] for r in clean}
    extra=sorted(available-old_validation-old_train,key=lambda f:digest(['user-interactions-split-v1',f]))
    validation=(available&old_validation)|set(extra[:max(0,len(available)//5-len(available&old_validation))])
    for row in clean:row['split']='validation' if row['family'] in validation else 'train'
    if not validation or not available-validation:raise ValueError('Need both train and validation families')
    return clean,dict(excluded)

def preference_audit(archive):
    with zipfile.ZipFile(archive) as z:
        read=lambda name:[json.loads(l) for l in z.read(name).splitlines() if l.strip()]
        kto=read('data/preferences/train.kto.jsonl');dpo=read('data/preferences/train.dpo.chat.jsonl');rewards=read('data/rewards/train.rewarded.jsonl')
        lookup=defaultdict(list)
        for r in rewards:
            ms=r.get('messages',[])
            if ms and ms[-1]['role']=='assistant':lookup[digest([ms[:-1],ms[-1]['content']])].append(r)
        sources=Counter();matched=[]
        for i,r in enumerate(kto):
            matches=lookup[digest([r['prompt'],r['completion']])]
            labels=sorted({s for m in matches for s in m.get('signals',{})})
            source='+'.join(labels) or 'unresolved';sources[source]+=1
            matched.append({'row_index':i,'label':r['label'],'source_types':labels,'matched_reward_rows':len(matches)})
        return {'archive_kto_records':len(kto),'archive_dpo_pairs':len(dpo),'kto_source_types':dict(sources),'kto_label_balance':dict(Counter(str(r['label']) for r in kto)),
                'kto_provenance':matched,'used_for_sdpo':False,'training_ready':False,
                'limitations':['Preference files omit source IDs and their original family split. Rejoin and validate before training.',
                    'Inferred next-turn sentiment is not equivalent to an explicit human preference.','This audit does not manufacture new labels or treat unscored responses as positive.']}

@app.command()
def main(portable:Path=typer.Option(Path('/home/diogenes/Downloads/keating-portable-data(6).json')),
         archive:Path=typer.Option(Path('/home/diogenes/Downloads/keating-training-2026-09-06T20-43-04-888Z.zip')),
         output_dir:Path=typer.Option(...),context_messages:int=typer.Option(5)):
    audit_path=ROOT/'docs/case-study/aggregates.json';ledger_path=ROOT/'docs/case-study/subject-data.json'
    audit=json.loads(audit_path.read_text());ledger=json.loads(ledger_path.read_text())
    for role,path in [('portable',portable),('training',archive)]:
        if digest(path.read_bytes())!=next(r['sha256'] for r in audit['inputs'] if r['role']==role):raise ValueError('Source differs from the audited case study')
    if digest(portable.read_bytes())!=ledger['metadata']['portableSha256']:raise ValueError('Family ledger source mismatch')
    seed_dir=ROOT/'.keating/outputs/training/case-study-seed'
    prior=json.loads((seed_dir/'manifest.json').read_text())
    if prior['input_sha256']['portable']!=digest(portable.read_bytes()) or prior['input_sha256']['family_ledger']!=digest(ledger_path.read_bytes()):raise ValueError('Historical split belongs to a different snapshot')
    seed_train_body=(seed_dir/'train.jsonl').read_bytes()
    if digest(seed_train_body)!=prior['output_sha256']['train.jsonl']:raise ValueError('Original training split changed')
    prior['train_families']=sorted({json.loads(l)['family_id'] for l in seed_train_body.splitlines()})
    rows,excluded=extract(json.loads(portable.read_text()),ledger,prior,context_messages)
    output_dir.mkdir(parents=True,exist_ok=False,mode=0o700)
    for split in ['train','validation']:write_json(output_dir/f'{split}.json',[r for r in rows if r['split']==split])
    preferences=preference_audit(archive);write_json(output_dir/'preference-audit.json',preferences)
    manifest={'schema_version':1,'method':'logged-user-interaction-sdpo-surrogate','source_portable_sha256':digest(portable.read_bytes()),
        'source_archive_sha256':digest(archive.read_bytes()),'family_ledger_sha256':digest(ledger_path.read_bytes()),'prior_seed_manifest_sha256':digest((seed_dir/'manifest.json').read_bytes()),
        'counts':dict(Counter(r['split'] for r in rows)),'families':{s:sorted({r['family'] for r in rows if r['split']==s}) for s in ['train','validation']},
        'followup_kinds':dict(Counter(r['followup_kind'] for r in rows)),'excluded':excluded,'context_messages_minimum':context_messages,
        'maximum_context_messages':max(len(r['history']) for r in rows),'files':{n:digest((output_dir/n).read_bytes()) for n in ['train.json','validation.json','preference-audit.json']},
        'provider_calls':0,'synthetic_hints':0,'limitations':['Private single-learner observations; no causal learning-outcome labels.',
            'Original assistant outputs are logged data from other models, not fresh Inkling rollouts; behavior logprobs unavailable.',
            'Current application prompt is a declared adaptation; historical prompt/tool definitions are not recoverable from this snapshot.',
            'Context is an explicit recent-message window expanded to a user boundary; tool calls/results retained together.',
            'Hidden reasoning is excluded. Unsupported multimodal contexts, incomplete answers and suspected secrets are excluded.',
            'Development validation preserves prior held-out families but is not sealed against earlier human inspection.',
            'A user-role message can be a real form submission or app-inserted context; no blanket claim that every message was manually typed.']}
    write_json(output_dir/'manifest.json',manifest)
    print(json.dumps({k:manifest[k] for k in ['counts','followup_kinds','excluded','maximum_context_messages','provider_calls','synthetic_hints']}))
    print(json.dumps({k:preferences[k] for k in ['archive_kto_records','archive_dpo_pairs','kto_source_types','training_ready']}))
if __name__=='__main__':app()
