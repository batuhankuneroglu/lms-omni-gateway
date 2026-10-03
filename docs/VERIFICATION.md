# Verification for the 1.0.0 source release

Release preparation: 2026-10-03. Reference environment: Windows, LM Studio 0.4.25,
SDK 1.4.0. The release retains the tested installed implementation; publication
adds documentation, attribution, package metadata, ignore rules, and CI.

## Automated checks

`npm test` compiles TypeScript and runs 51 tests. The suite covers:

- Per-chat Active Provider with independent shared connection/model settings.
- Explicit empty values, reset defaults, ordering, and read-only legacy inputs.
- Paginated model discovery, normalization, cache isolation, failed refresh retention.
- EVREN X-API-Key authentication and Muskapi.cc account endpoint/Bearer authentication.
- Streaming text, tools, status classification, exactly one generation attempt per request.
- Usage persistence, final-answer footers, metadata stripping, speed/time switches.
- DeepSeek/OpenRouter billing isolation and management-key restrictions.
- Explicit local image paths, MIME signatures, capability metadata, and host file handles.
- Immediate registration with a stalled provider and background results saved for reload.

Tests use synthetic credentials and local/mock endpoints. Passing tests do not
establish real account access or provider pricing. This release preparation does
not perform paid generation. Native installation and every provider's live account
compatibility are not exhaustively verified.

`npm run build` emits `.lmstudio/production.js` using the committed loader source.
The GitHub workflow is configured to test/build with Node.js 22 on Windows, Linux,
and macOS. The Actions run is the source of truth for CI results; it does not verify
all native UI interactions on those systems.

## Startup regression

The plugin now registers entirely from local snapshots before API discovery starts.
A controlled installed-bundle check with real local metadata and stalled HTTP
responses completed registration in about 108 ms, with zero provider requests
before `initCompleted`. This measurement covers the controlled loader/registration
path, not LM Studio's total application startup or a promise about every machine.

## Distribution boundary

Only source, synthetic fixtures/tests, documentation, and build metadata are tracked.
Installed state, runtime catalogs, private settings, usage/balance files, conversation
history, recovery copies, and research outputs are excluded. The publication is
scanned locally against saved credentials without printing those credentials.

The README documents host limitations: frozen dropdown options, normal image
attachment gating, reset controls, unavailable menu search/favorites, and shared
provider model settings. No LM Studio application files are changed.
