import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { connectionDetails, getProvider, textValue, type ConfigReader, type Model, type Provider } from "./providers";
import { imageCapability } from "./vision";
import type { CapabilityReference } from "./capability-reference";

export type Fetch = typeof fetch;
export interface Catalog { models: readonly Model[]; status: string; live: boolean }
interface CacheEntry extends Catalog { checked: number; retryAt: number; freePricingKnown?: boolean }
const REFRESH_MS = 15 * 60_000;
const RETRY_MS = 5 * 60_000;

export function connectionIdentity(config: ConfigReader): string {
  const provider = getProvider(config);
  return createHash("sha256").update(JSON.stringify([
    provider.id, textValue(config.get(provider.baseUrl)) || provider.url, textValue(config.get(provider.apiKey)),
  ])).digest("hex");
}

export async function requestJSON(url: string, headers: Record<string, string>, fetcher: Fetch = fetch): Promise<any> {
  const response = await fetcher(url, { headers, redirect: "error", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`API returned HTTP ${response.status}.`);
  // Do not surface response bodies: an endpoint can echo credentials or private data.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The API returned no data.");
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8_000_000) { await reader.cancel(); throw new Error("The API response is too large."); }
    parts.push(value);
  }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw new Error("The API did not return valid JSON."); }
}

function zeroPrice(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value === 0;
  return typeof value === "string" && /^0+(?:\.0+)?(?:e[+-]?\d+)?$/i.test(value.trim());
}

// A Free label needs explicit zero prices for both token directions and every
// other price component the official OpenRouter response supplies.
export function isOpenRouterFreePricing(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pricing = value as Record<string, unknown>;
  return zeroPrice(pricing.prompt) && zeroPrice(pricing.completion)
    && Object.values(pricing).every(zeroPrice);
}

