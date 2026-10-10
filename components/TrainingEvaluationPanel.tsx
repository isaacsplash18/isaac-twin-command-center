'use client';

import { useEffect, useRef, useState } from 'react';
import { FrameCard } from './FrameCard';
import { useApi } from './useApi';

type Choice = 'A' | 'B' | 'both' | 'neither';
type Comparison = {
  id: string; title: string; platform: string; A: string; B: string; digest: string;
  sourceSnapshot: string; sourceUrl?: string; choice?: Choice; reason?: string;
  scope?: 'once' | 'always'; preference?: string; judgedAt?: string;
  baselineVersion?: string; candidateVersion?: string; aIs?: string; limitations?: string;
};
type Legacy = { id: string; caseId: string; baseline: string; candidate: string; baselineVersion: string; candidateVersion: string; winner: string; notes: string; createdAt: string };
type Data = {pending?: Comparison[]; completed?: Comparison[]; evaluations: Legacy[]};
type Answer = { choice: Choice | ''; reason: string; scope: 'once' | 'always'; preference: string };
const initial: Answer = {choice: '', reason: '', scope: 'once', preference: ''};
const choices: [Choice, string][] = [['A', 'Prefer A'], ['B', 'Prefer B'], ['both', 'Both good'], ['neither', 'Neither']];
const field = 'w-full rounded-lg border border-hairline bg-ground px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-oxbright';
const label = (c?: Choice) => choices.find(([key]) => key === c)?.[1] ?? 'Saved';

