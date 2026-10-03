import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CUSTOM_MODEL_VALUE, getProvider, providers, textValue, type ConfigReader } from "./providers";
import { readLegacyManualModel, readSavedSettings } from "./model-settings";

import { pluginDataDirectory } from "./storage";
export { pluginDataDirectory, catalogPath } from "./storage";
export interface LegacySettingsState {
  version: 1;
  revision: number;
  provider: string;
  customModel: string;
  models: Record<string, string>;
  connections: Record<string, { apiKey?: string; baseURL?: string; billingKey?: string; billingTeamId?: string }>;
}
function isProvider(value: unknown): value is string { return providers.some(provider => provider.id === value); }
// Read-only compatibility with previously saved connection profiles.
export class LegacySettings {
  constructor(readonly path = join(pluginDataDirectory, "settings.json"), private legacy: () => ConfigReader = readSavedSettings,
    private legacyManual: () => string = readLegacyManualModel) {}

  read(): LegacySettingsState {
    try {
      const text = readFileSync(this.path, "utf8");
      if (text.length > 250_000) throw new Error("Settings file is too large.");
      const data: LegacySettingsState = JSON.parse(text);
      if (data.version !== 1 || !Number.isSafeInteger(data.revision) || !isProvider(data.provider)
        || typeof data.customModel !== "string" || !data.models || !data.connections) throw new Error("Invalid settings file.");
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Unable to read legacy connection settings. The saved file was not overwritten.");
      const saved = this.legacy();
      const provider = getProvider(saved).id;
      return {
        version: 1, revision: 0, provider,
        customModel: typeof saved.get("customModel") === "string" ? textValue(saved.get("customModel")) : this.legacyManual(),
        models: Object.fromEntries(providers.map(item => [item.id,
          textValue(saved.get(`${item.id}SelectedModel`)) || (item.id === provider ? CUSTOM_MODEL_VALUE : "")])),
        connections: {},
      };
    }
  }

  config(state = this.read(), providerId = state.provider): ConfigReader {
    if (!isProvider(providerId)) throw new Error("Select a valid Provider.");
    const saved = this.legacy();
    const provider = providers.find(item => item.id === providerId)!;
    const override = state.connections[providerId] ?? {};
    return { get: key => {
      if (key === "provider") return providerId;
      if (key === "customModel") return state.customModel;
      if (key === "billingKey") return override.billingKey ?? "";
      if (key === "billingTeamId") return override.billingTeamId ?? "";
      if (key === `${providerId}SelectedModel`) return state.models[providerId] ?? "";
      if (key === provider.apiKey && override.apiKey !== undefined) return override.apiKey;
      if (key === provider.baseUrl && override.baseURL !== undefined) return override.baseURL;
      return saved.get(key);
    } };
  }

}
