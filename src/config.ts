import { createConfigSchematics } from "@lmstudio/sdk";
import { CUSTOM_MODEL_VALUE, emptyConfig, getProvider, providers, textValue, type ConfigReader, type Model } from "./providers";

export const emptySchematics = createConfigSchematics().build();

export const sidebarKey = (key: string) => `sidebar.${key}`;
export const connectionKeys = ["provider", "providerOrder", "customModel", "openrouterManagementKey", "showTokenUsage", "showModelInfo", "showSpeedTime", ...providers.flatMap(p => [`${p.id}SelectedModel`, `${p.id}CustomModel`, p.apiKey, p.baseUrl])];
export const sidebarProviders = [...providers].sort((a, b) => a.name.localeCompare(b.name, "en"));
export const defaultProviderOrder = sidebarProviders.map(p => p.name).join(", ");

// Field keys stay tied to provider IDs; ordering never moves credentials between profiles.
export function orderedSidebarProviders(value: unknown) {
  const normalize = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ").replace(/^evren \(ssyz\)$/, "evren.ssyz");
  const selected = new Set<string>();
  const result: typeof sidebarProviders = [];
  for (const name of textValue(value).split(/[,;\r\n]+/)) {
    const match = sidebarProviders.find(p => normalize(p.name) === normalize(name) || p.id === normalize(name));
    if (match && !selected.has(match.id)) { selected.add(match.id); result.push(match); }
  }
  return [...result, ...sidebarProviders.filter(p => !selected.has(p.id))];
}

// Defaults describe reset behavior, never the user's last saved values.
export function sidebarDefault(key: string): string {
  if (key === "provider") return "custom";
  if (key === "providerOrder") return defaultProviderOrder;
  if (providers.some(p => key === `${p.id}SelectedModel`)) return CUSTOM_MODEL_VALUE;
  return providers.find(p => p.baseUrl === key)?.url ?? "";
}

function chatProviderDefault(config: ConfigReader): string {
  const saved = textValue(config.get("provider"));
  return providers.some(p => p.id === saved) ? saved : sidebarDefault("provider");
}

// LM Studio restores this field with each chat. Provider credentials and model
// choices remain in the shared sidebar settings below.
export function createChatSchematics(config: ConfigReader) {
  const ordered = orderedSidebarProviders(config.get("providerOrder"));
  return createConfigSchematics()
    .field("activeProvider", "select", { displayName: "▶ ACTIVE PROVIDER",
      hint: "This selection belongs to the current chat. It uses the matching model, API Key and Base URL below on the next message.",
      options: ordered.map(p => ({ value: p.id, displayName: p.name })) }, chatProviderDefault(config))
    .build();
}

export function createChatDataSchematics(config: ConfigReader = emptyConfig) {
  return createConfigSchematics().field("activeProvider", "string", {}, chatProviderDefault(config)).build();
}

