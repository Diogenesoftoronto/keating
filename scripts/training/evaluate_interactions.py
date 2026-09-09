#!/usr/bin/env python3
"""Sample predeclared interactions, execute local contracts, preserve failures."""
import hashlib,json,os,subprocess
from pathlib import Path
import typer
from pilot_budget import PilotBudget
from run_tinker import write_json,verified_prompt_revision
ROOT=Path(__file__).resolve().parents[2]
app=typer.Typer(add_completion=False,pretty_exceptions_enable=False)

def native_prefix(messages,prompt,declarations):
    from tinker_cookbook.renderers.base import ToolCall
    native=[{'role':'system','content':prompt},{'role':'tool_declare','content':json.dumps(declarations,separators=(',',':'))}]
    for message in messages:
        m=dict(message)
        if m.get('tool_calls'):m['tool_calls']=[ToolCall.model_validate(c) for c in m['tool_calls']]
        native.append(m)
    return native

class Harness:
    def __init__(self,prompt_path,budget_file):
        import tinker
        from tinker_cookbook import renderers,tokenizer_utils
        self.tinker=tinker;self.renderers=renderers
        self.prompt=prompt_path.read_text();body=(prompt_path.parent/'tool-schemas.json').read_bytes();self.tools=json.loads(body)
        verified_prompt_revision(prompt_path,hashlib.sha256(self.prompt.encode()).hexdigest(),hashlib.sha256(body).hexdigest())
        self.renderer=renderers.get_renderer('tml_v0',tokenizer_utils.get_tokenizer(PilotBudget.MODEL),model_name=PilotBudget.MODEL)
        self.service=tinker.ServiceClient();self.budget=PilotBudget(budget_file,100)
    def sample(self,client,messages,label,max_tokens=2048,temperature=0,seed=42):
        prompt=self.renderer.build_generation_prompt(native_prefix(messages,self.prompt,self.tools),effort=.1)
        if prompt.length+max_tokens>32768:raise ValueError('Interaction exceeds bounded context; do not truncate')
        with self.budget.reserve(label,prefill=prompt.length,sample=max_tokens):
            sequence=client.sample(prompt,num_samples=1,sampling_params=self.tinker.SamplingParams(max_tokens=max_tokens,temperature=temperature,top_p=1,seed=seed,stop=self.renderer.get_stop_sequences())).result().sequences[0]
        parsed,status=self.renderer.parse_response(sequence.tokens)
        calls=[]
        for i,call in enumerate(parsed.get('tool_calls',[])):
            value=call.model_dump(mode='json') if hasattr(call,'model_dump') else call
            value['id']=f'{label}-call-{i}';calls.append(value)
        message={'role':'assistant','content':self.renderers.get_text_content(parsed),**({'tool_calls':calls} if calls else {})}
        return {'message':message,'parse_status':status,'prompt_tokens':prompt.to_ints(),'completion_tokens':sequence.tokens,'rollout_logprobs':sequence.logprobs,'at_token_limit':len(sequence.tokens)>=max_tokens}
    def check(self,scenario,response,directory,expected_grading=None):
        request=directory/'check-input.json';output=directory/'check-output.json'
        write_json(request,{'scenario':scenario,'response':response,**({'expected_grading':expected_grading} if expected_grading else {})})
        subprocess.run(['rtk','proxy','bun',str(ROOT/'scripts/training/interaction_check.ts'),str(request.resolve()),str(output.resolve())],cwd=ROOT,check=True,capture_output=True,text=True)
        output.chmod(0o600)
        return json.loads(output.read_text())
    def trajectory(self,client,scenario,directory,label,temperature=0):
        directory.mkdir(parents=True,exist_ok=False,mode=0o700)
        messages=[{'role':'user','content':scenario['prompt']}]
        limit=4096 if scenario['kind']=='exam' else 256 if scenario['kind'] in ['identity','arithmetic'] else 2048
        sampled=self.sample(client,messages,label+'-create',limit,temperature)
        write_json(directory/'sample-create.json',sampled);messages.append(sampled['message'])
        check=self.check(scenario,sampled['message'],directory)
        evidence={'scenario':scenario,'messages':messages,'creation':check,'samples':[{'parse_status':sampled['parse_status'],'at_token_limit':sampled['at_token_limit']}],'training_eligible':False}
        if check.get('expected_grading') and check.get('followup'):
            messages.append(check['followup'])
            graded=self.sample(client,messages,label+'-grade',1024,temperature)
            write_json(directory/'sample-grade.json',graded);messages.append(graded['message'])
            grade_check=self.check(scenario,graded['message'],directory,check['expected_grading'])
            evidence['grading']=grade_check
            messages.extend(grade_check.get('tool_results',[]))
        elif check.get('followup'):
            messages.append(check['followup'])
        evidence['passed']=bool(check['passed'] and evidence.get('grading',{'passed':True})['passed'])
        write_json(directory/'trace.json',evidence)
        return evidence

@app.command()
def main(run_dir:Path=typer.Option(...),output_dir:Path=typer.Option(...),prompt_path:Path=typer.Option(...),cases:Path=typer.Option(Path(__file__).parent/'data/interaction-eval.json'),budget_file:Path=typer.Option(ROOT/'.keating/outputs/training/inkling-pilot/budget.json')):
    os.environ['HF_HUB_OFFLINE']='1'
    if not os.environ.get('TINKER_API_KEY'):raise ValueError('Server-held credential required')
    checkpoint=json.loads((run_dir/'result.json').read_text());ledger=json.loads(budget_file.read_text())
    if checkpoint['model']!=PilotBudget.MODEL or Path(checkpoint['budget_file']).resolve()!=budget_file.resolve() or ledger['cap_usd']!=100:raise ValueError('Checkpoint/budget mismatch')
    scenarios=json.loads(cases.read_text())['cases'];output_dir.mkdir(parents=True,exist_ok=False,mode=0o700)
    harness=Harness(prompt_path,budget_file)
    client=harness.service.create_sampling_client(model_path=checkpoint['sampler_path'])
    report={'cases_sha256':hashlib.sha256(cases.read_bytes()).hexdigest(),'system_prompt_sha256':hashlib.sha256(harness.prompt.encode()).hexdigest(),'checkpoint':checkpoint['sampler_path'],'method':checkpoint['method'],'traces':[],'limits':'Structural checks and isolated execution; answer-key correctness requires review. Synthetic learner responses are not human outcomes.'}
    write_json(output_dir/'evaluation.json',report)
    for scenario in scenarios:
        evidence=harness.trajectory(client,scenario,output_dir/scenario['id'],'interaction-eval-'+scenario['id'])
        report['traces'].append(evidence);write_json(output_dir/'evaluation.json',report)
        print(json.dumps({'case':scenario['id'],'creation':evidence['creation']['passed'],'grading':evidence.get('grading',{}).get('passed'),'passed':evidence['passed']}),flush=True)
    report['passed']=sum(t['passed'] for t in report['traces']);report['total']=len(scenarios);write_json(output_dir/'evaluation.json',report)
    print(json.dumps({'output_dir':str(output_dir),'passed':report['passed'],'total':report['total']}))
if __name__=='__main__':app()
