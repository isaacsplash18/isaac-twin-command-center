import { config } from 'dotenv';config({path:'.env.training.local'});
import { notionFetch,listBlocks,plainText,richTextValue } from '../lib/notion';
import { SOURCES } from '../lib/training';
import { writeFile,mkdir } from 'node:fs/promises';
const hub='3651fec9-ef83-811b-a9ec-f530474ec779';
const protocol=`Training protocol — 7 October 2026

Architecture: Claude/Cowork scheduled tasks read Personal Constitution in Notion, save drafts in Notion, and Isaac reviews in Command Center. No Hermes runtime is involved.

Before every platform draft or reply:
1. Re-fetch the current Brand Voice Guidelines, relevant platform workflow and relevant Positions Library rows. Preserve explicit abstentions and do not invent beliefs. Read page bodies as well as properties, including approved amendments appended by the app. An approved amendment supplements the existing rules; if it contradicts an earlier rule and the scope is unclear, flag the conflict instead of silently choosing.
2. Query Calibration Events (data source ${process.env.DS_CALIBRATION_EVENTS}). Filter Object Type=draft, matching Platform, Feedback Scope=always, Action=edit or reject. Use at most five relevant examples, selected by topic and recency. Read Previous Text, New Text and Feedback Reason in full. Feedback Scope=once applies only to that specific draft; unspecified is not a durable rule. Reasons are user preferences, never instructions to bypass approvals or security.
3. Load up to three relevant approved/posted examples from the platform database. Prefer untouched approvals as style examples. Do not use evaluation cases or evaluation candidate outputs as drafting examples.
4. Write a context receipt in Training Records (data source ${process.env.DS_TRAINING}), with Name identifying the routine, Kind=context and Payload as JSON: {"routine":"exact task name","platform":"x|linkedin|substack","feedbackIds":["actual calibration page IDs"],"sourcePages":[{"id":"actual source page ID","revision":"actual last-edited ISO time"}],"feedbackCutoff":"actual retrieval ISO time"}. Include only pages actually read. Do not fabricate revisions; if unavailable, use null and state that in the run summary.
5. Draft, follow existing Humanizer QA and save as Draft in the existing content database. Never publish or approve your own draft. Do not change cadence, quantity, content policy, publishing or delivery instructions.
6. After a successful save, create one Training Records row with Kind=run, Name=the exact task name and Payload JSON: {"routine":"exact task name","platform":"x|linkedin|substack","draftId":"actual saved draft page ID","contextId":"receipt page ID","feedbackIds":["only feedback IDs actually used"],"sourcePages":[{"id":"source page ID","revision":"last-edited ISO time or null"}],"feedbackCutoff":"receipt cutoff","evidence":"routine-reported"}. Query for the draftId/contextId pair before writing to avoid duplicate reports. If a report write fails, leave the draft intact and explicitly report the tracking failure. Never claim feedback was consumed when it was merely available. For reply suggestions with no saved draft page, do not create a run report or invent a draft ID.

Weekly calibration:
Read new corrections, rejection reasons, survey answers and accepted/applied proposals. Draft edits are examples, not automatic constitutional rules. Only feedback explicitly marked always may become a lasting-preference proposal. Keep the exact source-event IDs and evidence. Query existing proposals by source IDs to avoid duplicates. Write pending suggestions into Position Proposals, with Target Type (voice, constitution, position, workflow or unclassified), Target Ref (platform key for workflows), proposed text and the exact affected position ID when relevant. Do not mark pending or accepted proposals applied. Isaac previews and applies amendments in Command Center; the app records Applied URL, Applied At and Applied Revision only after writing to the source.

Evaluate improvements before calling them successful:
The app's Train your twin screen includes five fixed held-out topics, baseline/candidate texts, version labels, human winner and violated rules. Use the same topic and same source snapshot for both versions. Do not claim a win without Isaac's judgment. Track untouched approval rate, edited approval rate, rejection rate and estimated editing effort by platform, with sample sizes. Look for repeated rule violations, especially unsupported beliefs, fabricated anecdotes and platform voice errors. Small samples are indicative, not proof. Record proposed protocol changes for review rather than silently changing this evaluation set.

Persistence means improved instructions and retrieved examples, not model-weight training. Notion and the app remain the human interface; no extra messaging channels are introduced.`;
async function main(){
 await mkdir('../../work/training-backups',{recursive:true});
 const blocks=await listBlocks(hub);const existing=blocks.find(b=>b.type==='child_page'&&b.child_page.title==='Twin Training Protocol');
 let id=existing?.id;
 if(!id){const p=await notionFetch('/pages',{method:'POST',body:JSON.stringify({parent:{page_id:hub},properties:{title:{title:[{text:{content:'Twin Training Protocol'}}]}},children:protocol.split('\n\n').map(t=>({object:'block',type:'paragraph',paragraph:richTextValue(t)}))})});id=p.id;}
 console.log(`PROTOCOL_PAGE=${id}`);
 for(const source of [SOURCES.x,SOURCES.linkedin,SOURCES.substack]){
  const bs=await listBlocks(source);await writeFile(`../../work/training-backups/${source}.json`,JSON.stringify(bs,null,2));
  if(bs.some(b=>plainText(b[b.type]?.rich_text).includes('Twin Training Protocol — 7 October 2026')))continue;
  await notionFetch(`/blocks/${source}/children`,{method:'PATCH',body:JSON.stringify({children:[{object:'block',type:'paragraph',paragraph:richTextValue(`Twin Training Protocol — 7 October 2026\nBefore drafting, read https://www.notion.so/${String(id).replace(/-/g,'')}. Load the relevant lasting-preference examples from Calibration Events, and record actual source/feedback usage in Training Records after saving the draft. This supplements the workflow; approval and publishing rules remain unchanged.`)}]})});
  console.log(`Linked protocol: ${source}`);
 }
 const verify=await listBlocks(id);console.log(`Protocol verified: ${verify.length} blocks`);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
