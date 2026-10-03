# Contributing

Issues and pull requests are welcome. Start with the README's current limitations
so a host-owned UI restriction is not mistaken for a plugin option.

## Run the checks

Use Node.js 22+:

```sh
npm ci
npm test
npm run build
```

Use `lms dev` for native LM Studio development. Normal automated tests use local
or mocked endpoints and synthetic keys. Do not add paid provider calls to CI.

## Layout

- `src/providers.ts`: stable provider IDs, API roots, starter model snapshots.
- `src/config.ts`: native shared sidebar settings and per-chat provider selection.
- `src/runtime.ts` / `src/index.ts`: cached registration and deferred discovery.
- `src/catalog.ts` / `src/capability-reference.ts`: model metadata and capabilities.
- `src/generator.ts`: history conversion, streaming, tools, and local commands.
- `src/usage*` / `src/turn-usage.ts`: persisted provider-reported usage and final footers.
- `src/billing.ts` / `src/balance-cache.ts`: explicit supported balance lookups.
- `src/vision.ts` / `src/desktop-actions.ts`: image input and Windows picker.
- `tests/`: configuration, isolated endpoints, synthetic image fixture, and regressions.
- `.lmstudio/entry.ts`: registration loader source; generated bundles are ignored.
- `scripts/migrate-sidebar.cjs`: optional legacy migration, never an automatic startup step.

Keep provider IDs stable so renaming a label does not move credentials or saved scopes.
Keep keys protected, avoid raw API bodies in errors, and strip local metadata from
future prompts. Do not add automatic retries or fallback calls that can cause a
second charge. Preserve the nonblocking startup path.

## Bug reports

Include OS, Node/LM Studio versions, provider name, model ID, HTTP status, and concise
steps. Redact keys, account identifiers, prompts, images, private Base URLs, and any
unreviewed log content. If a secret was exposed, revoke it with the provider before
posting another report. Do not attach runtime data directories.

For a security issue, use GitHub's private vulnerability reporting if available;
do not put a working credential or exploit against another user's account in a public issue.
