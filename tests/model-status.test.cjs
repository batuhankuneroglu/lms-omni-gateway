const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {join,dirname,resolve,basename}=require('node:path');
const {tmpdir}=require('node:os');
const {createServer}=require('node:http');
const {Chat}=require('@lmstudio/sdk');
const {ModelStatusTracker,diagnoseRequest,providerErrorDetail}=require('../dist/model-status');
const {usageFooter,stripUsageFooters}=require('../dist/usage-footer');
const {UsageTracker}=require('../dist/usage');
const {generate,toOpenAIMessages}=require('../dist/generator');
const {createSidebarSchematics,sidebarKey}=require('../dist/config');
const reader=values=>({get:key=>values[key]});

test('classification separates explicit model restrictions from authentication, format and transient failures',()=>{
 assert.equal(diagnoseRequest(404,'This model models/gemini-2.5-flash is no longer available to new users.').status,'restricted');
 assert.equal(diagnoseRequest(403,'You do not have access to this model.').status,'restricted');
 assert.equal(diagnoseRequest(404,'This model has been retired.').status,'unavailable');
 assert.equal(diagnoseRequest(404,'Model not found').status,'unavailable');
 assert.equal(diagnoseRequest(404,'model_not_found Not Found').status,'unavailable');
 assert.equal(diagnoseRequest(403,"You don't have access to this model.").status,'restricted');
 assert.equal(diagnoseRequest(503,'unavailable').status,'temporary');
 assert.equal(diagnoseRequest(429,'quota').status,'limited');
 for(const [code,detail] of [[401,'model access denied'],[402,'model balance'],[403,'account denied'],[404,'route not found'],[400,'unsupported image input'],[undefined,'socket reset']])
  assert.equal(diagnoseRequest(code,detail).status,undefined);
 assert.ok(!diagnoseRequest(403,'API key sk-private prompt secret').explanation.includes('sk-private'));
});

test('structured provider errors show a short cause without echoing keys or prompts',()=>{
 assert.equal(providerErrorDetail({error:{message:'This model is no longer available to new users. Prompt: private text'}},'test-key'),
  'This model is no longer available to new users.');
 assert.equal(providerErrorDetail({error:{code:'model_not_found',message:'Not Found'}},'test-key'),'model_not_found: Not Found');
 assert.equal(providerErrorDetail({error:{message:'Invalid API key: private-key'}},'private-key'),undefined);
 assert.equal(providerErrorDetail({error:{message:'Model unavailable at https://host.example/?key=private'}},''),undefined);
 assert.equal(providerErrorDetail({error:{message:'private-key prompt-secret'}},'private-key'),undefined);
});

test('observations survive restart, expire, isolate credentials and recover without storing upstream messages',()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'lms-status-test-'));
 try{
  let now=10000000;
  const config=reader({provider:'custom',customApiKey:'private-key',overrideBaseUrl:'https://private.example/v1'});
  const tracker=new ModelStatusTracker(directory,()=>now);
  tracker.record(config,'test-model','restricted');
  const restarted=new ModelStatusTracker(directory,()=>now);
  assert.equal(restarted.label(config,'test-model'),'Access restricted');
  for(const changed of [reader({provider:'custom',customApiKey:'different',overrideBaseUrl:'https://private.example/v1'}),
    reader({provider:'custom',customApiKey:'private-key',overrideBaseUrl:'https://other.example/v1'})])
    assert.equal(restarted.label(changed,'test-model'),'Not tested');
  restarted.record(config,'test-model','worked');
  assert.equal(tracker.label(config,'test-model'),'Worked');
  restarted.record(config,'test-model','temporary');now+=300001;
  assert.equal(tracker.label(config,'test-model'),'Not tested');
  const all=fs.readdirSync(directory).map(f=>f+fs.readFileSync(join(directory,f),'utf8')).join('');
  assert.ok(!all.includes('private-key'));assert.ok(!all.includes('private.example'));
  const schema=createSidebarSchematics(config,{custom:[{id:'test-model',name:'Test'}]},(id,model)=>restarted.label(config,model));
  assert.ok(schema.serialize().fields.find(f=>f.fullKey===sidebarKey('customSelectedModel')).typeParams.options.some(o=>o.displayName==='Test · Not tested'));
 }finally{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('lms-status-test-'));fs.rmSync(directory,{recursive:true,force:true});}
});

test('usage blocks are excluded from outgoing assistant history while ordinary text, user input and tools remain intact',async()=>{
 const footer=usageFooter({input:1200,output:30,total:1230});
 assert.equal(footer,'\n\n---\n> Tokens: 1,200 input · 30 output · 1,230 total');
 assert.ok(!footer.includes('<!--'));
 const legacy='\n\n<!-- sonct-usage-v1 -->\n*Tokens: 1,200 input · 30 output · 1,230 total*\n<!-- /sonct-usage-v1 -->';
 assert.equal(stripUsageFooters('Old reply'+legacy),'Old reply');
 assert.equal(stripUsageFooters('Reply'+footer+' quoted example'),'Reply'+footer+' quoted example');
 const messages=await toOpenAIMessages(Chat.from({messages:[
  {role:'user',content:[{type:'text',text:'Tokens: 1 input · 2 output · 3 total'}]},
  {role:'assistant',content:[{type:'text',text:'First'+footer+'\nSecond'+usageFooter()},
    {type:'toolCallRequest',toolCallRequest:{id:'t',type:'function',name:'lookup',arguments:{}}}]},
  {role:'tool',content:[{type:'toolCallResult',toolCallId:'t',content:'result'}]},
  {role:'user',content:[{type:'text',text:'continue'}]}
 ]}));
 assert.equal(messages[1].content,'First\nSecond');
 assert.equal(messages[0].content,'Tokens: 1 input · 2 output · 3 total');
 assert.equal(messages[1].tool_calls[0].function.name,'lookup');
 assert.equal(messages[2].content,'result');
 assert.equal(stripUsageFooters('Ordinary\n*Tokens: unavailable*'),'Ordinary\n*Tokens: unavailable*');
});

