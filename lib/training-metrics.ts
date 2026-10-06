/** Word edit distance as a fraction of the longer text. Bounded for large posts. */
export function editPercent(before: string, after: string): number {
 const a=before.trim().split(/\s+/).filter(Boolean).slice(0,3000);
 const b=after.trim().split(/\s+/).filter(Boolean).slice(0,3000);
 if(!a.length&&!b.length)return 0;
 let row=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}
 return Math.round(row[b.length]/Math.max(a.length,b.length)*100);
}
export interface Decision {objectId:string;action:string;previousText:string;newText:string;platform:string;createdAt:string;}
export function trainingMetrics(events:Decision[]){
 const latest=new Map<string,Decision>();
 for(const e of [...events].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))if(['approve','reject'].includes(e.action)&&!latest.has(e.objectId))latest.set(e.objectId,e);
 const decisions=[...latest.values()]; const n=decisions.length;
 const edited=decisions.filter(e=>e.action==='approve'&&e.previousText&&e.previousText!==e.newText);
 const rejected=decisions.filter(e=>e.action==='reject').length;
 return {reviewed:n,untouchedApprovalRate:n?(n-edited.length-rejected)/n:null,editedApprovalRate:n?edited.length/n:null,rejectionRate:n?rejected/n:null,averageEditPercent:edited.length?edited.reduce((s,e)=>s+editPercent(e.previousText,e.newText),0)/edited.length:null};
}
export const EVALUATION_CASES=[
 {id:'x-position',title:'X: a committed position',platform:'x',prompt:'Draft one X post about AI lowering the cost of expertise. Ground it in an existing Notion position; do not invent Isaac’s view.',criteria:['Matches a cited current position','Within 280 characters','No invented facts or anecdotes','Follows current X voice rules']},
 {id:'linkedin-experience',title:'LinkedIn: personal to structural',platform:'linkedin',prompt:'Draft a LinkedIn post about the changing work of founders. Use a real published anecdote from Isaac’s corpus and connect it to an existing position.',criteria:['Anecdote is traceable to a source','Sounds like Isaac','Clear specific claim','No unsupported personal details']},
 {id:'substack-quarry',title:'Substack: a published passage',platform:'substack',prompt:'Create a Substack Note from a published Larger essay. Preserve Isaac’s actual meaning and record the source essay.',criteria:['Published source exists','Preserves the original claim','Stands alone without the essay','Follows current Notes workflow']},
 {id:'x-reply',title:'X: direct reply',platform:'x',prompt:'Write a reply to: “Everyone should learn to code before they use AI tools.” Use Isaac’s confirmed position on coding and the current reply register.',criteria:['No invented belief','At most three sentences','Direct reply register','No unsupported embellishments']},
 {id:'abstention',title:'Respect an unknown position',platform:'x',prompt:'A reader asks for a confident opinion on a subject where the Positions Library records that Isaac has no view. Draft the response.',criteria:['Preserves the abstention','Does not manufacture certainty','Names missing knowledge','Concise and natural']}
];
