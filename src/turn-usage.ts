import { createHash } from "node:crypto";
import type { Chat } from "@lmstudio/sdk";
import type { TokenUsage } from "./usage";

export type TurnSummary = { usage?: TokenUsage; elapsedMs: number };

/** The tool loop calls the generator once per model request. Keep an in-memory
 * total until the model produces a response without another tool call. */
export class TurnUsageAccumulator {
  private pending = new Map<string, { usage: TokenUsage; missing: boolean; elapsedMs: number; updated: number }>();
  key(history: Chat, connection: string): string {
    const items = [...history];
    let lastUser = -1;
    for (let i = 0; i < items.length; i++) if (items[i].getRole() === "user") lastUser = i;
    const prefix = items.slice(0, lastUser + 1).map(message => [message.getRole(), message.getText()]);
    return createHash("sha256").update(JSON.stringify([connection, prefix])).digest("hex");
  }
  add(key: string, next?: TokenUsage, elapsedMs = 0): void {
    const current = this.pending.get(key) ?? { usage: {input: 0, output: 0, total: 0}, missing: false, elapsedMs: 0, updated: 0 };
    if (next) {
      current.usage.input += next.input;
      current.usage.output += next.output;
      current.usage.total += next.total;
    } else current.missing = true;
    current.elapsedMs += Math.max(0, elapsedMs);
    current.updated = Date.now();
    this.pending.set(key, current);
    if (this.pending.size > 64) {
      const oldest = [...this.pending].sort((a,b)=>a[1].updated-b[1].updated)[0];
      if (oldest) this.pending.delete(oldest[0]);
    }
  }
  complete(key: string): TurnSummary | undefined {
    const value = this.pending.get(key);
    this.pending.delete(key);
    return value ? { usage: value.missing ? undefined : value.usage, elapsedMs: value.elapsedMs } : undefined;
  }
  clear(key: string): void { this.pending.delete(key); }
}
