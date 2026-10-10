import { config } from 'dotenv';
config({ path: '.env.training.local' });
import { notionFetch, listBlocks, plainText } from '../lib/notion';
const hub='3651fec9-ef83-811b-a9ec-f530474ec779';
async function main(){
 for(const [env,properties] of Object.entries({
  DS_CALIBRATION_EVENTS:{'Feedback Scope':{select:{options:['once','always','unspecified'].map(name=>({name}))}},'Feedback Reason':{rich_text:{}}},
  DS_PROPOSALS:{'Applied URL':{url:{}},'Applied At':{date:{}},'Applied Revision':{rich_text:{}}}
 })){
  const id=process.env[env]; if(!id)throw new Error(`${env} is required`);
  const ds=await notionFetch(`/data_sources/${id}`);
  const missing=Object.fromEntries(Object.entries(properties).filter(([key])=>!ds.properties[key]));
  if(Object.keys(missing).length)await notionFetch(`/data_sources/${id}`,{method:'PATCH',body:JSON.stringify({properties:missing})});
  console.log(`${env}: ready`);
 }
 const blocks=await listBlocks(hub);
 const existing=blocks.find(b=>b.type==='child_database'&&b.child_database.title==='Training Records');
 let db;
 if(existing)db=await notionFetch(`/databases/${existing.id}`);
 else db=await notionFetch('/databases',{method:'POST',body:JSON.stringify({parent:{type:'page_id',page_id:hub},title:[{type:'text',text:{content:'Training Records'}}],initial_data_source:{properties:{Name:{title:{}},Kind:{select:{options:['context','run','evaluation','comparison'].map(name=>({name}))}},Payload:{rich_text:{}}}}})});
 const ds=db.data_sources?.[0]?.id;if(!ds)throw new Error('No training data source');
 const schema=await notionFetch(`/data_sources/${ds}`);
 const options=schema.properties.Kind.select.options;
 if(!options.some((o:any)=>o.name==='comparison'))await notionFetch(`/data_sources/${ds}`,{method:'PATCH',body:JSON.stringify({properties:{Kind:{select:{options:[...options,{name:'comparison'}]}}}})});
 console.log(`DS_TRAINING=${ds}`);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
