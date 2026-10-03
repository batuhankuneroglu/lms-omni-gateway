# lms omni gateway

Use API-hosted AI models directly in LM Studio chat, with native sidebar settings,
separate provider profiles, automatic model discovery, and optional usage information.
The plugin is a **generator**: it appears in LM Studio's model selector and sends
the conversation to the selected API instead of running a local model.

[Installation](docs/INSTALLATION.md) · [Providers](docs/PROVIDERS.md) ·
[Troubleshooting](docs/TROUBLESHOOTING.md) · [Privacy](docs/PRIVACY.md) ·
[Türkçe başlangıç rehberi](docs/README.tr.md)

## What it does

- Keeps independent **Model → Custom Model → API Key → Base URL** fields for each provider.
- Restores **Active Provider** separately for each chat when you switch conversations.
- Discovers model IDs from the configured provider's Models API and keeps a local cache.
- Streams answers and forwards function/tool calls exposed by LM Studio.
- Optionally shows provider-reported tokens, model/provider, response time, and output tokens/s.
- Displays one combined usage footer after the final answer in a tool workflow.
- Labels OpenRouter models **Free** when its official catalog explicitly reports zero pricing.
- Records model availability observations from ordinary requests, without automatic test calls.
- Reads DeepSeek/OpenRouter balance on demand and remembers the last successful result locally.
- Sends local photos from the same LM Studio chat using `/image`.
- Registers from saved model lists immediately; slow model APIs refresh in the background.

**Supported profiles:** Anthropic, Custom 1, Custom 2, DeepSeek, Evren.ssyz,
Gemini, GLM, Grok, Muskapi.cc, NVIDIA, OpenAI, and OpenRouter.

## Install from GitHub

You need LM Studio with generator-plugin support, its `lms` CLI, Git, and Node.js 22+
with npm. This revision was tested on Windows with LM Studio 0.4.25 and SDK 1.4.0.
The Windows photo picker is platform-specific; other platforms can use an absolute
image path. macOS/Linux end-to-end installation has not been verified.

Open LM Studio once, then run these commands in a terminal:

```sh
git clone https://github.com/batuhankuneroglu/lms-omni-gateway.git
cd lms-omni-gateway
npm ci
npm run build
lms dev --install
```

The last command uses LM Studio's [official local plugin installer](https://lmstudio.ai/docs/cli/develop-and-publish/dev).
Reopen LM Studio if the generator is not immediately visible. Select
**omni/lms-omni-gateway** in the chat's model selector.

This repository is a source distribution. It does not contain an API key, a local
installation state, a model download, or a preconfigured account. Each user supplies
their own endpoint and credentials. It is not currently published on LM Studio Hub.

For installing without Git, updating, development mode, and CLI troubleshooting,
see [Installation](docs/INSTALLATION.md).

## First conversation

1. Select **omni/lms-omni-gateway** as the generator.
2. Open the right sidebar's **Generator** settings.
3. Choose **ACTIVE PROVIDER** for this chat.
4. In that provider's block, enter its **API Key** and check its **Base URL**.
5. Send `/models` to retrieve the provider's current model IDs.
6. Select a listed model, or choose **Use custom model** and paste its ID into
   that provider's **Custom Model** field.
7. Send your message.

Base URL is the API root, for example `https://api.example.com/v1`. Do not append
`/chat/completions`, `/responses`, or `/models`; the plugin adds endpoint paths.
Muskapi.cc requires the account-specific address from its own dashboard.

**New model dropdown options appear on the next plugin load.** `/models` can
retrieve a new ID immediately, and Custom Model can use it immediately. LM Studio
fixes the dropdown's options when the plugin loads. Switching an existing
provider/model or changing a key/URL applies to your next message without restarting.

## Chat selection and sidebar settings

**ACTIVE PROVIDER belongs to the current chat.** For example, one conversation
can restore DeepSeek while another restores Anthropic. The model choice, manual
model ID, API key, and URL inside a provider block are shared across chats. Changing
Anthropic's model affects every conversation that uses that Anthropic profile.
Custom 1 and Custom 2 are separate profiles and can hold different accounts or endpoints.

The top switches **Show Token Usage**, **Show Model Info**, and **Show Speed & Time**
are independent and apply to the next message. Changing a setting during a streamed
answer does not change the request already in progress.

**Provider Order** accepts comma-separated profile names, for example:

```text
DeepSeek, OpenRouter, Evren.ssyz, Custom 1, Anthropic
```

Omitted providers follow afterward. Duplicate or unknown names are ignored.
Restart LM Studio to apply section ordering. Resetting this field restores A–Z order.
LM Studio's blue left border marks an overridden setting; its trash-shaped control
resets that field. It does not identify the active provider.

## Commands

Send a command as a chat message while this generator is selected:

