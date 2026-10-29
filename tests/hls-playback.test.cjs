const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Executed production TSX + helper modules; React lifecycle/media/timers are fixtures,
// not a DOM renderer, decoder, real hls.js networking or browser autoplay evidence.
function fixture(options = {}) {
  let cursor = 0, now = 0, timerId = 0, tree, props, lastKey;
  const slots = [], effects = [], pending = [], timers = new Map(), instances = [], videos = [];
  const counts = { ready: 0, ended: 0, error: 0 };
  class Video {
    _currentTime = 0; duration = 100; readyState = 0; paused = true; ended = false;
    get currentTime() { return this._currentTime; }
    set currentTime(value) {
      this._currentTime = options.clampRestoreBeforeData && this.readyState < 2 ? 0 : value;
      if (options.emitSeekingOnSet) this.emit('seeking');
    }
    listeners = new Map(); plays = 0; loads = 0;
    addEventListener(e, fn) { if (!this.listeners.has(e)) this.listeners.set(e, new Set()); this.listeners.get(e).add(fn); }
    removeEventListener(e, fn) { this.listeners.get(e)?.delete(fn); }
    emit(e) { for (const fn of [...(this.listeners.get(e) || [])]) fn({ type: e }); }
    play() { this.plays++; if (options.rejectPlay) return Promise.reject(new Error('blocked')); this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    load() { this.loads++; this._currentTime = 0; this.readyState = 0; }
    removeAttribute() {}
    canPlayType() { return options.native ? 'probably' : ''; }
  }
  class Hls {
    static Events = { MANIFEST_PARSED: 'manifest', MEDIA_ENDED: 'media-ended', ERROR: 'hls-error' };
    static isSupported() { return !options.native; }
    handlers = new Map(); destroyed = false;
    constructor() { instances.push(this); }
    on(e, fn) { this.handlers.set(e, fn); }
    loadSource(url) { this.url = url; }
    attachMedia(video) { this.video = video; }
    destroy() { this.destroyed = true; }
    emit(e, data) { this.handlers.get(e)?.(e, data); }
  }
  const react = {
    memo: (x) => x, forwardRef: (fn) => (p) => fn(p, {}),
    useRef(value) { const n = cursor++; return slots[n] ||= { current: value }; },
    useState(value) { const n = cursor++; if (!(n in slots)) slots[n] = value; return [slots[n], (v) => { slots[n] = typeof v === 'function' ? v(slots[n]) : v; }]; },
    useEffect(fn, deps) { const n = cursor++; const old = effects[n]; if (!old || !deps || deps.some((v, i) => v !== old.deps[i])) pending.push(() => { old?.cleanup?.(); effects[n] = { deps, cleanup: fn() }; }); },
    useImperativeHandle() { cursor++; },
  };
  const cache = new Map();
  const timeout = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} }; cache.set(file, module.exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, p, key) => ({ type, props: p, key }), jsxs: (type, p, key) => ({ type, props: p, key }) };
      if (name === 'hls.js') return Hls;
      if (name.includes('utils/hls')) return { isHlsUrl: (url) => url.includes('.m3u8') };
      const resolved = path.resolve(path.dirname(file), name);
      return load(fs.existsSync(resolved + '.ts') ? resolved + '.ts' : resolved + '.tsx');
    }, setTimeout: timeout, clearTimeout: (id) => timers.delete(id), performance: { now: () => now }, Date: class extends Date { static now() { return now; } }, Event, console: { warn() {}, error() {}, info() {} } });
    return module.exports;
  }
  const Component = load(path.resolve('src/components/video/HlsVideo.tsx')).default;
  function nodes(node) { if (!node || typeof node !== 'object') return []; return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
  function render(next = {}) {
    props = { url: 'https://fixture/media.m3u8', playbackKey: 'a', onLoadedData: () => counts.ready++, onEnded: () => counts.ended++, onError: () => counts.error++, ...props, ...next };
    cursor = 0; tree = Component(props);
    const element = nodes(tree).find((n) => n.type === 'video');
    if (element) {
      if (!videos.length || lastKey !== element.key) { videos.push(new Video()); lastKey = element.key; }
      element.props.ref.current = videos.at(-1);
    }
    pending.splice(0).forEach((fn) => fn());
    return tree;
  }
  function advance(ms) {
    const end = now + ms;
    while (true) { const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; timers.delete(next[0]); now = next[1].at; next[1].fn(); }
    now = end;
  }
  render(options.props);
  return { render, advance, counts, instances, timers, get video() { return videos.at(-1); }, status() { render(); return nodes(tree).find((n) => n.props?.role === 'status'); }, manifest() { instances.at(-1)?.emit('manifest'); }, ready() { this.video.readyState = 2; this.video.emit('loadeddata'); }, retry() { render(); return nodes(tree).find((n) => n.type === 'button'); }, unmount() { effects.forEach((e) => e?.cleanup?.()); } };
}

