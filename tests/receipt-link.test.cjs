const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('Hub receipt card opens the actual private ReceiptDesk pilot, never the retired scanner',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const elements={};const document={getElementById(id){return elements[id]??={innerHTML:'',textContent:'',hidden:false};}};
 const ctx=vm.createContext({document});vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],ctx);
 const cards=JSON.parse(vm.runInContext('JSON.stringify(APPS.filter(a=>a.glyph==="RCP"))',ctx));
 assert.equal(cards.length,1);
 assert.equal(cards[0].name,'ReceiptDesk');
 assert.equal(cards[0].url,'https://jonj360.github.io/receiptdesk-preview/pilot/?v=9994f15');
 assert.equal(cards[0].live,true);
 assert.ok(elements.live.innerHTML.includes(cards[0].url));
 assert.ok(!elements.live.innerHTML.includes('https://jonj360.github.io/receipts/'));
});
