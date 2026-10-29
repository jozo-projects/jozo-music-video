const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');

// Executes production component + hooks. React scheduling/media/socket/REST are
// deterministic boundaries, not a DOM renderer or browser playback proof.
function fixture({ resolvedUrl = '' } = {}) {
  let cursor = 0, dirty = false, tree, clock = 100000, sequence = 0;
  const slots = [], effects = [], pending = [], timers = new Map(), cache = new Map();
  const sent = [], media = { currentTime: 0, duration: 200, volume: 1, muted: true, paused: true,
    plays: 0, pauses: 0, play() { this.plays++; this.paused = false; return Promise.resolve(); },
    pause() { this.pauses++; this.paused = true; } };
  class Socket extends EventEmitter {
    emit(...args) { sent.push(args); return true; }
    receive(...args) { return super.emit(...args); }
  }
  const socket = new Socket();
  let finishRest;
  const rest = new Promise(resolve => { finishRest = resolve; });
  function timer(fn, delay, repeat = false) { const id = ++sequence; timers.set(id, { fn, at: clock + delay, delay, repeat }); return id; }
  const react = {
    memo: x => x,
    useState(initial) {
      const n = cursor++;
      if (!(n in slots)) { slots[n] = typeof initial === 'function' ? initial() : initial; slots[n + ':set'] = value => {
        const next = typeof value === 'function' ? value(slots[n]) : value;
        if (!Object.is(next, slots[n])) { slots[n] = next; dirty = true; }
      }; }
      return [slots[n], slots[n + ':set']];
    },
    useRef(initial) { const n = cursor++; return slots[n] ||= { current: initial }; },
    useCallback(fn, deps) { const n = cursor++; const old = slots[n]; if (!old || !deps.every((v, i) => Object.is(v, old.deps[i]))) slots[n] = { fn, deps }; return slots[n].fn; },
    useMemo(fn, deps) { return react.useCallback(fn, deps)(); },
    useEffect(fn, deps) { const n = cursor++; const old = effects[n]; if (!old || !deps?.every((v, i) => Object.is(v, old.deps?.[i]))) pending.push(() => { old?.cleanup?.(); effects[n] = { deps, cleanup: fn() }; }); },
  };
  const jsx = (type, props) => ({ type, props });
  const hls = { buildHlsUrl: () => '', resolveHlsUrl: async () => resolvedUrl, isHlsUrl: url => /m3u8/.test(url), isLocalHlsFallbackEnabled: () => false };
  const window = { addEventListener() {}, removeEventListener() {}, setInterval: (fn, ms) => timer(fn, ms, true), clearInterval: id => timers.delete(id), location: { pathname: '/' } };
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({ DEV: false, VITE_API_BASE_URL: "http://fixture" })');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, console, navigator: { onLine: true }, window,
      document: { addEventListener() {}, removeEventListener() {} }, Date: class extends Date { static now() { return clock; } },
      URLSearchParams, AbortController, setTimeout: timer, clearTimeout: id => timers.delete(id), setInterval: window.setInterval, clearInterval: window.clearInterval,
      require(name) {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
        if (name === 'react-router-dom') return { useSearchParams: () => [new URLSearchParams('roomId=12')] };
        if (name.includes('devLog')) return { devLog() {}, devError() {}, IS_DEV: false };
        if (name.endsWith('/hls')) return hls;
        if (name.includes('fetchRoomNowPlaying')) return { fetchRoomNowPlaying: () => rest };
        if (name.includes('useSocketConnection')) return { useSocketConnection: () => ({ socket, socketStatus: { connected: true }, isVideoOff: false }) };
        if (name.endsWith('HlsVideo')) return { default: 'HlsVideo', __esModule: true };
        if (name.includes('youtubePlaybackQuality')) return { enforceFallbackQualityOnChange() {} };
        if (name.includes('assets')) return { logo: 'logo' };
        if (name === 'axios') return { get: async () => ({}) };
        if (name === 'socket.io-client') return {};
        const actual = path.resolve(path.dirname(filename), name);
        for (const ext of ['.ts', '.tsx']) if (fs.existsSync(actual + ext) && (/useBackupVideo|useVideoEvents|hlsTransitionState|nowPlayingHydration|constants/.test(name))) return load(actual + ext);
        return new Proxy({ __esModule: true, default: name }, { get: (target, prop) => target[prop] ?? String(prop) });
      },
    }, { filename });
    return module.exports;
  }
  const Component = load('src/components/video/VideoPlayer.tsx').default;
  function nodes(node = tree) { if (!node || typeof node !== 'object' || !node.type) return []; const children = node.props?.children; return [node, ...(Array.isArray(children) ? children.filter(Boolean).flatMap(n => nodes(n)) : children ? nodes(children) : [])]; }
  function render() {
    let count = 0;
    do { dirty = false; cursor = 0; tree = Component(); pending.splice(0).forEach(fn => fn()); if (++count > 40) throw new Error('render loop'); } while (dirty);
    for (const node of nodes()) if (node.type === 'HlsVideo' || node.type === 'video') node.props.ref.current = media;
    return tree;
  }
  function advance(ms) {
    const end = clock + ms;
    while (true) { const next = [...timers].filter(([, t]) => t.at <= end).sort((a,b) => a[1].at - b[1].at)[0]; if (!next) break;
      const [id,t] = next; clock = t.at; if (t.repeat) t.at += t.delay; else timers.delete(id); t.fn(); }
    clock = end;
  }
  render();
  return { render, nodes, media, sent, socket, advance,
    hls: () => nodes().find(n => n.type === 'HlsVideo'),
    backup: () => slots.find(value => value && typeof value === 'object' && 'backupVideoReady' in value),
    async rest(data, shouldPlay = true) { finishRest({ nowPlaying: data, shouldPlay }); await new Promise(setImmediate); render(); },
    receive(event, data, flush = true) { socket.receive(event, data); if (flush) render(); },
  };
}
const song = (video_id = 'one', timestamp = 99000) => ({ video_id, timestamp, currentTime: 12, title: video_id, hls_url: `https://media/${video_id}.m3u8` });

