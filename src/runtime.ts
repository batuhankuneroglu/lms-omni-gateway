import { type GeneratorController } from "@lmstudio/sdk";
import { BalanceCache } from "./balance-cache";
import { ModelCatalog } from "./catalog";
import { catalogPath, pluginDataDirectory } from "./storage";
import { join } from "node:path";
import { UsageTracker } from "./usage";
import { TurnUsageAccumulator } from "./turn-usage";
import { providers, textValue, type ConfigReader } from "./providers";
import { ModelStatusTracker } from "./model-status";
import { type GeneratorServices } from "./generator";
import { CapabilityReference } from "./capability-reference";
import { chooseImage } from "./desktop-actions";
import { createChatDataSchematics, createChatSchematics, createSidebarDataSchematics,
  createSidebarSchematics, readChatSelection, sidebarDefault, sidebarKey } from "./config";
import { readSavedSettings } from "./model-settings";

// Native overrides survive restarts. Missing/reset values use stable defaults;
// legacy settings and conversation history must never resurrect cleared fields.
export function sidebarDefaults(saved = readSavedSettings()): ConfigReader {
  return { get: key => saved.get(sidebarKey(key)) ?? sidebarDefault(key) };
}

export function createRuntime() {
  const defaults = sidebarDefaults();
  const balanceCache = new BalanceCache(join(pluginDataDirectory, "balances"));
  const usage = new UsageTracker(join(pluginDataDirectory, "usage"));
  const turnUsage = new TurnUsageAccumulator();
  const modelStatus = new ModelStatusTracker(join(pluginDataDirectory, "model-status"));
  const catalog = new ModelCatalog(fetch, Date.now, catalogPath,
    new CapabilityReference(join(pluginDataDirectory, "capability-reference.json")));
  const profile = (id: string): ConfigReader => ({ get: key => key === "provider" ? id : defaults.get(key) });
  // Register from local snapshots. A provider timeout or paginated model list
  // must never hold up LM Studio's plugin initialization.
  const schematics = createSidebarSchematics(defaults, Object.fromEntries(providers.map(p => [p.id, catalog.snapshot(profile(p.id)).models])),
    (id, model) => modelStatus.label(profile(id), model));
  const parser = createSidebarDataSchematics();
  const chatSchematics = createChatSchematics(defaults);
  const chatParser = createChatDataSchematics(defaults);
  let backgroundRefresh: Promise<void> | undefined;
  const refreshCatalogs = (): Promise<void> => {
    if (process.env.LMS_PLUGIN_OFFLINE === "1") return Promise.resolve();
    return backgroundRefresh ??= Promise.allSettled(providers.filter(p => textValue(defaults.get(p.apiKey)))
      .map(async p => catalog.refresh(profile(p.id), catalog.needsOpenRouterPricing(profile(p.id)))))
      .then(() => undefined);
  };
  return { schematics, chatSchematics, refreshCatalogs, services: (): GeneratorServices => ({
    catalog, usage, turnUsage, modelStatus, balanceCache, defaults, chooseImage,
    getConfig: (ctl: GeneratorController) => {
      const native: ConfigReader = ctl.getGlobalPluginConfig(parser);
      const chat: ConfigReader = ctl.getPluginConfig(chatParser);
      return readChatSelection(native, chat);
    },
    refresh: async config => { await catalog.refresh(config, true); },
  }) };
}
