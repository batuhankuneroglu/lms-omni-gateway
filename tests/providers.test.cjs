const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname, basename, resolve } = require('node:path');
const { Chat } = require('@lmstudio/sdk');
const { providers, getProvider, resolveConnection, CUSTOM_MODEL_VALUE } = require('../dist/providers');
const { createConnectionDataSchematics, createSidebarSchematics, createSidebarDataSchematics,
  createChatSchematics, createChatDataSchematics, readChatSelection, readSidebarSelection, sidebarKey } = require('../dist/config');
const { sidebarDefaults } = require('../dist/runtime');
const { readModelSettings, readLegacyManualModel } = require('../dist/model-settings');
const { ModelCatalog, fetchModels, normalizeModels, isOpenRouterFreePricing, connectionIdentity } = require('../dist/catalog');
const { UsageTracker, parseUsage, balanceReport } = require('../dist/usage');
const { generate, consumeStream } = require('../dist/generator');

const reader = values => ({ get: key => values[key] });
const raw = values => ({ fields: Object.entries(values).map(([key, value]) => ({ key, value })) });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const cleanup = directory => {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('lms-model-settings-'));
  rmSync(directory, { recursive: true, force: true });
};

test('native sidebar exposes stable protected profile fields without reload-dependent visibility', () => {
  assert.deepEqual(providers.map(p => p.name), ['Anthropic', 'Custom 1', 'Custom 2', 'DeepSeek', 'Evren.ssyz', 'Gemini', 'GLM', 'Grok', 'Muskapi.cc', 'NVIDIA', 'OpenAI', 'OpenRouter']);
  const schema = createSidebarSchematics(reader({provider:'custom',customModel:'manual'}), {});
  const fields = schema.serialize().fields;
  const chatFields=createChatSchematics(reader({provider:'custom'})).serialize().fields;
  assert.equal(fields.length,53);
  assert.deepEqual(fields.slice(0,4).map(f=>f.fullKey),['showTokenUsage','showModelInfo','showSpeedTime','providerOrder'].map(sidebarKey));
  assert.deepEqual(chatFields.map(f=>f.fullKey),['activeProvider']);
  assert.equal(chatFields[0].typeParams.displayName,'▶ ACTIVE PROVIDER');
  assert.ok(!fields.some(f=>f.fullKey===sidebarKey('customModel')));
  assert.deepEqual(fields.filter(f=>f.typeKey==='select').map(f=>f.fullKey),
    ['anthropic','custom','custom2','deepseek','evren','gemini','glm','grok','muskapi','nvidia','openai','openrouter'].map(id=>sidebarKey(id+'SelectedModel')));
  for(const p of providers) {
    const key = fields.find(f=>f.fullKey===sidebarKey(p.apiKey));
    assert.equal(key.typeParams.isProtected,true);
    assert.equal(key.typeParams.nonConfigurable,undefined);
    const index=fields.findIndex(f=>f.fullKey===sidebarKey(p.id+'SelectedModel'));
    assert.deepEqual(fields.slice(index,index+4).map(f=>f.fullKey),
      [p.id+'SelectedModel',p.id+'CustomModel',p.apiKey,p.baseUrl].map(sidebarKey));
  }
});

test('saved provider order survives reload without changing routing or hiding omitted profiles', () => {
  const persisted=raw({
    [sidebarKey('providerOrder')]:'custom 2, DEEPSEEK; Custom 1, unknown, custom2',
    [sidebarKey('provider')]:'custom2', [sidebarKey('custom2SelectedModel')]:CUSTOM_MODEL_VALUE,
    [sidebarKey('custom2CustomModel')]:'saved-model', [sidebarKey('custom2ApiKey')]:'saved-key',
    [sidebarKey('custom2BaseUrl')]:'https://saved.example/v1'
  });
  const saved=readModelSettings(JSON.stringify({json:{plugins:[['omni/lms-omni-gateway',persisted]]}}));
  const schema=createSidebarSchematics(sidebarDefaults(saved),{});
  const fields=schema.serialize().fields;
  assert.equal(fields[2].fullKey,sidebarKey('showSpeedTime'));
  assert.equal(fields[3].fullKey,sidebarKey('providerOrder'));
  const ids=createChatSchematics(sidebarDefaults(saved)).serialize().fields[0].typeParams.options.map(o=>o.value);
  assert.deepEqual(ids,['custom2','deepseek','custom','anthropic','evren','gemini','glm','grok','muskapi','nvidia','openai','openrouter']);
  assert.equal(new Set(ids).size,providers.length);
  assert.deepEqual(fields.filter(f=>f.typeKey==='select').map(f=>f.fullKey),ids.map(id=>sidebarKey(id+'SelectedModel')));
  const selected=readChatSelection(createSidebarDataSchematics().parse(persisted),
    createChatDataSchematics(sidebarDefaults(saved)).parse(raw({})));
  const connection=resolveConnection(selected,[]);
  assert.equal(connection.provider.id,'custom2');
  assert.equal(connection.modelId,'saved-model');
  assert.equal(connection.apiKey,'saved-key');
  assert.equal(connection.baseURL,'https://saved.example/v1');
  const reset=raw(Object.fromEntries(persisted.fields.filter(f=>f.key!==sidebarKey('providerOrder')).map(f=>[f.key,f.value])));
  const restarted=sidebarDefaults(readModelSettings(JSON.stringify({json:{plugins:[['omni/lms-omni-gateway',reset]]}})));
  assert.deepEqual(createChatSchematics(restarted).serialize().fields[0].typeParams.options.map(o=>o.value),
    ['anthropic','custom','custom2','deepseek','evren','gemini','glm','grok','muskapi','nvidia','openai','openrouter']);
});

