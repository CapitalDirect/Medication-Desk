/** Pure search functions usable by a GitHub Pages app or Node, without dependencies. */
export function normalizeName(value) {
 return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
export function buildSearch(index) {
 const byKey=new Map(index.entries.map(e=>[e.key,e]));
 function result(entry,rank) {
  const ids=[...new Set(entry.associations.map(a=>a.target_id))];
  return {key:entry.key,name:entry.display_names[0],alternateSpellings:entry.display_names.slice(1),rank,candidateCount:ids.length,targets:ids.map(id=>index.targets[id]),associations:entry.associations};
 }
 return {
  exact(query) {const e=byKey.get(normalizeName(query));return e ? result(e,0) : null;},
  suggest(query,limit=10) {
   const q=normalizeName(query);if(!q)return [];
   const tokens=q.split(' ');
   return index.entries.map(e=>{
    const words=e.key.split(' ');
    const rank=e.key===q?0:e.key.startsWith(q)?1:tokens.every(t=>words.some(w=>w.startsWith(t)))?2:e.key.includes(q)?3:99;
    return {e,rank};
   }).filter(x=>x.rank<99).sort((a,b)=>a.rank-b.rank||a.e.key.localeCompare(b.e.key)).slice(0,Math.max(0,Math.min(100,limit))).map(x=>result(x.e,x.rank));
  }
 };
}

/** Condition results retain all distinct source/product targets and matched-use evidence. */
export function buildConditionSearch(conditionIndex, nameIndex) {
 function matching(query) {
  const q=normalizeName(query);if(!q)return [];
  const tokens=q.split(' ');
  return conditionIndex.entries.map(e=>{
   const words=e.key.split(' ');
   const rank=e.key===q?0:e.key.startsWith(q)?1:tokens.every(t=>words.some(w=>w.startsWith(t)))?2:e.key.includes(q)?3:99;
   return {e,rank};
  }).filter(x=>x.rank<99).sort((a,b)=>a.rank-b.rank||a.e.key.localeCompare(b.e.key));
 }
 return {
  suggest(query,limit=10){return matching(query).slice(0,Math.max(0,Math.min(100,limit))).map(({e})=>({key:e.key,name:e.label}));},
  search(query){
   const found=new Map();
   for(const {e,rank} of matching(query))for(const a of e.associations){
    const old=found.get(a.target_id)||{target:nameIndex.targets[a.target_id],matches:[],rank,hasPrimary:false};
    old.matches.push({condition:e.label,matchType:a.match_type,evidenceStatus:a.evidence_status,source:a.source});
    old.hasPrimary ||= a.match_type==='primary';old.rank=Math.min(old.rank,rank);found.set(a.target_id,old);
   }
   return [...found.values()].sort((a,b)=>Number(b.hasPrimary)-Number(a.hasPrimary)||a.rank-b.rank||a.target.display_name.localeCompare(b.target.display_name));
  }
 };
}
