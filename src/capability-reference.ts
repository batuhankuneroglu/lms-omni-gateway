import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { Model } from "./providers";
import { requestJSON, type Fetch } from "./catalog";

/** Public metadata only: no credentials, prompts or image data leave for this lookup. */
export class CapabilityReference {
  private data?: { checked: number; models: Record<string, boolean> };
  private pending?: Promise<void>;
  constructor(private path?: string, private fetcher: Fetch = fetch) {
    try {
      const text = path ? readFileSync(path, "utf8") : "";
      const data = text.length < 1_000_000 ? JSON.parse(text) : undefined;
      if (Number.isFinite(data?.checked) && data.models && Object.entries(data.models).every(([k, v]) => k.length < 500 && typeof v === "boolean")) this.data = data;
    } catch {}
  }
  async enrich(models: Model[], provider: string): Promise<Model[]> {
    const prefix: Record<string, string> = { anthropic: "anthropic", openai: "openai", gemini: "google", grok: "x-ai", glm: "z-ai", deepseek: "deepseek" };
    if (!prefix[provider] || models.every(model => model.imageInput !== undefined)) return models;
    if (!this.data || Date.now() - this.data.checked > 24 * 60 * 60_000) {
      if (!this.pending) this.pending = (async () => {
        try {
          const result = await requestJSON("https://openrouter.ai/api/v1/models", {}, this.fetcher);
          if (!Array.isArray(result.data)) return;
          const entries: Array<[string, boolean]> = [];
          for (const row of result.data) if (typeof row.id === "string" && row.id.length < 500 && Array.isArray(row.architecture?.input_modalities)) {
            entries.push([row.id, row.architecture.input_modalities.includes("image")]);
          }
          this.data = { checked: Date.now(), models: Object.fromEntries(entries) };
          if (this.path) {
            mkdirSync(dirname(this.path), { recursive: true });
            const temp = this.path + "." + process.pid + ".tmp";
            writeFileSync(temp, JSON.stringify(this.data), { mode: 0o600 }); renameSync(temp, this.path);
          }
        } catch { /* Keep unknown status on failed or ambiguous lookups. */ }
      })();
      try { await this.pending; } finally { this.pending = undefined; }
    }
    if (!this.data || Date.now() - this.data.checked > 7 * 24 * 60 * 60_000) return models;
    return models.map(model => {
      const value = this.data!.models[prefix[provider] + "/" + model.id];
      return model.imageInput !== undefined || value === undefined ? model : {
        ...model, imageInput: value, capabilitySource: "OpenRouter reference · " + new Date(this.data!.checked).toISOString().slice(0, 10),
      };
    });
  }
}
