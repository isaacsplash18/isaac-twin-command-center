import assert from "node:assert/strict";
import { pageToEvent } from "../lib/calibration-events";
import { readTrainingPayload, SOURCES, applyProposal, previewApplication, reportRun, saveExample, trainingContext } from "../lib/training";

import { comparisonState, judgeComparison, comparisonPreferences, forgetComparisonPreference } from '../lib/comparisons';

const DS = {
  events: "10000000-0000-4000-8000-000000000001",
  training: "10000000-0000-4000-8000-000000000002",
  proposals: "10000000-0000-4000-8000-000000000003",
  positions: "10000000-0000-4000-8000-000000000004",
  x: "10000000-0000-4000-8000-000000000005",
  linkedin: "10000000-0000-4000-8000-000000000006",
  substack: "10000000-0000-4000-8000-000000000007",
};
const IDS = {
  proposal: "20000000-0000-4000-8000-000000000001",
  onceEvent: "20000000-0000-4000-8000-000000000002",
  alwaysEvent: "20000000-0000-4000-8000-000000000003",
  context: "20000000-0000-4000-8000-000000000004",
  draft: "20000000-0000-4000-8000-000000000005",
};

const rich = (value: string) => ({ type: "rich_text", rich_text: [{ type: "text", text: { content: value }, plain_text: value }] });
const select = (name: string) => ({ type: "select", select: { name } });
const title = (value: string) => ({ type: "title", title: [{ type: "text", text: { content: value }, plain_text: value }] });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const prop = (properties: Record<string, unknown>, key: string) => properties[key];

function proposalPage(status = "accepted") {
  return {
    id: IDS.proposal,
    created_time: "2026-10-01T00:00:00.000Z",
    last_edited_time: "2026-10-02T00:00:00.000Z",
    parent: { data_source_id: DS.proposals },
    properties: {
      Name: title("Voice preference"),
      "Source Event IDs": rich(""),
      "Affected Position ID": rich(""),
      Topic: rich("Voice"),
      "Current Position Text": rich(""),
      "Proposed Position Text": rich("Use direct language."),
      Reason: rich("Repeated user correction"),
      "Evidence Summary": rich(""),
      Confidence: select("high"),
      Status: select(status),
      "Target Type": select("voice"),
      "Target Ref": rich(""),
    },
  };
}

function eventPage(id: string, scope: string) {
  return {
    id,
    created_time: scope === "once" ? "2026-10-04T00:00:00.000Z" : "2026-10-03T00:00:00.000Z",
    parent: { data_source_id: DS.events },
    properties: {
      Name: title("Draft correction"),
      Source: select("command_center"),
      "Object Type": select("draft"),
      "Object ID": rich(`draft-${scope}`),
      Platform: select("x"),
      Topic: rich("opening"),
      Action: select("edit"),
      "Raw User Text": rich(""),
      "Previous Text": rich("Old opening"),
      "New Text": rich("Better opening"),
      "Affected Position IDs": rich(""),
      "Inferred Delta": rich(""),
      Status: select("pending"),
      "Feedback Scope": select(scope),
      "Feedback Reason": rich(scope === "always" ? "Start with the claim" : "This one time"),
    },
  };
}

function trainingPage(payload: Record<string, unknown>, id = IDS.context) {
  return {
    id,
    created_time: "2026-10-05T00:00:00.000Z",
    parent: { data_source_id: DS.training },
    properties: { Name: title("context"), Kind: select("context"), Payload: rich(JSON.stringify(payload)) },
  };
}

function withNotionMock(handler: (url: URL, init: RequestInit) => Promise<Response> | Response) {
  const originalFetch = globalThis.fetch;
  const envKeys = ["NOTION_TOKEN", "DS_CALIBRATION_EVENTS", "DS_TRAINING", "DS_PROPOSALS", "DS_POSITIONS", "DS_X", "DS_LINKEDIN", "DS_SUBSTACK"] as const;
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NOTION_TOKEN: "mock-token",
    DS_CALIBRATION_EVENTS: DS.events,
    DS_TRAINING: DS.training,
    DS_PROPOSALS: DS.proposals,
    DS_POSITIONS: DS.positions,
    DS_X: DS.x,
    DS_LINKEDIN: DS.linkedin,
    DS_SUBSTACK: DS.substack,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => handler(new URL(String(input)), init)) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      const value = oldEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function testSnapshotParsingOver1900Chars() {
  const longText = "snapshot-".repeat(800);
  const event = pageToEvent({
    id: IDS.onceEvent,
    created_time: "2026-10-01T00:00:00Z",
    properties: {
      Name: title("Long snapshot"), Source: select("agent"), "Object Type": select("draft"), "Object ID": rich("draft"),
      Platform: select("x"), Topic: rich("long"), Action: select("edit"), "Raw User Text": rich(""),
      "Previous Text": { type: "rich_text", rich_text: Array.from({ length: Math.ceil(longText.length / 1900) }, (_, i) => {
        const value = longText.slice(i * 1900, (i + 1) * 1900);
        return { type: "text", text: { content: value }, plain_text: value };
      }) },
      "New Text": rich("new"), "Affected Position IDs": rich(""), "Inferred Delta": rich(""), Status: select("pending"),
    },
  });
  assert.equal(event.previousText.length, longText.length);
  assert.equal(event.previousText, longText);
}

