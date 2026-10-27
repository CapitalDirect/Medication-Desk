import {buildSearch,buildConditionSearch,normalizeName} from './search.mjs';
const $=id=>document.getElementById(id),q=$('query'),list=$('suggestions'),results=$('results'),status=$('status'),dialog=$('detail');
let names,conditions,data,nameSearch,conditionSearch,records,entities,mode='medication',suggestions=[],active=-1,current=[],shown=0,lastScroll=0;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unique=a=>[...new Set(a.filter(Boolean))];
document.querySelector('.welcome')?.remove();
const footer=document.querySelector('footer');footer.querySelector(':scope > p')?.remove();
footer.querySelector('summary').textContent='Reference notes';
footer.querySelector('details p').textContent='Tier estimates are not verified plan coverage. Uses do not establish a diagnosis or eligibility. Some source statements and aliases remain unverified. Medication lists and notes are temporary and clear on refresh or leaving the page.';
// Appointment worksheet is intentionally memory-only: no storage or network writes.
const selected=new Map();
const workspace=document.createElement('div');workspace.className='workspace';
const lookup=document.createElement('section');lookup.className='lookup';lookup.setAttribute('aria-label','Medication lookup');
document.querySelector('.search-panel').before(workspace);
workspace.append(lookup);lookup.append(document.querySelector('.search-panel'),status,results);
const sidebar=document.createElement('aside');sidebar.className='medication-sidebar';sidebar.setAttribute('aria-labelledby','selected-heading');
sidebar.innerHTML='<div class="sidebar-heading"><h2 id="selected-heading">Medication list <span id="selected-count">0</span></h2></div><p id="selection-status" role="status" aria-live="polite"></p><div id="selected-list"><p class="list-empty">Add medications from your search results.</p></div>';
workspace.append(sidebar);
function selectable(t){return t&&!['source_reference_group','ambiguous_family'].includes(t.kind);}
function selectButton(t){return selectable(t)?`<button type="button" class="subtle add-med" data-add="${esc(t.id)}" ${selected.has(t.id)?'disabled':''}>${selected.has(t.id)?'Added to list':'＋ Add to list'}</button>`:'<p class="help">Choose a specific medication record to add it to your list.</p>';}
function syncSelectionButtons(){document.querySelectorAll('[data-add]').forEach(b=>{const added=selected.has(b.dataset.add);b.disabled=added;b.textContent=added?'Added to list':'＋ Add to list';});$('selected-count').textContent=selected.size;}
function addMedication(id){
 const t=names.targets[id];if(!selectable(t)||selected.has(id))return;
 selected.set(id,{dosage:'',frequency:'',refill:'',notes:''});
 $('selected-list').querySelector('.list-empty')?.remove();
 const entry=document.createElement('details');entry.className='selected-med';entry.dataset.selected=id;
 entry.innerHTML=`<summary class="selected-title"><button type="button" class="selected-name" data-reference="${esc(id)}" aria-label="View reference for ${esc(t.display_name)}">${esc(t.display_name)}</button><span class="collapse-arrow" aria-hidden="true">›</span><button type="button" class="remove-med" data-remove="${esc(id)}" aria-label="Remove ${esc(t.display_name)}">×</button></summary><div class="selected-fields"><p class="help">${esc(t.formulation||'Formulation not specified — confirm with client')}</p>${[['dosage','Strength / dosage','e.g., 20 mg, 1 tablet'],['frequency','How often taken','e.g., Twice daily'],['refill','Quantity / refill interval','e.g., 180 tablets every 3 months'],['notes','Notes / explanation','Optional explanation']].map(([key,title,placeholder])=>`<label>${title}<textarea rows="${key==='notes'?2:1}" data-entry-field="${key}" placeholder="${placeholder}" autocomplete="off" spellcheck="false"></textarea></label>`).join('')}<p class="help collapse-hint">Click the box to collapse. Click the name for reference details.</p></div>`;
 $('selected-list').append(entry);syncSelectionButtons();$('selection-status').textContent=`${t.display_name} added.`;
}
sidebar.addEventListener('input',ev=>{const key=ev.target.dataset.entryField;if(key){const item=selected.get(ev.target.closest('[data-selected]').dataset.selected);if(item)item[key]=ev.target.value;}});
sidebar.addEventListener('click',ev=>{
 if(ev.target.closest('[data-remove],[data-reference]'))ev.preventDefault();
 const remove=ev.target.closest('[data-remove]');if(remove){const id=remove.dataset.remove,item=selected.get(id);if(!item)return;if(Object.values(item).some(Boolean)&&!confirm('Remove this medication and its entered notes?'))return;selected.delete(id);remove.closest('[data-selected]').remove();if(!selected.size)$('selected-list').innerHTML='<p class="list-empty">Search for a medication, then choose Add to list.</p>';syncSelectionButtons();$('selection-status').textContent='Medication removed.';}
 const ref=ev.target.closest('[data-reference]');if(ref){openDetail(ref.dataset.reference);return;}
 const entry=ev.target.closest('details.selected-med');
 if(entry&&!ev.target.closest('summary,button,input,textarea,label,a,select'))entry.open=!entry.open;
});
document.addEventListener('click',ev=>{const add=ev.target.closest('[data-add]');if(add)addMedication(add.dataset.add);});
// Back/forward cache must not retain one appointment's worksheet for the next.
window.addEventListener('pagehide',()=>{selected.clear();$('selected-list').innerHTML='<p class="list-empty">Search for a medication, then choose Add to list.</p>';syncSelectionButtons();$('selection-status').textContent='';});
const sourceFields=t=>(t.source_record_ids||[]).map(id=>records.get(id)).filter(Boolean);
const entity=t=>entities.get(t.normalized_entity_id||t.id);
const glanceCache=new Map();
function glanceInfo(t){
 if(glanceCache.has(t.id))return glanceCache.get(t.id);
 const e=entity(t),rs=sourceFields(t),related=relatedReferences(t),fields=rs.map(r=>r.fields);
 const collect=key=>unique(fields.map(f=>f[key])).join('\n');
 const values=key=>unique([...fields,...related.map(r=>r.fields)].map(f=>f[key])).join('\n');
 const brands=e?e.brand_names:unique(fields.flatMap(f=>[f.brand_names_raw,f.name_type==='Brand'?f.name:''].filter(Boolean)));
 const generic=e?.ingredient_name||collect('generic_name_raw')||fields.find(f=>f.name_type==='Generic')?.name||related[0]?.fields.generic_name_raw||'';
 const guide=data.source_snapshots.find(s=>s.source_id==='spelling-guide')?.sheets.find(s=>s.name==='Life UW Guide');
 const needles=unique([t.display_name,generic,...rs.flatMap(r=>(r.fields.matching_names_raw||'').split(','))]).map(normalizeName).filter(n=>n.length>3);
 const rows=(guide?.rows||[]).filter(r=>r.row>4&&Object.entries(r.cells).some(([c,v])=>c.startsWith('B')&&needles.some(n=>(' '+normalizeName(v)+' ').includes(' '+n+' '))));
 const info={brands:unique([...brands,...related.map(r=>r.fields.brand_names_raw)].flatMap(v=>(v||'').split(',').map(s=>s.trim()))),generic,primary:e?.uses_summary||collect('primary_condition')||'Not listed',other:e?.other_verified_uses?.join('; ')||(!e?values('other_common_uses'):'')||'Not listed',drugClass:values('drug_class')||'Not listed',category:collect('category'),route:t.route,questions:unique(rows.map(r=>r.cells['E'+r.row])).join('\n')||'No medication-specific questions listed.'};
 glanceCache.set(t.id,info);return info;
}
function glanceHTML(t){const g=glanceInfo(t);return `<dl>${field('Brand names',g.brands.join('; ')||'Not listed')}${field('Ingredient / generic',g.generic||'Not listed')}${field('Primary condition / use',g.primary)}${field('Other listed uses',g.other)}${field('Drug class',g.drugClass)}${field('Category',g.category)}${field('Route',g.route)}${field('Questions to ask',g.questions)}</dl>`;}
let browseRows=[],browseShown=0,browseTargets,primaryGroups;
const browseControls=document.createElement('div');browseControls.id='browse-controls';browseControls.hidden=true;
browseControls.innerHTML='<label for="browse-view">Browse by</label><select id="browse-view"><option value="all">All medications</option><option value="brand">Brand name</option><option value="class">Drug class</option><option value="condition">Primary condition</option></select><label for="browse-group" id="browse-group-label" hidden>Group</label><select id="browse-group" hidden></select>';
$('search-form').after(browseControls);
$('browse-view').addEventListener('change',()=>renderBrowse(true));$('browse-group').addEventListener('change',()=>renderBrowse(false));
function renderBrowse(resetGroup=true){
 if(!names){status.textContent='Loading medication library…';return;}
 browseTargets??=Object.values(names.targets).filter(t=>t.kind!=='source_reference_group');
 if(!primaryGroups){primaryGroups=new Map();for(const entry of conditions.entries)for(const a of entry.associations)if(a.match_type==='primary'){if(!primaryGroups.has(a.target_id))primaryGroups.set(a.target_id,[]);primaryGroups.get(a.target_id).push(entry.label);}}
 const view=$('browse-view').value;const rows=[];
 for(const t of browseTargets){const g=glanceInfo(t);
  if(view==='brand'){
   const brands=t.name_type_as_reported==='Brand'?[t.display_name]:t.kind.startsWith('reviewed_')?g.brands:[];
   for(const brand of brands)rows.push({target:t,name:brand,group:brand[0]?.toUpperCase()||'#'});
  }else{const groups=view==='class'?g.drugClass.split('\n'):view==='condition'?(primaryGroups.get(t.id)||['Not listed']):[''];for(const group of view==='all'?groups:unique(groups))rows.push({target:t,name:t.display_name,group});}
 }
 rows.sort((a,b)=>a.group.localeCompare(b.group,undefined,{sensitivity:'base'})||a.name.localeCompare(b.name,undefined,{sensitivity:'base'})||a.target.id.localeCompare(b.target.id));
 const grouped=view!=='all';$('browse-group').hidden=!grouped;$('browse-group-label').hidden=!grouped;
 if(resetGroup){$('browse-group').innerHTML='<option value="">All groups</option>'+unique(rows.map(r=>r.group)).map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join('');}
 const group=$('browse-group').value;browseRows=grouped&&group?rows.filter(r=>r.group===group):rows;browseShown=0;
 results.innerHTML='<div class="result-heading"><h2>Medication library</h2><span id="browse-count"></span></div><div id="browse-list"></div><button id="browse-more" class="subtle show-more">Show more</button>';
 $('browse-more').addEventListener('click',appendBrowse);appendBrowse();status.textContent=`${browseRows.length} ${view==='brand'?'brand listings':'medication records'}`;
}
function appendBrowse(){
 const end=Math.min(browseShown+50,browseRows.length);let html='';
 for(let i=browseShown;i<end;i++){const row=browseRows[i],t=row.target,g=glanceInfo(t);
  if(row.group&&(i===0||browseRows[i-1].group!==row.group))html+=`<h3 class="browse-group-heading">${esc(row.group)}</h3>`;
  html+=`<details class="browse-item" data-browse-id="${esc(t.id)}"><summary><button type="button" class="browse-name" data-open-reference="${esc(t.id)}">${esc(row.name)}</button><span class="browse-generic">${esc(g.generic)}</span><span class="browse-use">${esc(g.primary)}</span><span class="browse-arrow" aria-hidden="true">›</span></summary><div class="browse-glance"></div></details>`;
 }
 $('browse-list').insertAdjacentHTML('beforeend',html);browseShown=end;$('browse-more').hidden=end>=browseRows.length;$('browse-count').textContent=`Showing ${end} of ${browseRows.length}`;
 if(!browseRows.length)$('browse-list').innerHTML='<p class="help">No listed medications in this view.</p>';
}
results.addEventListener('toggle',ev=>{const row=ev.target;if(!row.matches('details.browse-item')||!row.open||row.dataset.built)return;const t=names.targets[row.dataset.browseId];row.querySelector('.browse-glance').innerHTML=glanceHTML(t)+`<div class="browse-actions"><button class="subtle" data-open-reference="${esc(t.id)}">Full reference ↗</button>${selectButton(t)}</div>`;row.dataset.built='true';},true);
results.addEventListener('click',ev=>{const ref=ev.target.closest('[data-open-reference]');if(ref){ev.preventDefault();openDetail(ref.dataset.openReference);}});
function relatedReferences(t){
 if(t.kind!=='source_name_record')return [];
 const key=normalizeName(t.display_name);
 return data.records.filter(r=>r.record_type==='reference'&&names.targets[r.id]&&([r.fields.generic_name_raw,...r.fields.brand_names_raw.split(',')].some(v=>normalizeName(v)===key)));
}
function targetSummary(t){const e=entity(t),r=sourceFields(t)[0];return e?.uses_summary||r?.fields.primary_condition||'Choose a specific product to continue.';}
function label(t){return t.kind==='source_reference_group'?'Reference context':t.kind==='ambiguous_family'?'Product family · choose a formulation':t.kind==='reviewed_product'?'Reviewed product':t.kind==='reviewed_ingredient_formulation'?'Reviewed name relationship':t.name_type_as_reported||'Medication';}
function closeSuggestions(){list.hidden=true;q.setAttribute('aria-expanded','false');q.removeAttribute('aria-activedescendant');active=-1;}
function suggestionsForInput(){
 $('clear').hidden=!q.value;
 suggestions=mode==='medication'?nameSearch.suggest(q.value,10):conditionSearch.suggest(q.value,10);
 active=-1;
 list.innerHTML=suggestions.map((s,i)=>{const subtitle=mode==='condition'?'Condition or use':unique((s.targets||[]).map(t=>t.kind==='source_reference_group'?'Reference context':t.kind==='ambiguous_family'?'Product family':t.name_type_as_reported||t.ingredient||t.display_name)).slice(0,3).join(' · ');return `<li id="suggestion-${i}" role="option" aria-selected="false" data-index="${i}">${esc(s.name)}<small>${esc(subtitle)}</small></li>`;}).join('');
 list.hidden=!suggestions.length;q.setAttribute('aria-expanded',String(!list.hidden));
}
function choose(i){if(!suggestions[i])return;q.value=suggestions[i].name;$('clear').hidden=false;closeSuggestions();q.focus();}
list.addEventListener('click',e=>{const item=e.target.closest('[data-index]');if(item)choose(Number(item.dataset.index));});
q.addEventListener('input',suggestionsForInput);
q.addEventListener('keydown',e=>{
 if(e.key==='Escape'){closeSuggestions();return;}
 if(e.key==='ArrowDown'||e.key==='ArrowUp'){
  e.preventDefault();if(list.hidden)suggestionsForInput();if(!suggestions.length)return;
  active=active<0?(e.key==='ArrowDown'?0:suggestions.length-1):(active+(e.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length;
  [...list.children].forEach((li,i)=>{li.classList.toggle('active',i===active);li.setAttribute('aria-selected',String(i===active));});
  q.setAttribute('aria-activedescendant',`suggestion-${active}`);list.children[active].scrollIntoView({block:'nearest'});
 }else if(e.key==='Tab'&&!list.hidden&&active>=0){e.preventDefault();choose(active);}
 else if(e.key==='Enter'&&!list.hidden&&active>=0){choose(active);}
});
document.addEventListener('click',e=>{if(!e.target.closest('.input-wrap'))closeSuggestions();});
$('clear').addEventListener('click',()=>{q.value='';$('clear').hidden=true;closeSuggestions();q.focus();});
for(const tab of document.querySelectorAll('[role=tab]')){
 tab.addEventListener('click',()=>switchMode(tab.dataset.mode));
 tab.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const modes=['medication','condition','browse'];const next=modes[(modes.indexOf(mode)+(e.key==='ArrowRight'?1:2))%3];switchMode(next);$(next+'-tab').focus();}});
}
function switchMode(next){mode=next;document.querySelectorAll('[role=tab]').forEach(t=>{const on=t.dataset.mode===mode;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});$('search-form').hidden=mode==='browse';browseControls.hidden=mode!=='browse';closeSuggestions();if(mode==='browse'){renderBrowse(true);return;}$('search-label').textContent=mode==='medication'?'Medication name':'Primary condition or other use';q.placeholder=mode==='medication'?'Try a brand or generic name…':'Try asthma, diabetes or heart failure…';q.value='';$('clear').hidden=true;status.textContent=mode==='medication'?'Search by a brand name, ingredient or alias.':'Primary-condition matches appear first. Other uses are labeled separately.';results.innerHTML='';current=[];q.focus();}
function distance(a,b){if(Math.abs(a.length-b.length)>3)return 99;let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=row;}return prev[b.length];}
function nearMatches(query){const n=normalizeName(query);if(n.length<4)return [];return names.entries.map(e=>({name:e.display_names[0],d:distance(n,e.key)})).filter(x=>x.d<=Math.min(3,Math.floor(n.length/4))).sort((a,b)=>a.d-b.d||a.name.localeCompare(b.name)).slice(0,5);}
function renderCards(){
 const grid=$('card-grid');const next=current.slice(shown,shown+40);shown+=next.length;
 grid.insertAdjacentHTML('beforeend',next.map(item=>{const t=item.target;return `<button class="card" data-target="${esc(t.id)}"><span class="badge ${t.kind==='source_reference_group'?'context':''}">${esc(item.hasPrimary===false?'Other-use match':label(t))}</span><h3>${esc(t.display_name)}</h3><p>${esc(t.formulation||'Formulation not specified')}</p><p>${esc(targetSummary(t))}</p>${item.matches?`<p><strong>${item.hasPrimary?'Primary condition':'Other use'}:</strong> ${esc(unique(item.matches.map(m=>m.condition)).join('; '))}</p>`:''}<span class="open">View reference details ↗</span></button>`;}).join(''));
 for(const card of grid.querySelectorAll('button.card')){
  const t=names.targets[card.dataset.target],wrapper=document.createElement('article');wrapper.className='result-card';card.replaceWith(wrapper);wrapper.append(card);const actions=document.createElement('div');actions.className='card-actions';actions.innerHTML=selectButton(t);wrapper.append(actions);
 }
 $('more').hidden=shown>=current.length;
}
function renderResults(items,query,partial=false){
 current=items;shown=0;
 if(!items.length){const near=mode==='medication'?nearMatches(query):[];results.innerHTML=`<div class="empty"><h2>${mode==='medication'?'Medication':'Condition'} not found</h2><p>No listed match for “${esc(query)}”. Check the spelling or try another name.</p>${near.length?`<p>Similar spellings — not confirmed matches:</p><div class="chips">${near.map(n=>`<button data-fill="${esc(n.name)}">${esc(n.name)}</button>`).join('')}</div><p class="help">Selecting a spelling fills the search box. Press Search to continue.</p>`:''}</div>`;status.textContent='No matches found.';return;}
 results.innerHTML=`<div class="result-heading"><h2>${partial?'Names matching':'Results for'} “${esc(query)}”</h2><span>${items.length} distinct records and reference groups</span></div>${mode==='medication'&&items.length>1?'<p class="help">An ingredient can have several products or formulations. Choose the record that matches the medication.</p>':''}<div id="card-grid" class="cards"></div><button id="more" class="subtle show-more" hidden>Show more results</button>`;
 $('more').addEventListener('click',renderCards);renderCards();status.textContent=`${items.length} results. Reference groups provide additional context; they are not interchangeable product listings.`;
}
function submit(e){e?.preventDefault();closeSuggestions();const query=q.value.trim();if(!query){status.textContent='Enter a medication or condition to search.';q.focus();return;}
 if(mode==='condition'){renderResults(conditionSearch.search(query),query);return;}
 const exact=nameSearch.exact(query);
 if(exact){renderResults(exact.targets.map(target=>({target})),query);return;}
 const partial=nameSearch.suggest(query,100);const candidates=new Map();for(const s of partial)for(const t of s.targets)candidates.set(t.id,{target:t});renderResults([...candidates.values()],query,true);
}
$('search-form').addEventListener('submit',submit);
results.addEventListener('click',e=>{const fill=e.target.closest('[data-fill]');if(fill){q.value=fill.dataset.fill;$('clear').hidden=false;q.focus();return;}const card=e.target.closest('[data-target]');if(card)openDetail(card.dataset.target);});
const field=(key,val)=>val?`<dt>${esc(key)}</dt><dd>${esc(val)}</dd>`:'';
function sourceLocation(r){return r.source_rows.map(s=>`${s.source_id==='cheatsheet'?'RX Cheatsheet':'Spelling Reference Guide'} · ${s.sheet}, row ${s.row}`).join('; ');}
function soundWarnings(t,e){const needles=unique([t.display_name,e?.ingredient_name,...(e?.brand_names||[])]).map(normalizeName);const snapshot=data.source_snapshots.find(s=>s.source_id==='spelling-guide');const sheet=snapshot?.sheets.find(s=>s.name==='Sound-Alikes');return (sheet?.rows||[]).filter(r=>r.row>1&&Object.entries(r.cells).some(([k,v])=>k.startsWith('A')&&needles.some(n=>normalizeName(v).split(' / ').includes(n)||(' '+normalizeName(v)+' ').includes(' '+n+' '))));}
function openDetail(id){
 const t=names.targets[id];if(!t)return;lastScroll=window.scrollY;const e=entity(t),rs=sourceFields(t),related=relatedReferences(t),fields=rs.map(r=>r.fields);
 const collect=key=>unique(fields.map(f=>f[key])).join('\n');
 const brands=e?e.brand_names:unique(fields.flatMap(f=>[f.brand_names_raw,f.name_type==='Brand'?f.name:''].filter(Boolean)));
 const generic=e?.ingredient_name||collect('generic_name_raw')||fields.find(f=>f.name_type==='Generic')?.name||related[0]?.fields.generic_name_raw;
 const warnings=soundWarnings(t,e);
 let body=`<span class="badge">${esc(label(t))}</span><h2>${esc(t.display_name)}</h2><p class="subtitle">${esc(t.formulation||'Exact formulation not specified')}</p>`;
 if(t.kind==='ambiguous_family')body+=`<div class="notice">This is a product-family name. Confirm the exact product, concentration and formulation.</div><div class="chips">${t.candidate_target_ids.map(i=>`<button data-detail="${esc(i)}">${esc(names.targets[i].display_name)}</button>`).join('')}</div>`;
 body+=`<h3>Names and uses</h3><dl>${field('Brand names',brands.join('; '))}${field('Ingredient name',generic)}${field('Route',t.route)}${field('Primary condition / use',e?.uses_summary||collect('primary_condition'))}${field('Other listed uses',e?.other_verified_uses?.join('; ')||(!e?collect('other_common_uses'):''))}${field('Category',collect('category'))}${field('Drug class (source-listed)',collect('drug_class'))}${field('Matching names (source-listed)',!e?collect('matching_names_raw'):'')}</dl>`;
 if(e)body+=`<p class="notice">${esc(e.normalization_note)}</p>`;
 if(warnings.length)body+=`<h3>Similar-name warnings</h3>${warnings.map(w=>{const v=Object.values(w.cells);return `<div class="notice"><b>${esc(v[0])}</b><p>${esc(v[1])}</p>${esc(v[2]||'')}</div>`;}).join('')}`;
 const tiers=unique(rs.map(r=>r.supplemental_fields?.general_tier_estimate?.value));
 body+=`<h3>General prescription tier guidance</h3>${e?'<p class="notice">No tier is assigned to this normalized entry. Earlier group-based estimates are retained in the source records only.</p>':`<dl>${field('Estimated tier range',tiers.join('; ')||'Not available')}${field('Estimate notes',unique(rs.map(r=>r.supplemental_fields?.tier_estimate_notes?.value)).join('\n'))}</dl><p class="help">These are broad heuristic estimates, not a verified formulary. Actual tiers, coverage and costs vary by plan, year, indication, strength and formulation.</p>`}`;
 body+=`<h3>Insurance reference notes</h3><dl>${field('Life underwriting attention (general)',collect('life_underwriting_attention'))}${field('Part D notes (source-listed; not independently verified)',collect('part_d_notes'))}${field('Possible C-SNP link (diagnosis must be confirmed)',collect('possible_csnp_link'))}${field('Other source notes',collect('notes'))}</dl><p class="help">Medication use alone does not establish a diagnosis or eligibility. Insurance notes are reference context from the spreadsheets.</p>`;
 if(related.length)body+=`<h3>Related detailed reference</h3><p class="help">These source groups match the name. A group may include several formulations; its notes are context, not confirmation of an exact product.</p>${related.map(r=>`<details class="context-block" open><summary>${esc(r.fields.brand_names_raw)} · ${esc(r.fields.generic_name_raw)}</summary><dl>${[['Drug class','drug_class'],['Other common uses','other_common_uses'],['Life underwriting attention','life_underwriting_attention'],['Part D notes — unverified','part_d_notes'],['Possible C-SNP link','possible_csnp_link'],['Notes','notes']].map(([label,key])=>field(label,r.fields[key])).join('')}</dl><p class="help">${esc(sourceLocation(r))}</p></details>`).join('')}`;
 const guide=data.source_snapshots.find(s=>s.source_id==='spelling-guide')?.sheets.find(s=>s.name==='Life UW Guide');
 const guideNames=unique([t.display_name,generic,...rs.flatMap(r=>(r.fields.matching_names_raw||'').split(','))]).map(normalizeName).filter(n=>n.length>3);
 const guideRows=(guide?.rows||[]).filter(r=>r.row>4&&Object.entries(r.cells).some(([cell,value])=>cell.startsWith('B')&&guideNames.some(n=>(' '+normalizeName(value)+' ').includes(' '+n+' '))));
 if(guideRows.length)body+=`<h3>Related underwriting guide</h3><p class="help">General source guidance; these are not a carrier's acceptance rules.</p>${guideRows.map(r=>{const value=col=>r.cells[col+r.row]||'';return `<details class="context-block"><summary>${esc(value('A'))}</summary><dl>${field('Examples',value('B'))}${field('What it may signal',value('C'))}${field('General attention',value('D'))}${field('Questions to ask',value('E'))}${field('Agency carrier notes',value('F'))}</dl></details>`;}).join('')}`;
 body+=`<h3>Sources and original context</h3>${e?`<ul class="source-list">${unique(e.evidence.map(x=>x.url)).map(url=>`<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Official label / product reference ↗</a></li>`).join('')}</ul>`:'<p class="help">This entry reflects the supplied spreadsheets and has not received an individual medical review.</p>'}`;
 body+=rs.map(r=>`<details class="context-block"><summary>${esc(r.fields.name||r.fields.brand_names_raw||r.fields.generic_name_raw)} · original source</summary><p class="help">${esc(sourceLocation(r))}</p><dl>${Object.entries(r.fields).map(([k,v])=>field(k.replaceAll('_',' '),v)).join('')}</dl>${e?'<p class="help">Original names and uses may be superseded by the reviewed information above.</p>':''}</details>`).join('');
 const referenceValues=key=>unique([...fields,...related.map(r=>r.fields)].map(f=>f[key])).join('\n');
 const quickBrands=unique([...brands,...related.map(r=>r.fields.brand_names_raw)].flatMap(v=>(v||'').split(',').map(s=>s.trim()))).join('; ');
 const questions=unique(guideRows.map(r=>r.cells['E'+r.row])).join('\n');
 const quick=`<section class="quick-reference"><h3>At a glance</h3><dl>${field('Brand names',quickBrands||'Not listed')}${field('Ingredient / generic',generic||'Not listed')}${field('Primary condition / use',e?.uses_summary||collect('primary_condition')||'Not listed')}${field('Other listed uses',e?.other_verified_uses?.join('; ')||(!e?referenceValues('other_common_uses'):'')||'Not listed')}${field('Drug class',referenceValues('drug_class')||'Not listed')}${field('Category',collect('category'))}${field('Route',t.route)}${field('Questions to ask',questions||'No medication-specific questions listed.')}</dl></section>`;
 const container=$('detail-body');container.innerHTML=selectButton(t)+body;
 // Replace the long names section with a scannable summary; keep original records below.
 const namesHeading=[...container.querySelectorAll('h3')].find(h=>h.textContent==='Names and uses');
 if(namesHeading){namesHeading.nextElementSibling?.remove();namesHeading.insertAdjacentHTML('beforebegin',quick);namesHeading.remove();}
 container.querySelectorAll('p.help').forEach(p=>{if(/These are broad heuristic|Medication use alone|These source groups match|General source guidance|has not received an individual medical review/.test(p.textContent))p.remove();});
 const tierHeading=[...container.querySelectorAll('h3')].find(h=>h.textContent==='General prescription tier guidance');
 if(tierHeading)tierHeading.textContent='Prescription tiers · estimates';
 // Give each reference section its own quiet gray panel.
 for(const heading of [...container.children].filter(el=>el.tagName==='H3')){
  const panel=document.createElement('section');panel.className='reference-section';heading.before(panel);panel.append(heading);
  while(panel.nextElementSibling&&panel.nextElementSibling.tagName!=='H3')panel.append(panel.nextElementSibling);
  if(!panel.querySelector('dd,details,.notice,li'))panel.remove();
 }
 dialog.showModal();dialog.scrollTop=0;
}
function closeDetail(){dialog.close();window.scrollTo({top:lastScroll});}
$('back').addEventListener('click',closeDetail);$('close').addEventListener('click',closeDetail);
$('detail-body').addEventListener('click',ev=>{const b=ev.target.closest('[data-detail]');if(b){dialog.close();openDetail(b.dataset.detail);}});
dialog.addEventListener('click',ev=>{if(ev.target===dialog){const r=dialog.getBoundingClientRect();if(ev.clientX<r.left||ev.clientX>r.right||ev.clientY<r.top||ev.clientY>r.bottom)closeDetail();}});
async function load(){
 try{[names,conditions,data]=await Promise.all(['name-index.json','condition-index.json','medications.json'].map(async file=>{const r=await fetch(new URL(file,import.meta.url));if(!r.ok)throw Error(`${file}: ${r.status}`);return r.json();}));nameSearch=buildSearch(names);conditionSearch=buildConditionSearch(conditions,names);records=new Map(data.records.map(r=>[r.id,r]));entities=new Map(data.normalized_entities.map(e=>[e.id,e]));q.disabled=false;$('submit').disabled=false;status.textContent=`Ready · ${names.entries.length.toLocaleString()} searchable names · ${conditions.entries.length} condition and use labels`;
 }catch(err){status.textContent='The reference could not load.';results.innerHTML=`<div class="notice">Make sure all website files were uploaded together and open the GitHub Pages URL. Double-clicking index.html on your computer may block the data files.<p>${esc(err.message)}</p><button class="subtle" onclick="location.reload()">Try again</button></div>`;}
}
load().then(()=>{if(mode==='browse'&&names&&records)renderBrowse(true);});
