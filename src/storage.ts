import { homedir } from "node:os";
import { join } from "node:path";

export const pluginDataDirectory = process.env.LMS_PLUGIN_DATA_DIR || process.env.LMS_PANEL_DATA_DIR ||
  join(homedir(), ".lmstudio", "extensions", "data", "omni", "lms-omni-gateway");
export const catalogPath = join(pluginDataDirectory, "model-catalog-cache.json");
