# Provider profiles

Each profile has an independent model selection, manual model ID, API key, and Base URL.
All keys start empty. Manual model IDs start empty. Enter your own credentials in
LM Studio's right sidebar, never in `src/providers.ts` or a committed settings file.

## Default API roots

| Sidebar name | Default Base URL | Model discovery |
| --- | --- | --- |
| Anthropic | `https://api.anthropic.com/v1` | Native Models API, paginated |
| Custom 1 | Empty; enter your endpoint | Compatible `/models` |
| Custom 2 | Empty; enter your endpoint | Compatible `/models` |
| DeepSeek | `https://api.deepseek.com/v1` | `/models` |
| Evren.ssyz | `https://evren-llmapi.ssyz.org.tr/v1` | `/models`, chat tasks filtered |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | Native Gemini Models API at the default URL |
| GLM | `https://api.z.ai/api/paas/v4` | Compatible `/models` when available |
| Grok | `https://api.x.ai/v1` | `/models` |
| Muskapi.cc | Empty; copy your current account API root | `/models` |
| NVIDIA | `https://integrate.api.nvidia.com/v1` | Public `/models`; generation needs a key |
| OpenAI | `https://api.openai.com/v1` | `/models`, compatible chat models filtered |
| OpenRouter | `https://openrouter.ai/api/v1` | `/models`, explicit pricing and modalities |

The plugin generates text through `/chat/completions`. Being returned by `/models`
does not guarantee that a model supports that API, your account, tools, or images.
Offline starter models are a snapshot, not a guaranteed list of currently available models.
The live Models API list replaces the starter list after a successful refresh.

## Provider details

**Anthropic:** discovery uses `x-api-key` and `anthropic-version`; generation uses
Anthropic's OpenAI-compatible Chat Completions interface. See the
[compatibility guide](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk).
Not every provider-specific feature is exposed by this gateway.

**Gemini:** generation uses Google's OpenAI-compatible root. At the default URL,
discovery uses the native Models API and follows pagination, filtering models that
do not list `generateContent`. A listed model may still be unavailable under free
tier access, quotas, regional rules, or an API endpoint.
[Google compatibility documentation](https://ai.google.dev/gemini-api/docs/openai).

**Evren.ssyz:** both discovery and generation use `X-API-Key` rather than Bearer
authentication. If the API supplies `task`, only `chat` and `vision_chat` are included.
Explicit `capabilities.vision` supplies the image capability flag.
[EVREN's API specification](https://evren-llmapi.ssyz.org.tr/openapi.json).

**Muskapi.cc:** copy the current Base URL from **User Center → API Key**, including
its version path. The address may depend on your account; the plugin does not guess it.
Authentication uses `Authorization: Bearer …`. No starter model IDs are invented.
[API reference](https://docs.muskapi.cc/en/guide/api-reference),
[Models API](https://docs.muskapi.cc/en/api/models).

**NVIDIA:** the public model listing is broader than guaranteed Chat Completions
access. Use your own NVIDIA API key for generation. This gateway does not mark the
models Free because the Models API does not state pricing/account eligibility.
[NVIDIA API quickstart](https://docs.api.nvidia.com/nim/docs/api-quickstart).

**OpenRouter:** an option receives the Free label only when the default official
Models API reports explicit zero prompt/completion prices and zero for every other
supplied price component. This is a catalog snapshot; access and rate limits still
depend on your account. Overridden URLs do not inherit the official Free label.

**Custom 1/2:** enter an OpenAI-compatible API root and its model ID. If `/models`
is unavailable, select **Use custom model** and fill the manual field. Custom profiles
omit `stream_options` to accommodate servers that reject it; token usage is available
only if the endpoint reports it. Responses-only endpoints are not supported.

## Discovery and availability labels

At startup, the dropdown uses saved metadata or starter models. Authenticated profiles
refresh in the background after registration, normally once per 15-minute cache window.
The active profile checks its cache before generation. `/models` forces a refresh.
There is no periodic idle polling. New dropdown options appear on the next plugin load;
use a discovered ID immediately through the manual field.

The ordinary requests you send produce these observations:

| Label | Meaning | Observation lifetime |
| --- | --- | --- |
| Not tested | No recent observation for this connection/model | Until a request |
| Worked | A response supplied text or a tool call | 30 days |
| Access restricted | Explicit model-specific access restriction | 7 days |
| Model unavailable | Explicit model-not-found/retirement evidence | 1 day |
| Temporarily unavailable | Timeout or temporary server error | 5 minutes |
| Rate / quota limited | Rate/quota limit response | 5 minutes |

A generic 404 alone does not prove a model was retired. Authentication/payment
errors do not mark a model inaccessible. Status labels neither prevent retries nor
trigger test requests. `/models` reports current observations; dropdown labels are
snapshots taken on plugin load. Changing a key or endpoint creates a separate scope.

## Balance support

- **DeepSeek:** `/balance` uses the normal key and the official balance endpoint.
  [API documentation](https://api-docs.deepseek.com/api/get-user-balance/).
- **OpenRouter without Management Key:** `/balance` shows current-key usage and
  remaining spending limit, explicitly labelled as a key limit rather than account balance.
- **OpenRouter with Management Key:** fill the optional protected field if your
  management key permits the credits lookup. It is used only for `/balance` at
  OpenRouter's default URL, never for generation or model discovery.
  [Account credits API](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits).
- Other profiles do not perform balance lookups. `/usage` remains a local total
  of reported usage from this plugin, rather than usage across all account applications.

Failed balance lookups preserve the last successful saved result. `/status` reads
that saved result and its timestamp locally. Switching credentials/endpoints isolates it.
