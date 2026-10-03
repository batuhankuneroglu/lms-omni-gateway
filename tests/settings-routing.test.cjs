const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync,readFileSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve,dirname,basename}=require('node:path');
const {createServer}=require('node:http');
const {Chat}=require('@lmstudio/sdk');
const {LegacySettings}=require('../dist/legacy-settings');
const {createChatDataSchematics,createSidebarDataSchematics,readChatSelection,sidebarKey}=require('../dist/config');
const {ModelCatalog}=require('../dist/catalog');
const {UsageTracker}=require('../dist/usage');
const {generate}=require('../dist/generator');
const {CUSTOM_MODEL_VALUE}=require('../dist/providers');
const reader=values=>({get:key=>values[key]});
const temporary=()=>mkdtempSync(join(tmpdir(),'lms-settings-test-'));
function cleanup(dir){assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('lms-settings-test-'));rmSync(dir,{recursive:true,force:true});}

test('legacy settings import all saved profiles without modifying the source file',()=>{
 const dir=temporary();try{
  const path=join(dir,'settings.json');
  const data={version:1,revision:2,provider:'custom',customModel:'keep-manual',models:{custom:'keep-model'},connections:{custom:{apiKey:'saved-key',baseURL:'https://saved.example/v1'},custom2:{apiKey:''}}};
  writeFileSync(path,JSON.stringify(data));const before=readFileSync(path,'utf8');
  const store=new LegacySettings(path,()=>reader({customApiKey:'old-key',custom2ApiKey:'old-two'}),()=>'');
  assert.equal(store.config().get('customApiKey'),'saved-key');
  assert.equal(store.config().get('overrideBaseUrl'),'https://saved.example/v1');
  assert.equal(store.config().get('customModel'),'keep-manual');
  assert.equal(store.config(store.read(),'custom2').get('custom2ApiKey'),'');
  assert.equal(readFileSync(path,'utf8'),before);
 }finally{cleanup(dir);}
});

test('corrupt legacy settings fail explicitly without overwriting saved data',()=>{
 const dir=temporary();try{
  const path=join(dir,'settings.json');writeFileSync(path,'not-json');
  const store=new LegacySettings(path,()=>reader({}),()=>'');
  assert.throws(()=>store.read(),/not overwritten/);
  assert.equal(readFileSync(path,'utf8'),'not-json');
 }finally{cleanup(dir);}
});

test('switching between chats restores each Active Provider and routes to its key and URL',async()=>{
 const dir=temporary(),requests=[];
 async function makeEndpoint(label){
  const server=createServer(async(req,res)=>{
   if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end('{"data":[]}');return;}
   let body='';for await(const chunk of req)body+=chunk;
   requests.push({label,auth:req.headers.authorization,body:JSON.parse(body)});
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   res.end('data: '+JSON.stringify({choices:[{delta:{content:label}}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,url:'http://127.0.0.1:'+server.address().port+'/v1'};
 }
 const a=await makeEndpoint('A'),b=await makeEndpoint('B');
 try{
  const defaults=reader({...Object.fromEntries(['custom','custom2'].map(id=>[id+'SelectedModel',CUSTOM_MODEL_VALUE])),customCustomModel:'manual-A',custom2CustomModel:'manual-B',provider:'custom',customApiKey:'key-A',overrideBaseUrl:a.url,custom2ApiKey:'key-B',custom2BaseUrl:b.url});
  const parser=createSidebarDataSchematics();
  const chatParser=createChatDataSchematics(defaults);
  const services={catalog:new ModelCatalog(),usage:new UsageTracker(),defaults,
   getConfig:ctl=>readChatSelection(ctl.getGlobalPluginConfig(parser),ctl.getPluginConfig(chatParser)),refresh:async()=>{}};
  const sharedFields=[...['customSelectedModel','custom2SelectedModel','customCustomModel','custom2CustomModel','customApiKey','overrideBaseUrl','custom2ApiKey','custom2BaseUrl'].map(key=>({key:sidebarKey(key),value:defaults.get(key)})),
   {key:sidebarKey('provider'),value:'custom2'}];
  const controller=activeProvider=>({fragmentGenerated:()=>{},getToolDefinitions:()=>[],onAborted:()=>{},
   getGlobalPluginConfig:schema=>schema.parse({fields:sharedFields}),
   getPluginConfig:schema=>schema.parse({fields:[{key:'activeProvider',value:activeProvider}]})});
  const chatA=controller('custom'),chatB=controller('custom2');
  const history=Chat.from([{role:'user',content:'/settings'},{role:'assistant',content:'http://127.0.0.1:1/#private-control-token'},{role:'user',content:'hello'}]);
  await generate(chatA,history,services);
  await generate(chatB,history,services);
  await generate(chatA,history,services);
  assert.deepEqual(requests.map(r=>[r.label,r.auth]),[['A','Bearer key-A'],['B','Bearer key-B'],['A','Bearer key-A']]);
  for(const req of requests){
   assert.equal(req.body.model,'manual-'+req.label);
   assert.deepEqual(req.body.messages,[{role:'user',content:'hello'}]);
  }
 }finally{await Promise.all([a,b].map(item=>new Promise(resolve=>item.server.close(resolve))));cleanup(dir);}
});

test('a text-only custom model accepts a greeting but explains rejection when history contains an image',async()=>{
 const requests=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  requests.push(JSON.parse(body));
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.end('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const config=reader({provider:'custom',customSelectedModel:CUSTOM_MODEL_VALUE,customModel:'gpt-4.1',
   overrideBaseUrl:'http://127.0.0.1:'+server.address().port+'/v1',customApiKey:'test'});
  const services={defaults:config,getConfig:()=>config,usage:new UsageTracker(),refresh:async()=>{},
   catalog:{refresh:async()=>({models:[{id:'gpt-4.1',name:'GPT-4.1',imageInput:false,capabilitySource:'Models API'}]})}};
  const ctl={fragmentGenerated:()=>{},getToolDefinitions:()=>[],onAborted:()=>{}};
  await generate(ctl,Chat.from([{role:'user',content:'selam'}]),services);
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].messages,[{role:'user',content:'selam'}]);
  const history=Chat.from([{role:'user',content:`/image "${resolve(__dirname,'fixtures/vision-check.png')}" Describe.`},
   {role:'assistant',content:'A shape.'},{role:'user',content:'selam'}]);
  await assert.rejects(generate(ctl,history,services),/Custom 1 lists gpt-4\.1 as text-only.*including earlier messages/);
  assert.equal(requests.length,1,'blocked image history must not reach the endpoint');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
