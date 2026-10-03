# Privacy and local data

## What goes to an API

The selected provider receives the conversation required for a normal generation
request, including tool definitions/results and images that you explicitly supply.
Your key goes to the configured endpoint. Check the Base URL before entering it.
HTTP redirects are rejected instead of forwarding credentials to a redirected host.

Model discovery sends a read request to that profile's Models API using its key
where required. Built-in provider capability enrichment can read OpenRouter's public
catalog; that public reference request contains no key, prompt, or image.

`/balance` sends a separate read request only to the supported official DeepSeek
or OpenRouter endpoint. The optional OpenRouter management key is never used for
chat or model discovery. There are no automatic balance requests after messages.

Local command reports, token/model/time footers, and image file paths are removed
from later remote prompts. The actual bytes of an explicitly sent image are encoded
and included in the model request. Follow-ups may resend those bytes as context.
Deleting the file makes that follow-up fail explicitly.

The gateway adds no telemetry or analytics service. LM Studio and your providers
have their own behavior and privacy policies.

## Credentials

API keys and management keys are set in LM Studio's protected configuration fields.
The protection controls the displayed value; it is not an encrypted vault.
Credentials belong to the user's native LM Studio settings and are not embedded
in the source code or distributed with this project.

Avoid committing `.env` files, private settings, logs, API responses, or screenshots
with an exposed key. Bug reports should use redacted provider/model/HTTP information.
The plugin screens structured upstream error explanations before displaying them,
but you should still review any log before sharing it.

## Storage

Native provider settings are managed by LM Studio. The plugin's default runtime
data directory is:

```text
~/.lmstudio/extensions/data/omni/lms-omni-gateway/
```

`~` is the current user's home folder. `LMS_PLUGIN_DATA_DIR` can override that
directory for verification or an isolated environment; the older
`LMS_PANEL_DATA_DIR` name remains a compatibility fallback.

| Data | Contents |
| --- | --- |
| `model-catalog-cache.json` | Model metadata, timestamps, and connection digests |
| `capability-reference.json` | Cached public image capability metadata |
| `model-status/` | Model IDs, fixed observation codes, and timestamps |
| `usage/` | Per-request model IDs, timestamps, tokens, and API-reported costs |
| `balances/` | Successful explicit balance reports and lookup timestamps |
| Legacy `settings.json` | Older user-saved connection data, if it already exists |

New catalog/status/usage files do not store prompts, images, raw API errors, or
credentials. Scopes use hashes derived from provider, URL, and key. Balance files
contain financial information and are local user data. Legacy settings may contain
credentials; the runtime does not treat them as a portable distribution template.

These directories are outside the source checkout. `.gitignore` also excludes
common runtime/settings/backup files accidentally placed in a checkout. The
synthetic strings called keys in automated tests are local dummy values.

## Publication boundary

This GitHub repository contains source, synthetic fixtures, tests, documentation,
and build metadata. It contains no saved account settings, usage history, balance
snapshots, conversation files, real API keys, installed state, or recovery archive.
Generated bundles and `node_modules` are built/installed locally.
