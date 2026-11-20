import { expect, test } from "bun:test";
import { compileOpenUISourceToSharedDocument, validateUiDocument, validateUiActionAgainstDocument, type UiLabNode, type UiLabObservation } from "@keating/learner-contracts";
import { StorageConversationEventStore } from "../keating/event-store";
import { createConversationRuntime, recordOpenUIAction } from "../keating/integration";
import { parseLearnerResponse } from "../keating/learner-response";
import { dispatchSharedUiAction } from "../keating/openui/shared-actions";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

const at = "2026-11-19T10:00:00.000Z";
const source = 'root = LearningSurface([lab], "Intervals", "", "workspace")\nlab = Lab("pitch", "Play a third", "Start at middle C.", {kind:"midi"}, [{id:"third",title:"C then E",hint:"Count four semitones.",check:{kind:"notes",notes:[60,64]}},{id:"fifth",title:"C then G",check:{kind:"notes",notes:[60,67]}}], "workspace")';
const document = compileOpenUISourceToSharedDocument(source, {documentId:"intervals", createdAt: at});

test("the chat delivers each lab observation once and keeps the next checkpoint available", () => {
  const storage = new MemoryStorage();
  const runtime = createConversationRuntime({ sessionId: "music", runId: "run", store: new StorageConversationEventStore(new MemoryStorage()) });
  const miss = { type: "observe-lab" as const, nodeId: "pitch", attemptId: "first", checkpointId: "third", passed: false, evidence: "MIDI device played 60 63", observation:{kind:"notes" as const, input:"device" as const, notes:[60,63]} };
  const delivery = { sessionId: "music", humanFriendlyMessage: "Played C then E flat." };
  const first = dispatchSharedUiAction(storage, document, miss, at, delivery);
  expect(validateUiActionAgainstDocument({...first.action, passed:true}, document)).toBe(false);
  expect(validateUiActionAgainstDocument({...first.action, observation:{kind:"range",input:"manual",value:1}}, document)).toBe(false);
  const replay = dispatchSharedUiAction(storage, document, miss, at, delivery);
  expect(replay.replayed).toBe(true);
  expect(replay.deliveries).toHaveLength(1);
  const match = dispatchSharedUiAction(storage, first.document, { ...miss, attemptId:"second", passed:true, evidence:"MIDI device played 60 64", observation:{kind:"notes",input:"device",notes:[60,64]} }, at, delivery);
  expect(match.document.lifecycle).toBe("ready");
  expect(match.journal.receipts).toHaveLength(2);
  expect(validateUiActionAgainstDocument({...miss, ...match.action, checkpointId:"missing", documentRevision:match.document.revision}, match.document)).toBe(false);
  const next = dispatchSharedUiAction(storage, match.document, { ...miss, attemptId:"third", checkpointId:"fifth", passed:true, evidence:"On-screen keyboard 60 67", observation:{kind:"notes",input:"screen",notes:[60,67]} }, at, delivery);
  expect(next.journal.receipts).toHaveLength(3);
  for (const result of [first, replay, match, next]) {
    // The chat re-delivers the original source revision retained in the outbox.
    const entry = result.deliveries.find(row => row.id === result.action.documentId + "-" + result.action.idempotencyKey)!;
    recordOpenUIAction(runtime, {
    kind:"canonical", type:"observe-lab", params:{...result.action}, action:result.action,
      receipt:result.receipt, sourceDocument:entry.sourceDocument, humanFriendlyMessage:entry.humanFriendlyMessage,
      document:{id:document.id, revision:entry.sourceDocument.revision, lifecycle:"workspace"},
    });
  }
  const turns = runtime.pendingLearnerResponses();
  expect(turns).toHaveLength(3);
  const missTurn = turns.find(turn => turn.serialized.includes(miss.evidence))!;
  const failed = parseLearnerResponse(missTurn.serialized)!;
  expect(failed.review.items).toContainEqual({label:"Checkpoint",value:"C then E"});
  expect(failed.review.items).toContainEqual({label:"Observed",value:miss.evidence});
  expect(failed.agentInstruction).toContain("first mismatch");
  expect(missTurn.serialized).toContain("Count four semitones");
});

