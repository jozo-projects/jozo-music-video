# FE HLS recovery verification

## Scope

Affected repository: `jozo-music-video` only. API contract unchanged; no backend, worker, R2, environment, dependency, deployment or device changes authorized by this task. No commit/push.

Baseline: `main`, `33ad91e`, clean working tree before implementation.

## Analysis and implementation

1. Protect initial REST hydration against newer socket song/control/clear events and preserve catalog HLS source/readiness.
2. Reconcile explicit empty room status after reconnect without treating malformed status as an empty room.
3. Move HLS readiness from playlist parsing to media data; add bounded startup/stall recovery with explicit manual retry, preserve pause/seek/volume, reject stale playback callbacks.
4. Keep existing socket reconnect implementation and existing source selection policy.

## Manual acceptance

See [box checklist](hls-box-recovery.md). Physical box playback, latency, decoder and real remote acceptance remain pending until performed. No automatic test fixture proves picture and sound on the target box.

## Verification status

Verified locally on the final implementation:

- `npm test`: 70/70 passed (28 HLS lifecycle/recovery, 20 parent hydration, 5 metadata/time-update, 17 existing socket tests including real local Socket.IO transport).
- `npm run build`: passed. Existing warnings: stale Browserslist dataset and bundle larger than 500 kB.
- `npm run lint`: passed with 0 errors and 0 warnings; new hook dependencies are explicitly listed.
- `git diff --check`: passed.
- TDD: new behavioral tests failed against the old paths before fixes, including late REST, empty-room reconciliation, paused readiness, startup/stall budget, pending seek, missing duration and late-recovery overlay. Production TS/TSX runs through test fixtures; those fixtures do not render a real React DOM/decoder.

### Ad-hoc browser check (not a CI dependency)

Executed a locally generated 320px H.264/AAC HLS fixture in headless Chromium using the production playback controller. Muted browser test, not the complete authenticated room UI or real R2/BE pipeline.

- Paused hydration: currentTime 7, paused true, readyState 4, videoWidth 320, decoded frames present. Ready callback was at currentTime 7 with readyState 4. Resume advanced beyond 8 seconds; no JavaScript page errors.
- Intercepted actual segment HTTP requests and aborted all of them: 12 requests blocked; logs showed startup recovery attempts 1 and 2, then manual retry. No ready/end callback was emitted while blocked.
- Unblocked segments and clicked the fixture retry button: data returned at currentTime 7, paused true, readyState 4, videoWidth 320. Thus pause and initial position survived failure/retry.
- Browser control button is fixture wiring, not proof of physical remote focus within the application. React adapter/button wiring is covered by TSX fixtures; box remote/UI acceptance is pending.

Temporary browser fixture/scripts and screenshot: `/tmp/jozo-hls-qa/` (`run-browser.cjs`, `run-network.cjs`). Not installed as project dependencies; temporary artifacts may be removed by the OS.

No target box, authenticated room, production catalog, worker callback, R2 fetch, sound output or box latency was exercised. This change does not establish the exact cause of the reported rare box failure.

## Risk / rollback

Changes are local and uncommitted. Do not overwrite another developer's edits or use a repository reset to roll back. Review the task diff and revert only task-owned changes if necessary. Build output is local; it does not update the running website or TV.
