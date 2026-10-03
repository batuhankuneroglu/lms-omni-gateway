import { requestJSON, type Fetch } from "./catalog";
import { connectionDetails, getProvider, textValue, type ConfigReader } from "./providers";
import { balanceReport } from "./usage";

/** Explicit /balance only. No polling or balance requests during generation. */
export async function accountReport(config: ConfigReader, fetcher: Fetch = fetch, onSuccess?: (report: string) => void): Promise<string> {
  const provider = getProvider(config);
  if (!["deepseek", "openrouter"].includes(provider.id))
    return "Balance lookup is enabled only for DeepSeek and OpenRouter. No account request was made.";
  if (provider.id === "deepseek") return balanceReport(config, fetcher, onSuccess);
  const key = textValue(config.get("openrouterManagementKey"));
  if (!key) return balanceReport(config, fetcher, onSuccess);
  const { baseURL } = connectionDetails(config);
  if (baseURL !== provider.url) return "Account lookup is available only with OpenRouter's default Base URL.";
  try {
    const result = await requestJSON(provider.url + "/credits", { Authorization: "Bearer " + key }, fetcher);
    const credits = result.data?.total_credits, spent = result.data?.total_usage;
    if (![credits, spent].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0))
      throw new Error("Invalid balance response.");
    const report = `OpenRouter — account balance\nAvailable credits: $${(credits - spent).toFixed(4)}\nTotal spend: $${spent.toFixed(4)}\n\nQueried on demand. No automatic balance polling.`;
    onSuccess?.(report); return report;
  } catch { return "OpenRouter: account balance is unavailable. Check the optional Management Key and its permissions."; }
}
