import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectionIdentity } from "./catalog";
import type { ConfigReader } from "./providers";

export const statusLabels = {
  worked: "Worked", restricted: "Access restricted", unavailable: "Model unavailable",
  temporary: "Temporarily unavailable", limited: "Rate / quota limited",
} as const;
type Status = keyof typeof statusLabels;
export interface RequestDiagnosis { status?: Status; explanation: string }
const ttl: Record<Status, number> = { worked: 30 * 86400_000, restricted: 7 * 86400_000,
  unavailable: 86400_000, temporary: 5 * 60_000, limited: 5 * 60_000 };

// Examine upstream text in memory only. Never echo/store a response body, which
// can contain credentials, request content or private account identifiers.
export function diagnoseRequest(code: number | undefined, detail = ""): RequestDiagnosis {
  const text = detail.slice(0, 16000).toLowerCase();
  if (code === 401) return { explanation: "Authentication failed. Check this connection's API key." };
  if (code === 402) return { explanation: "The provider requires payment or additional credit. Check its billing dashboard." };
  if ((code === 403 || code === 404) && /model/.test(text)) {
    if (/no longer available to new users|only available to (?:existing|previous) users/.test(text))
      return { status: "restricted", explanation: "The provider no longer offers this model to new users. Choose a newer model." };
    if (/do not have access|does not have access|don.t have access|not have permission|not authorized|not authorised|access.{0,30}(?:denied|restricted)|not available (?:for|to) (?:your|this) (?:account|project|api key)/.test(text))
      return { status: "restricted", explanation: "The provider reports that this account cannot access this model." };
    if (/decommissioned|retired|shut.?down|discontinued|no longer (?:available|supported)/.test(text))
      return { status: "unavailable", explanation: "The provider reports that this model has been retired or is no longer available." };
    if (/model.{0,180}(?:not found|does not exist|not supported)|model[_ -]?not[_ -]?found|unknown model|no such model/.test(text))
      return { status: "unavailable", explanation: "The provider cannot find or serve this model through the requested API. Check the model ID and Base URL." };
  }
  if (code === 429) return { status: "limited", explanation: "A request-rate or usage quota limit was reached. This does not establish that the model is inaccessible." };
  if (code !== undefined && [408, 500, 502, 503, 504].includes(code))
    return { status: "temporary", explanation: "The provider is temporarily unavailable or timed out. Try again later." };
  if (code === 403) return { explanation: "The request was denied. Check account permissions and provider policy restrictions." };
  if (code === 404) return { explanation: "The requested resource was not found. Check the model ID and Base URL; this alone does not prove the model was retired." };
  if (code === 400 || code === 422) return { explanation: "The provider rejected the request format or an unsupported feature. This is not proof of missing model access." };
  return { explanation: "The request did not complete. Check the connection and provider status. Model access could not be determined." };
}

// Only a short, structured provider message is shown. Never expose a raw HTTP
// body: compatible endpoints may echo API keys, prompts or HTML in an error.
export function providerErrorDetail(error: unknown, apiKey: string): string | undefined {
  if (!error || typeof error !== "object") return;
  const source = error as { error?: unknown; code?: unknown };
  const body = source.error && typeof source.error === "object"
    ? source.error as { message?: unknown; code?: unknown } : undefined;
  const rawCode = body?.code ?? source.code;
  const code = typeof rawCode === "string" && /^[a-z0-9_.-]{1,48}$/i.test(rawCode)
    && /model|quota|rate|auth|access|invalid|unsupported|not_found|overload|timeout|server|service|insufficient|payment/i.test(rawCode)
    ? rawCode : "";
  if (typeof body?.message !== "string") return code || undefined;
  const message = body.message.split(/\r?\n|(?<=[.!?])\s+(?=[A-Z])|;\s*/)[0].trim();
  if (!message || message.length > 240 || /[{}<>]|https?:\/\/|bearer\s+\S+|\b(?:sk|AIza)[-_][a-z0-9_-]{8,}/i.test(message)
    || (apiKey.length >= 8 && message.includes(apiKey))
    || !/model|quota|rate|credit|balance|permission|access|authoriz|authenticat|invalid|unsupported|not found|unavailable|overload|timeout|timed out|context|token|capacity|server|service/i.test(message)) {
    return code || undefined;
  }
  return code && !message.toLowerCase().includes(code.toLowerCase()) ? `${code}: ${message}` : message;
}

interface Observation { version: 1; model: string; status: Status; checked: number }
export class ModelStatusTracker {
  private memory = new Map<string, Observation>();
  constructor(private directory?: string, private now: () => number = Date.now) {}
  private key(config: ConfigReader, model: string) {
    return createHash("sha256").update(connectionIdentity(config) + "\0" + model).digest("hex");
  }
  record(config: ConfigReader, model: string, status: Status) {
    const key = this.key(config, model);
    const row: Observation = { version: 1, model, status, checked: this.now() };
    this.memory.set(key, row);
    if (!this.directory) return;
    try {
      mkdirSync(this.directory, { recursive: true });
      const path = join(this.directory, key + ".json"), temp = path + "." + randomUUID() + ".tmp";
      writeFileSync(temp, JSON.stringify(row), { mode: 0o600 }); renameSync(temp, path);
    } catch { console.warn("Model status could not be saved. The response is unaffected."); }
  }
  observation(config: ConfigReader, model: string): Observation | undefined {
    const key = this.key(config, model);
    let row = this.memory.get(key);
    if (this.directory) try {
      const text = readFileSync(join(this.directory, key + ".json"), "utf8");
      if (text.length < 4000) row = JSON.parse(text);
    } catch { /* A missing or damaged optional observation is not an API failure. */ }
    if (!row || row.version !== 1 || row.model !== model || !Object.prototype.hasOwnProperty.call(statusLabels, row.status)
      || !Number.isFinite(row.checked) || row.checked > this.now()
      || this.now() - row.checked > ttl[row.status]) return;
    return row;
  }
  label(config: ConfigReader, model: string) {
    const row = this.observation(config, model);
    return row ? statusLabels[row.status] : "Not tested";
  }
  report(config: ConfigReader, model: string) {
    const row = this.observation(config, model);
    return row ? `${statusLabels[row.status]} (last observed ${new Date(row.checked).toISOString()})` : "Not tested recently";
  }
}
