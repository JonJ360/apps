const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
test('Executive Portfolio retains render targets and adds accessible search',()=>{
 assert.match(html,/class="mast"/);
 assert.match(html,/id="appSearch"[^>]*aria-label="Find an application"/);
 for(const id of ['live','soon','identity-status'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/<details class="planned">/);
 assert.match(html,/executive-hub\.js\?v=/);
});
test('Executive presentation uses existing rendered cards, not its own registry or identity',()=>{
 const js=fs.readFileSync(path.join(root,'executive-hub.js'),'utf8');
 assert.doesNotMatch(js,/\bAPPS\b|ownerUid|localStorage|sessionStorage|supabase|fetch\(/);
 assert.match(js,/MutationObserver/);
 assert.match(js,/textContent/);
});