test('initial paused hydration restores 12 without playing', () => {
  const f = fixture({ props: { initialPosition: 12, desiredPlaying: false } });
  f.manifest(); f.video.emit('loadedmetadata'); assert.equal(f.video.currentTime, 12);
  f.ready(); assert.equal(f.video.currentTime, 12); assert.equal(f.video.plays, 0);
});
test('initial playing hydration restores 42 and ordinary renders do not restart or seek', () => {
  const f = fixture({ props: { initialPosition: 42, desiredPlaying: true } });
  f.manifest(); f.ready(); assert.equal(f.video.currentTime, 42); assert.equal(f.video.paused, false);
  f.video.currentTime = 55; f.video.emit('timeupdate'); const plays = f.video.plays;
  f.render({ initialPosition: 9, volume: 30 }); f.video.emit('loadedmetadata'); f.video.emit('canplay');
  assert.equal(f.video.currentTime, 55); assert.equal(f.instances.length, 1); assert.equal(f.video.plays, plays);
});
test('initial position survives repeated startup retries without metadata or data', () => {
  const f = fixture({ native: true, props: { initialPosition: 42, desiredPlaying: false } });
  f.advance(24000); assert.equal(f.video.currentTime, 0); assert.equal(f.video.loads, 3);
  f.retry().props.onClick(); f.video.emit('loadedmetadata'); f.ready();
  assert.equal(f.video.currentTime, 42); assert.equal(f.video.plays, 0);
});
test('remote seek during recovery wins over old pending position and later startup retry', () => {
  const f = fixture({ native: true, props: { initialPosition: 12, desiredPlaying: true } });
  f.ready(); f.advance(8000);
  f.video.currentTime = 63; f.video.emit('seeking'); f.video.emit('loadedmetadata');
  assert.equal(f.video.currentTime, 63);
  f.advance(8000); assert.equal(f.video.currentTime, 0);
  f.video.emit('loadedmetadata'); f.ready(); assert.equal(f.video.currentTime, 63);
});
test('seeking to zero during recovery also replaces a nonzero pending position', () => {
  const f = fixture({ native: true }); f.ready(); f.video.currentTime = 37; f.video.emit('timeupdate');
  f.advance(8000); f.video.currentTime = 0; f.video.emit('seeking');
  f.video.emit('loadedmetadata'); f.ready(); assert.equal(f.video.currentTime, 0);
});
test('invalid initial positions fall back to zero', () => {
  for (const initialPosition of [-1, NaN, Infinity]) {
    const f = fixture({ props: { initialPosition } }); f.ready(); assert.equal(f.video.currentTime, 0);
  }
});

test('restore seeking feedback cannot erase a pending position before data', () => {
  const f = fixture({ emitSeekingOnSet: true, clampRestoreBeforeData: true, props: { initialPosition: 42, desiredPlaying: false } });
  f.video.emit('loadedmetadata'); assert.equal(f.video.currentTime, 0);
  f.ready(); assert.equal(f.video.currentTime, 42); assert.equal(f.video.plays, 0);
});
test('a new queue identity initializes from the latest initial position', () => {
  const f = fixture({ props: { initialPosition: 12, desiredPlaying: false } });
  f.ready(); f.render({ playbackKey: 'b', initialPosition: 42 }); f.ready();
  assert.equal(f.instances.length, 2); assert.equal(f.video.currentTime, 42);
});