test('normal streaming requests record outcomes and usage without extra API calls, and footers never return to the provider',async()=>{
 let mode='restricted';const requests=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;requests.push({url:req.url,body:JSON.parse(body)});
  if(['restricted','temporary','auth'].includes(mode)){
   const status={restricted:404,temporary:503,auth:401}[mode];res.writeHead(status,{'Content-Type':'application/json'});
   res.end(JSON.stringify({error:{message:mode==='restricted'?'This model is no longer available to new users. private-key prompt-secret':'private-key prompt-secret'}}));return;
  }
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(mode==='stream-error'){res.end('data: {"error":{"code":503,"message":"private-key prompt-secret"}}\n\n');return;}
  res.end('data: '+JSON.stringify({choices:mode==='empty'?[]:[{delta:{content:'Hello'}}]})+'\n\n'+
   'data: '+JSON.stringify({choices:[],...(mode==='missing'?{}:{usage:{prompt_tokens:12,completion_tokens:3,total_tokens:15}})})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const config=reader({provider:'custom',customSelectedModel:'__custom__',customModel:'test-model',customApiKey:'private-key',overrideBaseUrl:'http://127.0.0.1:'+server.address().port+'/v1'});
  const tracker=new ModelStatusTracker();let output='';
  const ctl={fragmentGenerated:t=>output+=t,getToolDefinitions:()=>[],onAborted:()=>{}};
  const services={defaults:config,getConfig:()=>config,modelStatus:tracker,usage:new UsageTracker(),
   catalog:{refresh:async()=>({models:[]})},refresh:async()=>{}};
  const hello=Chat.from([{role:'user',content:'hi'}]);
  await assert.rejects(generate(ctl,hello,services),e=>/no longer offers this model to new users/.test(e.message)&&!e.message.includes('private-key'));
  assert.equal(tracker.label(config,'test-model'),'Access restricted');
  mode='success';output='';await generate(ctl,hello,services);
  assert.equal(tracker.label(config,'test-model'),'Worked');assert.match(output,/Tokens: 12 input · 3 output · 15 total/);
  const first=output;output='';
  await generate(ctl,Chat.from([{role:'user',content:'hi'},{role:'assistant',content:first},{role:'user',content:'again'}]),services);
  assert.equal(requests[2].body.messages[1].content,'Hello');
  mode='temporary';await assert.rejects(generate(ctl,hello,services),/temporarily unavailable/);
  assert.equal(tracker.label(config,'test-model'),'Temporarily unavailable');
  assert.equal(requests.length,4,'a pre-stream 503 is not retried');
  mode='auth';await assert.rejects(generate(ctl,hello,services),/Authentication failed/);
  assert.equal(tracker.label(config,'test-model'),'Temporarily unavailable');
  mode='stream-error';await assert.rejects(generate(ctl,hello,services),/temporarily unavailable/);
  mode='missing';output='';await generate(ctl,hello,services);assert.match(output,/not reported by provider/);
  const untouched=new ModelStatusTracker();services.modelStatus=untouched;
  mode='empty';output='';await generate(ctl,hello,services);assert.equal(untouched.label(config,'test-model'),'Not tested');
  assert.match(output,/returned no text/);
  assert.equal(requests.length,8);assert.ok(requests.every(r=>r.url==='/v1/chat/completions'));
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('failed requests are never retried automatically, including pre-stream and partial failures',async()=>{
 let mode=502;let requests=0;let output='';
 const server=createServer(async(req,res)=>{
  for await(const _ of req){};requests++;
  if(typeof mode==='number'){
   res.writeHead(mode,{'Content-Type':'application/json'});
   res.end(JSON.stringify({error:{message:'Service temporarily unavailable'}}));return;
  }
  if(mode==='auth'){
   res.writeHead(401,{'Content-Type':'application/json'});
   res.end(JSON.stringify({error:{message:'Invalid API key for model test-model.'}}));return;
  }
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(mode==='partial'){
   res.end('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\ndata: {"error":{"code":503,"message":"Service unavailable"}}\n\n');return;
  }
  res.end('data: {"choices":[{"delta":{"content":"Ready"}}]}\n\ndata: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const config=reader({provider:'custom',customSelectedModel:'__custom__',customModel:'test-model',customApiKey:'test-key',
   overrideBaseUrl:'http://127.0.0.1:'+server.address().port+'/v1'});
  const ctl={fragmentGenerated:text=>output+=text,getToolDefinitions:()=>[],onAborted:()=>{}};
  const services={defaults:config,getConfig:()=>config,usage:new UsageTracker(),
   catalog:{refresh:async()=>({models:[]})},refresh:async()=>{}};
  const history=Chat.from([{role:'user',content:'hello'}]);
  await assert.rejects(generate(ctl,history,services),/HTTP 502/);
  assert.equal(requests,1,'a pre-stream 502 is not retried');
  mode=503;
  await assert.rejects(generate(ctl,history,services),/HTTP 503/);
  assert.equal(requests,2,'a pre-stream 503 is not retried');
  mode='auth';
  await assert.rejects(generate(ctl,history,services),error=>error.message.includes('Invalid API key for model test-model')
   && error.message.includes('test-model') && error.message.includes('Authentication failed'));
  assert.equal(requests,3,'authentication failure is not retried');
  mode='partial';output='';
  await assert.rejects(generate(ctl,history,services),/temporarily unavailable/);
  assert.equal(requests,4,'a stream error after output is not retried');
  assert.match(output,/Partial/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
