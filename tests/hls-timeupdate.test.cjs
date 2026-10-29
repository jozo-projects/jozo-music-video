const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Actual production hook, fixture React/transport/media only; not a DOM/decoder test.
function fixture(video) {
  const sent = [];
  let ended = 0;
  const source = fs.readFileSync('src/components/video/hooks/useVideoEvents.ts', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const socket = { emit: (...args) => sent.push(args) };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name === 'react') return { useRef: (current) => ({ current }), useCallback: (fn) => fn, useEffect() {} };
      if (name.includes('constants')) return { FALLBACK_VIDEO_ID: 'waiting' };
      if (name.includes('hlsTransitionState')) return { songPlaybackKey: (song) => song.video_id, transitionBackupState() {} };
      if (name.includes('utils/hls')) return { isHlsUrl: (url) => url.includes('.m3u8') };
      if (name.includes('devLog')) return { devLog() {}, devError() {} };
      throw new Error(`Unexpected runtime import ${name}`);
    },
    Date, window: {}, setTimeout, clearTimeout, clearInterval,
  });
  const hook = module.exports.useVideoEvents({
    socket, roomId: 'qa',
    videoState: { nowPlayingData: { video_id: 'hls-song', hls_url: 'https://fixture/song.m3u8' }, currentVideoId: 'hls-song', isPaused: false, isBuffering: true },
    setVideoState() {}, setIsChangingSong() {},
    playerRef: { current: null }, backupVideoRef: { current: video },
    backupState: { backupUrl: 'https://fixture/song.m3u8', backupVideoReady: true },
    setBackupState() {}, handleBackupVideoEnd: () => ended++,
  });
  return { tick: hook.handleTimeUpdate, sent, get ended() { return ended; } };
}

for (const duration of [NaN, 0, undefined, Infinity]) {
  test(`HLS metadata duration ${String(duration)} cannot advance queue during startup/recovery`, () => {
    const f = fixture({ currentTime: 0, duration, paused: true });
    f.tick(); f.tick();
    assert.equal(f.ended, 0);
    assert.equal(f.sent.length, 0);
  });
}
test('loaded HLS progress still emits transport position, and valid end still advances', () => {
  const video = { currentTime: 20, duration: 100, paused: false };
  const f = fixture(video);
  f.tick();
  assert.equal(f.sent[0][0], 'time_update');
  assert.equal(f.sent[0][1].currentTime, 20);
  video.currentTime = 100;
  f.tick();
  assert.equal(f.ended, 1);
});