async function testWrongDatabaseIdsAreRejected() {
  const patches: string[] = [];
  const restore = withNotionMock((url, init) => {
    if (url.pathname === `/v1/pages/${IDS.proposal}`) return response({ ...proposalPage(), parent: { data_source_id: DS.training } });
    if (init.method === "PATCH") patches.push(url.pathname);
    return response({});
  });
  try {
    await assert.rejects(() => previewApplication(IDS.proposal), /outside the configured database/);
    await assert.rejects(() => saveExample(IDS.onceEvent, { scope: "once", reason: "fine" }), /outside the configured database/);
    assert.deepEqual(patches, [], "wrong-database pages must never be patched");
  } finally { restore(); }
}

async function testStalePreviewDoesNotAppend() {
  const patchPaths: string[] = [];
  const restore = withNotionMock((url, init) => {
    if (url.pathname === `/v1/pages/${IDS.proposal}`) return response(proposalPage());
    if (url.pathname === `/v1/pages/${SOURCES.voice}`) return response({ id: SOURCES.voice, last_edited_time: "2026-10-05T00:00:00Z", properties: { Name: title("Voice") } });
    if (url.pathname === `/v1/blocks/${SOURCES.voice}/children`) return response({ results: [], has_more: false });
    if (init.method === "PATCH") patchPaths.push(url.pathname);
    return response({});
  });
  try {
    await assert.rejects(() => applyProposal(IDS.proposal, "stale-digest"), /source or suggestion changed/);
    assert.deepEqual(patchPaths, [], "stale digest must not append content or mark the proposal applied");
  } finally { restore(); }
}

async function testMatchingMarkerRetryDoesNotAppendTwice() {
  const appendBodies: unknown[] = [];
  const patchPaths: string[] = [];
  const content = `[Approved amendment ${IDS.proposal.replace(/-/g, "")}]\nVoice\nUse direct language.`;
  const restore = withNotionMock((url, init) => {
    if (init.method === "PATCH") patchPaths.push(url.pathname);
    if (url.pathname === `/v1/blocks/${SOURCES.voice}/children` && init.method === "PATCH") appendBodies.push(init.body);
    if (url.pathname === `/v1/pages/${IDS.proposal}`) return response(proposalPage());
    if (url.pathname === `/v1/pages/${SOURCES.voice}`) return response({ id: SOURCES.voice, last_edited_time: "2026-10-05T00:00:00Z", properties: { Name: title("Voice") } });
    if (url.pathname === `/v1/blocks/${SOURCES.voice}/children`) return response({ results: [{ id: "block-1", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content }, plain_text: content }] } }], has_more: false });
    if (url.pathname === `/v1/pages/${SOURCES.voice}`) return response({ id: SOURCES.voice, last_edited_time: "2026-10-06T00:00:00Z", properties: { Name: title("Voice") } });
    return response({});
  });
  try {
    const preview = await previewApplication(IDS.proposal);
    const result = await applyProposal(IDS.proposal, preview.digest);
    assert.equal(result.ok, true);
    assert.deepEqual(appendBodies, [], "a matching marker means the append already happened");
    assert.deepEqual(patchPaths, [`/v1/pages/${IDS.proposal}`], "retry only finalizes proposal metadata");
  } finally { restore(); }
}

