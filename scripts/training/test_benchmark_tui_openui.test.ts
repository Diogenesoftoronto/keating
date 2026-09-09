import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectTuiOpenUi } from './benchmark_tui_openui.js';
import { HostController, type HostSurface, type UiDocumentControl } from '../../src/tui/host-controller.js';
import { OPENUI_JSON_PARITY_FIXTURE, type UiDocument, type UiDocumentNode } from '../../src/tui/learner-contracts.js';
import { PI_UI_ACTION_COMMAND, RpcUiActionDispatcher, registerPiUiActionCommand, decodeUiActionEnvelope } from '../../src/tui/ui/rpc-action-transport.js';
import { FileUiActionJournalStorage } from '../../src/tui/ui/filesystem-journal.js';

// Authored assistant outputs exercise the production host. These are not paid
// model samples and do not demonstrate that a model can author these documents.
function document(nodes: UiDocumentNode[]): UiDocument {
  return { ...structuredClone(OPENUI_JSON_PARITY_FIXTURE), id:'tui-benchmark-example', title:'Teaching activity', nodes, revision:0, lifecycle:'ready' };
}
const quiz = (): UiDocument => document([{type:'quiz',id:'quiz',title:'Heat check',questions:[
  {id:'objective',kind:'multiple_choice',prompt:'2 times 3?',choices:[{id:'six',label:'6'},{id:'five',label:'5'}],correctAnswer:'six',explanation:'Multiply to obtain six.'},
  {id:'reason',kind:'short_answer',prompt:'Why does doubling mass double heating energy?',correctAnswer:'Twice the material needs twice the energy.',explanation:'Hold material and temperature rise fixed.'},
]}]);
const deck = (): UiDocument => document([{type:'deck',id:'deck',title:'Fractions',topic:'fractions',cards:[{id:'quarter',front:'0.25 as a fraction',back:'One quarter'}]}]);
const fence = (doc: UiDocument) => `Try this activity.\n\n\`\`\`keating-ui\n${JSON.stringify(doc)}\n\`\`\``;

function surface() {
  const state = { document:null as UiDocument|null, controls:[] as readonly UiDocumentControl[], entries:[] as any[], answers:[] as string[], choices:[] as number[], confirmations:[] as Array<{title:string;message:string}> };
  const port: HostSurface = {
    hydrateEntries(entries) { state.entries = entries; }, appendEntry(entry) { state.entries.push(entry); },
    setStreaming() {},setStatus() {},setHeaderState() {},setEditorText() {},setWidget() {},setTitle() {},
    setUiDocument(document,controls) { state.document=document;state.controls=controls; },
    async presentSelect(_title,options) { const index=state.choices.shift();return index === undefined ? undefined : options[index]; },
    async presentConfirm(title,message) { state.confirmations.push({title,message});return true; },async presentInput() { return state.answers.shift(); },async presentEditor() { return state.answers.shift(); },
  };
  return {state,port};
}

async function withReceiver(run: (host: ReturnType<typeof surface> & {controller:HostController;prompts:string[];submissions:Array<{message:any;options:any}>;cwd:string})=>Promise<void>) {
  const cwd=await mkdtemp(join(tmpdir(),'keating-tui-openui-test-'));
  const handlers = new Map<string,{handler(args:string|string[],ctx:any):Promise<void>}>();
  const submissions:Array<{message:any;options:any}>=[];
  registerPiUiActionCommand({registerCommand(name,command) {handlers.set(name,command);},sendMessage(message,options) {submissions.push({message,options});}});
  const listeners=new Set<(event:unknown)=>void>(), prompts:string[]=[];
  const client={
    onEvent(listener:(event:unknown)=>void) {listeners.add(listener);return ()=>{listeners.delete(listener);};},
    async getCommands() {return [{name:PI_UI_ACTION_COMMAND,source:'extension'}];},
    async getState() {return {isStreaming:false};},
    async prompt(message:string) {
      prompts.push(message);
      expect(message).toStartWith(`/${PI_UI_ACTION_COMMAND} `);
      await handlers.get(PI_UI_ACTION_COMMAND)!.handler(message.slice(message.indexOf(' ')+1),{cwd,ui:{notify(message:string) {
        for(const listener of listeners) listener({type:'extension_ui_request',method:'notify',message});
      }}});
    },
  };
  const dispatcher=new RpcUiActionDispatcher(client,1000), host=surface();
  const controller=new HostController(client,host.port,{uiActionDispatcher:dispatcher});
  try {await run({...host,controller,prompts,submissions,cwd});} finally {dispatcher.dispose();await rm(cwd,{recursive:true,force:true});}
}