test('manifest is not readiness; real data is ready once', () => {
  const f = fixture(); f.manifest(); assert.equal(f.counts.ready, 0); f.ready(); f.ready(); assert.equal(f.counts.ready, 1);
});
test('startup budget is two 8s recoveries, then keyboard-accessible manual retry without queue error', () => {
  const f = fixture(); f.advance(7999); assert.equal(f.instances.length, 1); f.advance(1); assert.equal(f.instances.length, 2);
  f.render({ volume: 50 }); f.advance(8000); assert.equal(f.instances.length, 3); f.advance(8000);
  const button = f.retry(); assert.ok(button); assert.notEqual(button.props.tabIndex, -1); assert.equal(button.props.type, 'button');
  assert.equal(f.counts.error, 0); assert.equal(f.counts.ended, 0); f.advance(80000); assert.equal(f.instances.length, 3);
  button.props.onClick(); assert.equal(f.instances.length, 4);
});
test('stall restores actual position and explicit paused intent without auto-unpause', () => {
  const f = fixture(); f.manifest(); f.ready(); f.video.currentTime = 37; f.video.emit('timeupdate');
  f.advance(8000); assert.equal(f.instances.length, 2); f.manifest(); f.video.emit('loadedmetadata'); assert.equal(f.video.currentTime, 37);
  f.render({ desiredPlaying: false }); const plays = f.video.plays; f.instances.at(-1).emit('hls-error', { fatal: true }); f.manifest(); f.ready();
  assert.equal(f.video.paused, true); assert.equal(f.video.plays, plays); assert.equal(f.video.currentTime, 37);
});
test('hydrated paused startup loads data but never plays or stall-recovers after ready', () => {
  const f = fixture(); f.render({ desiredPlaying: false }); f.manifest(); f.ready(); assert.equal(f.video.plays, 0); f.advance(80000); assert.equal(f.instances.length, 1);
  f.render({ desiredPlaying: true }); assert.equal(f.video.plays, 1);
});
test('same URL new entry has fresh readiness/end and stale callbacks cannot mutate it', () => {
  const f = fixture(); f.manifest(); f.ready(); const old = f.instances[0]; const oldVideo = f.video;
  const oldData = [...oldVideo.listeners.get('loadeddata') || []]; const staleTimer = [...f.timers.values()][0]?.fn;
  f.render({ playbackKey: 'b' }); const current = f.instances.at(-1); const plays = f.video.plays;
  old.emit('manifest'); old.emit('hls-error', { fatal: true }); old.emit('media-ended'); oldData.forEach((fn) => fn()); staleTimer?.();
  assert.equal(f.counts.ready, 1); assert.equal(f.video.plays, plays); assert.equal(f.instances.at(-1), current);
  f.manifest(); f.ready(); assert.equal(f.counts.ready, 2); f.video.currentTime = 100; f.video.ended = true; f.video.emit('ended'); current.emit('media-ended'); assert.equal(f.counts.ended, 1);
});
test('playing progress prevents stalls but does not replenish recovery budget', () => {
  const f = fixture(); f.advance(8000); f.manifest(); f.ready();
  for (let i = 1; i < 20; i++) { f.video.currentTime = i; f.advance(1000); }
  assert.equal(f.instances.length, 2); f.advance(8000); assert.equal(f.instances.length, 3); f.manifest(); f.ready(); f.advance(8000); assert.ok(f.retry()); assert.equal(f.instances.length, 3);
});
test('native HLS also waits for data and retries with preserved position', () => {
  const f = fixture({ native: true }); assert.equal(f.counts.ready, 0); f.ready(); f.video.currentTime = 22; f.video.emit('timeupdate'); f.advance(8000); assert.ok(f.video.loads >= 2); f.video.emit('loadedmetadata'); assert.equal(f.video.currentTime, 22);
});
test('repeated startup recovery does not overwrite the pending resume position with reset media time', () => {
  const f = fixture({ native: true }); f.ready(); f.video.currentTime = 44; f.video.emit('timeupdate');
  f.advance(8000); assert.equal(f.video.currentTime, 0); f.advance(8000); f.video.emit('loadedmetadata'); assert.equal(f.video.currentTime, 44);
});
test('manual retry invokes play inside the user gesture rather than awaiting a new manifest', () => {
  const f = fixture(); f.advance(24000); const plays = f.video.plays; f.retry().props.onClick(); assert.equal(f.video.plays, plays + 1);
});
test('old attempt data/end/error/manifest callbacks are ignored after recovery', () => {
  const f = fixture(); const old = f.instances[0]; const ready = [...f.video.listeners.get('loadeddata')];
  f.advance(8000); const current = f.instances.at(-1); f.video.readyState = 2; f.video.ended = true;
  ready.forEach((fn) => fn()); old.emit('manifest'); old.emit('media-ended'); old.emit('hls-error', { fatal: true });
  assert.equal(f.counts.ready, 0); assert.equal(f.counts.ended, 0); assert.equal(f.instances.at(-1), current);
});
test('native explicit pause is retained during fatal recovery when desiredPlaying is omitted', () => {
  const f = fixture(); f.manifest(); f.ready(); f.video.currentTime = 17; f.video.pause(); f.video.emit('pause');
  f.instances.at(-1).emit('hls-error', { fatal: true }); const plays = f.video.plays; f.manifest(); f.ready(); assert.equal(f.video.plays, plays); assert.equal(f.video.paused, true);
});
test('each same-URL queue identity ends at most once and never before data', () => {
  const f = fixture(); f.video.ended = true; f.video.emit('ended'); assert.equal(f.counts.ended, 0);
  f.ready(); f.video.emit('ended'); f.video.emit('ended'); assert.equal(f.counts.ended, 1);
  f.render({ playbackKey: 'b' }); f.ready(); f.video.ended = true; f.video.emit('ended'); f.video.emit('ended'); assert.equal(f.counts.ended, 2);
});
test('late canplay/metadata events do not rewind an already-ready player after a parent seek', () => {
  const f = fixture(); f.ready(); f.video.currentTime = 37; f.video.emit('timeupdate'); f.advance(8000); f.ready(); f.video.currentTime = 63; f.video.emit('canplay'); f.video.emit('loadedmetadata'); assert.equal(f.video.currentTime, 63);
});
test('manual retry is auto-focused for keyboard/remote activation', () => {
  const f = fixture(); f.advance(24000); assert.equal(f.retry().props.autoFocus, true);
});
test('a queued old retry click cannot reload a new same-URL identity', () => {
  const f = fixture(); f.advance(24000); const retry = f.retry().props.onClick; f.render({ playbackKey: 'b' }); const n = f.instances.length;
  retry(); assert.equal(f.instances.length, n);
});
test('updated pending initialPosition before metadata is applied without restarting mounted identity', () => {
  const f = fixture({ props: { initialPosition: 12, desiredPlaying: false } });
  f.render({ initialPosition: 65 }); assert.equal(f.instances.length, 1);
  f.video.emit('loadedmetadata'); f.ready(); assert.equal(f.video.currentTime, 65);
  f.video.currentTime = 70; f.render({ initialPosition: 4 }); assert.equal(f.video.currentTime, 70);
});
test('seek restoration must have data at the restored position before reporting ready', () => {
  const f = fixture(); f.render({ playbackKey: 'seek-entry', initialPosition: 7, desiredPlaying: false });
  let position = 0;
  Object.defineProperty(f.video, 'currentTime', { configurable: true, get: () => position, set: (value) => { position = value; f.video.readyState = 1; } });
  f.ready(); assert.equal(f.counts.ready, 0);
  f.ready(); assert.equal(f.counts.ready, 1); assert.equal(f.video.currentTime, 7);
});
test('late actual playback hides retry without replenishing exhausted budget', () => {
  const f = fixture(); f.advance(24000); assert.ok(f.retry());
  f.manifest(); f.ready(); f.video.currentTime = 1; f.video.emit('timeupdate');
  assert.equal(f.retry(), undefined); assert.equal(f.instances.length, 3);
  f.advance(8000); assert.ok(f.retry()); assert.equal(f.instances.length, 3);
});
test('initial loading and recovery feedback are visible until media has data', () => {
  const f = fixture(); assert.ok(f.status());
  f.manifest(); assert.ok(f.status()); f.ready(); assert.equal(f.status(), undefined);
  f.advance(8000); assert.ok(f.status()); f.ready(); assert.equal(f.status(), undefined);
});
test('play rejection exposes manual retry and unmount invalidates pending promise/timer callbacks', async () => {
  const f = fixture({ rejectPlay: true }); f.manifest(); await Promise.resolve(); await Promise.resolve(); assert.ok(f.retry());
  f.unmount(); const n = f.instances.length; f.advance(80000); assert.equal(f.instances.length, n);
});
