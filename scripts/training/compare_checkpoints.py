#!/usr/bin/env python3
"""Predeclared three-arm conversational probes; inference only, shared pilot cap."""
import hashlib,json,os
from pathlib import Path
import typer
from pilot_budget import PilotBudget
ROOT=Path(__file__).resolve().parents[2]
app=typer.Typer(add_completion=False,pretty_exceptions_enable=False)
SCENARIOS=[
 {"id":"identity","title":"Identity and application","turns":["What is your name and which version of this application are you?","What should I use you for?"]},
 {"id":"philosophy","title":"How Keating teaches","turns":["Why do you ask me to explain things instead of just giving me the answer?","I get stuck easily. What does working at the edge of my understanding mean in practice?"]},
 {"id":"misconception","title":"Diagnose a fraction misconception","turns":["I think 1/2 equals 2/2 because I doubled the numerator. Can you check my reasoning?","I see that 2/2 is a whole. But why do I need to change the denominator too?"]},
 {"id":"transfer","title":"Compare real-world alternatives","turns":["I can calculate percentages but don't understand when they help. Can you help me use them to compare two real-world options?","Shop A saves me $10 on $50. Shop B saves me $10 on $100. I think they are the same deal because both save $10."]},
 {"id":"quiz","title":"Create an OpenUI quiz","turns":["We have finished practicing rectangle area and perimeter. I can multiply length by width and add the four sides. Give me a four-question OpenUI quiz now, mixing recall, calculation and a tiling application. Let me submit before you discuss the answers."]},
 {"id":"flashcards","title":"Create OpenUI flashcards","turns":["We finished learning zero-based array indices, the i < length loop guard, off-by-one errors and empty arrays. Make four OpenUI flashcards for me to review later. Use concrete prompts that require me to recall the idea before revealing the answer."]},
 {"id":"simulation","title":"Predict, explore, justify","turns":["I learned area = length times width. Build an OpenUI simulation where I can change a rectangle's length while width stays at 3 metres. I want to predict the area before moving the slider."]},
]
def write(path,data):
 path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n");path.chmod(0o600)
@app.command()
def main(output_dir:Path=typer.Option(...),key_file:Path=typer.Option(Path("/tmp/keating-tinker-eval-key"))):
 os.environ["TINKER_API_KEY"]=key_file.read_text().strip()
 os.environ["HF_HUB_OFFLINE"]="1"
 import tinker
 from tinker_cookbook import renderers,tokenizer_utils
 from tinker_cookbook.renderers.base import ToolCall
 prompt_path=ROOT/".keating/outputs/training/openui-context/system-prompt.txt"
 prompt=prompt_path.read_text();metadata=json.loads(Path(str(prompt_path)+".metadata.json").read_text())
 for relative,expected in metadata["sourceSha256"].items():
  if hashlib.sha256((ROOT/relative).read_bytes()).hexdigest()!=expected:raise ValueError("Stale prompt export: "+relative)
 declarations=json.loads((prompt_path.parent/"tool-schemas.json").read_text())
 records={name:json.loads((ROOT/f".keating/outputs/training/{folder}/result.json").read_text()) for name,folder in [("sft","identity-sft-run-v2"),("sdpo","identity-sdpo-run")]}
 output_dir.mkdir(parents=True,exist_ok=False,mode=0o700)
 report={"scenarios":SCENARIOS,"arms":["base","sft","sdpo"],"system_prompt_sha256":hashlib.sha256(prompt.encode()).hexdigest(),"temperature":0,"seed":42,"max_tokens":2048,"effort":0.1,"limitations":["Predeclared qualitative probes, not a blinded or powered learning-outcome evaluation.","All arms receive the same current Keating prompt. Its OpenUI quiz/flashcard guidance was revised after these checkpoints were trained.","No new weight updates; the new OpenUI conversation corpus has not been trained.","Native tool requests are recorded and end a trace; these evaluation traces do not execute tools.","Learner follow-ups are scripted and identical between arms, not human outcomes."],"traces":[]}
 write(output_dir/"comparison.json",report)
 budget=PilotBudget(ROOT/".keating/outputs/training/inkling-pilot/budget.json")
 renderer=renderers.get_renderer("tml_v0",tokenizer_utils.get_tokenizer(PilotBudget.MODEL),model_name=PilotBudget.MODEL)
 service=tinker.ServiceClient()
 clients={"base":service.create_sampling_client(base_model=PilotBudget.MODEL),**{name:service.create_sampling_client(model_path=r["sampler_path"]) for name,r in records.items()}}
 for scenario in SCENARIOS:
  for arm,client in clients.items():
   messages=[];trace={"scenario":scenario["id"],"arm":arm,"messages":messages}
   report["traces"].append(trace)
   for i,learner in enumerate(scenario["turns"]):
    messages.append({"role":"user","content":learner})
    native=[{"role":"system","content":prompt},{"role":"tool_declare","content":json.dumps(declarations,separators=(",",":"))},*messages]
    inputs=renderer.build_generation_prompt(native,effort=.1)
    try:
     with budget.reserve(f"three-arm-{scenario['id']}-{arm}-{i}",prefill=inputs.length,sample=2048):
      result=client.sample(inputs,num_samples=1,sampling_params=tinker.SamplingParams(max_tokens=2048,temperature=0,top_p=1,seed=42,stop=renderer.get_stop_sequences())).result()
     sequence=result.sequences[0]
     answer,finished=renderer.parse_response(sequence.tokens)
     calls=[c.model_dump(mode="json") if hasattr(c,"model_dump") else c for c in answer.get("tool_calls",[])]
     messages.append({"role":"assistant","content":renderers.get_text_content(answer),**({"tool_calls":calls} if calls else {})})
     trace.setdefault("usage",[]).append({"input_tokens":inputs.length,"output_tokens":len(sequence.tokens),"parse_finished":finished,"at_token_limit":len(sequence.tokens)>=2048})
     if calls:trace["stopped_for_tool_execution"]=True
     write(output_dir/"comparison.json",report)
     print(json.dumps({"scenario":scenario["id"],"arm":arm,"turn":i+1,"output_tokens":len(sequence.tokens),"tool_calls":len(calls)}),flush=True)
     if calls:break
    except Exception as exc:
     trace["error_type"]=type(exc).__name__;write(output_dir/"comparison.json",report);raise
 print(json.dumps({"output_dir":str(output_dir),"traces":len(report["traces"]),"reserved_usd":json.loads(budget.path.read_text())["reserved_usd"]}))
if __name__=="__main__":app()