test('stable reset defaults match the UI and never resurrect saved or legacy manual IDs', () => {
  const saved=reader({[sidebarKey('provider')]:'custom2',[sidebarKey('customCustomModel')]:'my-model',
    [sidebarKey('custom2CustomModel')]:'', [sidebarKey('customApiKey')]:'saved-key',
    customModel:'gpt-4.1', [sidebarKey('customModel')]:'gpt-4.1'});
  const current=sidebarDefaults(saved);
  const ui=createSidebarSchematics(current,{}), parser=createSidebarDataSchematics();
  const blank=parser.parse(raw({}));
  for(const p of providers) {
    for(const key of [p.id+'CustomModel',p.apiKey]) {
      assert.equal(blank.get(sidebarKey(key)),'');
      if (key===p.apiKey) assert.equal(ui.parse(raw({})).get(sidebarKey(key)),'');
      else assert.equal(ui.parse(raw({})).get(sidebarKey(key)),'');
    }
    assert.equal(blank.get(sidebarKey(p.baseUrl)),p.url);
    assert.equal(blank.get(sidebarKey(p.id+'SelectedModel')),CUSTOM_MODEL_VALUE);
    assert.equal(ui.parse(raw({})).get(sidebarKey(p.id+'SelectedModel')),CUSTOM_MODEL_VALUE);
  }
  assert.equal(current.get('customCustomModel'),'my-model');
  assert.equal(current.get('custom2CustomModel'),'');
  assert.equal(current.get('openaiCustomModel'),'');
  // A fresh parser after restart reads native persisted values, not old defaults.
  const persisted=raw({[sidebarKey('provider')]:'custom',[sidebarKey('customCustomModel')]:'my-model'});
  for(let restart=0;restart<3;restart++) {
    assert.equal(readSidebarSelection(createSidebarDataSchematics().parse(persisted)).get('customModel'),'my-model');
  }
  persisted.fields=persisted.fields.filter(f=>f.key!==sidebarKey('customCustomModel'));
  assert.equal(readSidebarSelection(parser.parse(persisted)).get('customModel'),'');
  assert.equal(sidebarDefaults(readModelSettings(JSON.stringify({json:{plugins:[['omni/lms-omni-gateway',persisted]]}}))).get('customCustomModel'),'');
});

test('offline migration preserves native edits, keys, empty values and unrelated settings without copying the shared model', () => {
  const {migrateSidebarSettings}=require('../dist/settings-migration');
  const document={json:{plugins:[['other/plugin',{fields:[{key:'keep',value:'untouched'}]}],['omni/lms-omni-gateway',raw({
    [sidebarKey('provider')]:'custom2',[sidebarKey('customApiKey')]:'',
    [sidebarKey('customCustomModel')]:'user-model',[sidebarKey('custom2CustomModel')]:''
  })]]},meta:{keep:true}};
  const legacy=id=>reader({customModel:'gpt-4.1',[id+'SelectedModel']:CUSTOM_MODEL_VALUE,
    customApiKey:'old-key',deepseekApiKey:'keep-key',overrideBaseUrl:'https://saved.example/v1'});
  const result=migrateSidebarSettings(JSON.stringify(document),legacy,'custom');
  const config=sidebarDefaults(readModelSettings(result));
  assert.equal(config.get('provider'),'custom2');
  assert.equal(config.get('customApiKey'),'');
  assert.equal(config.get('deepseekApiKey'),'keep-key');
  assert.equal(config.get('overrideBaseUrl'),'https://saved.example/v1');
  assert.equal(config.get('customCustomModel'),'user-model');
  assert.equal(config.get('custom2CustomModel'),'');
  assert.equal(config.get('anthropicCustomModel'),'');
  assert.deepEqual(JSON.parse(result).json.plugins[0],document.json.plugins[0]);
  assert.deepEqual(JSON.parse(result).meta,document.meta);
  assert.equal(migrateSidebarSettings(result,legacy,'custom'),result);
});

