const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { setImmediate: nextTurn } = require('node:timers/promises');

const directory = mkdtempSync(join(tmpdir(), 'lms-startup-'));
const oldDirectory = process.env.LMS_PLUGIN_DATA_DIR;
process.env.LMS_PLUGIN_DATA_DIR = directory;
const settingsModule = require('../dist/model-settings');
const { main } = require('../dist/index');
const { createRuntime } = require('../dist/runtime');
const { sidebarKey } = require('../dist/config');
const { ModelCatalog, connectionIdentity } = require('../dist/catalog');
const { Chat } = require('@lmstudio/sdk');
const raw = values => ({fields:Object.entries(values).map(([key,value]) => ({key,value}))});
const reader = values => ({get:key => values[key]});

after(() => {
  if (oldDirectory === undefined) delete process.env.LMS_PLUGIN_DATA_DIR;
  else process.env.LMS_PLUGIN_DATA_DIR = oldDirectory;
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('lms-startup-'));
  rmSync(directory, {recursive:true,force:true});
});

test('registration completes with cached models while discovery stalls, then saves background results for reload', async t => {
  const previousOffline = process.env.LMS_PLUGIN_OFFLINE;
  delete process.env.LMS_PLUGIN_OFFLINE;
  const values = {
    [sidebarKey('provider')]:'evren',
    [sidebarKey('evrenApiKey')]:'evren-startup-test-key',
    [sidebarKey('evrenSelectedModel')]:'saved-evren-model',
    [sidebarKey('openrouterApiKey')]:'router-startup-test-key',
    [sidebarKey('openrouterSelectedModel')]:'vendor/saved-router-model',
  };
  t.mock.method(settingsModule, 'readSavedSettings', () => reader(values));
  const evrenConfig = reader({provider:'evren',evrenApiKey:values[sidebarKey('evrenApiKey')]});
  const routerConfig = reader({provider:'openrouter',openrouterApiKey:values[sidebarKey('openrouterApiKey')]});
  const cachePath = join(directory,'model-catalog-cache.json');
  writeFileSync(cachePath,JSON.stringify([
    [connectionIdentity(evrenConfig), {models:[{id:'saved-evren-model',name:'Saved EVREN'}],live:true,checked:Date.now()-3600000}],
    [connectionIdentity(routerConfig), {models:[{id:'vendor/saved-router-model',name:'Saved router'}],live:true,checked:Date.now()-3600000,freePricingKnown:true}],
  ]));
  let releaseSlow;
  const slowResponse = new Promise(resolve => {releaseSlow=resolve;});
  const requests = [], tasks = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(String(url));
    if (String(url).startsWith('https://evren-llmapi.ssyz.org.tr/')) return slowResponse;
    assert.equal(String(url),'https://openrouter.ai/api/v1/models');
    return new Response(JSON.stringify({data:[{id:'vendor/new-router-model',name:'New router'}]}),
      {headers:{'content-type':'application/json'}});
  });
  const refresh = ModelCatalog.prototype.refresh;
  t.mock.method(ModelCatalog.prototype,'refresh',function(...args) {
    const task = refresh.apply(this,args); tasks.push(task); return task;
  });
  const registered = {};
  const context = {
    withConfigSchematics:value => {registered.chat=value;return context;},
    withGlobalConfigSchematics:value => {registered.global=value;return context;},
    withGenerator:value => {registered.generate=value;return context;},
  };
  const options = (schematics,provider) => schematics.serialize().fields
    .find(field => field.fullKey===sidebarKey(provider+'SelectedModel')).typeParams.options.map(option=>option.value);
  let ready = false;
  const loading = main(context).then(() => {ready=true;});
  try {
    await Promise.resolve();
    assert.equal(ready,true,'plugin readiness must not wait for a model API');
    assert.equal(requests.length,0,'provider requests must start after registration');
    assert.ok(registered.chat && registered.global && registered.generate);
    assert.ok(options(registered.global,'evren').includes('saved-evren-model'));
    assert.ok(options(registered.global,'openrouter').includes('vendor/saved-router-model'));
    await nextTurn();
    assert.equal(requests.length,2);
    // The stalled provider still cannot block a local command in the loaded plugin.
    let output = '';
    await registered.generate({
      getGlobalPluginConfig:schema=>schema.parse(raw(values)),
      getPluginConfig:schema=>schema.parse(raw({activeProvider:'evren'})),
      fragmentGenerated:text=>{output+=text;},
    },Chat.from([{role:'user',content:'/settings'}]));
    assert.match(output,/right sidebar/);
    releaseSlow(new Response('',{status:503}));
    await Promise.all(tasks);
    const saved = readFileSync(cachePath,'utf8');
    assert.ok(saved.includes('new-router-model'));
    assert.ok(saved.includes('saved-evren-model'),'a failed refresh must keep its saved models');
    assert.equal(saved.includes('startup-test-key'),false);
    const callsBeforeReload = requests.length;
    const reloaded = createRuntime();
    assert.equal(requests.length,callsBeforeReload,'building a runtime must perform no HTTP requests');
    assert.ok(options(reloaded.schematics,'openrouter').includes('vendor/new-router-model'));
    assert.ok(options(reloaded.schematics,'evren').includes('saved-evren-model'));
    // Offline verification must never schedule remote discovery.
    process.env.LMS_PLUGIN_OFFLINE = '1';
    await main(context);
    await nextTurn();
    assert.equal(requests.length,callsBeforeReload);
  } finally {
    releaseSlow(new Response('',{status:503}));
    await Promise.allSettled([loading,...tasks]);
    if (previousOffline === undefined) delete process.env.LMS_PLUGIN_OFFLINE;
    else process.env.LMS_PLUGIN_OFFLINE = previousOffline;
  }
});
