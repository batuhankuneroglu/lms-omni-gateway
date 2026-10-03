const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {join,dirname,resolve,basename}=require('node:path');
const {tmpdir}=require('node:os');
const {Chat}=require('@lmstudio/sdk');
const {BalanceCache}=require('../dist/balance-cache');
const {accountReport}=require('../dist/billing');
const {generate,toOpenAIMessages}=require('../dist/generator');
const {usageFooter,stripUsageFooters}=require('../dist/usage-footer');
const reader=values=>({get:key=>values[key]});
test('model footer remains local across history and tool continuations',async()=>{
 const footer=usageFooter({input:1,output:2,total:3},{id:'my-model',provider:'Custom 1'});
 assert.match(footer,/\n> Model: my-model · Provider: Custom 1$/);
 assert.equal(stripUsageFooters('Answer'+footer+'\nNext'+footer),'Answer\nNext');
 const messages=await toOpenAIMessages(Chat.from([{role:'user',content:'/status'},
  {role:'assistant',content:'Saved balance: private'}, {role:'user',content:'hello'},
  {role:'assistant',content:'Answer'+footer}]));
 assert.deepEqual(messages,[{role:'user',content:'hello'},{role:'assistant',content:'Answer'}]);
});
test('successful balance persists, failures preserve it, and credentials isolate snapshots',async()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'omni-balance-test-'));
 try {
  let now=1700000000000;const store=new BalanceCache(directory,()=>now);
  const values={provider:'openrouter',openrouterApiKey:'chat-secret',openrouterManagementKey:'admin-secret'};
  const config=reader(values);const save=report=>store.record(config,report);
  await accountReport(config,async()=>new Response(JSON.stringify({data:{total_credits:10,total_usage:2}})),save);
  const restored=new BalanceCache(directory);assert.match(restored.read(config).report,/8.0000/);
  now+=1000;
  await accountReport(config,async()=>new Response('{}',{status:503}),save);
  assert.equal(restored.read(config).checked,1700000000000);
  for(const changed of [{openrouterApiKey:'different'},{openrouterManagementKey:'different'},
   {openrouterBaseUrl:'https://example.com/v1'}])assert.equal(restored.read(reader({...values,...changed})),undefined);
  const content=fs.readdirSync(directory).map(f=>f+fs.readFileSync(join(directory,f),'utf8')).join('');
  assert.ok(!content.includes('chat-secret')&&!content.includes('admin-secret'));
  let output='';let calls=0;
  await generate({fragmentGenerated:t=>output+=t},Chat.from([{role:'user',content:'/status'}]),{
   getConfig:()=>reader({...values,openrouterSelectedModel:'__custom__',customModel:'chosen-model'}),
   balanceCache:restored,catalog:{refresh:async()=>{calls++;throw Error('Unexpected network');}},
   refresh:async()=>{calls++;throw Error('Unexpected network');}});
  assert.equal(calls,0);assert.match(output,/Model: chosen-model/);assert.match(output,/8.0000/);
  assert.match(output,/2023-11-14T22:13:20.000Z/);assert.match(output,/not a live balance/);
 }finally{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('omni-balance-test-'));fs.rmSync(directory,{recursive:true,force:true});}
});
