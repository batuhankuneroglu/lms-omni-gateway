import { type PluginContext } from "@lmstudio/sdk";
import { generate } from "./generator";
import { createRuntime } from "./runtime";

export async function main(context: PluginContext) {
  const started = performance.now();
  const runtime = createRuntime();
  context.withConfigSchematics(runtime.chatSchematics);
  context.withGlobalConfigSchematics(runtime.schematics);
  context.withGenerator((ctl, history) => {
    if (process.env.LMS_PLUGIN_OFFLINE === "1") throw new Error("Offline verification mode: API calls are disabled.");
    return generate(ctl, history, runtime.services());
  });
  console.info(`lms omni gateway ready in LM Studio's right sidebar (${Math.round(performance.now() - started)} ms; using saved model lists).`);
  // The loader calls initCompleted after main resolves. Yield to the next
  // event-loop turn so registration completes before any provider HTTP call.
  if (process.env.LMS_PLUGIN_OFFLINE !== "1") setImmediate(() => {
    void runtime.refreshCatalogs().catch(() => {
      console.warn("Background model refresh failed; saved model lists remain available.");
    });
  }).unref();
}
