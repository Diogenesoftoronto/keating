"""Reuse authored histories as contexts; prepare SDPO hints and contract preferences."""
import copy
import hashlib
import json
import subprocess
from pathlib import Path
import typer
from run_tinker import write_json, verified_prompt_revision

ROOT=Path(__file__).resolve().parents[2]
CATALOG=ROOT/'scripts/training/data/openui-conversations.json'
app=typer.Typer(add_completion=False,pretty_exceptions_enable=False)
RUBRIC=('Help the learner make progress at the edge of their understanding. Give useful explanation when stuck; '
        'ask a focused question or task when it helps them think, then wait. Invite alternatives, justified reasoning '
        'and real-world transfer when appropriate. Do not turn every request into a question, withhold needed help, '
        'answer your own diagnostic, or substitute a preference survey for teaching. Wording is flexible. '
        'Use OpenUI for quizzes and flashcards; tool names, schemas and submitted IDs remain exact.')

def cases_from_catalog(catalog):
    result={'train':[],'validation':[]}
    for c in catalog['conversations']:
        if c['variant']!='guided':continue
        for i,m in enumerate(c['messages']):
            if m['role']!='assistant':continue
            content=m['content']; calls=m.get('tool_calls',[]);expected={};kind=None
            if i==1:kind='begin';hint='Begin teaching with a small concrete idea and one meaningful thinking task. A menu of learning preferences alone is insufficient.'
            elif i==9:kind='repair';hint='Use the preceding learner answer and recorded diagnostic result. Explain the misconception briefly, then offer a manageable next step. Do not repeat a failed explanation verbatim.'
            elif 'activity = Flashcards(' in content:kind='cards';expected={'component':'deck'};hint='Create resumable recall-first OpenUI Flashcards based on the conversation. Do not use a native deck tool.'
            elif 'activity = Quiz(' in content:kind='quiz';expected={'component':'quiz'};hint='Create the requested resumable mixed OpenUI Quiz, then wait for a real submission. Do not reveal its answers in the surrounding prose.'
            elif calls:
                call=calls[0];name=call['function']['name'];args=json.loads(call['function']['arguments'])
                if name not in ['grade_quiz','grade_question_checks','remember_learner_profile','feedback']:continue
                kind=name;expected={'tool':name};hint='Act only on the actual request and submitted evidence in this history. Preserve IDs and distinguish supported practice from independent mastery.'
                if name=='grade_quiz':expected.update(identifiers={'result_id':args['result_id']},question_ids=[g['question_id'] for g in args['grades']])
                if name=='grade_question_checks':expected.update(identifiers={'topic':args['topic']},questions=[r['question'] for r in args['results']])
            if kind:
                result[c['split']].append({'id':f'{c["id"]}-{i}','family':c['family'],'kind':kind,'history':c['messages'][:i],
                    'expected':expected,'hint':hint,'hint_source':'authored behavior guidance from user goals, not a measured rating of a fresh response',
                    'reference':m,'source':{'conversation':c['id'],'assistant_index':i}})
    # Teaching and tooling both occur before any larger optional curriculum.
    priorities=[('fractions','begin'),('discounts','repair'),('loops','cards'),('unit-price','grade_quiz')]
    selected=[]
    for family,kind in priorities:selected.append(next(r for r in result['train'] if r['family']==family and r['kind']==kind))
    result['train']=selected+[r for r in result['train'] if r not in selected]
    # Reused development families, explicitly not a sealed test set.
    result['validation']=[next(r for r in result['validation'] if r['family']==f and r['kind']==k)
        for f,k in [('area','begin'),('mean','repair'),('area','cards'),('mean','grade_quiz')]]
    result['validation'].append({'id':'direct-units-help','family':'direct-units-help','kind':'direct-help',
        'history':[{'role':'user','content':'I am stuck converting 2.5 hours to minutes. Please show one short worked example first; no quiz or questions yet.'}],
        'expected':{},'hint':'Respect the explicit request for a worked example without a question.',
        'hint_source':'authored evaluation specification; never included in training',
        'source':{'authorship':'new regression probe for excessive Socratic withholding'}})
    return result

def corrupt(reference):
    rejected=copy.deepcopy(reference)
    if rejected.get('tool_calls'):
        rejected['tool_calls'][0]['function']['arguments']='{}'
    elif 'root = LearningSurface(' in rejected['content']:
        rejected['content']=rejected['content'].replace('root = LearningSurface(', 'root = MissingComponent(',1)
    else:return None
    return rejected

@app.command()
def main(output_dir:Path=typer.Option(...),prompt_path:Path=typer.Option(...)):
    tools_path=prompt_path.parent/'tool-schemas.json';tools=json.loads(tools_path.read_text())
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    verified_prompt_revision(prompt_path,sha(prompt_path),sha(tools_path))
    catalog=json.loads(CATALOG.read_text());cases=cases_from_catalog(catalog)
    if {r['family'] for r in cases['train']}&{r['family'] for r in cases['validation']}:raise ValueError('Family overlap')
    output_dir.mkdir(parents=True,exist_ok=False,mode=0o700)
    candidates=[];checks=[]
    for row in cases['train']:
        rejected=corrupt(row['reference'])
        if rejected is None:continue
        candidates.append((row,rejected))
        checks.extend({'response':response,'tools':tools,'expected':row['expected']} for response in [row['reference'],rejected])
    write_json(output_dir/'contract-input.json',checks)
    subprocess.run(['rtk','proxy','bun',str(ROOT/'scripts/training/check_restart.ts'),str(output_dir/'contract-input.json'),str(output_dir/'contract-results.json')],check=True)
    judgments=json.loads((output_dir/'contract-results.json').read_text());pairs=[];binary=[]
    for i,(row,rejected) in enumerate(candidates):
        good,bad=judgments[2*i:2*i+2]
        if not good['contract_passed'] or bad['contract_passed']:raise ValueError(f'Unverified preference {row["id"]}: {good} {bad}')
        shared={k:row[k] for k in ['id','family','history','source','expected']}
        shared.update(label_source='deterministic contract validation of authored positive and artificial corruption',label_scope='contract correctness only; teaching quality unscored',system_prompt_sha256=sha(prompt_path),tools_sha256=sha(tools_path))
        pairs.append({**shared,'chosen':row['reference'],'rejected':rejected,'rejection_evidence':bad})
        binary.extend({**shared,'response':response,'desirable':label} for response,label in [(row['reference'],True),(rejected,False)])
    # Do not provide exact authored response targets to the SDPO runner.
    for split in cases:
        for row in cases[split]:row.pop('reference',None)
    write_json(output_dir/'cases.json',{'rubric':RUBRIC,**cases})
    write_json(output_dir/'dpo.json',pairs);write_json(output_dir/'kto.json',binary)
    manifest={'schema_version':1,'catalog_sha256':sha(CATALOG),'system_prompt_sha256':sha(prompt_path),'tools_sha256':sha(tools_path),
        'files':{n:sha(output_dir/n) for n in ['cases.json','dpo.json','kto.json']},'sdpo_train_cases':len(cases['train']),
        'validation_cases':len(cases['validation']),'dpo_pairs':len(pairs),'kto_examples':len(binary),'provider_calls':0,
        'limitations':['Validation families were used in earlier development; not sealed holdout.','Histories are authored snapshots, not fresh multi-turn autonomous rollouts.',
        'DPO/KTO negatives are synthetic corruptions; no claim of realistic preference diversity or pedagogical improvement.','No old SFT weights or optimizer state are reused.']}
    write_json(output_dir/'manifest.json',manifest);print(json.dumps(manifest))
if __name__=='__main__':app()