test('switching providers restores independent models, keys and URLs', () => {
  const values = {
    provider: 'openrouter', openrouterSelectedModel: 'vendor/same', custom2SelectedModel: 'vendor/same',
    openrouterApiKey: 'router-test', custom2ApiKey: 'work-test', custom2BaseUrl: 'https://work.example/v1/',
    overrideBaseUrl: 'https://unrelated.example/v1', customModel: 'manual-kept',
  };
  const available = [{ id: 'vendor/same', name: 'Same model' }];
  let config = createConnectionDataSchematics().parse(raw(values));
  assert.equal(resolveConnection(config, available).apiKey, 'router-test');
  assert.equal(resolveConnection(config, available).baseURL, 'https://openrouter.ai/api/v1');
  values.provider = 'custom2';
  config = createConnectionDataSchematics().parse(raw(values));
  assert.equal(resolveConnection(config, available).apiKey, 'work-test');
  assert.equal(resolveConnection(config, available).baseURL, 'https://work.example/v1');
  assert.equal(config.get('customModel'), 'manual-kept');
});

test('existing Custom 1 fields and legacy manual model defaults are retained', () => {
  const values = { settingsConnection: 'custom', customApiKey: 'old-test', overrideBaseUrl: 'https://old.example/v1', customModel: 'gpt-4.1' };
  const config = createConnectionDataSchematics(reader(values)).parse(raw(values));
  const connection = resolveConnection(config, []);
  assert.equal(connection.apiKey, 'old-test');
  assert.equal(connection.modelId, 'gpt-4.1');
  assert.equal(connection.baseURL, 'https://old.example/v1');
});

test('manual input is used only when selected; removed models cannot silently reroute', () => {
  const values = { provider: 'deepseek', deepseekApiKey: 'test', deepseekSelectedModel: 'removed', customModel: 'manual-id' };
  const config = reader(values);
  assert.throws(() => resolveConnection(config, []), /no longer/);
  const schema = createConnectionDataSchematics(config);
  assert.equal(schema.parse(raw(values)).get('deepseekSelectedModel'), 'removed');
  values.deepseekSelectedModel = CUSTOM_MODEL_VALUE;
  assert.equal(resolveConnection(config, []).modelId, 'manual-id');
  values.customModel = '';
  assert.throws(() => resolveConnection(config, []), /Custom Model ID/);
});

test('invalid provider and malformed base URLs fail explicitly', () => {
  assert.throws(() => getProvider(reader({ provider: 'missing' })), /valid Provider/);
  for (const url of ['invalid', 'file:///tmp/file', 'https://user:pass@example.com', 'https://example.com?key=test']) {
    assert.throws(() => resolveConnection(reader({ provider: 'custom', overrideBaseUrl: url, customModel: 'm' }), []), /Base URL/);
  }
  assert.throws(() => resolveConnection(reader({ provider: 'openai', customModel: 'm' }), []), /API Key/);
  for (const [url, reason] of [
    ['https://example.com/v1/chat/completions', /Remove that suffix/],
    ['https://example.com/v1/models', /API root/],
    ['https://example.com/v1/responses', /API root/],
    ['https://example.com/v1/v1', /version twice/],
  ]) {
    assert.throws(() => resolveConnection(reader({ provider: 'custom', overrideBaseUrl: url, customModel: 'm' }), []), reason);
  }
  assert.equal(resolveConnection(reader({ provider: 'custom', overrideBaseUrl: 'https://example.com/proxy/v1/', customModel: 'm' }), []).baseURL,
    'https://example.com/proxy/v1');
});

test('NVIDIA profile keeps its own key, model and official API root', () => {
  const model='nvidia/nemotron-3.5-lightning-30b-a3b';
  const config=reader({provider:'nvidia',nvidiaApiKey:'nvapi-test',nvidiaSelectedModel:model,
    openaiApiKey:'unrelated-key'});
  const connection=resolveConnection(config,[{id:model,name:'Nemotron 3.5 Lightning 30B'}]);
  assert.equal(connection.provider.name,'NVIDIA');
  assert.equal(connection.modelId,model);
  assert.equal(connection.apiKey,'nvapi-test');
  assert.equal(connection.baseURL,'https://integrate.api.nvidia.com/v1');
});

