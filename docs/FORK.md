# Maintaining the Tlapnet stable fork

Repository: https://github.com/tlapnet/ocpp-rpc (public fork of
https://github.com/mikuso/ocpp-rpc).

## Baseline and scope

The `2.x` branch starts at npm `ocpp-rpc@2.2.1`, upstream commit
`d18163a024c90c8ad9f9141222ffad90b946f412`. This was still npm's `latest` on
2026-10-14. It retains CommonJS, the original runtime dependencies, public options,
defaults, and MIT copyright/license. The fork's primary target is Node.js 22 and
OCPP 1.6 JSON/WebSocket. It is not a receiver application or a charger firmware
qualification.

Upstream `master` at the audit was `9a8ef4a` and included the ESM conversion for
the next major version. Do not merge that branch wholesale into `2.x`.

The package version remains `2.2.1`; it does not identify the fork patches. No
package has been published to npm. Consumers must pin an immutable fork commit.
The stable baseline includes `index.d.ts` and module declarations. Runtime and
declaration compatibility must both be checked when integrating it into a strict
TypeScript consumer; CommonJS loading alone is not that integration test.

## Install an approved commit

After reviewing a merged commit and its CI results, use its full 40-character SHA:

```sh
npm install --save-exact 'git+https://github.com/tlapnet/ocpp-rpc.git#FULL_COMMIT_SHA'
```

Commit the consuming application's lockfile. Do not pin a moving branch such as
`master` or `2.x`, and do not use plain `ocpp-rpc@2.2.1` to obtain our fixes.

## Lifecycle fixes

Each fix has regression tests exercising real local WebSocket connections:

- Completed, rejected, timed-out, and disconnected calls release their caller's
  abort listener. Already-aborted queued calls are not dispatched (upstream
  [#55](https://github.com/mikuso/ocpp-rpc/issues/55); upstream
  [PR #91](https://github.com/mikuso/ocpp-rpc/pull/91) was still unmerged).
- Handshake failure listeners stop owning a socket once the WebSocket upgrade
  succeeds. Later socket/auth errors must not produce `upgradeAborted` for an
  established connection ([#64](https://github.com/mikuso/ocpp-rpc/issues/64)).
- HTTP listener shutdown releases its caller's abort listener, including aborted
  or failed startup paths.
- A call that times out or is aborted while waiting for a WebSocket connection is
  removed from the outgoing buffer, so it cannot execute after it has failed.
- Synchronous request serialization/send failures settle pending state without
  leaving a timer or a rejected internal Promise behind.
- Responses from handlers belonging to a disconnected WebSocket are not sent
  over a later connection, even if the handler ignores its abort signal.
- Closing or failing connection setup rejects pending calls and discards buffered
  traffic, including when the call timeout is disabled.
- Client TypeScript constructor/reconfiguration declarations accept runtime
  defaults and partial updates while still requiring the initial identity.
  A strict CommonJS compiler regression test checks these declarations.

## Verification and limits

Run `npm ci --ignore-scripts --no-audit --no-fund`, `npm test`,
`npm run coverage`, and `npm run test:types` on Node.js 22. GitHub Actions runs
coverage and the TypeScript check on 17.3.0, 18, 19,
20, 22, 24, and 26, preserving the baseline's minimum engine compatibility while
checking newer runtimes. Older versions in this matrix are compatibility checks,
not a recommendation to deploy them. The workflow needs no Coveralls account.

The baseline suite passed 138 tests on Node.js 22 before the fork patches.
Regression failures were reproduced before applying each relevant fix. Use the
specific PR/commit's Actions run for remote CI evidence; local PASS is not remote
CI or production/hardware validation.

The following behavior remains unchanged:

- `callConcurrency` limits active outbound calls, not the size of its waiting
  queue. The call timeout starts when a queued call is dispatched. Aborting a
  queued call prevents its eventual send, but its Promise settles only when it
  reaches the front; queue wait time is not an end-to-end deadline.
- Inbound call concurrency is unlimited. Applications must bound their work and
  outstanding commands according to their own capacity.
- Aborting a request already delivered to a peer cannot undo that peer's work.
- Graceful close may wait for handlers that ignore their abort signal. Use
  cooperative handlers or the existing `force` option for bounded shutdown.
- [#87](https://github.com/mikuso/ocpp-rpc/issues/87), reporting OOM above roughly
  1000 chargers, had no reproduction, heap snapshot, configuration, or discussion
  proving a cause. This audit neither confirms nor disproves that deployment's
  OOM and does not certify capacity for 1000 chargers.

No receiver, database, tenant routing, billing rules, OCPP 2.1 changes, npm
publication, or server deployment is included.

## Synchronize upstream

Keep remotes separate:

```sh
git remote -v
# origin   https://github.com/tlapnet/ocpp-rpc.git
# upstream https://github.com/mikuso/ocpp-rpc.git
git fetch upstream
git fetch origin
git switch -c codex/review-upstream-fix origin/2.x
git log --oneline origin/2.x..upstream/master
git show UPSTREAM_COMMIT
```

Select only compatible fixes, inspect their dependencies, and cherry-pick with
`git cherry-pick -x UPSTREAM_COMMIT` when appropriate. Retain upstream attribution
and license notices. Reproduce the affected behavior, run regression and full
coverage checks, then open an internal PR with base `tlapnet/ocpp-rpc:2.x`.
Confirm the PR target explicitly so it is not accidentally opened upstream.
Merge after review and passing CI; update consumer pins separately. A major/ESM
migration needs a separate compatibility decision.
