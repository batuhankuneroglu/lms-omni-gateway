const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,writeFileSync,rmSync,readdirSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,dirname,resolve,basename}=require('node:path');
const {Chat}=require('@lmstudio/sdk');
const {UsageTracker,parseUsage}=require('../dist/usage');
const {accountReport}=require('../dist/billing');
const {imageCapability,imageDataURL,parseImageCommand}=require('../dist/vision');
const {toOpenAIMessages,generate}=require('../dist/generator');
const {LegacySettings}=require('../dist/legacy-settings');
const {CapabilityReference}=require('../dist/capability-reference');
const reader=values=>({get:key=>values[key]});
const config=reader({provider:'deepseek',deepseekApiKey:'test-secret'});
const temp=()=>mkdtempSync(join(tmpdir(),'lms-vision-test-'));
function cleanup(dir){assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('lms-vision-test-'));rmSync(dir,{recursive:true,force:true});}
const json=data=>new Response(JSON.stringify(data));

test('usage survives restart and concurrent writers without exposing keys',()=>{
 const dir=temp();try{
  const a=new UsageTracker(dir),b=new UsageTracker(dir);
  a.record(config,parseUsage({prompt_tokens:10,completion_tokens:2,prompt_tokens_details:{cached_tokens:3},cost:0.001}),'one');
  b.record(config,undefined,'two');b.record(config,{input:5,output:6,total:11},'two');
  const row=new UsageTracker(dir).summary(config);
  assert.equal(row.total,23);assert.equal(row.missing,1);assert.equal(row.cachedInput,3);assert.equal(row.requestsWithCost,1);
  assert.equal(row.reportedCost,0.001);assert.deepEqual(row.models,[{model:'one',tokens:12,requests:1},{model:'two',tokens:11,requests:2}]);
  assert.equal(new UsageTracker(dir).summary(reader({provider:'deepseek',deepseekApiKey:'other'})).total,0);
  assert.ok(!JSON.stringify(readdirSync(dir)).includes('test-secret'));
 }finally{cleanup(dir);}
});