async function testOnceFeedbackCannotBeReportedAsConsumed() {
  const restore = withNotionMock((url, init) => {
    const path = url.pathname;
    if (path === `/v1/data_sources/${DS.events}/query`) return response({ results: [eventPage(IDS.onceEvent, "once"), eventPage(IDS.alwaysEvent, "always")], has_more: false });
    if (path === `/v1/data_sources/${DS.positions}/query`) return response({ results: [], has_more: false });
    if (path.startsWith("/v1/blocks/") && path.endsWith("/children")) return response({ results: [], has_more: false });
    if (path.startsWith("/v1/pages/") && init.method !== "POST") {
      const id = path.split("/").pop();
      if (id === IDS.draft) return response({ id, parent: { data_source_id: DS.x }, properties: {} });
      if (id === IDS.context) return response(trainingPage({ kind: "context", platform: "x", feedbackIds: [IDS.alwaysEvent], sourcePages: [], feedbackCutoff: "2026-10-05T00:00:00Z" }));
      if (id === SOURCES.voice || id === SOURCES.constitution || id === SOURCES.x) return response({ id, last_edited_time: "2026-10-01T00:00:00Z", properties: { Name: title("Source") } });
    }
    if (path === "/v1/pages" && init.method === "POST") {
      const body = JSON.parse(String(init.body));
      const properties = body.properties;
      const payloadText = (prop(properties, "Payload") as any).rich_text.map((part: any) => part.text.content).join("");
      const payload = JSON.parse(payloadText);
      return response(trainingPage(payload, IDS.context));
    }
    return response({ results: [], has_more: false });
  });
  try {
    const context = await trainingContext("x", "opening");
    assert.deepEqual(context.feedbackIds, [IDS.alwaysEvent], "only lasting corrections enter the routine context");
    await assert.rejects(() => reportRun({
      draftId: IDS.draft,
      contextId: IDS.context,
      routine: "test-routine",
      feedbackIds: [IDS.onceEvent],
    }), /Report only feedback IDs from this context receipt/);
  } finally { restore(); }
}

async function testComparisons() {
 let payload:any={caseId:'substack-quarry',platform:'substack',title:'A passage',baseline:'First draft',candidate:'Second draft',baselineVersion:'v1',candidateVersion:'v2',aIs:'candidate',status:'pending',sourceSnapshot:'Source',sourceUrl:'',limitations:'Exercise',comparisonKey:'key'};
 let patches=0;
 const restore=withNotionMock((url,init)=>{
   const page=()=>({...trainingPage(payload),properties:{...trainingPage(payload).properties,Kind:select('comparison')}});
   if(init.method==='PATCH'){patches++;payload=JSON.parse(JSON.parse(String(init.body)).properties.Payload.rich_text.map((x:any)=>x.text.content).join(''));return response(page());}
   if(url.pathname.endsWith('/query'))return response({results:[page()],has_more:false});
   return response(page());
 });
 try{
   const pending=(await comparisonState()).pending[0];
   assert.equal(pending.A,'Second draft');assert.equal('aIs' in pending,false);assert.equal('baselineVersion' in pending,false);
   const answer={choice:'B',scope:'always',reason:'Natural ending',preference:'Keep endings plain',digest:pending.digest};
   await assert.rejects(()=>judgeComparison(IDS.context,{...answer,digest:'stale'}),/changed/);
   await assert.rejects(()=>judgeComparison(IDS.context,{...answer,preference:''}),/invalid/);
   assert.equal(patches,0);
   await judgeComparison(IDS.context,answer);assert.equal(payload.winner,'baseline');assert.equal(patches,1);
   await judgeComparison(IDS.context,answer);assert.equal(patches,1);
   await assert.rejects(()=>judgeComparison(IDS.context,{...answer,choice:'A'}),/already answered/);
   const preferences=await comparisonPreferences('substack');assert.equal(preferences[0].preference,'Keep endings plain');assert.equal('baseline' in preferences[0],false);
   assert.deepEqual(await comparisonPreferences('x'),[]);
   await forgetComparisonPreference(IDS.context);assert.deepEqual(await comparisonPreferences('substack'),[]);
   for(const choice of ['both','neither']){payload.status='pending';await judgeComparison(IDS.context,{...answer,scope:'once',choice});assert.equal(payload.winner,choice);assert.equal(payload.preference,'');}
 }finally{restore();}
}

async function main() {
  const restorePayload = withNotionMock(() => response({results:[{type:'code',code:{language:'json',rich_text:rich('{"routine":"cowork","feedbackIds":[]}').rich_text}}],has_more:false}));
  try {
    assert.deepEqual(await readTrainingPayload({id:IDS.context,properties:{Payload:rich('JSON payload in page body')}}),{routine:'cowork',feedbackIds:[]});
    assert.deepEqual(await readTrainingPayload({id:IDS.context,properties:{Payload:rich('training-json: {"routine":"prefix"}')}}),{routine:'prefix'});
  } finally {restorePayload();}
  await testComparisons();
  await testSnapshotParsingOver1900Chars();
  await testWrongDatabaseIdsAreRejected();
  await testStalePreviewDoesNotAppend();
  await testMatchingMarkerRetryDoesNotAppendTwice();
  await testOnceFeedbackCannotBeReportedAsConsumed();
  console.log("Training API mock assertions passed; no live Notion calls were made.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
