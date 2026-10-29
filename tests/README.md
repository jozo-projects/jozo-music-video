# Socket reconnect regression tests

Run from the repository root with the existing dependencies:

```sh
npm test
npm run build
npm run lint
git diff --check
```

No new packages are required. The harness uses Node's test runner and the
project's TypeScript compiler to execute the production hook. It supplies a
minimal state/ref/effect fixture (including cleanup/setup replay); this is not a
React DOM renderer or a browser/TV playback test.

## Coverage

- Unlimited transport recovery with exponential delay capped at 5 seconds.
- Manager `reconnect_attempt` status, no early/duplicate refresh on Manager
  `reconnect`, one canonical refresh via the Socket `connect` callback.
- Delayed server disconnect recovery, repeated-kick backoff, browser online
  recovery, terminal namespace rejection and explicit client disconnect.
- Pending/connected StrictMode-style replay, current callbacks, video off/on,
  same-room sharing, subscriber-specific cleanup, full remount, room changes,
  cancellation of retries, intervals and browser/Manager listeners.
- The actual `VideoPlayer` connect callback emits `check_now_playing`, the event
  implemented in `be-ezinn/src/sockets/room.socket.ts`; the old
  `request_current_song` event is not implemented there.

Four optional integration cases use the real installed Socket.IO client/server:
recovery after seven rejected transport handshakes, server disconnect with a
canonical `now_playing_status` response, transport-close Manager recovery, and
namespace middleware rejection remaining stopped after `online`. The handshake
case accelerates the fixture delays only, retaining the production retry budget.
Servers bind only to `127.0.0.1` on OS-assigned ports and are closed in `finally`.
No application backend, Redis, database or environment files are loaded.

The server package is resolved from this checkout first, then the existing
sibling `../be-ezinn` checkout (package resolution only, read-only). With neither
available, Node explicitly reports these four cases **skipped**, not passed.
The remaining thirteen cases are standalone. No installation is performed.

## Backend rejection boundary

The inspected backend room socket joins the handshake room and has no custom
room/auth rejection event/code, nor an explicit server disconnect policy. Do not
invent message-string matching. Socket.IO v4 namespace rejection is terminal
(`socket.active === false` in `connect_error`); transport failures remain active
and continue Manager recovery. A bare server `DISCONNECT` has no application
rejection payload and is retried with backoff. If the backend later uses that
same packet to revoke room access, it must introduce a distinguishable rejection
contract before the frontend can safely treat it as terminal.

## Observed TDD evidence

Before production edits, `node --test tests/socket-connection.test.cjs` reported
**12 tests: 2 passed, 10 failed, 0 skipped**. Failures included the five-attempt
budget, missing Manager status, no server-disconnect/online recovery, lost replay
listeners and missing cleanup. A preliminary fixture issue (`off(event)` differs
between Node EventEmitter and Socket.IO) was repaired before recording this RED.
The explicit-client-disconnect and room-change cases already passed.

A separate callback contract RED was observed with:

```sh
node --test --test-name-pattern='player connect callback' tests/socket-connection.test.cjs
```

It failed because the callback emitted `request_current_song` instead of the real
backend event `check_now_playing`. Extra real-transport/rejection and remount
cases subsequently expanded coverage; they are not claimed as additional
observed RED cycles.

Final local run: **17 passed, 0 failed, 0 skipped** (13 fixture/contract cases,
4 real loopback integrations). Build passed, with existing outdated Browserslist
and large-chunk warnings. Full lint passed with two warnings in untouched
`useVideoEvents.ts` (lines 450 and 666); changed production files lint clean.
`git diff --check` passed. No commit, push, deploy or environment/secret changes.
