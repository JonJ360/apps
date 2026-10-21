const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function setup(){const elements={};const document={getElementById(id){return elements[id]??={innerHTML:'',textContent:'',hidden:false};}};const ctx=vm.createContext({document});vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],ctx);return {ctx,elements};}
const ownerId='b605d98f-498e-4a94-94cf-e055ed2b5fcc';
// Explicit reviewed public inventory: Inventory plus the seven original public apps.
const publicGlyphs=['INV','FS','AR','SMI','SFAB','AST','TT','RCP'];
test('public inventory remains exactly the eight intended apps',()=>{
 const {ctx}=setup();
 assert.deepEqual(Array.from(vm.runInContext('APPS.filter(a=>a.live&&!a.ownerUid).map(a=>a.glyph)',ctx)),publicGlyphs);
});
test('Corporate is exact-owner-only and hides again after sign-out',()=>{
 const {ctx,elements}=setup();
 const cards=JSON.parse(vm.runInContext('JSON.stringify(APPS.filter(a=>a.name==="Corporate"))',ctx));
 assert.equal(cards.length,1);
 assert.equal(cards[0].ownerUid,ownerId);
 assert.equal(cards[0].url,'https://jonj360.github.io/apps/corporate/');
 assert.equal(cards[0].desc,'Companies, officers, documents');
 assert.equal(cards[0].live,true);
 for(const [user,expected] of [[null,false],[{id:'other',email:'jonj@360-llc.com'},false],[{email:'jonj@360-llc.com'},false],[{id:ownerId.toUpperCase()},false],[{id:ownerId,email:'different@example.com'},true],[null,false]]){
  ctx.user=user;vm.runInContext('renderApps(user)',ctx);
  assert.equal(elements.live.innerHTML.includes(cards[0].url),expected);
 }
});
test('published Corporate shared-session helper is byte-identical to Hub',()=>{
 assert.deepEqual(fs.readFileSync(path.join(__dirname,'../corporate/shared-session.js')),fs.readFileSync(path.join(__dirname,'../shared-session.js')));
});
test('AP is visible only for exact verified Jon UID; existing cards stay public',()=>{
 const {ctx,elements}=setup();
 assert.equal(vm.runInContext('APPS.filter(a=>a.glyph==="AP").length',ctx),1,'AP card must exist exactly once');
 for(const [user,expected] of [[null,false],[{id:'other',email:'jonj@360-llc.com'},false],[{email:'jonj@360-llc.com'},false],[{id:'b605d98f-498e-4a94-94cf-e055ed2b5fcc',email:'jonj@360-llc.com'},true]]){
  ctx.user=user;vm.runInContext('renderApps(user)',ctx);
  assert.equal(elements.live.innerHTML.includes('https://jonj360.github.io/SMI-AP-CRM/'),expected);
  assert.equal((elements.live.innerHTML.match(/class="app"/g)||[]).length,expected?10:8);
  assert.equal((elements.soon.innerHTML.match(/class="app soon"/g)||[]).length,3);
 }
});