export function TrainingEvaluationPanel({index}: {index:number}) {
  const {data,error,loading,refresh,setData}=useApi<Data>('/api/training/evaluations',120000);
  const [message,setMessage]=useState('');
  const [forgotten,setForgotten]=useState<string[]>([]);
  const [forgetting,setForgetting]=useState<string|null>(null);
  const pending=data?.pending??[], completed=data?.completed??[], legacy=data?.evaluations??[];
  const current=pending[0];
  async function forget(id:string){
    setForgetting(id);
    try{const r=await fetch(`/api/training/comparisons/${id}`,{method:'DELETE'});const b=await r.json();if(!r.ok)throw Error(b.error||'Could not update preference');setForgotten(v=>[...v,id]);setMessage('Preference removed from future drafting context. Your judgment remains in history.');await refresh();}
    catch(e){setMessage(e instanceof Error?e.message:'Could not update preference');}
    finally{setForgetting(null);}
  }
  function saved(result:Comparison){
    setData(d=>d?{...d,pending:(d.pending??[]).filter(c=>c.id!==result.id),completed:[result,...(d.completed??[]).filter(c=>c.id!==result.id)]}:d);
    setMessage(result.scope==='always'?'Saved. Your preference is available to future routines when they next read training context.':'Saved for this comparison. No lasting preference was added.');
    void refresh();
  }
  return <FrameCard index={index} className="p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="panel-heading">Train with comparisons</h2><p className="mt-2 max-w-2xl text-sm text-ink-dim">Pick what sounds like you. Tell your twin what made the difference.</p></div><span className="rounded-full border border-hairline px-3 py-1 text-xs text-ink-dim">{pending.length} to review · {completed.length+legacy.length} completed</span></div>
    {error&&<div role="alert" className="mt-4 text-sm text-oxbright">Could not load comparisons: {error} <button className="btn btn-secondary" onClick={()=>refresh()}>Retry</button></div>}
    {message&&<p role="status" className="mt-4 rounded-lg border border-hairline p-3 text-sm">{message}</p>}
    {loading&&!data&&<p role="status" className="mt-4 text-sm">Loading your comparisons…</p>}
    {current?<Review key={current.id+current.digest} comparison={current} remaining={pending.length} onSaved={saved}/>:data&&<div className="my-6 rounded-xl border border-hairline bg-ground p-6"><h3 className="text-lg font-medium">You’re caught up</h3><p className="mt-2 text-sm text-ink-dim">New comparisons from your Claude routines will appear here. Your completed choices and remembered preferences are below.</p><button className="btn btn-secondary mt-4" disabled={loading} onClick={()=>refresh()}>{loading?'Checking…':'Check for comparisons'}</button></div>}
    <details className="mt-6 border-t border-hairline pt-4"><summary className="cursor-pointer text-sm font-medium">Your evaluation history ({completed.length+legacy.length})</summary>
      {!completed.length&&!legacy.length&&<p className="mt-3 text-sm text-ink-dim">Your first choice will appear here.</p>}
      {completed.map(c=><article key={c.id} className="mt-4 rounded-lg border border-hairline p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{c.title}</h3><span className="text-sm text-ink-dim">{label(c.choice)}</span></div>{c.reason&&<p className="mt-2 whitespace-pre-wrap text-sm">{c.reason}</p>}{c.preference&&<div className="mt-3 rounded-lg bg-ground p-3 text-sm"><p className="font-medium">{c.scope==='always'&&!forgotten.includes(c.id)?'Remembered preference':'Preference no longer active'}</p><p className="mt-1 whitespace-pre-wrap">{c.preference}</p>{c.scope==='always'&&!forgotten.includes(c.id)&&<button className="btn btn-secondary mt-3" disabled={forgetting===c.id} onClick={()=>forget(c.id)}>{forgetting===c.id?'Updating…':'Stop remembering this'}</button>}</div>}<details className="mt-3 text-sm"><summary className="cursor-pointer text-ink-dim">View drafts and methods</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><Draft name="A" text={c.A}/><Draft name="B" text={c.B}/></div><p className="mt-3 text-xs text-ink-dim">A: {c.aIs==='baseline'?c.baselineVersion:c.candidateVersion} · B: {c.aIs==='baseline'?c.candidateVersion:c.baselineVersion}</p>{c.limitations&&<p className="mt-2 text-xs text-ink-dim">{c.limitations}</p>}</details></article>)}
      {legacy.map(e=><article key={e.id} className="mt-4 rounded-lg border border-hairline p-4"><h3 className="font-medium">Earlier comparison · {e.caseId.replaceAll('-',' ')}</h3><p className="mt-1 text-xs text-ink-dim">{e.winner==='tie'?'Tie':`${e.winner==='baseline'?e.baselineVersion:e.candidateVersion} preferred`}</p><p className="mt-2 whitespace-pre-wrap text-sm">{e.notes}</p><details className="mt-3 text-sm"><summary className="cursor-pointer">View the two drafts</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><Draft name={e.baselineVersion} text={e.baseline}/><Draft name={e.candidateVersion} text={e.candidate}/></div></details></article>)}
    </details>
    <p className="mt-4 text-xs text-ink-dim">Choices guide future drafting; they don’t publish either draft. History shows up to 300 recent records per type. Once used for training, these comparisons are not independent benchmarks.</p>
  </FrameCard>;
}
function Draft({name,text}:{name:string;text:string}){
  return <section aria-label={`Draft ${name}`} className="min-w-0 rounded-xl border border-hairline bg-ground p-4 sm:p-5"><h4 className="font-mono text-xs uppercase tracking-widest text-ink-dim">{name}</h4><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">{text}</p></section>;
}
function Review({comparison:c,remaining,onSaved}:{comparison:Comparison;remaining:number;onSaved:(c:Comparison)=>void}){
  const [answer,setAnswer]=useState<Answer>(initial),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submitting=useRef(false);
  const key=`twin-comparison:${c.id}:${c.digest}`;
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&['','A','B','both','neither'].includes(saved.choice)&&['once','always'].includes(saved.scope)&&typeof saved.reason==='string'&&typeof saved.preference==='string')setAnswer(saved);}catch{}setReady(true);},[key]);
  useEffect(()=>{if(ready)try{localStorage.setItem(key,JSON.stringify(answer));}catch{}},[answer,key,ready]);
  const update=(values:Partial<Answer>)=>setAnswer(a=>({...a,...values}));
  async function submit(e:React.FormEvent){
    e.preventDefault();if(submitting.current||!answer.choice)return;submitting.current=true;setBusy(true);setError('');
    try{const r=await fetch(`/api/training/comparisons/${c.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...answer,digest:c.digest})});const b=await r.json();if(!r.ok)throw Error(b.error||'Could not save your choice');try{localStorage.removeItem(key);}catch{}onSaved(b.result);}
    catch(e){setError(e instanceof Error?e.message:'Could not save your choice');}
    finally{submitting.current=false;setBusy(false);}
  }
  return <form onSubmit={submit} className="mt-6">
    <div className="mb-4"><p className="font-mono text-xs uppercase tracking-wider text-ink-dim">{c.platform} · Next of {remaining}</p><h3 className="mt-2 text-lg font-medium">{c.title}</h3></div>
    <div className="grid gap-4 md:grid-cols-2"><Draft name="A" text={c.A}/><Draft name="B" text={c.B}/></div>
    <details className="mt-3 text-sm text-ink-dim"><summary className="cursor-pointer">Read the source passage</summary><p className="mt-3 whitespace-pre-wrap">{c.sourceSnapshot}</p>{c.sourceUrl&&<a className="mt-2 inline-block underline" target="_blank" rel="noreferrer" href={c.sourceUrl}>Open source in Notion ↗</a>}</details>
    <fieldset disabled={busy||!ready} className="mt-6"><legend className="text-sm font-medium">Which would you choose?</legend><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{choices.map(([value,title])=><button key={value} type="button" aria-pressed={answer.choice===value} onClick={()=>update({choice:value})} className={`btn min-h-12 ${answer.choice===value?'btn-primary':'btn-secondary'}`}>{title}</button>)}</div>
    <label className="mt-5 block text-sm">What made the difference? <span className="text-ink-dim">(optional)</span><textarea rows={3} maxLength={4000} className={`${field} mt-2`} placeholder="For example: B’s last sentence sounds more natural." value={answer.reason} onChange={e=>update({reason:e.target.value})}/></label>
    <fieldset className="mt-4"><legend className="text-sm font-medium">How should this feedback be used?</legend><div className="mt-2 flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="radio" name={`scope-${c.id}`} checked={answer.scope==='once'} onChange={()=>update({scope:'once'})}/>This comparison only</label><label className="flex items-center gap-2"><input type="radio" name={`scope-${c.id}`} checked={answer.scope==='always'} onChange={()=>update({scope:'always'})}/>Remember a preference</label></div></fieldset>
    {answer.scope==='always'&&<label className="mt-4 block text-sm">What should future {c.platform} drafts do?<textarea required maxLength={2000} rows={2} className={`${field} mt-2`} placeholder="Write the specific preference you want remembered." value={answer.preference} onChange={e=>update({preference:e.target.value})}/><span className="mt-2 block text-xs text-ink-dim">Only this instruction becomes a lasting preference. The two example drafts stay out of drafting context. You can stop remembering it from history.</span></label>}
    <button type="submit" className="btn btn-primary mt-5" disabled={!answer.choice||(answer.scope==='always'&&!answer.preference.trim())}>{busy?'Saving…':remaining>1?'Save and next':'Save evaluation'}</button></fieldset>
    {error&&<p role="alert" className="mt-3 text-sm text-oxbright">{error} Your answer is kept here so you can retry.</p>}
    <p className="mt-3 text-xs text-ink-dim">Unsubmitted answers are saved on this browser. Submitted choices are saved in Notion.</p>
  </form>;
}