test('settings reader accepts only this plugin and the fixed profile fields', () => {
  const settings = JSON.stringify({ json: { plugins: [
    ['other/plugin', raw({ provider: 'openai' })],
    ['omni/lms-omni-gateway', raw({ provider: 'deepseek', deepseekApiKey: 'needed-in-memory', customConnections: ['old'], manageCustomConnections: true })],
  ] } });
  const parsed = readModelSettings(settings);
  assert.equal(parsed.get('provider'), 'deepseek');
  assert.equal(parsed.get('deepseekApiKey'), 'needed-in-memory');
  assert.equal(parsed.get('customConnections'), undefined);
  assert.equal(parsed.get('manageCustomConnections'), undefined);
  assert.throws(() => readModelSettings('{}'), /format/);
});

test('manual migration reads plugin configuration without modifying a conversation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lms-model-settings-'));
  try {
    const data = { messages: ['unrelated'], pluginConfigs: { 'omni/lms-omni-gateway': { config: raw({ customModel: 'keep-this' }) } } };
    writeFileSync(join(dir, 'one.conversation.json'), JSON.stringify(data));
    assert.equal(readLegacyManualModel(dir), 'keep-this');
  } finally { cleanup(dir); }
});

test('discovery follows Anthropic pagination with its own authentication', async () => {
  const calls = [];
  const models = await fetchModels(reader({ provider: 'anthropic', anthropicApiKey: 'ant-test' }), async (url, init) => {
    calls.push({ url, headers: init.headers });
    return json(calls.length === 1
      ? { data: [{ id: 'model-z', display_name: 'Zebra' }], has_more: true, last_id: 'model-z' }
      : { data: [{ id: 'model-a', display_name: 'Alpha' }], has_more: false });
  });
  assert.deepEqual(models.map(m => m.name), ['Alpha', 'Zebra']);
  assert.equal(calls[0].headers['x-api-key'], 'ant-test');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.match(calls[1].url, /after_id=model-z/);
});

