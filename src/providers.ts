export const CUSTOM_MODEL_VALUE = "__custom__";
export interface ConfigReader { get(key: string): unknown }
export interface Model { id: string; name: string; imageInput?: boolean; capabilitySource?: string; isFree?: boolean }
export interface Provider {
  id: string; name: string; apiKey: string; baseUrl: string; url: string;
  models: readonly Model[];
}
const models = (entries: Record<string, string>): Model[] =>
  Object.entries(entries).map(([id, name]) => ({ id, name }));

// Offline starting lists verified against official documentation on 2026-09-23.
// A successful Models API response replaces these lists, including removals.
export const providers: readonly Provider[] = [
  { id: "anthropic", name: "Anthropic", apiKey: "anthropicApiKey", baseUrl: "anthropicBaseUrl", url: "https://api.anthropic.com/v1", models: models({
    "claude-fable-5-1": "Claude Fable 5.1", "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
    "claude-opus-5-5": "Claude Opus 5.5", "claude-sonnet-5": "Claude Sonnet 5",
  }) },
  { id: "custom", name: "Custom 1", apiKey: "customApiKey", baseUrl: "overrideBaseUrl", url: "", models: [] },
  { id: "custom2", name: "Custom 2", apiKey: "custom2ApiKey", baseUrl: "custom2BaseUrl", url: "", models: [] },
  { id: "deepseek", name: "DeepSeek", apiKey: "deepseekApiKey", baseUrl: "deepseekBaseUrl", url: "https://api.deepseek.com/v1", models: models({
    "deepseek-flash": "DeepSeek-V4.1-Flash", "deepseek-v4-pro": "DeepSeek-V4-Pro",
  }) },
  { id: "evren", name: "Evren.ssyz", apiKey: "evrenApiKey", baseUrl: "evrenBaseUrl", url: "https://evren-llmapi.ssyz.org.tr/v1", models: [] },
  { id: "gemini", name: "Gemini", apiKey: "geminiApiKey", baseUrl: "geminiBaseUrl", url: "https://generativelanguage.googleapis.com/v1beta/openai", models: models({
    "gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite", "gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
    "gemini-3.5-flash": "Gemini 3.5 Flash", "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
    "gemini-3.6-flash": "Gemini 3.6 Flash", "gemini-3.7-flash": "Gemini 3.7 Flash", "gemini-3.8-flash": "Gemini 3.8 Flash",
  }) },
  { id: "glm", name: "GLM", apiKey: "glmApiKey", baseUrl: "glmBaseUrl", url: "https://api.z.ai/api/paas/v4", models: models({
    "glm-5.2": "GLM-5.2", "glm-5.3": "GLM-5.3", "glm-5.3-flash": "GLM-5.3-Flash", "glm-5.3-flashx": "GLM-5.3-FlashX",
  }) },
  { id: "grok", name: "Grok", apiKey: "grokApiKey", baseUrl: "grokBaseUrl", url: "https://api.x.ai/v1", models: models({ "grok-4.7": "Grok 4.7" }) },
  { id: "muskapi", name: "Muskapi.cc", apiKey: "muskapiApiKey", baseUrl: "muskapiBaseUrl", url: "", models: [] },
  { id: "nvidia", name: "NVIDIA", apiKey: "nvidiaApiKey", baseUrl: "nvidiaBaseUrl", url: "https://integrate.api.nvidia.com/v1", models: models({
    "nvidia/nemotron-3.5-lightning-30b-a3b": "Nemotron 3.5 Lightning 30B",
    "nvidia/nemotron-3-super-120b-a12b": "Nemotron 3 Super 120B",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": "Nemotron 3 Nano Omni 30B",
    "deepseek-ai/deepseek-v4.1-flash": "DeepSeek V4.1 Flash (NVIDIA)",
    "openai/gpt-oss-20b": "GPT-OSS 20B (NVIDIA)",
  }) },
  { id: "openai", name: "OpenAI", apiKey: "openaiApiKey", baseUrl: "openaiBaseUrl", url: "https://api.openai.com/v1", models: models({
    "gpt-6-astra": "GPT-6 Astra", "gpt-6-luna": "GPT-6 Luna", "gpt-6-sol": "GPT-6 Sol",
    "gpt-5.6-sol": "GPT-5.6 Sol", "gpt-5.6-terra": "GPT-5.6 Terra", "gpt-5.6-luna": "GPT-5.6 Luna",
  }) },
  { id: "openrouter", name: "OpenRouter", apiKey: "openrouterApiKey", baseUrl: "openrouterBaseUrl", url: "https://openrouter.ai/api/v1", models: [] },
].sort((a, b) => a.name.localeCompare(b.name, "en"));

export const emptyConfig: ConfigReader = { get: () => undefined };
export const textValue = (value: unknown) => typeof value === "string" ? value.trim() : "";
export function getProvider(config: ConfigReader): Provider {
  const legacy = textValue(config.get("settingsConnection"));
  const id = textValue(config.get("provider")) || (providers.some(provider => provider.id === legacy) ? legacy : "custom");
  const provider = providers.find(item => item.id === id);
  if (!provider) throw new Error("Select a valid Provider.");
  return provider;
}

export function normalizeBaseURL(value: unknown): string {
  const input = textValue(value);
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Enter a valid Base URL."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Base URL must be an HTTP(S) address without credentials, query parameters or a fragment.");
  }
  const segments = url.pathname.split("/").filter(Boolean).map(segment => segment.toLowerCase());
  const last = segments.at(-1);
  if (last === "completions" && segments.at(-2) === "chat") {
    throw new Error("Base URL includes /chat/completions. Remove that suffix; the plugin adds it when sending a message.");
  }
  if (last === "models" || last === "responses") {
    throw new Error(`Base URL includes /${last}. Remove that suffix; enter the API root instead.`);
  }
  if (segments.some((segment, index) => index > 0 && /^v\d+(?:beta\d*)?$/.test(segment) && segment === segments[index - 1])) {
    throw new Error("Base URL contains the API version twice (for example /v1/v1). Remove the duplicate segment.");
  }
  return input.replace(/\/+$/, "");
}

export function connectionDetails(config: ConfigReader) {
  const provider = getProvider(config);
  const apiKey = textValue(config.get(provider.apiKey));
  const baseURL = normalizeBaseURL(textValue(config.get(provider.baseUrl)) || provider.url);
  return { provider, apiKey, baseURL };
}

export function resolveConnection(config: ConfigReader, availableModels: readonly Model[]) {
  const connection = connectionDetails(config);
  const selected = textValue(config.get(`${connection.provider.id}SelectedModel`)) || CUSTOM_MODEL_VALUE;
  const modelId = selected === CUSTOM_MODEL_VALUE ? textValue(config.get("customModel")) : selected;
  if (!modelId) throw new Error("Choose a Model or enter a Custom Model ID.");
  if (selected !== CUSTOM_MODEL_VALUE && !availableModels.some(model => model.id === modelId)) {
    throw new Error("The selected model is no longer in this provider's list. Choose another Model or explicitly use Custom Model.");
  }
  if (!connection.apiKey && !connection.provider.id.startsWith("custom")) throw new Error(`Enter the ${connection.provider.name} API Key.`);
  return { ...connection, modelId };
}