test("marks re-check measured stdout, note sequence or sensor range with the authored input requirement", () => {
  const check = (adapter: UiLabNode["adapter"], target: UiLabNode["checkpoints"][number]["check"], observation: UiLabObservation, passed: boolean) => {
    const source = { ...document, nodes: [{
      id:"target", type:"lab", title:"Experiment", brief:"Take a measurement.", adapter,
      checkpoints:[{id:"observe", title:"Observe the target", check:target}],
    }] };
    return validateUiActionAgainstDocument({
      schemaVersion:1, type:"observe-lab", documentId:source.id, documentRevision:0, idempotencyKey:"sample",
      nodeId:"target", checkpointId:"observe", attemptId:"first", observation, passed, evidence:"Run observed.",
    },source);
  };
  const shell = { kind:"code",language:"sh",source:"echo one" } as const;
  const expected = {kind:"output",stdout:"one",exitCode:0} as const;
  expect(check(shell,expected,{kind:"output",stdout:"one\r\n",exitCode:0},true)).toBe(true);
  expect(check(shell,expected,{kind:"output",stdout:"one",exitCode:1},true)).toBe(false);
  expect(check(shell,expected,{kind:"output",stdout:"one",exitCode:0,truncated:true},true)).toBe(false);
  const midi = {kind:"midi",requireDevice:true} as const;
  expect(check(midi,{kind:"notes",notes:[60]},{kind:"notes",notes:[60],input:"screen"},true)).toBe(false);
  expect(check(midi,{kind:"notes",notes:[60]},{kind:"notes",notes:[60],input:"mixed"},false)).toBe(true);
  const serial = {kind:"serial",baudRate:9600,unit:"V",requireDevice:true} as const;
  const range = {kind:"range",min:2,max:3} as const;
  expect(check(serial,range,{kind:"range",input:"device",value:3},true)).toBe(true);
  expect(check(serial,range,{kind:"range",input:"device",value:3.1},true)).toBe(false);
  expect(check(serial,range,{kind:"range",input:"manual",value:3},true)).toBe(false);
  expect(check(serial,range,{kind:"range",input:"device",value:NaN},false)).toBe(false);
});

test("lab checks are bounded and must correspond to the authored adapter", () => {
  const valid = (adapter: unknown, check: unknown) => validateUiDocument({ ...document, nodes: [{
    type:"lab", id:"test", title:"Test", brief:"Try it.", adapter,
    checkpoints:[{id:"step", title:"Step", check}],
  }] });
  expect(valid({kind:"code",language:"sh",source:"echo ready"}, {kind:"output",stdout:"ready",exitCode:0})).toBe(true);
  expect(valid({kind:"code",language:"wat",source:"(module)",exportName:"add",args:[3,4]}, {kind:"output",stdout:"7",exitCode:0})).toBe(true);
  expect(valid({kind:"midi",requireDevice:true}, {kind:"notes",notes:[0,127]})).toBe(true);
  expect(valid({kind:"serial",unit:"°C",baudRate:9600}, {kind:"range",min:0,max:50})).toBe(true);
  expect(valid({kind:"serial",unit:"°C",baudRate:2400}, {kind:"range",min:0,max:50})).toBe(false);
  expect(valid({kind:"serial",unit:"°C",baudRate:9600}, {kind:"range",min:51,max:50})).toBe(false);
  expect(valid({kind:"midi"}, {kind:"notes",notes:[128]})).toBe(false);
  expect(valid({kind:"midi"}, {kind:"output",stdout:"",exitCode:0})).toBe(false);
  const first = document.nodes[0];
  if (first?.type !== "lab") throw new Error("Expected a lab");
  expect(validateUiDocument({...document,nodes:[{...first,checkpoints:[first.checkpoints[0], first.checkpoints[0]]}]})).toBe(false);
});