test('socket status before deferred REST keeps HLS source and readiness', async () => {
  const f = fixture(), data = song(); f.receive('now_playing_status', { data, isPlaying: false });
  f.hls().props.onLoadedData(); f.render();
  await f.rest(data, false);
  assert.equal(f.hls()?.props.url, data.hls_url);
  assert.equal(f.hls().props.desiredPlaying, false);
  assert.equal(f.backup().backupVideoReady, true);
});
test('REST first then same-song status retains source, initial position and pause', async () => {
  const f = fixture(), data = song(); await f.rest(data, false);
  const position = f.hls().props.initialPosition;
  assert.equal(position, 12);
  f.hls().props.onLoadedData(); f.render(); f.media.currentTime = 28;
  f.receive('now_playing_status', { data, isPlaying: false });
  assert.equal(f.hls().props.initialPosition, position); assert.equal(f.media.currentTime, 28);
  assert.equal(f.hls().props.desiredPlaying, false);
});
for (const event of ['play_song', 'current_song', 'now_playing']) test(`synchronous ${event} invalidates delayed REST before rerender`, async () => {
  const f = fixture(); f.receive(event, song('two'), false); await f.rest(song('one'));
  assert.equal(f.hls()?.props.url, song('two').hls_url);
});
test('clear invalidates delayed REST immediately, before its delayed presentation reset', async () => {
  const f = fixture(); f.receive('now_playing_cleared', undefined, false); await f.rest(song()); f.advance(151); f.render();
  assert.equal(f.hls(), undefined);
});
test('pause immediately after new song, without rerender, wins over REST', async () => {
  const f = fixture(); f.receive('play_song', song(), false); f.receive('playback_event', { event: 'pause', videoId: 'one', currentTime: 37 }, false);
  await f.rest(song(), true); assert.equal(f.hls().props.desiredPlaying, false);
  assert.equal(f.hls().props.initialPosition, 37);
});
test('explicit empty status clears song and rejects stale REST', async () => {
  const f = fixture(); f.receive('play_song', song()); f.receive('now_playing_status', { data: null, isPlaying: false });
  assert.equal(f.hls(), undefined);
  await f.rest(song()); assert.equal(f.hls(), undefined);
});
test('missing or malformed status does not clear an active song', () => {
  const f = fixture(); f.receive('play_song', song());
  for (const value of [undefined, {}, { isPlaying: false }, { data: {} }, { data: 'bad' }]) { f.receive('now_playing_status', value); assert.equal(f.hls()?.props.url, song().hls_url); }
});
test('paused HLS readiness never plays, unmutes volume zero, or emits business play', async () => {
  const f = fixture(); await f.rest(song(), false);
  f.receive('volumeChange', 0); assert.equal(f.hls().props.volume, 0);
  f.hls().props.onLoadedData(); f.advance(101); f.render();
  assert.equal(f.media.plays, 0); assert.equal(f.hls().props.desiredPlaying, false);
  assert.equal(f.sent.some(([name, data]) => name === 'video_event' && data.event === 'play'), false);
  assert.equal(f.media.muted, true);
});
test('same-song reconnect aliases do not rewind or resume a paused mounted HLS', async () => {
  const f = fixture(), data = song(); await f.rest(data, false); f.hls().props.onLoadedData(); f.render(); f.media.currentTime = 42;
  for (const event of ['current_song', 'now_playing', 'play_song']) { f.receive(event, data); assert.equal(f.media.currentTime, 42); assert.equal(f.hls().props.desiredPlaying, false); }
  assert.equal(f.media.plays, 0);
});
test('newer same-ID queue entry is a new playback boundary', async () => {
  const f = fixture(); await f.rest(song(), false); const old = f.hls().props.playbackKey;
  f.receive('play_song', song('one', 100000));
  assert.notEqual(f.hls().props.playbackKey, old); assert.equal(f.hls().props.desiredPlaying, true); assert.equal(f.hls().props.initialPosition, 0);
});
test('seek received while HLS is still loading updates its pending initial position', async () => {
  const f = fixture(); await f.rest(song(), false);
  f.receive('playback_event', { videoId: 'one', event: 'seek', currentTime: 65 });
  assert.equal(f.hls().props.initialPosition, 65); assert.equal(f.hls().props.desiredPlaying, false);
});
test('stale progressive readiness timer cannot play replacement HLS', async () => {
  const f = fixture(); await f.rest({ ...song(), hls_url: 'https://media/one.mp4' });
  f.nodes().find(n => n.type === 'video').props.onLoadedData();
  f.receive('play_song', song('two')); f.advance(101); f.render();
  assert.equal(f.media.plays, 0);
  assert.equal(f.sent.some(([name, data]) => name === 'video_event' && data.event === 'play'), false);
});
test('clear followed by canonical status for the same entry cannot clear it later', () => {
  const f = fixture(); f.receive('play_song', song()); f.receive('now_playing_cleared');
  f.receive('now_playing_status', { data: song(), isPlaying: false }); f.advance(151); f.render();
  assert.equal(f.hls()?.props.url, song().hls_url);
});
test('repeated status without HLS metadata preserves loaded catalog source/readiness', async () => {
  const f = fixture(); await f.rest(song(), false); f.hls().props.onLoadedData(); f.render();
  const data = { ...song() }; delete data.hls_url;
  for (let i = 0; i < 3; i++) f.receive('now_playing_status', { data, isPlaying: false });
  assert.equal(f.hls()?.props.url, song().hls_url); assert.equal(f.backup().backupVideoReady, true); assert.equal(f.media.plays, 0);
});
test('local-resolved HLS readiness is presentation only even when media currentSrc is blob', async () => {
  const f = fixture({ resolvedUrl: song().hls_url });
  await f.rest({ ...song(), hls_url: '' }, false); await new Promise(setImmediate); f.render();
  f.media.currentSrc = 'blob:fixture'; f.hls().props.onLoadedData(); f.render();
  assert.equal(f.hls().props.desiredPlaying, false); assert.equal(f.media.plays, 0);
  assert.equal(f.sent.some(([name, data]) => name === 'video_event' && data.event === 'play'), false);
});
test('waiting-player readiness is not authoritative room playback and cannot discard REST', async () => {
  const f = fixture(); f.nodes().find(n => n.props.onReady).props.onReady({ target: {} });
  await f.rest(song(), false);
  assert.equal(f.hls()?.props.url, song().hls_url);
});
test('malformed status cannot supersede a valid pending REST snapshot', async () => {
  const f = fixture(); f.receive('now_playing_status', { data: {} }); await f.rest(song(), false);
  assert.equal(f.hls()?.props.url, song().hls_url);
});
test('HLS manual retry is not obscured by parent loading/blackout/pause overlays', async () => {
  const f = fixture(); await f.rest(song(), false);
  const blockers = f.nodes().filter(n => n.type === 'div' && /absolute inset-0/.test(n.props.className || '') && /z-50|z-40|z-\[25\]/.test(n.props.className || ''));
  assert.equal(blockers.length, 0);
});
