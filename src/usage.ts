import { connectionDetails, getProvider, type ConfigReader } from "./providers";
import { connectionIdentity, requestJSON, type Fetch } from "./catalog";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface TokenUsage { input: number; output: number; total: number; cachedInput?: number; reportedCost?: number }
export function parseUsage(usage: any): TokenUsage | undefined {
  if (!usage) return;
  const input = usage.prompt_tokens;
  const output = usage.completion_tokens;
  const total = usage.total_tokens ?? (input + output);
  if (![input, output, total].every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) return;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens;
  const cost = usage.cost;
  return { input, output, total,
    ...(Number.isSafeInteger(cached) && cached >= 0 ? { cachedInput: cached } : {}),
    ...(typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? { reportedCost: cost } : {}),
  };
}

interface UsageEvent { id: string; time: string; model: string; usage?: TokenUsage }
export interface UsageSummary {
  input: number; output: number; total: number; cachedInput: number;
  reported: number; missing: number; reportedCost: number; requestsWithCost: number;
  thisMonth: number; last?: UsageEvent; models: Array<{ model: string; tokens: number; requests: number }>;
  persistent: boolean;
}
export class UsageTracker {
  private events = new Map<string, UsageEvent[]>();
  constructor(private directory?: string) {}
  record(config: ConfigReader, usage?: TokenUsage, model = "unspecified") {
    const key = connectionIdentity(config);
    const event: UsageEvent = { id: randomUUID(), time: new Date().toISOString(), model, usage };
    if (this.directory) {
      const folder = join(this.directory, key, event.time.slice(0, 7));
      mkdirSync(folder, { recursive: true });
      // One immutable file per request avoids lost counts across concurrent chats.
      const temporary = join(folder, event.id + ".tmp");
      writeFileSync(temporary, JSON.stringify(event), { flag: "wx", mode: 0o600 });
      renameSync(temporary, join(folder, event.id + ".json"));
    } else this.events.set(key, [...(this.events.get(key) ?? []), event]);
  }
  summary(config: ConfigReader): UsageSummary {
    const key = connectionIdentity(config);
    let events = this.events.get(key) ?? [];
    if (this.directory) {
      events = [];
      const folder = join(this.directory, key);
      let months: string[] = [];
      try { months = readdirSync(folder).filter(name => /^\d{4}-\d{2}$/.test(name)); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Unable to read saved usage.");
      }
      for (const month of months) for (const file of readdirSync(join(folder, month))) {
        if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
        const event = JSON.parse(readFileSync(join(folder, month, file), "utf8")) as UsageEvent;
        if (typeof event.time !== "string" || typeof event.model !== "string") throw new Error("Unable to read saved usage.");
        if (event.usage && (![event.usage.input, event.usage.output, event.usage.total].every(value => Number.isSafeInteger(value) && value >= 0)
          || (event.usage.reportedCost !== undefined && (!Number.isFinite(event.usage.reportedCost) || event.usage.reportedCost < 0)))) throw new Error("Unable to read saved usage.");
        events.push(event);
      }
    }
    const summary: UsageSummary = { input: 0, output: 0, total: 0, cachedInput: 0, reported: 0, missing: 0,
      reportedCost: 0, requestsWithCost: 0, thisMonth: 0, models: [], persistent: Boolean(this.directory) };
    const month = new Date().toISOString().slice(0, 7);
    const models = new Map<string, { model: string; tokens: number; requests: number }>();
    for (const event of events) {
      if (!summary.last || event.time > summary.last.time) summary.last = event;
      const row = models.get(event.model) ?? { model: event.model, tokens: 0, requests: 0 }; row.requests++;
      if (event.usage) {
        summary.reported++; summary.input += event.usage.input; summary.output += event.usage.output;
        summary.total += event.usage.total; row.tokens += event.usage.total;
        summary.cachedInput += event.usage.cachedInput ?? 0;
        if (event.time.startsWith(month)) summary.thisMonth += event.usage.total;
        if (event.usage.reportedCost !== undefined) { summary.reportedCost += event.usage.reportedCost; summary.requestsWithCost++; }
      } else summary.missing++;
      models.set(event.model, row);
    }
    summary.models = [...models.values()].sort((a, b) => a.model.localeCompare(b.model, "en"));
    return summary;
  }
  report(config: ConfigReader): string {
    const provider = getProvider(config);
    const row = this.summary(config);
    const heading = `${provider.name} — usage recorded by this plugin\n\n`;
    if (!row.reported && !row.missing) return heading + "No requests recorded for this connection yet.";
    const format = (value: number) => value.toLocaleString("en-US");
    return heading + [
      `Input tokens: ${format(row.input)}`, `Output tokens: ${format(row.output)}`, `Total tokens: ${format(row.total)}`,
      `Requests with usage: ${row.reported}`, `Requests without usage (including interrupted requests): ${row.missing}`,
      `This month (UTC): ${format(row.thisMonth)} tokens`,
      ...(row.last?.usage ? [`Last reported request: ${format(row.last.usage.total)} tokens`] : []),
      ...(row.requestsWithCost ? [`API-reported cost: $${row.reportedCost.toFixed(6)} (${row.requestsWithCost} requests)`] : []),
      "", "Only provider-reported usage is counted. This is not account-wide billing.",
      row.persistent ? "Usage is saved locally and survives restarts." : "These test-session counters are not saved.",
    ].join("\n");
  }
}

export async function balanceReport(config: ConfigReader, fetcher: Fetch = fetch, onSuccess?: (report: string) => void): Promise<string> {
  const provider = getProvider(config);
  if (!["deepseek", "openrouter"].includes(provider.id)) {
    return `${provider.name}: account balance lookup is not implemented for this provider. Use its billing dashboard.`;
  }
  const { baseURL, apiKey } = connectionDetails(config);
  if (baseURL !== provider.url) return "Balance lookup is available only with this provider's default Base URL.";
  if (!apiKey) return "Enter an API Key before checking balance.";
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  try {
    if (provider.id === "deepseek") {
      const result = await requestJSON(baseURL.replace(/\/v1$/, "") + "/user/balance", headers, fetcher);
      if (!Array.isArray(result.balance_infos)) throw new Error("Missing balance.");
      const balances = result.balance_infos.filter((row: any) => ["USD", "CNY"].includes(row.currency)
        && typeof row.total_balance === "string" && /^\d+(\.\d+)?$/.test(row.total_balance));
      if (!balances.length) throw new Error("Missing balance.");
      const report = "DeepSeek — available balance\n\n" + balances.map((row: any) => `${row.currency}: ${row.total_balance}`).join("\n");
      onSuccess?.(report); return report;
    }
    const { data } = await requestJSON(baseURL + "/key", headers, fetcher);
    const valid = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
    if (!data || !valid(data.usage)) throw new Error("Missing usage.");
    const report = [
      "OpenRouter — current API key", "",
      `Reported spend: $ ${data.usage.toFixed(4)}`,
      valid(data.limit_remaining) ? `Remaining key spending limit: $ ${data.limit_remaining.toFixed(4)}` : "No remaining key spending limit reported.",
      "", "A key spending limit is not the account balance. For account balance, enter an OpenRouter Management Key in the right sidebar.",
    ].join("\n");
    onSuccess?.(report); return report;
  } catch { return `${provider.name}: balance data is currently unavailable. Check the API Key and try again.`; }
}
