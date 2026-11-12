/* Presentation only: enhance existing authorized DOM cards and preserve their links. */
(() => {
 'use strict';
 const live=document.getElementById('live'),soon=document.getElementById('soon'),search=document.getElementById('appSearch');
 const order=['CORP','FS','AR','AP','SMI','SFAB','INV','AST','TT','RCP'];
 const paths={
  CORP:'<path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h1m4 0h1m-6 4h1m4 0h1m-6 7v-4h6v4"/>',
  FS:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 17v-2m4 2v-5m4 5v-3"/>',
  AR:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18m-7 4-3 3 3 3m-3-3h7M7 3v4m10-4v4"/>',
  AP:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18m11 4 3 3-3 3m-4-3h7M7 3v4m10-4v4"/>',
  SMI:'<path d="M3 20h18M6 16v-5m6 5V6m6 10v-9"/>',
  SFAB:'<path d="M3 20h18M6 16v-4m6 4V8m6 8V4"/>',
  INV:'<path d="m3 7 9-4 9 4v10l-9 4-9-4Zm0 0 9 4 9-4m-9 4v10M7 5l10 4"/>',
  AST:'<path d="m5 7 2-4h10l2 4m-16 4 2-4h14l2 4v7H3Zm3 7v3m12-3v3M6 13h2m8 0h2"/>',
  TT:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  RCP:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Zm3 4h6m-6 4h6m-6 4h4"/>',
  generic:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'
 };
 const svg=content=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+content+'</svg>';
 function filter(){
  const query=search.value.trim().toLowerCase();let found=0;
  for(const a of live.querySelectorAll('.app')){a.hidden=!!query&&!a.textContent.toLowerCase().includes(query);if(!a.hidden)found++;}
  document.getElementById('appCount').textContent=live.querySelectorAll('.app').length+' apps';
  document.getElementById('noMatches').hidden=found!==0;
 }
 function enhance(){
  for(const root of [live,soon])for(const a of root.querySelectorAll('.app:not([data-enhanced])')){
   a.dataset.enhanced='true';const glyph=a.querySelector('.glyph');const key=glyph.textContent.trim();a.dataset.glyph=key;
   glyph.className='app-icon';glyph.innerHTML=svg(paths[key]||paths.generic);
   const text=document.createElement('span');text.className='app-text';text.append(a.querySelector('.nm'),a.querySelector('.ds'));a.append(text);a.classList.add('tile');
   if(root===live)a.insertAdjacentHTML('beforeend',svg('<path d="m9 6 6 6-6 6"/>'));
   else{a.setAttribute('aria-disabled','true');a.tabIndex=-1;a.addEventListener('click',e=>e.preventDefault());}
  }
  const cards=[...live.querySelectorAll('.app')];const sorted=[...cards].sort((a,b)=>{const ai=order.indexOf(a.dataset.glyph),bi=order.indexOf(b.dataset.glyph);return (ai<0?order.length:ai)-(bi<0?order.length:bi);});
  if(cards.some((a,i)=>a!==sorted[i]))live.append(...sorted);
  document.getElementById('comingCount').textContent=soon.querySelectorAll('.app').length;
  filter();
 }
 const observer=new MutationObserver(enhance);observer.observe(live,{childList:true});observer.observe(soon,{childList:true});
 search.addEventListener('input',filter);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.activeElement===search){search.value='';filter();}});
 enhance();
})();
