import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {parseArgs} from "node:util";
import {cohort,startHost,study} from "./host.mjs";

const {values} = parseArgs({options:{product:{type:"string"},sample:{type:"string",default:"live-stage-light"}}});
const samples = {
  "live-stage-light": ["Stage light","receipts"],
  "recorded-question": ["Paper folds","receipts"],
  "recorded-python": ["Editable Python","receipts"],
  "final-prediction": ["Tile prediction","supplement/prediction/receipts"],
  "final-python": ["Multiples of three","supplement/addendum/receipts"],
  "live-tile-confirm": ["Typed tile answer","classroom-v2.3.7/receipts"],
  "linked-tile-confirm": ["Typed tile answer after the instruction change","classroom-v2.3.8/receipts"],
};
if (!values.product || !Object.hasOwn(samples,values.sample))
  throw Error("Pass --product <frozen checkout> and --sample "+Object.keys(samples).join(", "));
const [label,receiptDirectory]=samples[values.sample];
const directory=join(import.meta.dirname,values.sample);
const read=path=>readFile(path,"utf8").then(JSON.parse);
const [evidence,trace]=await Promise.all([read(join(directory,"evidence.json")),read(join(directory,"settings-export.json"))]);
const raw=await readFile(join(study,receiptDirectory,(evidence.id??evidence.cell)+".json"));
assert.equal(createHash("sha256").update(raw).digest("hex"),evidence.receiptSha256);
const receipt=JSON.parse(raw);
const followup=["live-tile-confirm","linked-tile-confirm"].includes(values.sample);
assert.equal(receipt.disposition,followup?"withheld":"released");
const message=(receipt.publicEnvelope??receipt.public).message;
assert(message.content.every(p=>p.type==="text"));
assert(trace.turns.some(row=>row.conversationId===evidence.measuredTurn.conversationId&&row.turnId===evidence.measuredTurn.turnId));
const priorMessages=[];
if(followup){
  const phase=resolve(study,receiptDirectory,"..");
  const registered=await read(join(phase,"cohort.json"));
  const parentBytes=await readFile(resolve(phase,registered.parentReceipt));
  assert.equal(createHash("sha256").update(parentBytes).digest("hex"),evidence.parentReceiptSha256);
  const parent=JSON.parse(parentBytes);
  priorMessages.push({role:"user",content:parent.prompt},parent.public.message);
}
const tutor=cohort.tutors[receipt.tutor];
const host=await startHost({product:resolve(values.product),sample:{provider:tutor.provider,model:tutor.id},
  exhibit:{label,message,learner:followup?evidence.typedLearner:evidence.originatingLearner,trace,priorMessages}});
console.log("Read-only classroom "+host.origin+"/");
console.log("Recorded Settings trace "+host.origin+"/?inspector");
const stop=async()=>{await host.close();process.exit(0)};
process.on("SIGINT",stop);process.on("SIGTERM",stop);
