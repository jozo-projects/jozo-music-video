/** currentTime is already sampled by the server, not an offset from queue start. */
export function playbackPosition(
  data: { currentTime?: number; position_timestamp?: number } | null | undefined,
  playing: boolean,
): number {
  const position = Number.isFinite(data?.currentTime) ? Math.max(0, data!.currentTime!) : 0;
  const sample = data?.position_timestamp;
  // Legacy snapshots have no sample clock: use their position once, without
  // reusing timestamp (which identifies the queue entry and can be minutes old).
  const elapsed = playing && sample !== undefined && Number.isFinite(sample)
    ? Math.max(0, Date.now() - sample) / 1000 : 0;
  return position + elapsed;
}
