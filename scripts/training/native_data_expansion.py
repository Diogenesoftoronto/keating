"""Resumable, source-bound agy drafting packets and reviewed training candidates.

No model calls here. Generated labels remain model-assisted, not calibrated truth.
"""
import argparse
from collections import Counter
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import native_scenarios as native
import observer_core as observer

VERSION = "native-contextual-data/v2"
MODEL = "gemini-3.8-flash-high"

def read(path):
    return json.loads(Path(path).read_text())

def write(path, value):
    with Path(path).open("x") as f:
        f.write(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")

def require(condition, message):
    if not condition:
        raise ValueError(message)

def aliases(scenario):
    return {scenario["family"], *scenario["evaluation_only"]["origin"]["aliases"]}

def replay(bundle_path):
    bundle = read(bundle_path)
    require(bundle["purpose"] == "development", "Only admitted development data")
    expected = native.build_native_scenarios(native.load_source_records(), native.load_registry(),
        bundle["source"], "development", native.read_exposure_ledger()["families"])
    require(bundle == expected, "Source/admission replay mismatch")
    return bundle

def prepare(bundle_path, output, families=60, batch_size=10, prior_observers=()):
    require(type(families) is int and families >= 6 and type(batch_size) is int and 1 <= batch_size <= 20, "Invalid batch/family bounds")
    bundle = replay(bundle_path)
    excluded, pins = set(), {}
    for path in prior_observers:
        payload = read(path)
        pins[str(path)] = native.digest(payload)
        # Exclude all previously measured families, including training families.
        for row in payload["records"]:
            excluded.update([row["family_id"], *row.get("group_ids", [])])
    for path in [Path(__file__).parent / "benchmarks/teaching-v4/cases.json",
                 Path(__file__).parent / "benchmarks/teaching-v4/versions/4.0.0/cases.json"]:
        payload = read(path); pins[str(path)] = native.digest(payload)
        for case in payload["cases"]:
            excluded.update([case["id"], case["family"]])
    # Connected aliases are grouped BEFORE selecting scenarios or sources.
    parents = {}
    def root(a):
        parents.setdefault(a,a)
        while parents[a] != a:
            parents[a] = parents[parents[a]]; a = parents[a]
        return a
    for s in bundle["scenarios"]:
        group = sorted(aliases(s))
        for a in group:
            left,right = root(group[0]),root(a)
            parents[max(left,right)] = min(left,right)
    groups = {}
    for s in bundle["scenarios"]:
        groups.setdefault(root(s["family"]), []).append(s)
    admitted = []
    exclusions = []
    for group, rows in groups.items():
        names = set().union(*(aliases(s) for s in rows))
        if names & excluded or any(s["evaluation_only"]["admission"].get("protected") for s in rows):
            exclusions.append({"family":group,"reason":"prior-measurement-or-protected-family"}); continue
        # Shorter prefixes ease manual review. No private field enters the draft.
        chosen = min(rows, key=lambda s:(len(s["actor"]["opening_message"]),s["id"]))
        admitted.append((chosen,names))
    buckets = {}
    for s,names in admitted:
        buckets.setdefault(s["source"]["dataset"],[]).append((s,names))
    for rows in buckets.values():
        rows.sort(key=lambda pair:native.digest({"seed":42,"family":pair[0]["family"]}))
    selected = []
    while len(selected) < families and any(buckets.values()):
        for dataset in sorted(buckets):
            if buckets[dataset] and len(selected)<families:
                selected.append(buckets[dataset].pop(0))
    require(len(selected)==families,"Insufficient eligible connected families")
    # Fixed before drafting; rejected examples do not cause split reassignment.
    selected.sort(key=lambda pair:native.digest({"split_seed":73,"family":pair[0]["family"]}))
    output=native.output_directory(output); output.mkdir(parents=True,exist_ok=False)
    packets=[]; membership={}
    train_end=families*2//3; calibration_end=train_end+(families-train_end)//2
    for i,(s,names) in enumerate(selected):
        split="train" if i<train_end else "calibration" if i<calibration_end else "test"
        membership[s["id"]]={"family":s["family"],"aliases":sorted(names),"split":split,"source":s["source"]}
        packets.append({"scenario_id":s["id"],"source":s["source"],"family":s["family"],
            "opening_message":s["actor"]["opening_message"]})
    manifest={"version":VERSION,"model":MODEL,"bundle_path":str(Path(bundle_path).resolve()),
        "bundle_sha256":native.digest(bundle),"families":membership,"exclusion_pins":pins,
        "excluded_aliases":sorted(excluded),"excluded_groups":exclusions,"target_examples":families*10,
        "batch_size":batch_size,"batch_hashes":{},"partition_groups":dict(Counter(v["split"] for v in membership.values()))}
    for i in range(0,len(packets),batch_size):
        name=f"batch-{i//batch_size:03}.input.json"; payload={"version":VERSION,"sources":packets[i:i+batch_size]}
        write(output/name,payload);manifest["batch_hashes"][name]=native.digest(payload)
    manifest["manifest_hash"]=native.digest(manifest)
    write(output/"manifest.json",manifest)
    print(json.dumps({"output":str(output),"families":families,"target_examples":families*10,
        "sources":dict(Counter(p["source"]["dataset"] for p in packets)),"partitions":manifest["partition_groups"]}))

FIT={"appropriate","overhelp","underhelp","misdirected","unknown"}
NEED={"explanation","space","diagnosis","transfer","unknown"}
EXAMPLE_FIELDS={"slot","prefix","response","fit","need","substantive","correct","grade","spans","rationale"}

def validate_draft(draft, packet):
    expected={s["scenario_id"]:s for s in packet["sources"]}
    require(isinstance(draft,list) and len(draft)==len(expected) and {d["scenario_id"] for d in draft}==set(expected),"Draft must account for each source exactly once")
    for d in draft:
        require(set(d)=={"scenario_id","status","reason","topic","practice_prompt","examples"},"Unexpected draft fields")
        require(d["status"] in {"ready","deferred"} and isinstance(d["reason"],str) and d["reason"].strip(),"Draft decision needs reason")
        source=expected[d["scenario_id"]]
        prompt=d["practice_prompt"]
        require(isinstance(prompt,str) and (not prompt or prompt in source["opening_message"]),"Practice question must quote visible source text")
        if d["status"]=="deferred":
            require(d["examples"]==[] and not prompt,"Deferred source cannot produce examples");continue
        require(isinstance(d["topic"],str) and d["topic"].strip(),"Missing topic")
        rows=d["examples"]
        require(len(rows)==10 and {e["slot"] for e in rows}==set(range(1,11)),"Ten unique planned slots required")
        for e in rows:
            require(set(e)==EXAMPLE_FIELDS,"Unexpected example fields")
            require(e["fit"] in FIT and e["need"] in NEED,"Unknown teaching category")
            require(e["grade"] is None or type(e["grade"]) is int and e["grade"] in (0,1,2),"Invalid grade")
            require(all(v is None or type(v) is bool for v in [e["correct"],e["substantive"]]),"Boolean labels or explicit unknown required")
            expected_grade=None if (e["fit"]=="unknown" or e["need"]=="unknown" or e["correct"] is None or e["substantive"] is None) else 0 if e["fit"]!="appropriate" or not e["correct"] else 2 if e["substantive"] else 1
            require(e["grade"]==expected_grade,"Grade contradicts classifications")
            require(isinstance(e["prefix"],list) and e["prefix"] and e["prefix"][-1]["role"]=="user","Prefix must end with learner")
            for turn in e["prefix"]:
                require(set(turn)=={"role","content"} and turn["role"] in {"user","assistant"} and isinstance(turn["content"],str) and turn["content"].strip(),"Invalid authored turn")
            require(isinstance(e["response"],str) and e["response"].strip() and isinstance(e["rationale"],str) and e["rationale"].strip(),"Response and rationale required")
            require(isinstance(e["spans"],list) and e["spans"],"At least one exact explanatory span required")
            for span in e["spans"]:
                require(set(span)=={"text","move"} and isinstance(span["text"],str) and span["text"] and e["response"].count(span["text"])==1 and span["move"] in {"explanation","hint","question","feedback","answer","claim","other"},"Span must identify one exact response substring")
        by_slot={e["slot"]:e for e in rows}
        require(by_slot[1]["response"]==by_slot[2]["response"] and by_slot[1]["fit"]=="overhelp" and by_slot[2]["fit"]=="appropriate","Context flip must preserve the exact response with changed fit")
    return draft

def projections(example, source, member):
    identity=source["scenario_id"]+f'-contrast-{example["slot"]:02}'
    turns=[{"role":"user","content":source["opening_message"]},*example["prefix"]]
    events=[{"event_id":f"{identity}-prefix-{i}","phase":"pre_action","visibility":"public",
        "kind":"learner_message" if t["role"]=="user" else "actor_message","text":t["content"]} for i,t in enumerate(turns)]
    records=[]
    for boundary in ["pre_action","delivered"]:
        selected=deepcopy(events)
        if boundary=="delivered":
            selected.append({"event_id":identity+"-response","phase":"delivered","visibility":"public","kind":"actor_message","text":example["response"]})
        last=selected[-1]
        labels={}
        if boundary=="pre_action" and example["need"]!="unknown":
            labels={f'need.{n}':int(example["need"]==n) for n in sorted(NEED-{"unknown"})}
        elif boundary=="delivered" and example["grade"] is not None:
            labels={f'fit.{n}':int(example["fit"]==n) for n in sorted(FIT-{"unknown"})}
            labels.update({"help.substantive_appropriate":int(example["grade"]==2),
                "help.substantive":int(example["substantive"]),"help.correct":int(example["correct"])})
        row={"record_id":identity+'-'+boundary,"family_id":member["family"],"group_ids":member["aliases"],
            "split":member["split"],"boundary":boundary,"latest_allowed_event_id":last["event_id"],"events":selected,
            "spans":[{"event_id":last["event_id"],"start":0,"end":len(last["text"])}],
            # Pool the same public response at training and inference. Selecting
            # only an annotated error span here would leak the target location.
            "pooling_policy":"whole_last_event",
            "annotation_spans":[] if boundary=="pre_action" else [
                {"event_id":last["event_id"],"start":example["response"].index(span["text"]),
                 "end":example["response"].index(span["text"])+len(span["text"]),
                 "text":span["text"],"move":span["move"],"offset_unit":"unicode_codepoint"}
                for span in example["spans"]],
            "source":"agy synthetic source-derived contrast; no runtime execution", "labels":labels,
            "label_provenance":{k:{"origin":"model_assisted_reviewed_draft","example_hash":native.digest(example),"model":MODEL} for k in labels}}
        observer.boundary_view(row);records.append(row)
    return records


def sft_candidate(row, source):
    """Approved teaching includes restraint; only the final reply is a target.

    Message weights are a preparation contract, not tokenizer-specific weights.
    A renderer must enforce this contract before dispatching a supervised update.
    """
    example=row['example']
    if (row['split']!='train' or example['fit']!='appropriate' or
            example['correct'] is not True or example['grade'] not in (1,2)):
        return None
    messages=[{'role':'user','content':source['opening_message']},
        *deepcopy(example['prefix']),{'role':'assistant','content':example['response']}]
    return {'id':row['id'],'family':row['family'],'source':source['source'],
        'messages':messages,'review_hash':row['review']['hash'],
        'teaching':{'fit':example['fit'],'need':example['need'],
            'substantive':example['substantive'],'grade':example['grade']},
        'supervision':{'kind':'last-assistant-message/v1','target_message_index':len(messages)-1,
            'message_weights':[0]*(len(messages)-1)+[1],
            'target_text_sha256':hashlib.sha256(example['response'].encode()).hexdigest(),
            'tokenization_status':'not_prepared'},
        'status':'model-reviewed synthetic SFT candidate; not logged-policy RL'}


def validate_membership(manifest, parents, packets):
    """Bind public packets to source records and disjoint connected families."""
    selected = [source for packet in packets for source in packet['sources']]
    membership = manifest['families']
    require(len(selected) == len(membership) and
        {s['scenario_id'] for s in selected} == set(membership), 'Packet membership mismatch')
    alias_index = {}
    for identity, parent in parents.items():
        for name in aliases(parent):
            alias_index.setdefault(name, set()).add(identity)
    used = set()
    for source in selected:
        identity = source['scenario_id']
        require(identity in parents, 'Unknown source scenario')
        parent, member = parents[identity], membership[identity]
        expected = {'scenario_id': identity, 'source': parent['source'],
            'family': parent['family'], 'opening_message': parent['actor']['opening_message']}
        require(source == expected, 'Public packet differs from admitted source')
        require(member['source'] == parent['source'] and member['family'] == parent['family'],
            'Membership source differs from admitted source')
        connected, pending, names = set(), [identity], set()
        while pending:
            current = pending.pop()
            if current in connected:
                continue
            connected.add(current)
            for name in aliases(parents[current]):
                names.add(name)
                pending.extend(alias_index[name] - connected)
        require(member['aliases'] == sorted(names), 'Connected family aliases changed')
        require(not names.intersection(used), 'Connected family selected more than once')
        require(not names.intersection(manifest['excluded_aliases']) and
            not any(parents[i]['evaluation_only']['admission'].get('protected') for i in connected),
            'Protected or previously measured family')
        require(member['split'] in {'train', 'calibration', 'test'}, 'Invalid split')
        used.update(names)
    require(dict(Counter(m['split'] for m in membership.values())) == manifest['partition_groups'],
        'Partition group counts changed')


def compile_pack(directory, output):
    directory=Path(directory);manifest=read(directory/'manifest.json');unsigned=deepcopy(manifest)
    claimed=unsigned.pop('manifest_hash');require(native.digest(unsigned)==claimed,"Manifest changed")
    bundle=replay(manifest['bundle_path']);require(native.digest(bundle)==manifest['bundle_sha256'],"Admitted corpus changed")
    for name,pin in manifest['exclusion_pins'].items():
        require(native.digest(read(name))==pin,"Exclusion artifact changed")
    parents={s['id']:s for s in bundle['scenarios']}
    packets = [read(directory/name) for name in manifest['batch_hashes']]
    validate_membership(manifest, parents, packets)
    output=native.output_directory(output);require(not output.exists(),"Fresh output required")
    accepted=[];rejected=[];observer_rows=[];sft=[];scenarios=[];review_pins={};draft_pins={}
    from native_practice_activities import adapt_practice
    for name,pin in manifest['batch_hashes'].items():
        packet=read(directory/name);require(native.digest(packet)==pin,"Drafting packet changed")
        stem=name.replace('.input.json','')
        draft=validate_draft(read(directory/(stem+'.draft.json')),packet)
        review=read(directory/(stem+'.review.json'))
        require(review['draft_sha256']==native.digest(draft) and review['model']==MODEL,"Review is not bound to draft/model")
        require(len(review['decisions'])==len(draft) and {r['scenario_id'] for r in review['decisions']}=={d['scenario_id'] for d in draft},"Review must cover all scenarios")
        decisions={r['scenario_id']:r for r in review['decisions']}
        review_pins[stem]=native.digest(review);draft_pins[stem]=native.digest(draft)
        for d in draft:
            source=next(s for s in packet['sources'] if s['scenario_id']==d['scenario_id'])
            member=manifest['families'][d['scenario_id']];decision=decisions[d['scenario_id']]
            require(type(decision['source_sufficient']) is bool and type(decision['practice_approved']) is bool,"Explicit review flags")
            if d['status']=='deferred' or not decision['source_sufficient']:
                rejected.append({'scenario_id':d['scenario_id'],'reason':decision['reason'],'kind':'source'});continue
            reviewed=decision['examples']
            require(len(reviewed)==10 and {r['slot'] for r in reviewed}==set(range(1,11)),"Review each example")
            by_slot={r['slot']:r for r in reviewed}
            for e in d['examples']:
                r=by_slot[e['slot']];require(type(r['approved']) is bool and isinstance(r['reason'],str) and r['reason'].strip(),"Explicit per-example judgment")
                pair_rejected=e['slot'] in (1,2) and not all(by_slot[i]['approved'] is True for i in (1,2))
                if not r['approved'] or pair_rejected:
                    rejected.append({'scenario_id':d['scenario_id'],'slot':e['slot'],'reason':r['reason'] if not pair_rejected else 'Context-flip pair requires both judgments to pass review', 'kind':'example'});continue
                row={'id':d['scenario_id']+f'-contrast-{e["slot"]:02}', 'family':member['family'],'group_ids':member['aliases'],'split':member['split'],
                    'source':source['source'],'source_scenario_id':d['scenario_id'],'topic':d['topic'],'example':e,
                    'authorship':'source-derived synthetic; Gemini 3.8 Flash draft and separate model-assisted review',
                    'review':{'model':MODEL,'hash':native.digest(review),'decision':r},'runtime_executed':False,
                    'learning_outcome':None,'behavior_logprobs':None}
                row['localizations']=[{'text':span['text'],'move':span['move'],'start':e['response'].index(span['text']),
                    'end':e['response'].index(span['text'])+len(span['text']), 'offset_unit':'unicode_codepoint'} for span in e['spans']]
                accepted.append(row);observer_rows.extend(projections(e,source,member))
                candidate=sft_candidate(row,source)
                if candidate is not None:sft.append(candidate)
            if d['practice_prompt'] and decision['practice_approved']:
                mapping={'id':d['scenario_id'],'source_sha256':source['source']['sha256'],'status':'ready','reason':decision['reason'],'prompt':d['practice_prompt']}
                adapted=adapt_practice(parents[d['scenario_id']],mapping,'2026-09-15T00:00:00.000Z','agy-gemini-3.8-flash-separate-review:'+native.digest(review))
                scenarios.append({'split':member['split'],'scenario':adapted})
    output.mkdir(parents=True,exist_ok=False)
    write(output/'examples.json',{'version':VERSION,'examples':accepted})
    write(output/'observer-inputs.json',{'records':observer_rows})
    write(output/'sft-candidates.json',{'version':VERSION,'status':'model-reviewed synthetic candidates',
        'loss_contract':'LAST_ASSISTANT_MESSAGE; earlier messages are context only. Enforce message weights with the actual actor renderer before training.',
        'examples':sft})
    write(output/'scenarios.json',{'scenarios':scenarios})
    for split in ['train', 'calibration', 'test']:
        write(output/f'scenarios-{split}.json', {'split':split,
            'scenarios':[item['scenario'] for item in scenarios if item['split']==split]})
    scenario_dir=output/'scenarios';scenario_dir.mkdir()
    for item in scenarios:
        write(scenario_dir/(item['scenario']['id']+'.json'),item['scenario'])
    write(output/'rejected.json',{'records':rejected})
    write(output/'splits.json',manifest['families'])
    for i in range(0,len(observer_rows),100):
        write(output/f'observer-shard-{i//100:03}.json',{'records':observer_rows[i:i+100]})
    report={'version':VERSION,'parent_manifest_hash':claimed,'draft_hashes':draft_pins,'review_hashes':review_pins,
        'planned_examples':manifest['target_examples'],'accepted_examples':len(accepted),'rejected':len(rejected),
        'accepted_families':len({r['family'] for r in accepted}),'by_split':dict(Counter(r['split'] for r in accepted)),
        'by_source':dict(Counter(r['source']['dataset'] for r in accepted)), 'by_fit':dict(Counter(r['example']['fit'] for r in accepted)),
        'sft_candidates':len(sft),'native_practice_scenarios':len(scenarios),'observer_records':len(observer_rows),
        'sft_by_need':dict(Counter(r['teaching']['need'] for r in sft)),
        'sft_restraint_candidates':sum(not r['teaching']['substantive'] for r in sft),
        'observer_label_contract':'v2: fit.appropriate includes restraint; help.substantive_appropriate means grade 2; help.substantive is independent.',
        'localization_contract':'annotation_spans are private targets; spans remain label-independent pooling spans.',
        'native_scenarios_by_split':dict(Counter(item['split'] for item in scenarios)),
        'deferred_source_examples':10*sum(r['kind']=='source' for r in rejected),
        'rejected_individual_examples':sum(r['kind']=='example' for r in rejected),
        'complete_context_flip_pairs':sum(r['example']['slot']==1 for r in accepted),
        'model':MODEL,
        'current_template_hashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((Path(__file__).parent/'prompts').glob('contextual-data-*.md'))},
        'calibrated_classifier':False,'policy_update_executed':False,
        'files':{str(p.relative_to(output)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(output.rglob('*')) if p.is_file()}}
    write(output/'manifest.json',report);print(json.dumps({k:v for k,v in report.items() if k not in ['files','draft_hashes','review_hashes']}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('prepare');p.add_argument('--bundle',required=True);p.add_argument('--output',required=True);p.add_argument('--families',type=int,default=60);p.add_argument('--batch-size',type=int,default=10);p.add_argument('--prior-observer',action='append',default=[])
    p=sub.add_parser('compile');p.add_argument('directory');p.add_argument('--output',required=True)
    args=parser.parse_args()
    if args.command=='prepare':prepare(args.bundle,args.output,args.families,args.batch_size,args.prior_observer)
    else:compile_pack(args.directory,args.output)
