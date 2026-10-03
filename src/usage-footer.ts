import type { TokenUsage } from "./usage";

// LM Studio displays HTML comments literally. Use a plain, narrowly matched
// footer and remove it from outgoing assistant history, including old versions.
export function usageFooter(usage?: TokenUsage, model?: { id: string; provider: string },
  visibility: { tokens?: boolean; model?: boolean; speedTime?: boolean } = {},
  timing?: { elapsedMs: number }): string {
  const n = (value: number) => value.toLocaleString("en-US");
  const line = usage ? `Tokens: ${n(usage.input)} input · ${n(usage.output)} output · ${n(usage.total)} total`
    : "Tokens: unavailable (not reported by provider)";
  const elapsedMs = timing?.elapsedMs;
  const seconds = elapsedMs !== undefined && Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs / 1000 : undefined;
  const speed = seconds && usage && Number.isFinite(usage.output) && usage.output > 0
    ? `${(usage.output / seconds).toFixed(1)} tokens/s` : "unavailable";
  const timeLine = seconds ? `Time: ${seconds < 1 ? seconds.toFixed(4) : seconds.toFixed(2)} s · Speed: ${speed}` : undefined;
  const safe = (value: string) => value.replace(/[\r\n\u0000-\u001f]/g, " ").replace(/([\\*_`<>\[\]])/g, "\\$1");
  const rows = [
    ...(visibility.tokens !== false ? [line] : []),
    ...(visibility.speedTime !== false && timeLine ? [timeLine] : []),
    ...(visibility.model !== false && model ? [`Model: ${safe(model.id)} · Provider: ${safe(model.provider)}`] : []),
  ];
  return rows.length ? "\n\n---\n" + rows.map(row => `> ${row}`).join("\n") : "";
}
export function stripUsageFooters(text: string): string {
  const line = String.raw`\*Tokens: (?:[\d,]+ input · [\d,]+ output · [\d,]+ total|unavailable \(not reported by provider\))\*`;
  const tokens = String.raw`> Tokens: (?:[\d,]+ input · [\d,]+ output · [\d,]+ total|unavailable \(not reported by provider\))`;
  const timing = String.raw`> Time: \d+(?:\.\d+)? s · Speed: (?:\d+(?:\.\d+)? tokens/s|unavailable)`;
  const model = String.raw`> Model: [^\r\n]* · Provider: [^\r\n]*`;
  return text
    .replace(new RegExp(String.raw`\n\n<!-- sonct-usage-v1 -->\n${line}\n<!-- /sonct-usage-v1 -->`, "g"), "")
    .replace(new RegExp(String.raw`\n\n---\n(?:${tokens}(?:\n${timing})?(?:\n${model})?|${timing}(?:\n${model})?|${model})(?=\n|$)`, "g"), "")
    .replace(new RegExp(String.raw`\n\n${line}(?:\n\*Model: [^\r\n]* · Provider: [^\r\n]*\*)?(?=\n|$)`, "g"), "");
}