test('Gemini uses native model metadata, pagination and headers without a key in the URL', async () => {
  const calls = [];
  const models = await fetchModels(reader({ provider: 'gemini', geminiApiKey: 'google-test' }), async (url, init) => {
    calls.push({ url, headers: init.headers });
    return json(calls.length === 1
      ? { models: [{ name: 'models/gemini-text', displayName: 'Text', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'page-2' }
      : { models: [{ name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }] });
  });
  assert.deepEqual(models.map(m => m.id), ['gemini-text']);
  assert.equal(calls[0].headers['x-goog-api-key'], 'google-test');
  assert.equal(calls[0].url.includes('google-test'), false);
  assert.match(calls[1].url, /pageToken=page-2/);
});

test('catalog refresh replaces added/deleted models, caches, retains failures and isolates account changes', async () => {
  let now = 0, hits = 0, failing = false;
  let rows = [{ id: 'vendor/one' }];
  const config = reader({ provider: 'custom', customApiKey: 'first', overrideBaseUrl: 'https://custom.example/v1' });
  const catalog = new ModelCatalog(async () => { hits++; if (failing) throw new Error('offline'); return json({ data: rows }); }, () => now);
  assert.equal((await catalog.refresh(config)).models[0].id, 'vendor/one');
  await catalog.refresh(config);
  assert.equal(hits, 1);
  rows = [{ id: 'vendor/two' }];
  now += 16 * 60_000;
  assert.deepEqual((await catalog.refresh(config)).models.map(m => m.id), ['vendor/two']);
  failing = true;
  assert.deepEqual((await catalog.refresh(config, true)).models.map(m => m.id), ['vendor/two']);
  const changed = reader({ provider: 'custom', customApiKey: 'second', overrideBaseUrl: 'https://custom.example/v1' });
  assert.deepEqual(catalog.snapshot(changed).models, []);
  failing = false; rows = [];
  assert.deepEqual((await catalog.refresh(config, true)).models, []);
});

test('malformed, incomplete and looping catalogs never replace a valid list', async () => {
  for (const response of [{ noData: true }, { data: [], has_more: true }, { data: [], has_more: true, last_id: 'same' }]) {
    const config = reader({ provider: 'openai', openaiApiKey: 'test' });
    const catalog = new ModelCatalog(async () => json(response));
    const before = catalog.snapshot(config).models;
    assert.deepEqual((await catalog.refresh(config)).models, before);
    assert.equal(catalog.snapshot(config).live, false);
  }
});

test('model normalization deduplicates, sorts and filters non-chat outputs', () => {
  const provider = providers.find(p => p.id === 'openrouter');
  const result = normalizeModels([
    { id: 'vendor/z', name: 'Z' }, { id: 'vendor/a', name: 'A' }, { id: 'vendor/z', name: 'Z' },
    { id: 'vendor/image', architecture: { output_modalities: ['image'] } },
    { id: 'vendor/embedding' }, null,
  ], provider);
  assert.deepEqual(result.map(m => m.id), ['vendor/a', 'vendor/z']);
});

test('NVIDIA model discovery uses its public Models API and Bearer authentication when set', async () => {
  const calls=[];
  const response={data:[{id:'nvidia/nemotron-3.5-lightning-30b-a3b'},
    {id:'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'},
    {id:'nvidia/nemotron-3-embed-1b'}]};
  const models=await fetchModels(reader({provider:'nvidia',nvidiaApiKey:'nvapi-test'}),async(url,init)=>{
    calls.push({url,headers:init.headers});return json(response);
  });
  assert.equal(calls[0].url,'https://integrate.api.nvidia.com/v1/models');
  assert.equal(calls[0].headers.Authorization,'Bearer nvapi-test');
  assert.deepEqual(models.map(model=>model.id),[
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning','nvidia/nemotron-3.5-lightning-30b-a3b']);
  assert.equal(models[0].imageInput,true);
  const catalog=new ModelCatalog(async(url,init)=>{
    assert.equal(url,'https://integrate.api.nvidia.com/v1/models');
    assert.equal(init.headers.Authorization,undefined);
    return json(response);
  });
  assert.equal((await catalog.refresh(reader({provider:'nvidia'}))).live,true);
});

test('OpenRouter Free label needs explicit zero pricing and does not change model IDs', () => {
  const openrouter = providers.find(p => p.id === 'openrouter');
  const custom = providers.find(p => p.id === 'custom');
  const zero = { prompt: '0', completion: '0.0000', request: '0', image: 0 };
  assert.equal(isOpenRouterFreePricing(zero), true);
  for (const price of [undefined, {prompt:'0'}, {prompt:'0',completion:'0.001'},
    {prompt:'0',completion:'0',request:'0.01'}, {prompt:'0',completion:'0',image:null}]) {
    assert.equal(isOpenRouterFreePricing(price), false);
  }
  const rows = [
    {id:'vendor/free',name:'Free model',pricing:zero},
    {id:'vendor/paid',name:'Paid model',pricing:{prompt:'0',completion:'0.0001'}},
    {id:'vendor/unknown',name:'Unknown model'},
  ];
  const models = normalizeModels(rows,openrouter);
  assert.deepEqual(models.map(model=>[model.id,model.isFree]),[
    ['vendor/free',true],['vendor/paid',undefined],['vendor/unknown',undefined]]);
  assert.equal(normalizeModels(rows,custom)[0].isFree,undefined);
  assert.equal(normalizeModels(rows,openrouter,false)[0].isFree,undefined);
  const schema=createSidebarSchematics(reader({provider:'openrouter'}),{openrouter:models});
  const options=schema.serialize().fields.find(field=>field.fullKey===sidebarKey('openrouterSelectedModel')).typeParams.options;
  assert.ok(options.some(option=>option.value==='vendor/free' && option.displayName==='Free model · Not tested'));
  assert.ok(options.some(option=>option.value==='vendor/paid' && !option.displayName.includes('Free')));
  assert.ok(options.some(option=>option.value==='vendor/unknown' && !option.displayName.includes('Free')));
  const renamed=createSidebarSchematics(reader({provider:'openrouter'}),{openrouter:[{id:'vendor/free',name:'Model',isFree:true}]});
  assert.ok(renamed.serialize().fields.find(field=>field.fullKey===sidebarKey('openrouterSelectedModel'))
    .typeParams.options.some(option=>option.value==='vendor/free' && option.displayName==='Model · Free · Not tested'));
});

test('an older OpenRouter catalog refreshes pricing once and keeps the Free label after reload', async () => {
  const dir=mkdtempSync(join(tmpdir(),'lms-model-settings-'));
  try {
    const path=join(dir,'catalog.json');
    const config=reader({provider:'openrouter',openrouterApiKey:'private-test-key'});
    writeFileSync(path,JSON.stringify([[connectionIdentity(config),{
      models:[{id:'vendor/free',name:'Model'}],live:true,checked:1000
    }]]));
    let calls=0;
    const catalog=new ModelCatalog(async()=>{calls++;return json({data:[{
      id:'vendor/free',name:'Model',pricing:{prompt:'0',completion:'0',request:'0'}
    }]});},()=>2000,path);
    assert.equal(catalog.needsOpenRouterPricing(config),true);
    const models=(await catalog.refresh(config,catalog.needsOpenRouterPricing(config))).models;
    assert.equal(calls,1);
    assert.equal(models[0].isFree,true);
    const saved=readFileSync(path,'utf8');
    assert.equal(saved.includes('private-test-key'),false);
    const reloaded=new ModelCatalog(async()=>{throw Error('cache should be used');},()=>3000,path);
    assert.equal(reloaded.needsOpenRouterPricing(config),false);
    assert.equal((await reloaded.refresh(config)).models[0].isFree,true);
  } finally {cleanup(dir);}
});

test('a refreshed catalog survives reload without persisting keys or URLs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lms-model-settings-'));
  try {
    const path = join(dir, 'catalog.json');
    const config = reader({ provider: 'custom', customApiKey: 'never-persist-this-key', overrideBaseUrl: 'https://private.example/v1' });
    const catalog = new ModelCatalog(async () => json({ data: [{ id: 'live-model' }] }), () => 1000, path);
    await catalog.refresh(config, true);
    const text = readFileSync(path, 'utf8');
    assert.equal(text.includes('never-persist-this-key'), false);
    assert.equal(text.includes('private.example'), false);
    const reloaded = new ModelCatalog(async () => { throw new Error('should use cached data'); }, () => 2000, path);
    assert.equal((await reloaded.refresh(config)).models[0].id, 'live-model');
  } finally { cleanup(dir); }
});

test('local settings command does not make a provider request', async () => {
  let calls = 0;
  const catalog = new ModelCatalog(async () => { calls++; return json({ data: [] }); });
  let output = '';
  const ctl = { getGlobalPluginConfig: schema => schema.parse(raw({ provider: 'deepseek' })), fragmentGenerated: text => { output += text; } };
  const services = { catalog, usage: new UsageTracker(), defaults: reader({}), openSettings: async () => 'http://127.0.0.1:1/#test', refresh: async () => {} };
  await generate(ctl, Chat.from([{ role: 'user', content: '/settings' }]), services);
  assert.match(output, /right sidebar/);
  assert.equal(calls, 0);
});

test('stream usage-only chunks are counted once and missing usage is not fabricated', async () => {
  const config = reader({ provider: 'openai', openaiApiKey: 'test' });
  const tracker = new UsageTracker();
  let latest, text = '';
  async function* stream() {
    yield { choices: [{ delta: { content: 'hello' } }] };
    yield { choices: [], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } };
    yield { choices: [], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } };
  }
  await consumeStream(stream(), { fragmentGenerated: value => { text += value; } }, usage => { latest = usage; });
  tracker.record(config, latest); tracker.record(config);
  assert.equal(text, 'hello');
  assert.match(tracker.report(config), /Total tokens: 25/);
  assert.match(tracker.report(config), /Requests with usage: 1/);
  assert.equal(parseUsage({ prompt_tokens: -1, completion_tokens: 2 }), undefined);
  assert.equal(parseUsage(undefined), undefined);
});

