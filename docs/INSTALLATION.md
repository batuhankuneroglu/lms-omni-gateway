# Installation and updates

## Requirements

- LM Studio with generator-plugin support, opened at least once.
- The bundled `lms` CLI: verify with `lms --help`.
- Node.js 22 or newer and npm: verify with `node --version` and `npm --version`.
- Git for cloning, or a downloaded GitHub source ZIP.
- An API key for the provider you want to use. A compatible local Custom endpoint
  can work without a real key if that endpoint permits it.

The reference environment is Windows, LM Studio 0.4.25, and `@lmstudio/sdk` 1.4.0.
Plugin APIs are beta and can vary between LM Studio versions. Availability of
plugin support is a host requirement; this repository does not unlock it.

## Clone and install

Run each command from a terminal:

```sh
git clone https://github.com/batuhankuneroglu/lms-omni-gateway.git
cd lms-omni-gateway
npm ci
npm run build
lms dev --install
```

`npm ci` installs the versions in `package-lock.json`. `npm run build` compiles
TypeScript and creates `.lmstudio/production.js`. `lms dev --install` performs the
[official local installation](https://lmstudio.ai/docs/cli/develop-and-publish/dev)
and manages the local installation state. Do not copy somebody else's `install-state.json`.

If the installer asks about an existing plugin, review that prompt. This repository
uses the stable local identity `omni/lms-omni-gateway` so existing native settings
can remain associated with it. Credentials and conversation files are not part of
the source distribution.

In LM Studio, open Chat and choose **omni/lms-omni-gateway** in the model selector.
A generator appears as a model, as explained in the
[official generator documentation](https://lmstudio.ai/docs/typescript/plugins/generator).
Reopen LM Studio if needed, then configure the right sidebar.

## Install from a ZIP

1. Download the repository using **Code → Download ZIP** or a release's source archive.
2. Extract it into a folder you own.
3. Open a terminal in the extracted folder.
4. Run `npm ci`, `npm run build`, and `lms dev --install`.

Do not run these commands inside an unextracted ZIP archive. The source archive
contains the registration loader source `.lmstudio/entry.ts`; generated JavaScript
and dependencies are created on your own machine.

## Update an installed copy

In your source checkout:

```sh
git pull --ff-only
npm ci
npm run build
lms dev --install
```

Restart LM Studio to load the updated plugin and refreshed dropdown snapshots.
For a ZIP installation, extract the newer source archive to a new folder and
repeat the installation commands.

## Development mode

`lms dev` runs LM Studio's development loader and reloads on source changes.
The watcher must remain running during development. Use `lms dev --install`
for a normal installed copy that does not need a development terminal.

`npm test` compiles the source and runs automated tests. `npm run typecheck`
checks types without emitting files. `LMS_PLUGIN_OFFLINE=1` disables external
startup discovery and generation when explicitly using the offline verification mode.

## Legacy settings migration

New installations do **not** need migration. The optional
`scripts/migrate-sidebar.cjs` exists for older local revisions of this gateway.
It is not run at startup. It writes only this plugin's native global settings entry,
preserves existing overrides, and uses a completion marker to avoid restoring reset values.

If you are intentionally upgrading such a legacy revision, close LM Studio fully,
build first, and run `node scripts/migrate-sidebar.cjs` once. Do not use this helper
as a general installer or copy another user's settings into your installation.

## GitHub versus LM Studio Hub

This release is distributed through GitHub. It does not have a Hub listing or a
verified Hub publisher account. `lms push` would publish to LM Studio Hub, a separate
service; it is not required for installing or using this repository.