test('image commands produce actual MIME-checked multimodal payload without leaking local paths',async()=>{
 const dir=temp();try{
  const file=join(dir,'test photo.png');
  writeFileSync(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6tZkAAAAASUVORK5CYII=','base64'));
  const messages=await toOpenAIMessages(Chat.from([{role:'user',content:`/image "${file}" What color?`} ]));
  assert.equal(messages[0].content[0].text,'What color?');assert.match(messages[0].content[1].image_url.url,/^data:image\/png;base64,/);
  assert.ok(!JSON.stringify(messages).includes(dir));
  const other=join(dir,'fake.png');writeFileSync(other,'private plaintext');
  await assert.rejects(imageDataURL(other),/PNG, JPEG/);
  await assert.rejects(imageDataURL('https://example.com/photo.png'),/absolute local/);
  await assert.rejects(imageDataURL('\\\\server\\share\\photo.png'),/absolute local/);
  assert.throws(()=>parseImageCommand('/image'),/Use \/image/);
  assert.equal(parseImageCommand('ordinary text'),undefined);
 }finally{cleanup(dir);}
});

test('capability metadata is explicit, unknown models are not guessed',()=>{
 assert.equal(imageCapability('deepseek','deepseek-flash').imageInput,true);
 assert.equal(imageCapability('deepseek','deepseek-v4-pro').imageInput,false);
 assert.equal(imageCapability('nvidia','nvidia/nemotron-3-nano-omni-30b-a3b-reasoning').imageInput,true);
 assert.deepEqual(imageCapability('custom','gpt-unknown'),{});
 assert.equal(imageCapability('openrouter','x',{architecture:{input_modalities:['text','image']}}).imageInput,true);
 assert.equal(imageCapability('custom','x',{input_modalities:['text']}).imageInput,false);
});

test('balance is limited to DeepSeek and OpenRouter and management credentials never leave the official endpoint',async()=>{
 for(const provider of ['openai','anthropic','gemini','glm','grok','nvidia','evren','muskapi','custom','custom2']) {
  let calls=0;
  const report=await accountReport(reader({provider,billingKey:'legacy-admin',openrouterManagementKey:'management'}),async()=>{calls++;});
  assert.equal(calls,0);assert.match(report,/only for DeepSeek and OpenRouter/);
 }
 let calls=0;
 const router=await accountReport(reader({provider:'openrouter',openrouterManagementKey:'management',openrouterApiKey:'chat'}),async(url,init)=>{
  calls++;assert.equal(url,'https://openrouter.ai/api/v1/credits');assert.equal(init.headers.Authorization,'Bearer management');
  return json({data:{total_credits:10,total_usage:2}});
 });
 assert.equal(calls,1);assert.match(router,/Available credits: \$8.0000/);
 await accountReport(reader({provider:'openrouter',openrouterManagementKey:'management',openrouterBaseUrl:'https://other.example/v1'}),async()=>{calls++;});
 assert.equal(calls,1);
 const malformed=await accountReport(reader({provider:'openrouter',openrouterManagementKey:'management'}),async()=>json({data:{total_credits:'10',total_usage:2}}));
 assert.match(malformed,/unavailable/);
});

test('billing keys are separated from generation keys and remain locally stored',()=>{
 const dir=temp();try{
  const store=new LegacySettings(join(dir,'settings.json'),()=>reader({provider:'openai',openaiApiKey:'chat-key'}),()=>'');
  writeFileSync(store.path,JSON.stringify({version:1,revision:1,provider:'openai',customModel:'',models:{},connections:{openai:{billingKey:'admin-key'}}}));
  assert.equal(store.config().get('openaiApiKey'),'chat-key');assert.equal(store.config().get('billingKey'),'admin-key');
  assert.equal(store.config(store.read(),'anthropic').get('billingKey'),'');
 }finally{cleanup(dir);}
});

test('public capability reference preserves endpoint metadata, matches exact IDs and persists without credentials',async()=>{
 const dir=temp();try{
  let calls=0;const path=join(dir,'reference.json');
  const ref=new CapabilityReference(path,async(url,init)=>{
   calls++;assert.equal(url,'https://openrouter.ai/api/v1/models');assert.deepEqual(init.headers,{});
   return json({data:[{id:'z-ai/glm-vision',architecture:{input_modalities:['text','image']}},{id:'z-ai/glm-text',architecture:{input_modalities:['text']}}]});
  });
  const rows=await ref.enrich([{id:'glm-vision',name:'Vision'},{id:'glm-text',name:'Text',imageInput:true,capabilitySource:'Models API'},{id:'glm-other',name:'Other'}],'glm');
  assert.equal(rows[0].imageInput,true);assert.match(rows[0].capabilitySource,/OpenRouter reference/);
  assert.equal(rows[1].imageInput,true);assert.equal(rows[1].capabilitySource,'Models API');assert.equal(rows[2].imageInput,undefined);
  const restarted=new CapabilityReference(path,async()=>{throw new Error('Should use cache');});
  assert.equal((await restarted.enrich([{id:'glm-text',name:'Text'}],'glm'))[0].imageInput,false);
  const custom=await ref.enrich([{id:'glm-vision',name:'Unknown proxy'}],'custom');assert.equal(custom[0].imageInput,undefined);
  assert.equal(calls,1);
 }finally{cleanup(dir);}
});

test('existing LM Studio image file handles are forwarded as image blocks',async()=>{
 const file=join(__dirname,'fixtures','vision-check.png');
 const message={getRole:()=> 'user',getText:()=> 'Describe it',getFiles:()=>[{isImage:()=>true,getFilePath:async()=>file}]};
 const messages=await toOpenAIMessages([message],{client:{}});
 assert.equal(messages[0].content[0].text,'Describe it');assert.equal(messages[0].content[1].type,'image_url');
});

test('settings stays in LM Studio and never opens a browser; image picker never generates or leaks its reply',async()=>{
 let output='',opened='',picked=0;
 const services={getConfig:()=>config,openSettings:async()=> 'http://127.0.0.1:1234/#'+'a'.repeat(64),
  openBrowser:async url=>{opened=url;return true;},chooseImage:async()=>{picked++;return 'C:\\test photo.png';}};
 const ctl={fragmentGenerated:text=>output+=text};
 await generate(ctl,Chat.from([{role:'user',content:'/settings'}]),services);
 assert.match(output,/right sidebar/);assert.equal(opened,'');assert.ok(!output.includes('http'));
 output='';await generate(ctl,Chat.from([{role:'user',content:'/image'}]),services);
 assert.equal(picked,1);assert.match(output,/\/image "C:\\test photo.png"/);
 const messages=await toOpenAIMessages(Chat.from([{role:'user',content:'/image'},{role:'assistant',content:output},{role:'user',content:'hello'}]));
 assert.deepEqual(messages,[{role:'user',content:'hello'}]);
});
