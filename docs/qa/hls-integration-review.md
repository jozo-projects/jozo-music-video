# Integration review notes (internal working record)

- HlsVideo initialPosition contract must match VideoPlayer; followup delegated for optional finite nonnegative initialPosition and seeking during recovery.
- Verify `authorityRevisionRef` is invalidated only by accepted authoritative socket state/control observations. Presentation-only buffering/ready or waiting YouTube state must not cancel REST bootstrap when socket hydration is unavailable. A synchronous state-ref wrapper can update refs without incrementing the authority revision.
- Reject malformed status without clearing the song or suppressing a valid pending REST bootstrap.
- HlsVideo should visibly communicate initial loading/recovery before the 24-second manual-retry boundary; replacing white with silent black does not establish good recovery UX.
- Verify source handling for progressive backup is not unintentionally expanded or changed by HLS-only recovery scope.
- Review managed HLS time_update while element has missing metadata or is internally paused during recovery; no accidental queue advancement from duration=0, and no business pause/play emitted by internal reload.

These are review questions, not claimed defects in the final tree. Resolve against final implementation and regression tests before completion.
