import { type Chat, type GeneratorController } from "@lmstudio/sdk";
import OpenAI from "openai";
import {
  type ChatCompletionMessageParam,
  type ChatCompletionMessageToolCall,
  type ChatCompletionTool,
  type ChatCompletionToolMessageParam,
} from "openai/resources/index";
import { createConnectionDataSchematics } from "./config";
import { resolveConnection, getProvider, textValue, CUSTOM_MODEL_VALUE, type ConfigReader } from "./providers";
import { connectionIdentity, ModelCatalog } from "./catalog";
import { parseUsage, UsageTracker, type TokenUsage } from "./usage";
import { imageCapability, imageDataURL, parseImageCommand } from "./vision";
import { accountReport } from "./billing";
import { diagnoseRequest, providerErrorDetail, type ModelStatusTracker } from "./model-status";
import { stripUsageFooters, usageFooter } from "./usage-footer";
import { type TurnUsageAccumulator } from "./turn-usage";

import { type BalanceCache } from "./balance-cache";

const localCommands = new Set(["/status", "/models", "/usage", "/balance", "/settings", "/image"]);
export interface GeneratorServices {
  catalog: ModelCatalog;
  usage: UsageTracker;
  turnUsage?: TurnUsageAccumulator;
  balanceCache?: BalanceCache;
  modelStatus?: ModelStatusTracker;
  defaults: ConfigReader;
  getConfig?: (ctl: GeneratorController) => ConfigReader;
  chooseImage?: (signal?: AbortSignal) => Promise<string | undefined>;
  refresh(config: ConfigReader): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

type ToolCallState = {
  id: string;
  name: string | null;
  index: number;
  arguments: string;
};

/** Convert internal chat history to the format expected by OpenAI. */
export async function toOpenAIMessages(history: Chat, ctl?: GeneratorController): Promise<ChatCompletionMessageParam[]> {
  const messages: ChatCompletionMessageParam[] = [];

  let localReply = false;
  for (const message of history) {
    if (message.getRole() === "user") {
      localReply = localCommands.has(message.getText().trim());
      if (localReply) continue;
    } else if (localReply && message.getRole() === "assistant") {
      continue;
    }
    switch (message.getRole()) {
      case "system":
        messages.push({ role: "system", content: message.getText() });
        break;

      case "user": {
        const command = parseImageCommand(message.getText());
        const images: string[] = [];
        if (command) images.push(await imageDataURL(command.path));
        if (ctl?.client) for (const file of message.getFiles(ctl.client)) {
          if (file.isImage()) images.push(await imageDataURL(await file.getFilePath()));
        }
        const text = command?.prompt ?? message.getText();
        if (images.length > 8) throw new Error("Use at most eight images per message.");
        messages.push({ role: "user", content: images.length ? [
          { type: "text", text }, ...images.map(url => ({ type: "image_url" as const, image_url: { url } })),
        ] : text });
        break;
      }

      case "assistant": {
        const toolCalls: ChatCompletionMessageToolCall[] = message
          .getToolCallRequests()
          .map(toolCall => ({
            id: toolCall.id ?? "",
            type: "function",
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments ?? {}),
            },
          }));

        messages.push({
          role: "assistant",
          content: stripUsageFooters(message.getText()),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        });
        break;
      }

      case "tool": {
        message.getToolCallResults().forEach(toolCallResult => {
          messages.push({
            role: "tool",
            tool_call_id: toolCallResult.toolCallId ?? "",
            content: toolCallResult.content,
          } as ChatCompletionToolMessageParam);
        });
        break;
      }
    }
  }

  return messages;
}

/** Convert LM Studio tool definitions to OpenAI function-tool descriptors. */
function toOpenAITools(ctl: GeneratorController): ChatCompletionTool[] | undefined {
  const tools = ctl.getToolDefinitions().map<ChatCompletionTool>(t => ({
    type: "function",
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters ?? {},
    },
  }));
  return tools.length ? tools : undefined;
}

/* -------------------------------------------------------------------------- */
/*                            Stream-handling utils                           */
/* -------------------------------------------------------------------------- */

function wireAbort(ctl: GeneratorController, stream: { controller: AbortController }) {
  ctl.onAborted(() => {
    console.info("Generation aborted by user.");
    stream.controller.abort();
  });
}

function requestStatus(error: unknown): number | undefined {
  if (!(error instanceof OpenAI.APIError)) return;
  const streamCode = (error.error as { code?: unknown } | undefined)?.code;
  return error.status ?? (typeof streamCode === "number" && streamCode >= 400 && streamCode <= 599 ? streamCode : undefined);
}

