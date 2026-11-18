"""Build the local comparison of two fixed replies from the verified observations."""
import html
import json
from pathlib import Path

here = Path(__file__).resolve().parent
study = here.parent.parent
before, after = [json.loads((here / name).read_text())["probe"] for name in ["frozen.json", "current.json"]]
scored = json.loads((study / "scored.json").read_text())["records"]
exercise = next(node for row in scored if row["id"] == "gemini-3.1-flash-lite--code"
                for node in row["final"]["nodes"] if node["type"] == "coding-challenge")
assert before["archivedDraftSha256"] == after["archivedDraftSha256"]
assert exercise["language"] in after["challengeLanguages"]
model = {"languages": [], "help": [], "oracle": []}
for old, new in zip(before["cases"], after["cases"], strict=True):
    assert old["prompt"] == new["prompt"]
    model["languages"].append({"label": new["prompt"], "values": ["Matched" if row["actionMatched"] else "Missed" for row in (old, new)]})
for old, new in zip(before["proofCases"], after["proofCases"], strict=True):
    assert old["suffix"] == new["suffix"]
    model["help"].append({"label": new["suffix"].strip() or "No additional instruction",
                          "values": [row["disposition"].capitalize() for row in (old, new)]})
replay = json.loads((here / "expected-output-replay.json").read_text())["rows"]
for sample in json.loads((here / "python-outputs.json").read_text()):
    r = next(r for r in replay if r["cell"] == "odd-filter--minimax--" + sample["arm"] and r["attempt"] == sample["attempt"])
    decision = "Gemini Decision" if sample["arm"] == "google" else "Jev"
    model["oracle"].append({"label": decision + " guidance · candidate " + str(sample["attempt"]),
                            "values": [str(sample["actual"]), "Blocked" if r["originalBlocking"] else "Approved", r["singleCandidateNow"].capitalize()]})

def control(key, label, initial, columns=("v2.3.3", "v2.3.4")):
    options = "".join('<option value="' + str(i) + '"' + (" selected" if i == initial else "") + '>'
                      + html.escape(row["label"]) + "</option>" for i, row in enumerate(model[key]))
    results = "".join('<div><dt>' + column + '</dt><dd><output id="' + key + str(i) + '">'
                      + model[key][initial]["values"][i] + "</output></dd></div>" for i, column in enumerate(columns))
    return '<label for="' + key + '">' + label + '</label><select id="' + key + '">' + options + '</select><dl aria-live="polite">' + results + '</dl>'

page = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Interface use and draft decisions · Keating</title><style>
*{box-sizing:border-box}body{margin:0;background:#f7f5ef;color:#242e28;font:16px/1.55 system-ui,sans-serif}main{max-width:750px;margin:auto;padding:48px 24px 64px}
header{margin-bottom:30px}h1,h2{font-family:Georgia,serif;font-weight:normal;line-height:1.13;text-wrap:balance}h1{font-size:clamp(2.4rem,6vw,4.2rem);letter-spacing:-.055em;margin:.35em 0}
h2{font-size:clamp(1.6rem,4vw,2.35rem);letter-spacing:-.035em;margin:0 0 .5em}p{margin:.7rem 0}section{background:#fffefa;border:1px solid #cfcec3;border-radius:12px;padding:clamp(1rem,4vw,2rem);margin:1.15rem 0}
a,summary{color:#24593d;text-underline-offset:3px}a:focus-visible,summary:focus-visible,select:focus-visible{outline:3px solid #17653f;outline-offset:3px}
label{display:block;font-weight:650;margin:1.25rem 0 .4rem}select{display:block;background:white;border:1px solid #949b90;color:#20362b;border-radius:5px;font:inherit;width:100%;padding:.5rem}
dl{display:grid;grid-template-columns:1fr 1fr;margin:1rem 0 .5rem;border-top:1px solid #d0d3c8;border-bottom:1px solid #d0d3c8}dl>div{padding:.8rem 0}dt{font-size:.85rem;color:#526055}dd{margin:.1rem 0 0;font-size:1.4rem;font-weight:650}details{margin-top:.9rem}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef1ea;padding:.85rem;border-radius:5px;font-size:.85rem}
blockquote{border-left:3px solid #80917b;margin:1rem 0;padding-left:1rem}footer{font-size:.9rem}header p{max-width:620px}@media(max-width:500px){main{padding:24px 12px 40px}select{font-size:.9rem}}
</style><main><header><a href="../../REPORT.md">Keating interface audit</a><h1>When the same reply gets a different verdict</h1><p>Change the learner’s wording to compare the recorded decisions before and after two fixes. Both examples run entirely from saved results.</p></header>
<section><h2>A JavaScript exercise counted as a miss</h2><p>Gemini gave a Python learner this JavaScript coding challenge. The diagnostic replay pairs that exact reply with four requests to check which ones it satisfies.</p>
{language_control}<details><summary>See the actual JavaScript starter</summary><pre>{code}</pre><a href="../../evidence/gemini-3.1-flash-lite--code.json">Original tutor response</a></details></section>
<section><h2>“No hints” let the diagnosis through</h2><p>The learner asked for a buggy Python loop to fix independently. The test draft’s proposed interactive page described the fault in the preview itself.</p>
<blockquote>The bug is starting at index one, which skips the first value.</blockquote>{help_control}
<details><summary>What the gate compared</summary><p>The candidate, page description and permissive test reviewer were held fixed. The ordinary release gate had two draft slots. Only the additional learner instruction changes across these rows.</p><a href="probe.mjs">Inspect the test inputs</a></details></section>
<section><h2>An expected result can help a learner find the bug</h2><p>MiniMax wrote these four Python starters for the same input, <code>[5, 4, 9]</code>. Each should collect every odd number, giving <code>[5, 9]</code>. The printed results come from local CPython. The last column replays one saved candidate at a time through the web gate.</p>
{oracle_control}<details><summary>Why two verdicts changed</summary><p>Jev recorded the first two rejected exercises as visibly broken and independent. A separate generic check treated the stated expected output as an answer giveaway. The revised gate can verify the expected result of this bounded arithmetic exercise while leaving the repair for the learner. The third starter prints the correct list and still gets withheld.</p><a href="expected-output-replay.json">Gate probabilities and request hashes</a> · <a href="python-outputs.json">All four program outputs</a></details></section>
<footer><a href="README.md">Read the independent review</a> · <a href="frozen.json">Before receipts</a> · <a href="current.json">After receipts</a> · <a href="cues.json">Cue calibration</a></footer></main>
<script>const rows={observations};for(const key of Object.keys(rows)){const choice=document.getElementById(key);choice.addEventListener('change',()=>{rows[key][Number(choice.value)].values.forEach((v,i)=>{document.getElementById(key+i).textContent=v})})}</script></html>"""
for marker, replacement in {"{language_control}": control("languages", "Learner request", 0), "{help_control}": control("help", "Additional learner instruction", 1),
                            "{oracle_control}": control("oracle", "Saved Python starter", 1, ("Printed output", "v2.3.4 original", "v2.3.5 replay")),
                            "{code}": html.escape(exercise["starterCode"]), "{observations}": json.dumps(model).replace("<", "\\u003c")}.items():
    page = page.replace(marker, replacement)
(here / "index.html").write_text(page + "\n")
