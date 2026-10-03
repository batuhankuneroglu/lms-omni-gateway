import { connectionKeys, sidebarDefault, sidebarKey } from "./config";
import { pluginId } from "./model-settings";
import { providers, textValue, type ConfigReader } from "./providers";

/** Offline, one-time upgrade. Caller must close LM Studio before writing.
 * Preserve explicit native values (including empty strings), migrate connection
 * details, and never spread the old shared manual ID across provider fields.
 */
export function migrateSidebarSettings(text: string, legacy: (provider: string) => ConfigReader, active: string): string {
  const data = JSON.parse(text);
  if (!Array.isArray(data?.json?.plugins)) throw new Error("Unrecognized LM Studio settings format.");
  let entry = data.json.plugins.find((item: unknown) => Array.isArray(item) && item[0] === pluginId);
  if (!entry) { entry = [pluginId, { fields: [] }]; data.json.plugins.push(entry); }
  if (!Array.isArray(entry[1]?.fields)) throw new Error("Unable to read plugin settings.");
  const fields = entry[1].fields;
  const present = new Set(fields.map((f: { key: string }) => f.key));
  for (const key of connectionKeys) {
    const nativeKey = sidebarKey(key);
    if (present.has(nativeKey)) continue;
    let value = sidebarDefault(key);
    const provider = providers.find(p => [p.apiKey, p.baseUrl, `${p.id}SelectedModel`].includes(key));
    if (provider) {
      const old = legacy(provider.id).get(key);
      if (typeof old === "string") value = old;
      if (key === `${provider.id}SelectedModel` && !textValue(value)) value = sidebarDefault(key);
    }
    if (key === "provider" && providers.some(p => p.id === active)) value = active;
    if (value !== sidebarDefault(key)) fields.push({ key: nativeKey, value });
  }
  return JSON.stringify(data);
}
