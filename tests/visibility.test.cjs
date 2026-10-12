const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function setup(){const elements={};const document={getElementById(id){return elements[id]??={innerHTML:'',textContent:'',hidden:false};}};const ctx=vm.createContext({document});vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],ctx);return {ctx,elements};}
test('AP is visible only for exact verified Jon UID; existing cards stay public',()=>{
 const {ctx,elements}=setup();
 assert.equal(vm.runInContext('APPS.filter(a=>a.glyph==="AP").length',ctx),1,'AP card must exist exactly once');
 for(const [user,expected] of [[null,false],[{id:'other',email:'jonj@360-llc.com'},false],[{email:'jonj@360-llc.com'},false],[{id:'b605d98f-498e-4a94-94cf-e055ed2b5fcc',email:'jonj@360-llc.com'},true]]){
  ctx.user=user;vm.runInContext('renderApps(user)',ctx);
  assert.equal(elements.live.innerHTML.includes('https://jonj360.github.io/SMI-AP-CRM/'),expected);
  assert.equal((elements.live.innerHTML.match(/class="app"/g)||[]).length,expected?8:7);
  assert.equal((elements.soon.innerHTML.match(/class="app soon"/g)||[]).length,3);
 }
});
