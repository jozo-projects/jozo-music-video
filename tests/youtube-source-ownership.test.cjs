const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Production iframe component; fake API/lifecycle only, not browser autoplay proof.
function fixture(initial = {}) {
  let cursor = 0, props, handlers, tree, playerConfig;
  const slots = [], effects = [], pending = [], loads = [], calls = [];
  const ref = { current: null };
  const host = { children: [], replaceChildren(...nodes) { this.children = nodes; } };
  const player = { id: 'waiting',
    getVideoData() { return { video_id: this.id }; },
    loadVideoById(args) { loads.push(args); this.id = args.videoId; },
    mute() { calls.push('mute'); }, pauseVideo() { calls.push('pause'); }, destroy() { calls.push('destroy'); host.replaceChildren(); },
  };
  let creates = 0;
  const window = { location: { origin: 'http://fixture' }, setTimeout() {},
    YT: { Player: function (_id, config) { creates++; playerConfig = config; handlers = config.events; return player; } },
  };
  const react = {
    useRef(value) { const n = cursor++; return slots[n] ||= { current: value }; },
    useState(value) { const n = cursor++; if (!(n in slots)) slots[n] = value; return [slots[n], value => { slots[n] = value; }]; },
    useEffect(fn, deps) { const n = cursor++, old = effects[n]; if (!old || deps.some((v,i) => v !== old.deps[i])) pending.push(() => { old?.cleanup?.(); effects[n] = { deps, cleanup: fn() }; }); },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('src/components/video/YouTubePlayerIframe.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, window, document: { getElementById: () => host, createElement: () => ({}), querySelector: () => null }, console,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
      if (name.includes('deviceCapability')) return { resolveLowPowerMode: () => false };
      return new Proxy({}, { get: () => () => {} });
    },
  });
  const Component = module.exports.default;
  function render(next = {}) {
    props = { playerRef: ref, videoId: 'waiting', onReady() {}, onStateChange: () => calls.push('state'), onError: () => calls.push('error'), onPlaybackQualityChange() {}, ...props, ...next };
    cursor = 0; tree = Component(props); pending.splice(0).forEach(fn => fn()); return tree;
  }
  render(initial);
  return { render, ref, host, get playerConfig() { return playerConfig; }, replay() { effects.forEach(effect => effect?.cleanup?.()); effects.length = 0; render(); }, unmount() { effects.forEach(effect => effect?.cleanup?.()); }, player, loads, calls, get creates() { return creates; }, ready() { handlers.onReady({ target: player }); }, state(data) { handlers.onStateChange({ target: player, data }); }, error() { handlers.onError({ target: player, data: 150 }); } };
}

test('YouTube iframe fills the player host on creation and recreation', () => {
  const f = fixture();
  assert.equal(f.playerConfig.width, '100%'); assert.equal(f.playerConfig.height, '100%');
  f.replay();
  assert.equal(f.playerConfig.width, '100%'); assert.equal(f.playerConfig.height, '100%');
});

test('StrictMode cleanup/setup recreates the iframe inside a stable React-owned host', () => {
  const f = fixture(); f.ready();
  assert.equal(f.host.children.length, 1);
  f.replay(); assert.equal(f.creates, 2); assert.equal(f.host.children.length, 1);
  f.ready(); assert.equal(f.ref.current, f.player);
});

test('unmount destroys the iframe and clears its parent ref', () => {
  const f = fixture(); f.ready(); assert.equal(f.ref.current, f.player);
  f.unmount(); assert.equal(f.calls.filter(c => c === 'destroy').length, 1);
  assert.equal(f.ref.current, null);
});
test('late callbacks after unmount cannot restore a player ref or emit state/errors', () => {
  const f = fixture(); f.unmount(); f.calls.length = 0;
  f.ready(); f.state(1); f.error();
  assert.equal(f.ref.current, null); assert.deepEqual(f.calls, []);
});

test('suspension before iframe ready prevents stale load and pauses/mutes at readiness', () => {
  const f = fixture(); f.render({ videoId: 'new-waiting', suspended: true }); f.ready();
  assert.equal(f.loads.length, 0);
  assert.ok(f.calls.includes('mute')); assert.ok(f.calls.includes('pause'));
});
test('source suspension mutes and pauses an already ready retained iframe', () => {
  const f = fixture(); f.ready(); f.calls.length = 0; f.render({ suspended: true });
  assert.ok(f.calls.includes('mute')); assert.ok(f.calls.includes('pause')); assert.equal(f.creates, 1);
});
test('late hidden iframe state and errors cannot start a fallback while HLS owns playback', () => {
  const f = fixture({ suspended: true }); f.ready(); f.calls.length = 0; f.state(1); f.error();
  assert.equal(f.calls.includes('state'), false); assert.equal(f.calls.includes('error'), false);
  assert.ok(f.calls.includes('pause'));
});
test('unsuspending loads the latest requested video without recreating the iframe', () => {
  const f = fixture({ suspended: true }); f.ready(); f.render({ videoId: 'next', suspended: true });
  assert.equal(f.loads.length, 0); f.render({ suspended: false });
  assert.equal(f.loads.at(-1).videoId, 'next'); assert.equal(f.creates, 1);
});
