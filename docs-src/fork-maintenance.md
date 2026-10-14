---
title: Tlapnet fork maintenance
group: Guides
---

# Tlapnet 3.x development fork

The default `3.x` branch starts directly from upstream `master` commit
`9a8ef4a5e85e39b5def30588ab0b8c7ff04aef7f` (verified 2026-10-14), which contains
the unreleased 3.0.0 development work. Its version is `3.0.0-tlapnet.0` so that
installed code and the HTTP server identification are unambiguous. No npm package
or GitHub release has been published. The previous `2.x` branch is preserved at
`75c055fabea9c23c544609727eee19b3749a47b4`.

This branch retains upstream ESM, current validation/schema changes, runtime
dependencies, MIT copyright/license, and the Open Charge Alliance schema license.
The original upstream baseline passed 147 tests and built its declarations on
Node.js 22 before our changes. We ported the runtime corrections and regression
tests onto that baseline; we did not replace it with the old CommonJS files.

## Compatibility

- Use Node.js 22 for the pilot. Upstream declares Node.js >=20; CI checks the
  current releases of Node.js 20, 22, 24, and 26.
- This is an ESM package. Native ESM consumers use
  `import {RPCServer} from 'ocpp-rpc'`. CommonJS consumers can use native
  `await import('ocpp-rpc')` inside an async function. TypeScript Node16/NodeNext
  module resolution preserves that dynamic import for `.cts` consumers.
- An existing TypeScript project using `module: commonjs` needs an explicit
  integration decision; its compiler may transform dynamic imports into
  `require()`. No consuming TlapCar or GPS project was modified here.
- Upstream v3 changes custom validator schema identifiers and options. See
  [the upgrade guide](upgrading.md). Standard OCPP 1.6 schemas remain provided by
  upstream; charger firmware behavior still requires a hardware pilot.
- Declaration fixes are made in the source JSDoc and verified with strict
  `skipLibCheck: false` consumer checks, including runtime execution of the
  emitted ESM and CommonJS consumers. Generated `.d.ts` files are not hand edited.
  The Node, WebSocket and backoff type packages are installed dependencies,
  because the generated public declarations reference them.

## Install by immutable commit

```sh
npm install --save-exact 'git+https://github.com/tlapnet/ocpp-rpc.git#FULL_COMMIT_SHA'
```

Replace the placeholder with a reviewed 40-character commit, and commit the
consumer lockfile. The version string alone does not identify a fork revision.
Git installation runs `prepare` to build the declarations referenced by
`package.json`; do not suppress that build when installing from Git for a typed
consumer. A tarball prepared with `npm pack` after the build already includes them.
Both installation forms must contain `types/index.d.ts` and the OCPP schema files.

## Maintained corrections

- Release caller AbortSignal listeners when calls settle; reject already-aborted
  calls before dispatch (upstream #55; PR #91 was still unmerged at inspection).
- Remove cancelled/timed-out requests from the connecting buffer, including
  cancellation during buffer drain; preserve graceful close of pending messages.
- Settle request state after synchronous serialization/send failures and failed
  or aborted connection setup.
- Keep inbound responses attached to their original socket across reconnects,
  without deleting a newer request using the same message ID.
- End handshake ownership after successful upgrade (#64), preserve true failures
  during asynchronous verification, and clean up abort/bind/startup paths.
- Make generated declarations usable by strict ESM and CommonJS consumers.

The upstream keepalive timing and connection-result comparison test fixes are
already present in this baseline and are not reapplied as library changes.

The outgoing queue still has no capacity bound; `callTimeoutMs` begins at dispatch
and does not include queue wait time. Inbound concurrency remains unlimited.
Handlers must cooperate with cancellation, or the existing force-close option
must be used for bounded shutdown. OOM report #87 is neither confirmed nor
disproved: it lacks a reproduction/configuration/heap snapshot. We do not claim
capacity for 1000 chargers. These defaults and public options are unchanged.

## Verify and synchronize

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run coverage
npm run test:types
npm run docs
```

The fork's CI builds declarations, runs coverage and strict consumer checks on
Node.js 20/22/24/26. `test:types` installs a freshly packed artifact in a temporary
project outside the checkout, so missing installed type dependencies cannot be
hidden by this repository's development dependencies. Upstream npm-publication
and Pages-deployment workflows are
guarded to run only in the upstream repository. Enabling publication or deployment
requires a separate request.

```sh
git fetch upstream
git fetch origin
git switch -c codex/review-next-upstream origin/3.x
git log --oneline origin/3.x..upstream/master
git diff origin/3.x...upstream/master
```

Review upstream changes and their interaction with our corrections before merging
or selectively cherry-picking. Preserve provenance with `git cherry-pick -x` when
selecting a commit. Run the relevant regressions, full coverage, build and consumer
checks, then open an internal PR with base `tlapnet/ocpp-rpc:3.x`. Confirm the PR
target explicitly. Update consumer pins only after review and successful CI.
Keep `2.x` separate; do not silently replace its CommonJS compatibility contract.
