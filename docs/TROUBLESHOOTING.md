# Troubleshooting

## The generator is missing

Verify `lms --help`, use a version of LM Studio with generator-plugin support, and
run `lms dev --install` from the project root containing `manifest.json`.
Restart LM Studio if needed. Look in the chat's **model selector**, since a
generator is represented as a model rather than a normal tool-provider plugin.
The local installed identifier is `omni/lms-omni-gateway`.

If `lms` is missing from PATH, follow the
[official CLI setup instructions](https://lmstudio.ai/docs/cli). If `npm ci` or the
build fails, confirm Node.js 22+ and retain the first actual error for a bug report.

## Startup takes a long time

This revision registers with locally saved model metadata before starting API
discovery. A slow provider should no longer delay the registration stage.
The ready log includes the plugin's preparation duration in milliseconds. That
duration excludes LM Studio's own startup and the time spent loading JavaScript dependencies.

Confirm the updated copy was installed, fully restart LM Studio, and check its
plugin log for `using saved model lists`. If the delay persists, report the LM
Studio version and redacted timestamps from process start to the ready line.
Do not include API keys, conversation text, or unreviewed logs.

## A new model does not appear

Send `/models`. This forces discovery and reports IDs in the chat. New options in
the native dropdown appear on the next plugin load. Until then, select **Use custom
model** and paste the exact discovered ID into that provider's **Custom Model** field.

An unavailable Models API leaves the last valid catalog or starter list in place.
It does not prove a generation model is usable. For a provider without discovery,
manual input is the supported route.

## A listed model fails

Listing and generation are separate endpoints. Free-tier access, quotas, retirement,
account permissions, endpoint compatibility, tools, and region can all affect generation.
Check the model ID and Base URL against the provider's own documentation.

| Error | What to check |
| --- | --- |
| 400 / 422 | Request format or unsupported tools/features/context |
| 401 | API key and authentication |
| 402 | Provider payment/credit requirement |
| 403 | Account/model permissions or provider policy |
| 404 | Model ID, API root, and model availability; not automatically retirement |
| 429 | Request rate or token/account quota |
| 408 / 500 / 502 / 503 / 504 | Timeout or temporary provider/upstream failure |

The plugin includes a screened structured explanation when available. It never
automatically retries or sends the request to another model. An HTTP failure does
not establish whether the provider processed billable work; check its dashboard
before choosing to resend.

## Tokens, speed, or balance are unavailable

Enable the matching top-of-sidebar switch. Not every compatible endpoint returns
streamed usage metadata. Missing tokens are not estimated. Speed requires reported
output tokens. Time represents complete API response time, not just first-token latency.

`/usage` reports this plugin's locally recorded requests. It cannot reconstruct
older requests or usage made by another application. `/balance` supports only
DeepSeek and OpenRouter at their default URLs. An OpenRouter key limit is labelled
separately from account credits; the latter needs an appropriate management key.

## Image input is blocked

Use `/image "absolute-path" Your question` with a real local PNG/JPEG/GIF/WebP file.
On Windows, `/image` opens a picker and prepares a command, which you must then send.
The example path in the README is not an installed file.

The native Vision badge/attachment gate is controlled by LM Studio. Choosing an
API model cannot set that badge through the supported plugin SDK in this revision.
If the selected model is explicitly text-only, an earlier image anywhere in the
same conversation also prevents generation. Choose an image-capable model or start
a text-only conversation. Keep the original image on disk for follow-ups.

## Settings reset or a chat uses a different profile

**ACTIVE PROVIDER** is saved separately per conversation. The fields within each
provider block are shared. Check both the current chat's provider and that block's
model selection. Manual fields default to empty and are used only with **Use custom model**.

The trash-shaped icon resets a native override to its default. The blue line marks
an override; it is not an active-provider indicator. Provider ordering applies after
restart and does not move credentials between profiles.