export async function consumeStream(stream: AsyncIterable<any>, ctl: GeneratorController, onUsage: (usage: TokenUsage) => void) {
  let current: ToolCallState | null = null;
  let hasOutput = false;
  let hasToolCalls = false;

  function maybeFlushCurrentToolCall() {
    if (current === null || current.name === null) {
      return;
    }
    ctl.toolCallGenerationEnded({
      type: "function",
      name: current.name,
      arguments: JSON.parse(current.arguments || "{}"),
      id: current.id,
    });
    hasOutput = true;
    hasToolCalls = true;
    current = null;
  }

  for await (const chunk of stream) {
    if (chunk.error) throw new OpenAI.APIError(typeof chunk.error.code === "number" ? chunk.error.code : undefined,
      chunk.error, "Upstream stream error", undefined);
    const usage = parseUsage(chunk.usage);
    if (usage) onUsage(usage);
    const delta = chunk.choices?.[0]?.delta as
      | {
          content?: string;
          tool_calls?: Array<{
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        }
      | undefined;

    if (!delta) continue;

    /* Text streaming */
    if (delta.content) {
      hasOutput = true;
      ctl.fragmentGenerated(delta.content);
    }

    /* Tool-call streaming */
    for (const toolCall of delta.tool_calls ?? []) {
      if (toolCall.id !== undefined) {
        maybeFlushCurrentToolCall();
        current = { id: toolCall.id, name: null, index: toolCall.index, arguments: "" };
        ctl.toolCallGenerationStarted();
      }

      if (toolCall.function?.name && current) {
        current.name = toolCall.function.name;
        ctl.toolCallGenerationNameReceived(toolCall.function.name);
      }

      if (toolCall.function?.arguments && current) {
        current.arguments += toolCall.function.arguments;
        ctl.toolCallGenerationArgumentFragmentGenerated(toolCall.function.arguments);
      }
    }

    /* Finalize tool call */
    if (chunk.choices?.[0]?.finish_reason === "tool_calls" && current?.name) {
      maybeFlushCurrentToolCall();
    }
  }

  // Some compatible endpoints omit a final finish_reason chunk. A complete
  // streamed tool call still starts a tool continuation, not a final answer.
  maybeFlushCurrentToolCall();
  console.info("Generation completed.");
  return { hasOutput, hasToolCalls };
}

/* -------------------------------------------------------------------------- */
/*                                     API                                    */
/* -------------------------------------------------------------------------- */

export async function generate(ctl: GeneratorController, history: Chat, services: GeneratorServices) {
  // Take a fresh, immutable settings snapshot for every message. Switching in the
  // sidebar affects the next request without interrupting an in-flight response.
  const config = services.getConfig?.(ctl) ?? ctl.getGlobalPluginConfig(createConnectionDataSchematics(services.defaults));
  const lastUserMessage = [...history].filter(message => message.getRole() === "user").at(-1)?.getText().trim();
  if (lastUserMessage === "/settings") {
    ctl.fragmentGenerated("lms omni gateway settings are in LM Studio's right sidebar, under Generator → omni/lms-omni-gateway. This command does not open a window.\n\nLocal reports: /status, /models, /usage and /balance.");
    return;
  }
  if (lastUserMessage === "/image") {
    if (!services.chooseImage) { ctl.fragmentGenerated('Send /image followed by the quoted path of an existing photo and your question. Example paths must be replaced with your own file path.'); return; }
    ctl.fragmentGenerated("Choose a photo in the file picker. No image is uploaded at this step.\n\n");
    try {
      const path = await services.chooseImage(ctl.abortSignal);
      ctl.fragmentGenerated(path ? 'Copy the command below into this chat, change the question if needed, and send it:\n\n```text\n/image "' + path + '" Describe this image.\n```\n\nChoose a model with image input support in the right sidebar first.'
        : "Image selection cancelled. Send /image to try again.");
    } catch { ctl.fragmentGenerated('The file picker could not open. In File Explorer, right-click your photo and choose Copy as path. Paste that path after /image, then add your question.'); }
    return;
  }
  if (lastUserMessage === "/models") {
    await services.refresh(config);
    const snapshot = services.catalog.snapshot(config);
    ctl.fragmentGenerated(getProvider(config).name + " — models\n\n" + snapshot.status + "\n\n" +
      (snapshot.models.map(model => "- " + model.name + " (" + model.id + ")" + (getProvider(config).id === "openrouter" && model.isFree === true && !/\bfree\b/i.test(model.name) ? " — Free" : "")
        + (model.imageInput === true ? " — Vision" : model.imageInput === false ? " — Text only" : " — Image support unknown")
        + " — " + (services.modelStatus?.report(config, model.id) ?? "Not tested")).join("\n") || "No models listed. Use Custom Model.") + "\n\nStatuses reflect previous requests on this connection, not guaranteed future access. New model IDs can be used immediately with Custom Model. Dropdown options and status labels update when LM Studio restarts. Switching existing providers or models needs no reload.");
    return;
  }
  if (lastUserMessage === "/usage") {
    ctl.fragmentGenerated(services.usage.report(config));
    return;
  }
  if (lastUserMessage === "/status") {
    const provider = getProvider(config);
    const selected = textValue(config.get(`${provider.id}SelectedModel`));
    const model = !selected || selected === CUSTOM_MODEL_VALUE ? textValue(config.get("customModel")) : selected;
    let balance = "No saved balance. Use /balance to query supported providers.";
    try {
      const saved = services.balanceCache?.read(config);
      if (saved) balance = `${saved.report}\n\nLast checked: ${new Date(saved.checked).toISOString()} (UTC)\nSaved result; this is not a live balance.`;
    } catch { balance = "Saved balance could not be read."; }
    ctl.fragmentGenerated(`Provider: ${provider.name}\nModel: ${model || "Not selected"}\n\n${balance}\n\n/status makes no API request.`);
    return;
  }
  if (lastUserMessage === "/balance") {
    ctl.fragmentGenerated(await accountReport(config, fetch, report => {
      try { services.balanceCache?.record(config, report); }
      catch { console.warn("Balance result could not be saved."); }
    }));
    return;
  }
  if (services.getConfig && !config.get(`${getProvider(config).id}SelectedModel`)) {
    throw new Error("Choose a Model in the right sidebar first.");
  }
  const catalog = await services.catalog.refresh(config);
  const connection = resolveConnection(config, catalog.models);
  const turnKey = services.turnUsage?.key(history, `${connectionIdentity(config)}:${connection.modelId}`);

  /* 1. Setup client & payload */
  const openai = new OpenAI({ apiKey: connection.apiKey || "not-required", baseURL: connection.baseURL, maxRetries: 0,
    ...(connection.provider.id === "evren" ? { defaultHeaders: { Authorization: null, "X-API-Key": connection.apiKey } } : {}),
    fetch: (url, init) => fetch(url, { ...init, redirect: "error" }),
  });
  const messages = await toOpenAIMessages(history, ctl);
  const capability = { ...imageCapability(connection.provider.id, connection.modelId),
    ...catalog.models.find(model => model.id === connection.modelId) };
  if (JSON.stringify(messages).length > 40 * 1024 * 1024) throw new Error("This conversation contains too much image data. Start a new chat or use smaller images.");
  if (capability.imageInput === false && messages.some(message => Array.isArray(message.content)
    && message.content.some(part => part.type === "image_url"))) {
    throw new Error(`${connection.provider.name} lists ${connection.modelId} as text-only. This conversation contains images, including earlier messages. Choose an image-capable model or start a new text-only chat. The request was not sent to the API.`);
  }
  const tools = toOpenAITools(ctl);

  /* 2. Kick off streaming completion */
  const abort = new AbortController();
  ctl.onAborted(() => abort.abort());
  let reportedUsage: TokenUsage | undefined;
  try {
    const requestStarted = performance.now();
    const stream = await openai.chat.completions.create({
      model: connection.modelId, messages, tools, stream: true,
      // Unknown custom servers may reject stream_options. They can still return
      // usage spontaneously; never retry a paid generation just to get counters.
      ...(["openai", "anthropic", "deepseek", "gemini", "grok", "nvidia", "evren"].includes(connection.provider.id)
        ? { stream_options: { include_usage: true } } : {}),
    }, { signal: abort.signal });
    wireAbort(ctl, stream);
    const result = await consumeStream(stream, ctl, usage => { reportedUsage = usage; });
    const elapsedMs = performance.now() - requestStarted;
    if (!abort.signal.aborted && !ctl.abortSignal?.aborted) {
      if (result.hasOutput) services.modelStatus?.record(config, connection.modelId, "worked");
      else ctl.fragmentGenerated("The provider returned no text or tool call. Model access has not been marked as verified.");
      if (turnKey) services.turnUsage?.add(turnKey, reportedUsage, elapsedMs);
      if (!result.hasToolCalls) {
        const summary = turnKey ? services.turnUsage?.complete(turnKey) : undefined;
        const footer = usageFooter(turnKey ? summary?.usage : reportedUsage,
          { id: connection.modelId, provider: connection.provider.name }, {
          tokens: config.get("showTokenUsage") !== false,
          model: config.get("showModelInfo") !== false,
          speedTime: config.get("showSpeedTime") !== false,
        }, { elapsedMs: summary?.elapsedMs ?? elapsedMs });
        if (footer) ctl.fragmentGenerated(footer);
      }
    }
  } catch (error) {
    if (turnKey) services.turnUsage?.clear(turnKey);
    if (!abort.signal.aborted && !ctl.abortSignal?.aborted) {
      const apiError = error instanceof OpenAI.APIError ? error : undefined;
      const status = requestStatus(error);
      const diagnosis = diagnoseRequest(status, apiError ? `${apiError.code ?? ""} ${apiError.message}` : "");
      if (diagnosis.status) services.modelStatus?.record(config, connection.modelId, diagnosis.status);
      const upstream = providerErrorDetail(apiError, connection.apiKey);
      const model = connection.modelId.replace(/[\r\n]/g, " ").slice(0, 200);
      throw new Error(`${connection.provider.name} · ${model}${status ? ` returned HTTP ${status}` : " request failed"}. `
        + (upstream ? `Provider: ${upstream}. ` : "") + diagnosis.explanation);
    }
  } finally {
    if ((abort.signal.aborted || ctl.abortSignal?.aborted) && turnKey) services.turnUsage?.clear(turnKey);
    try { services.usage.record(config, reportedUsage, connection.modelId); }
    catch { console.warn("Usage could not be saved. The response is unaffected."); }
  }
}
