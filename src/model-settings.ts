import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { providers, textValue, type ConfigReader } from "./providers";
import { connectionKeys, sidebarKey } from "./config";

export const pluginId = "omni/lms-omni-gateway";
export const globalSettingsPath = join(homedir(), ".lmstudio", ".internal", "global-plugin-configs.json");
const allowed = new Set(["provider", "settingsConnection", "customModel",
  ...providers.flatMap(provider => [provider.apiKey, provider.baseUrl, `${provider.id}SelectedModel`]), ...connectionKeys.map(sidebarKey)]);

// Read only this plugin's fields. Keys stay in memory, solely to call the selected
// endpoint; never serialize them to logs, caches, source files or other providers.
export function readModelSettings(text: string, id = pluginId): ConfigReader {
  const data = JSON.parse(text);
  if (!Array.isArray(data?.json?.plugins)) throw new Error("Unrecognized LM Studio settings format.");
  const entry = data.json.plugins.find((item: unknown) => Array.isArray(item) && item[0] === id);
  const values = new Map<string, unknown>();
  if (entry !== undefined) {
    if (!Array.isArray(entry[1]?.fields)) throw new Error("Unable to read plugin settings.");
    for (const field of entry[1].fields) {
      if (field && allowed.has(field.key)) values.set(field.key, field.value);
    }
  }
  return { get: key => values.get(key) };
}

export function readSavedSettings(id = pluginId, path = globalSettingsPath): ConfigReader {
  try { return readModelSettings(readFileSync(path, "utf8"), id); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { get: () => undefined };
    throw error;
  }
}

// One-time default migration: preserve the last manual model entry, without
// changing conversations or copying their contents into plugin storage.
export function readLegacyManualModel(directory = join(homedir(), ".lmstudio", "conversations")): string {
  try {
    const files = readdirSync(directory).filter(name => name.endsWith(".conversation.json"))
      .map(name => ({ path: join(directory, name), time: statSync(join(directory, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (const file of files.slice(0, 20)) {
      try {
        const data = JSON.parse(readFileSync(file.path, "utf8"));
        const fields = data?.pluginConfigs?.[pluginId]?.config?.fields;
        if (!Array.isArray(fields)) continue;
        const entry = fields.find(field => field.key === "customModel");
        if (entry) return textValue(entry.value);
      } catch { /* Try the next saved conversation. */ }
    }
  } catch { /* No legacy conversations. */ }
  return "";
}