| Command | Result | Additional provider request |
| --- | --- | --- |
| `/settings` | Explains the native sidebar controls | No |
| `/status` | Shows selected provider/model and the last saved balance | No |
| `/models` | Refreshes model IDs and known image capabilities | Models API, possibly paginated |
| `/usage` | Shows this connection's locally saved token totals and API-reported costs | No |
| `/balance` | Queries DeepSeek balance or OpenRouter credits/key spending limit | Yes, read only |
| `/image` | Opens a Windows photo picker and prepares a command | No upload at selection |
| `/image "absolute-path" Your question` | Sends the image and question to the selected API model | Yes, normal generation |

Commands and their local replies are excluded from later remote prompts.
`/image "path" question` supplies actual model input and is included as text/image content.

## Tokens, time, and balance

An enabled footer looks like this:

> Tokens: 120 input · 30 output · 150 total
> Time: 1.50 s · Speed: 20.0 tokens/s
> Model: your-model-id · Provider: your-provider

These are illustrative values. Tokens come from the API's reported usage; missing
usage is shown as unavailable. Time is the combined duration of the model API calls
for that answer, including streaming and network time. It excludes tool execution and
model-list refreshes. Speed divides reported output tokens by that duration; it is
an average, not a measurement of the provider's internal inference speed.

Tool workflows can resend earlier context several times, so summed input tokens
may be large. The final footer sums those calls and appears once. Footer metadata
is removed from later prompts. Showing the footer makes no extra model request.
Local totals include this plugin's requests only, including automatic title requests;
they are not account-wide billing statistics.

Balance lookup is available only for **DeepSeek** and **OpenRouter** at their default
URLs. DeepSeek uses its normal API key. OpenRouter uses the current key's spending
limit unless you provide its optional **Management Key** for account credits.
There is no automatic balance polling. `/balance` performs a separate HTTP request
that may count toward the provider's HTTP rate limits. `/status` reads the saved
result and timestamp without contacting the provider.

## Photos

For an image-capable API model, send your own file path:

```text
/image "C:\photos\example.png" What is in this picture?
```

On Windows, `/image` by itself opens a picker. Selecting a photo returns a prepared
command; you must send that command to upload the image. PNG, JPEG, GIF, and WebP
are checked by file signature. Limits: 20 MB per file, eight images per user message,
and 40 MB of encoded conversation images. Keep the file available for follow-ups.
Local paths are removed from the remote prompt.

LM Studio 0.4.25 gates its normal attachment button using a local model's vision
adapter. The supported generator SDK does not expose a way to set that flag, so
`/image` is the plugin-only route in this revision. Host-exposed image attachments
are also forwarded. Application files are not patched.

Image capability uses explicit endpoint metadata when supplied. Some built-in
providers can use exact-ID matches from OpenRouter's public catalog as a reference.
Unknown capabilities are labelled unknown. A custom endpoint's capability is never
guessed from another provider's model name. An explicitly text-only model is blocked
if any earlier message in the conversation contains an image; images are not silently dropped.

## Current limits

- All provider blocks remain visible; the SDK does not support live conditional sections.
- New model options and status labels in dropdowns appear after plugin reload.
- Model menus have no plugin-provided search bar, favorite stars, or drag-and-drop ordering.
- Reset icons, fonts, colors, and sticky positioning are controlled by LM Studio.
- A model listing does not guarantee account access, credit, tools, or Chat Completions support.
- The gateway uses Chat Completions; Responses-only and non-chat models are not supported.
- Requests are never automatically retried or switched to another model after a failure.
- Third-party API compatibility depends on each provider. All-provider live account access
  has not been verified; automated tests use controlled local/mock endpoints.

See [Troubleshooting](docs/TROUBLESHOOTING.md) for model access errors, startup,
missing usage, images, and HTTP status codes.

## Development

```sh
npm ci
npm test
npm run build
lms dev
```

The test suite covers native configuration, per-chat routing, credential separation,
model discovery/pagination, streaming/tool calls, image payloads, billing isolation,
metadata removal, and startup with stalled APIs. Tests use synthetic keys and local
or mocked servers; they do not generate billable provider requests.

GitHub Actions runs tests and builds on Windows, Linux, and macOS with Node.js 22.
Passing CI does not certify installation or the native interface on all operating systems.
[Contributing](CONTRIBUTING.md) explains the layout and reporting bugs.

## Privacy and attribution

API keys are entered locally in protected LM Studio fields. Protected display is
not an encrypted vault. Runtime settings, balance snapshots, usage, and model caches
are kept outside this repository. See [Privacy](docs/PRIVACY.md) before sharing logs or data.

Based on [sonct/openai-compat-endpoint](https://lmstudio.ai/sonct/openai-compat-endpoint),
a fork of [lmstudio/openai-compat-endpoint](https://lmstudio.ai/lmstudio/openai-compat-endpoint).
Credit remains with their original authors. This gateway retains the upstream ISC
license declaration; the generated LM Studio loader has its separate MIT notice.
See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Maintained by [batuhankuneroglu](https://github.com/batuhankuneroglu).
The local identifier `omni/lms-omni-gateway` is independent of the GitHub account;
it does not claim an official LM Studio Hub organization or provider affiliation.
