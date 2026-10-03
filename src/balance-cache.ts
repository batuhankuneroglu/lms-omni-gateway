import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { connectionIdentity } from "./catalog";
import { getProvider, textValue, type ConfigReader } from "./providers";

interface SavedBalance { version: 1; checked: number; report: string }
/** Only successful explicit lookups are saved. No polling, keys, URLs or prompts. */
export class BalanceCache {
  constructor(private directory: string, private now = Date.now) {}
  private path(config: ConfigReader) {
    const management = getProvider(config).id === "openrouter" ? textValue(config.get("openrouterManagementKey")) : "";
    const id = createHash("sha256").update(JSON.stringify([connectionIdentity(config), management])).digest("hex");
    return join(this.directory, id + ".json");
  }
  record(config: ConfigReader, report: string) {
    const file = this.path(config);
    mkdirSync(this.directory, { recursive: true });
    const temporary = file + "." + randomUUID() + ".tmp";
    writeFileSync(temporary, JSON.stringify({ version: 1, checked: this.now(), report }), { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  }
  read(config: ConfigReader): SavedBalance | undefined {
    try {
      const value = JSON.parse(readFileSync(this.path(config), "utf8"));
      if (value.version !== 1 || !Number.isFinite(value.checked) || value.checked < 0 ||
        typeof value.report !== "string" || value.report.length > 10000) return;
      return value;
    } catch { return; }
  }
}