export function normalizeModels(data: any[], provider: Provider, trustedOpenRouterPricing = provider.id === "openrouter"): Model[] {
  const found = new Map<string, Model>();
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const id = textValue(row.id || (typeof row.name === "string" ? row.name.replace(/^models\//, "") : ""));
    if (!id || id.length > 500 || /[\r\n\x00-\x1f]/.test(id)) continue;
    if (Array.isArray(row.supportedGenerationMethods) && !row.supportedGenerationMethods.includes("generateContent")) continue;
    if (Array.isArray(row.architecture?.output_modalities) && !row.architecture.output_modalities.includes("text")) continue;
    if (provider.id === "evren" && typeof row.task === "string" && !["chat", "vision_chat"].includes(row.task)) continue;
    // The plugin generates text. Model listing APIs also contain non-chat models.
    if (/(embed|moderation|transcrib|whisper|tts|realtime|gpt-audio|native-audio|dall-e|gpt-image|imagen|veo|lyria|imagine|deep-research|computer-use|codex)/i.test(id)) continue;
    if (provider.id === "gemini" && /(-live|-image|omni)/i.test(id)) continue;
    if (provider.id === "openai" && (!/^(gpt-|chatgpt-|o[1-9]|ft:)/.test(id) || /-pro(?:-|$)/.test(id))) continue;
    const known = provider.models.find(model => model.id === id);
    const name = textValue(row.display_name || row.displayName || (row.id ? row.name : "")) || known?.name || id;
    found.set(id, { id, name: name.replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 500), ...imageCapability(provider.id, id, row),
      ...(trustedOpenRouterPricing && isOpenRouterFreePricing(row.pricing) ? { isFree: true } : {}) });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en"));
}

export async function fetchModels(config: ConfigReader, fetcher: Fetch = fetch): Promise<Model[]> {
  const { provider, apiKey, baseURL } = connectionDetails(config);
  const headers: Record<string, string> = { Accept: "application/json" };
  const nativeGemini = provider.id === "gemini" && baseURL === provider.url;
  const endpoint = nativeGemini ? "https://generativelanguage.googleapis.com/v1beta/models" : `${baseURL}/models`;
  if (apiKey) {
    if (provider.id === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (nativeGemini) headers["x-goog-api-key"] = apiKey;
    else if (provider.id === "evren") headers["X-API-Key"] = apiKey;
    else headers.Authorization = `Bearer ${apiKey}`;
  }
  const rows: any[] = [];
  let cursor = "";
  const seen = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const url = new URL(endpoint);
    if (provider.id === "anthropic") url.searchParams.set("limit", "1000");
    if (nativeGemini) url.searchParams.set("pageSize", "1000");
    if (cursor) url.searchParams.set(nativeGemini ? "pageToken" : "after_id", cursor);
    const result = await requestJSON(url.toString(), headers, fetcher);
    const entries = nativeGemini ? result.models : result.data;
    if (!Array.isArray(entries)) throw new Error("This endpoint does not provide a compatible model list.");
    rows.push(...entries);
    const next = nativeGemini ? result.nextPageToken : result.has_more ? result.last_id : "";
    if (!next) {
      if (result.has_more) throw new Error("The API returned an incomplete model list.");
      return normalizeModels(rows, provider, provider.id === "openrouter" && baseURL === provider.url);
    }
    if (typeof next !== "string" || seen.has(next)) throw new Error("The API repeated a model page.");
    seen.add(next);
    cursor = next;
  }
  throw new Error("The model list exceeded the page limit.");
}

export class ModelCatalog {
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<Catalog>>();
  constructor(private fetcher: Fetch = fetch, private now: () => number = Date.now, private cachePath?: string, private reference?: CapabilityReference) {
    if (!cachePath) return;
    try {
      const text = readFileSync(cachePath, "utf8");
      if (text.length > 8_000_000) return;
      const entries: unknown = JSON.parse(text);
      if (!Array.isArray(entries)) return;
      for (const [key, entry] of entries.slice(-30)) {
        if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key) || !entry?.live
          || !Number.isFinite(entry.checked) || entry.checked > this.now() || !Array.isArray(entry.models)) continue;
        if (!entry.models.every((model: any) => typeof model?.id === "string" && typeof model?.name === "string")) continue;
        this.cache.set(key, { models: entry.models, live: true, checked: entry.checked,
          freePricingKnown: entry.freePricingKnown === true,
          retryAt: entry.checked + REFRESH_MS, status: "Saved API list. Send /models to refresh it." });
      }
    } catch { /* Missing or invalid optional cache: use verified starter models. */ }
  }

  private save() {
    if (!this.cachePath) return;
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true });
      // Only model metadata, timestamps and connection digests are persisted.
      // API keys, URLs, messages and billing data are never written here.
      const entries = [...this.cache.entries()].filter(([, entry]) => entry.live)
        .sort((a, b) => a[1].checked - b[1].checked).slice(-30)
        .map(([key, entry]) => [key, { models: entry.models, live: true, checked: entry.checked,
          freePricingKnown: entry.freePricingKnown === true }]);
      const temporary = this.cachePath + "." + process.pid + ".tmp";
      writeFileSync(temporary, JSON.stringify(entries), { mode: 0o600 });
      renameSync(temporary, this.cachePath);
    } catch { console.warn("Model cache could not be saved; the in-memory catalog remains available."); }
  }

  snapshot(config: ConfigReader): Catalog {
    const key = connectionIdentity(config);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const provider = getProvider(config);
    const url = textValue(config.get(provider.baseUrl)) || provider.url;
    const models = url === provider.url ? provider.models : [];
    return { models, live: false, status: models.length ? "Starter list. Models refresh automatically when connected." : "Enter connection details to load models, or use Custom Model." };
  }

  needsOpenRouterPricing(config: ConfigReader): boolean {
    let details: ReturnType<typeof connectionDetails>;
    try { details = connectionDetails(config); } catch { return false; }
    return details.provider.id === "openrouter" && details.baseURL === details.provider.url
      && this.cache.get(connectionIdentity(config))?.freePricingKnown !== true;
  }

  async refresh(config: ConfigReader, force = false): Promise<Catalog> {
    const key = connectionIdentity(config);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const cached = this.cache.get(key);
    if (!force && cached && this.now() < cached.retryAt) return cached;
    const prior = this.snapshot(config);
    let details: ReturnType<typeof connectionDetails>;
    try { details = connectionDetails(config); } catch { return prior; }
    if (!details.apiKey && !details.provider.id.startsWith("custom")
      && !["openrouter", "nvidia"].includes(details.provider.id)) return prior;
    const task = (async () => {
      let entry: CacheEntry;
      try {
        let models = await fetchModels(config, this.fetcher);
        if (this.reference) models = await this.reference.enrich(models, details.provider.id);
        entry = { models, live: true, status: "Model list synced from API.", checked: this.now(), retryAt: this.now() + REFRESH_MS,
          freePricingKnown: details.provider.id === "openrouter" && details.baseURL === details.provider.url };
      } catch {
        entry = { ...prior, status: prior.live ? "Refresh unavailable; showing the last API list. /models retries." : "Live list unavailable; use the starter list or Custom Model.", checked: cached?.checked ?? this.now(), retryAt: this.now() + RETRY_MS };
      }
      this.cache.set(key, entry);
      this.save();
      return entry;
    })();
    this.pending.set(key, task);
    try { return await task; } finally { this.pending.delete(key); }
  }
}