// A stable field for every profile: switching never requires changing the schema.
export function createSidebarSchematics(config: ConfigReader, catalogs: Record<string, readonly Model[]>,
  statusLabel: (provider: string, model: string) => string = () => "Not tested") {
  const ordered = orderedSidebarProviders(config.get("providerOrder"));
  let fields = createConfigSchematics()
    .field(sidebarKey("showTokenUsage"), "boolean", { displayName: "Show Token Usage",
      hint: "Show token counts after the final response. Changes apply to the next message." }, true)
    .field(sidebarKey("showModelInfo"), "boolean", { displayName: "Show Model Info",
      hint: "Show the requested model and provider after the final response. Changes apply to the next message." }, true)
    .field(sidebarKey("showSpeedTime"), "boolean", { displayName: "Show Speed & Time",
      hint: "Show model response time and output tokens per second after the final response. Changes apply to the next message." }, true)
    .field(sidebarKey("providerOrder"), "string", { displayName: "Provider Order",
      subtitle: "Comma-separated names. Applies after restarting LM Studio.",
      placeholder: "Custom 1, DeepSeek, OpenAI, Anthropic",
      hint: "Use the provider names shown below. Omitted providers are added at the end. Duplicate and unknown names are ignored. After editing, the trash-shaped Reset control restores A–Z order, including Custom 1 and Custom 2. Restart LM Studio to apply. Model and connection settings are preserved."
    }, defaultProviderOrder);
  for (const p of ordered) {
    const models = catalogs[p.id] ?? p.models;
    const options = [...models].sort((a,b) => a.name.localeCompare(b.name,"en") || a.id.localeCompare(b.id,"en"))
      .map(m => ({ value: m.id, displayName: m.name
        + (p.id === "openrouter" && m.isFree === true && !/\bfree\b/i.test(m.name) ? " · Free" : "")
        + (m.imageInput === true ? " · Vision" : "") + " · " + statusLabel(p.id, m.id) }));
    const selected = textValue(config.get(`${p.id}SelectedModel`)) || CUSTOM_MODEL_VALUE;
    if (selected !== CUSTOM_MODEL_VALUE && !models.some(m => m.id === selected)) options.push({value: selected, displayName: `${selected} (unavailable)`});
    options.push({ value: CUSTOM_MODEL_VALUE, displayName: "Use custom model" });
    fields = fields
      .field(sidebarKey(`${p.id}SelectedModel`), "select", { displayName: "\u00a0",
        subtitle: `\u00a0\u2028──── ${p.name} · Model ────`, options }, CUSTOM_MODEL_VALUE)
      .field(sidebarKey(`${p.id}CustomModel`), "string", { displayName: `${p.name} Custom Model`,
        placeholder: "Enter a model ID" }, "")
      .field(sidebarKey(p.apiKey), "string", { displayName: `${p.name} API Key`, isProtected: true, placeholder: "Enter your API key" }, "")
      .field(sidebarKey(p.baseUrl), "string", { displayName: `${p.name} Base URL`, placeholder: "https://api.example.com/v1",
        ...(p.id === "muskapi" ? { hint: "Copy the current Base URL from MuskAPI's User Center → API Key page, including the API version path." } : {}) }, p.url);
    if (p.id === "openrouter") fields = fields.field(sidebarKey("openrouterManagementKey"), "string", {
      displayName: "OpenRouter Management Key (optional)", isProtected: true, placeholder: "Only for /balance",
      hint: "Used only for account balance at OpenRouter's default URL, never for chat or model discovery. Without it, /balance shows the chat key's spending limit, not account balance."
    }, "");
  }
  return fields.build();
}

// All generation code receives the active profile's manual ID through its
// existing customModel key. An intentionally empty manual ID stays empty.
export function readSidebarSelection(native: ConfigReader): ConfigReader {
  const config: ConfigReader = { get: key => native.get(sidebarKey(key)) };
  const provider = getProvider(config);
  return { get: key => key === "customModel" ? config.get(`${provider.id}CustomModel`) : config.get(key) };
}

export function readChatSelection(global: ConfigReader, chat: ConfigReader): ConfigReader {
  const shared: ConfigReader = { get: key => global.get(sidebarKey(key)) };
  const active = textValue(chat.get("activeProvider"));
  const config: ConfigReader = { get: key => key === "provider" ? active : shared.get(key) };
  const provider = getProvider(config);
  return { get: key => key === "customModel" ? shared.get(`${provider.id}CustomModel`) : config.get(key) };
}

export function createSidebarDataSchematics() {
  let fields = createConfigSchematics();
  for (const key of connectionKeys) fields = key === "showTokenUsage" || key === "showModelInfo" || key === "showSpeedTime"
    ? fields.field(sidebarKey(key), "boolean", {}, true)
    : fields.field(sidebarKey(key), "string", {}, sidebarDefault(key));
  return fields.build();
}

// Legacy parser retained for migration.
export function createConnectionDataSchematics(defaultConfig: ConfigReader = emptyConfig) {
  let fields = createConfigSchematics()
    .field("provider", "string", {}, getProvider(defaultConfig).id)
    .field("settingsConnection", "string", {}, "")
    .field("customModel", "string", {}, textValue(defaultConfig.get("customModel")));
  for (const provider of providers) {
    fields = fields
      .field(`${provider.id}SelectedModel`, "string", {}, CUSTOM_MODEL_VALUE)
      .field(provider.apiKey, "string", { isProtected: true }, "")
      .field(provider.baseUrl, "string", {}, provider.url);
  }
  return fields.build();
}