test('canonical assistant output becomes the real terminal document, presentation and keyboard controls',()=>{
  const doc=quiz(), text=fence(doc), receipt=inspectTuiOpenUi(text);
  expect(receipt.content).toBe('Try this activity.');
  expect(receipt.documents[0]).toMatchObject({status:'rendered',document:doc,presentation:{heading:'Teaching activity'}});
  expect(receipt.documents[0]!.presentation!.body.join('\n')).toContain('Quiz: Heat check');
  const {state,port}=surface();const controller=new HostController({onEvent(){}},port);
  controller.handleEvent({type:'message_end',message:{role:'assistant',content:[{type:'text',text}]}});
  expect(state.document).toEqual(doc);
  expect(state.controls.map(control=>control.label)).toEqual(['Take quiz: Heat check']);
  expect(state.entries.find(entry=>entry.kind==='assistant').body).not.toContain('schemaVersion');
  expect(receipt.documents[0]!.presentation!.body.join('\n')).not.toContain('Multiply to obtain six.');
  expect(receipt.documents[0]!.presentation!.body.join('\n')).not.toContain('Twice the material needs twice the energy.');
});

test('malformed and incomplete transports never count as rendered, and plain openui DSL is not silently accepted by the host',()=>{
  expect(inspectTuiOpenUi('```keating-ui\n{}\n```').documents[0]!.status).toBe('rejected');
  expect(inspectTuiOpenUi('Starting\n```keating-ui\n{"schemaVersion":1').documents).toHaveLength(0);
  const plain='```openui\nroot = LearningSurface([text])\ntext = Explanation("Hello")\n```';
  const receipt=inspectTuiOpenUi(plain);
  expect(receipt.plain_openui_fence_present).toBe(true);expect(receipt.documents).toHaveLength(0);expect(receipt.content).toBe(plain);
});

test('quiz controls persist objective results, leave open reasoning pending and request a tutor follow-up',async()=>{
  await withReceiver(async({controller,state,prompts,submissions,cwd})=>{
    controller.handleEvent({type:'message_end',message:{role:'assistant',content:fence(quiz())}});
    state.choices.push(0);state.answers.push('There is twice as much stuff, each piece needing the same energy.');
    await state.controls[0]!.run();
    expect(prompts).toHaveLength(1); // The action command is distinct from Pi's follow-up queue.
    const envelope=decodeUiActionEnvelope(prompts[0]!.split(' ')[1]!);
    expect(envelope.action.type).toBe('complete-quiz');
    const journal=await new FileUiActionJournalStorage(cwd,'receiver').load(envelope.sourceDocument.id);
    expect(journal!.receipts).toHaveLength(1);
    expect(state.document!.revision).toBe(1);
    const result=state.document!.nodes.find(node=>node.type==='callout');
    expect(result?.type).toBe('callout');
    if(result?.type!=='callout') throw new Error('Quiz receipt did not contain its result callout');
    expect(result.title).toBe('Quiz submitted');
    expect(result.markdown).toContain('Objective score: 1/1');
    expect(result.markdown).toContain('1 response pending tutor review.');
    expect(state.document!.lifecycle).toBe('submitted');
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.options).toMatchObject({triggerTurn:true,deliverAs:'followUp'});
    expect(submissions[0]!.message.content).toContain('There is twice as much stuff, each piece needing the same energy.');
    expect(submissions[0]!.message.details.document.lifecycle).toBe('submitted');
    // The production receiver queued real learner work; the injected transport
    // does not generate a tutor answer or pretend that semantic review occurred.
  });
});

test('card backs stay hidden until explicit reveal and rating persists a real SRS receipt',async()=>{
  const receipt=inspectTuiOpenUi(fence(deck()));
  expect(receipt.documents[0]!.presentation!.body.join('\n')).not.toContain('One quarter');
  await withReceiver(async({controller,state,prompts,submissions,cwd})=>{
    controller.handleEvent({type:'message_end',message:{role:'assistant',content:fence(deck())}});
    expect(state.controls.map(control=>control.label)).toEqual(['Rate card: 0.25 as a fraction','Complete deck: Fractions']);
    state.choices.push(2);await state.controls[0]!.run();
    expect(state.confirmations).toHaveLength(2);
    expect(state.confirmations[0]!.message).not.toContain('One quarter');
    expect(state.confirmations[1]!.message).toContain('One quarter');
    const envelope=decodeUiActionEnvelope(prompts[0]!.split(' ')[1]!);
    expect(envelope.action).toMatchObject({type:'rate-card',cardId:'quarter',rating:2});
    expect((await new FileUiActionJournalStorage(cwd,'receiver').load(envelope.sourceDocument.id))!.receipts).toHaveLength(1);
    expect(state.document!.nodes.find(node=>node.type==='deck')).toMatchObject({cards:[]});
    expect(state.document!.nodes.find(node=>node.type==='callout')).toMatchObject({title:'Card rated 2',markdown:expect.stringContaining('Next review:')});
    expect(prompts).toHaveLength(1);
    expect(submissions).toHaveLength(0); // Rating is not fabricated comprehension evidence.
  });
});
