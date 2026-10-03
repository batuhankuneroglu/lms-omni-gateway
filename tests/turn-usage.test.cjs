const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {Chat}=require('@lmstudio/sdk');
const {TurnUsageAccumulator}=require('../dist/turn-usage');
const {UsageTracker}=require('../dist/usage');
const {generate,toOpenAIMessages}=require('../dist/generator');
const {stripUsageFooters,usageFooter}=require('../dist/usage-footer');
const reader=values=>({get:key=>values[key]});

test('a tool cycle produces one combined footer after the final response and the three switches apply immediately',async()=>{
 let calls=0;const received=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;received.push(JSON.parse(body));calls++;
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const delta=calls===1?{tool_calls:[{index:0,id:'call-1',function:{name:'lookup',arguments:'{}'}}]}:{content:'Final answer'};
  res.end('data: '+JSON.stringify({choices:[{delta,finish_reason:calls===1?null:'stop'}]})+'\n\n'+
    'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:calls===1?10:20,completion_tokens:2,total_tokens:calls===1?12:22}})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const shared={provider:'custom',customSelectedModel:'__custom__',customModel:'test-model',customApiKey:'key',overrideBaseUrl:`http://127.0.0.1:${server.address().port}/v1`};
  let flags={showTokenUsage:true,showModelInfo:true,showSpeedTime:true};let output='';
  const ctl={fragmentGenerated:s=>output+=s,getToolDefinitions:()=>[],onAborted:()=>{},
   toolCallGenerationStarted:()=>{},toolCallGenerationNameReceived:()=>{},toolCallGenerationArgumentFragmentGenerated:()=>{},toolCallGenerationEnded:()=>{}};
  const services={getConfig:()=>reader({...shared,...flags}),defaults:reader(shared),turnUsage:new TurnUsageAccumulator(),usage:new UsageTracker(),
   catalog:{refresh:async()=>({models:[]})},refresh:async()=>{}};
  const user={role:'user',content:[{type:'text',text:'Question'}]};
  await generate(ctl,Chat.from([{role:'user',content:'Question'}]),services);
  assert.ok(!output.includes('Tokens:')&&!output.includes('Model:')&&!output.includes('Speed:'));
  output='';
  await generate(ctl,Chat.from({messages:[user,{role:'assistant',content:[{type:'toolCallRequest',toolCallRequest:{id:'call-1',type:'function',name:'lookup',arguments:{}}}]},
   {role:'tool',content:[{type:'toolCallResult',toolCallId:'call-1',content:'result'}]}]}),services);
  assert.match(output,/Tokens: 30 input · 4 output · 34 total/);
  assert.match(output,/Time: \d+(?:\.\d+)? s · Speed: \d+(?:\.\d+)? tokens\/s/);
  assert.match(output,/Model: test-model · Provider: Custom 1/);
  assert.equal(calls,2);
  const clean=await toOpenAIMessages(Chat.from([{role:'user',content:'Question'},{role:'assistant',content:output}]));
  assert.equal(clean[1].content,'Final answer');
  flags={showTokenUsage:false,showModelInfo:true,showSpeedTime:true};output='';
  assert.equal(usageFooter({input:1,output:1,total:2},{id:'id',provider:'Provider'},{tokens:flags.showTokenUsage,model:flags.showModelInfo}).includes('Tokens:'),false);
  flags={showTokenUsage:true,showModelInfo:false,showSpeedTime:true};
  assert.equal(usageFooter({input:1,output:1,total:2},{id:'id',provider:'Provider'},{tokens:flags.showTokenUsage,model:flags.showModelInfo}).includes('Model:'),false);
  const noSpeed=usageFooter({input:1,output:1,total:2},{id:'id',provider:'Provider'},
   {tokens:true,model:true,speedTime:false},{elapsedMs:2000});
  assert.ok(!noSpeed.includes('Speed:'));
  const speedOnly=usageFooter({input:1,output:4,total:5},undefined,
   {tokens:false,model:false,speedTime:true},{elapsedMs:2000});
  assert.equal(speedOnly,'\n\n---\n> Time: 2.00 s · Speed: 2.0 tokens/s');
  assert.equal(stripUsageFooters('A'+speedOnly),'A');
  assert.equal(stripUsageFooters('A'+usageFooter(undefined,{id:'id',provider:'P'},{tokens:false,model:true})),'A');
  flags={showTokenUsage:true,showModelInfo:true,showSpeedTime:false};output='';
  await generate(ctl,Chat.from([{role:'user',content:'Question'}]),services);
  assert.match(output,/Tokens:/);
  assert.ok(!output.includes('Speed:')&&!output.includes('Time:'));
  assert.equal(calls,3);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('tool-loop timing sums only model requests and preserves missing token metadata',()=>{
 const accumulator=new TurnUsageAccumulator();
 const key=accumulator.key(Chat.from([{role:'user',content:'Question'}]),'connection:model');
 accumulator.add(key,{input:10,output:2,total:12},500);
 accumulator.add(key,{input:20,output:2,total:22},1500);
 assert.deepEqual(accumulator.complete(key),{usage:{input:30,output:4,total:34},elapsedMs:2000});
 accumulator.add(key,{input:10,output:2,total:12},500);
 accumulator.add(key,undefined,200);
 assert.deepEqual(accumulator.complete(key),{usage:undefined,elapsedMs:700});
 assert.equal(usageFooter(undefined,undefined,{tokens:false,model:false,speedTime:true},{elapsedMs:700}),
  '\n\n---\n> Time: 0.7000 s · Speed: unavailable');
});