test('DeepSeek balance and OpenRouter key limit are labelled distinctly', async () => {
  let received;
  const deep = await balanceReport(reader({ provider: 'deepseek', deepseekApiKey: 'test' }), async (url, init) => {
    received = { url, auth: init.headers.Authorization };
    return json({ balance_infos: [{ currency: 'USD', total_balance: '4.20' }] });
  });
  assert.equal(received.url, 'https://api.deepseek.com/user/balance');
  assert.equal(received.auth, 'Bearer test');
  assert.match(deep, /USD: 4.20/);
  const router = await balanceReport(reader({ provider: 'openrouter', openrouterApiKey: 'test' }), async url => {
    assert.equal(url, 'https://openrouter.ai/api/v1/key');
    return json({ data: { usage: 1.25, limit_remaining: 3.75 } });
  });
  assert.match(router, /Remaining key spending limit: \$ 3.7500/);
  assert.match(router, /not the account balance/);
  let hits = 0;
  const unsupported = await balanceReport(reader({ provider: 'glm' }), async () => { hits++; });
  assert.match(unsupported, /not implemented/);
  assert.equal(hits, 0);
});

test('generator sends matching key/model, keeps commands local and reports provider tokens', async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end('{"data":[]}'); return; }
    requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'test-ok' } }] }) + '\n\n' +
      'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }) + '\n\n' +
      'data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const globals = { provider: 'custom2', custom2ApiKey: 'local-test', custom2BaseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', customModel: 'chosen-model' };
    let response = '';
    const ctl = {
      getGlobalPluginConfig: schema => schema.parse(raw(globals)),
      getToolDefinitions: () => [], onAborted: () => {},
      fragmentGenerated: text => { response += text; },
    };
    const catalog = new ModelCatalog();
    const usage = new UsageTracker();
    const services = { catalog, usage, defaults: reader({}), refresh: config => catalog.refresh(config, true) };
    await generate(ctl, Chat.from([
      { role: 'user', content: '/usage' }, { role: 'assistant', content: 'private-local-report' },
      { role: 'user', content: 'test' },
    ]), services);
    assert.equal(require('../dist/usage-footer').stripUsageFooters(response), 'test-ok');
    assert.match(response, /Tokens: 10 input · 3 output · 13 total/);
    assert.equal(requests[0].auth, 'Bearer local-test');
    assert.equal(requests[0].body.model, 'chosen-model');
    assert.deepEqual(requests[0].body.messages, [{ role: 'user', content: 'test' }]);
    assert.equal(requests[0].body.stream_options, undefined);
    for (const command of ['/usage', '/models', '/balance']) await generate(ctl, Chat.from([{ role: 'user', content: command }]), services);
    assert.equal(requests.length, 1);
    assert.match(response, /Total tokens: 13/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('NVIDIA generation sends its selected model and requests streamed token usage', async () => {
  const requests=[];
  const server=createServer(async(req,res)=>{
    if(req.url==='/v1/models') {
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({data:[{id:'nvidia/nemotron-3.5-lightning-30b-a3b'}]}));
      return;
    }
    let body='';for await(const part of req)body+=part;
    requests.push({url:req.url,auth:req.headers.authorization,body:JSON.parse(body)});
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end('data: '+JSON.stringify({choices:[{delta:{content:'NVIDIA OK'}}]})+'\n\n'+
      'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:6,completion_tokens:2,total_tokens:8}})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const values={provider:'nvidia',nvidiaApiKey:'nvapi-local-test',
      nvidiaBaseUrl:`http://127.0.0.1:${server.address().port}/v1`,
      nvidiaSelectedModel:'nvidia/nemotron-3.5-lightning-30b-a3b'};
    let output='';
    const ctl={getGlobalPluginConfig:schema=>schema.parse(raw(values)),getToolDefinitions:()=>[],
      onAborted:()=>{},fragmentGenerated:text=>output+=text};
    const catalog=new ModelCatalog();
    await generate(ctl,Chat.from([{role:'user',content:'Hello'}]),{
      defaults:reader(values),catalog,usage:new UsageTracker(),refresh:async()=>{},
    });
    assert.equal(requests.length,1);
    assert.equal(requests[0].url,'/v1/chat/completions');
    assert.equal(requests[0].auth,'Bearer nvapi-local-test');
    assert.equal(requests[0].body.model,values.nvidiaSelectedModel);
    assert.deepEqual(requests[0].body.stream_options,{include_usage:true});
    assert.match(output,/NVIDIA OK/);
    assert.match(output,/Tokens: 6 input · 2 output · 8 total/);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('EVREN discovery uses API-key authentication and lists only chat tasks with reported vision support', async () => {
  const models = await fetchModels(reader({provider:'evren',evrenApiKey:'evren-test-key'}), async (url, init) => {
    assert.equal(url, 'https://evren-llmapi.ssyz.org.tr/v1/models');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('x-api-key'), 'evren-test-key');
    assert.equal(headers.has('authorization'), false);
    return json({data:[
      {id:'evren-text',task:'chat',capabilities:{vision:false}},
      {id:'evren-vision',task:'vision_chat',capabilities:{vision:true}},
      {id:'document-reader',task:'ocr',capabilities:{vision:true}},
      {id:'ranking-model',task:'rerank'},
      {id:'vector-model',task:'embedding'},
      {id:'speech-model',task:'audio_transcription'},
    ]});
  });
  assert.deepEqual(models.map(model => [model.id,model.imageInput]), [['evren-text',false],['evren-vision',true]]);
});

test('MuskAPI discovery uses the account Base URL and Bearer key without invented starter models', async () => {
  const provider = providers.find(p => p.id === 'muskapi');
  assert.equal(provider.url, '');
  assert.deepEqual(provider.models, []);
  const models = await fetchModels(reader({provider:'muskapi',muskapiApiKey:'musk-test-key',
    muskapiBaseUrl:'https://account.example/v1/'}), async (url, init) => {
    assert.equal(url, 'https://account.example/v1/models');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer musk-test-key');
    assert.equal(headers.has('x-api-key'), false);
    return json({data:[{id:'account-model'}]});
  });
  assert.deepEqual(models.map(model => model.id), ['account-model']);
});

test('EVREN and MuskAPI restore independent native profile settings and authenticate discovery and generation', async () => {
  const requests = [];
  const server = createServer(async (req,res) => {
    const provider = req.url?.startsWith('/evren/v1/') ? 'evren'
      : req.url?.startsWith('/muskapi/v1/') ? 'muskapi' : undefined;
    if (!provider) { res.writeHead(404); res.end(); return; }
    const auth = req.headers.authorization;
    const apiKey = req.headers['x-api-key'];
    const authenticated = provider === 'evren' ? apiKey === 'evren-local-key' && !auth
      : auth === 'Bearer muskapi-local-key' && !apiKey;
    if (!authenticated) {
      res.writeHead(401, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error:{message:'Wrong authentication header'}}));
      return;
    }
    let body = '';
    for await (const part of req) body += part;
    requests.push({provider,url:req.url,auth,apiKey,body:body ? JSON.parse(body) : undefined});
    if (req.url.endsWith('/models')) {
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({data:[{id:provider+'-chat',task:'chat',capabilities:{vision:false}}]}));
      return;
    }
    if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    res.end('data: '+JSON.stringify({choices:[{delta:{content:provider+' OK'}}]})+'\n\n'+
      'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13}})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const settings = raw({
      [sidebarKey('evrenSelectedModel')]:'evren-chat',
      [sidebarKey('evrenCustomModel')]:'saved-evren-manual',
      [sidebarKey('evrenApiKey')]:'evren-local-key',
      [sidebarKey('evrenBaseUrl')]:base+'/evren/v1',
      [sidebarKey('muskapiSelectedModel')]:'muskapi-chat',
      [sidebarKey('muskapiCustomModel')]:'saved-muskapi-manual',
      [sidebarKey('muskapiApiKey')]:'muskapi-local-key',
      [sidebarKey('muskapiBaseUrl')]:base+'/muskapi/v1',
    });
    const catalog = new ModelCatalog();
    const usage = new UsageTracker();
    for (const provider of ['evren','muskapi','evren']) {
      let output = '';
      const ctl = {
        getGlobalPluginConfig:schema => schema.parse(settings),
        getPluginConfig:schema => schema.parse(raw({activeProvider:provider})),
        getToolDefinitions:() => [], onAborted:() => {},
        fragmentGenerated:text => { output += text; },
      };
      // A fresh native parser simulates settings being restored after switching chats/reloading.
      const config = readChatSelection(createSidebarDataSchematics().parse(settings),
        createChatDataSchematics().parse(raw({activeProvider:provider})));
      assert.equal(config.get('customModel'),provider === 'evren' ? 'saved-evren-manual' : 'saved-muskapi-manual');
      await generate(ctl,Chat.from([{role:'user',content:'Hello'}]),{
        defaults:reader({}),catalog,usage,refresh:async () => {},
        getConfig:controller => readChatSelection(controller.getGlobalPluginConfig(createSidebarDataSchematics()),
          controller.getPluginConfig(createChatDataSchematics())),
      });
      assert.match(output,new RegExp(provider+' OK'));
      assert.match(output,/Tokens: 10 input · 3 output · 13 total/);
      assert.match(output,new RegExp('Model: '+provider+'-chat'));
    }
    assert.deepEqual(requests.filter(req => req.url.endsWith('/models')).map(req => req.provider),['evren','muskapi']);
    const chats = requests.filter(req => req.body);
    assert.deepEqual(chats.map(req => [req.provider,req.body.model]),[
      ['evren','evren-chat'],['muskapi','muskapi-chat'],['evren','evren-chat']]);
    for (const req of requests) {
      assert.equal(req.auth,req.provider === 'evren' ? undefined : 'Bearer muskapi-local-key');
      assert.equal(req.apiKey,req.provider === 'evren' ? 'evren-local-key' : undefined);
    }
    assert.deepEqual(chats[0].body.stream_options,{include_usage:true});
    assert.equal(chats[1].body.stream_options,undefined);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
