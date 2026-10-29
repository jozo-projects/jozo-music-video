const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter, once } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { createRequire } = require('node:module');

// Exercise the actual hook with a minimal effect/state fixture, without installing
// a DOM or renderer. Socket/Manager are distinct, as in Socket.IO v4.
function fixture(realIo, url) {
  let current;
  const sockets = [];
  const browser = new EventEmitter();
  browser.addEventListener = browser.on.bind(browser);
  browser.removeEventListener = browser.off.bind(browser);
  let time = 0;
  let id = 0;
  const timers = new Map();
  function timeout(fn, delay, interval = false) {
    const key = ++id;
    timers.set(key, { fn, at: time + delay, delay, interval });
    return key;
  }
  function advance(ms) {
    const end = time + ms;
    while (true) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [key, timer] = next;
      time = timer.at;
      if (timer.interval) timer.at += timer.delay;
      else timers.delete(key);
      timer.fn();
    }
    time = end;
  }
  class Socket extends EventEmitter {
    connected = false;
    active = true;
    io = new EventEmitter();
    sent = [];
    connects = 0;
    disconnects = 0;
    emit(event, ...args) { this.sent.push([event, ...args]); return true; }
    receive(event, ...args) { return super.emit(event, ...args); }
    off(event, listener) { return listener ? super.off(event, listener) : this.removeAllListeners(event); }
    connect() { this.connects++; this.active = true; return this; }
    disconnect() {
      this.disconnects++;
      this.active = false;
      if (this.connected) { this.connected = false; this.receive('disconnect', 'io client disconnect'); }
      return this;
    }
    up() { this.connected = true; this.active = true; this.receive('connect'); }
    down(reason) { this.connected = false; this.active = reason !== 'io server disconnect' && reason !== 'io client disconnect'; this.receive('disconnect', reason); }
  }
  const react = {
    useState(value) {
      const hook = current;
      const n = hook.cursor++;
      if (!(n in hook.slots)) hook.slots[n] = typeof value === 'function' ? value() : value;
      return [hook.slots[n], (value) => { hook.slots[n] = typeof value === 'function' ? value(hook.slots[n]) : value; }];
    },
    useRef(value) {
      const hook = current;
      const n = hook.cursor++;
      return hook.slots[n] ||= { current: value };
    },
    useEffect(fn, deps) {
      const hook = current;
      const n = hook.cursor++;
      const old = hook.effects[n];
      if (!old || !deps.every((dep, i) => Object.is(dep, old.deps[i]))) {
        hook.pending.push(() => { old?.cleanup?.(); hook.effects[n] = { fn, deps, cleanup: fn() }; });
      }
    },
  };
  const io = (address, options) => {
    const socket = realIo ? realIo(address, options) : new Socket();
    socket.options = options;
    sockets.push(socket);
    return socket;
  };
  const source = fs.readFileSync('src/components/video/hooks/useSocketConnection.ts', 'utf8')
    .replaceAll('import.meta.env.VITE_SOCKET_URL', JSON.stringify(url || 'http://fixture'))
    .replaceAll('import.meta.env.DEV', 'false');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'socket.io-client') return Object.assign(io, { io });
      if (name.includes('deviceId')) return { getDeviceId: () => 'fixture-device' };
      if (name.includes('devLog')) return { devLog() {}, devError() {} };
      throw new Error(`Unexpected runtime import: ${name}`);
    },
    window: browser, navigator: { onLine: true },
    setTimeout: realIo ? setTimeout : timeout,
    clearTimeout: realIo ? clearTimeout : (key) => timers.delete(key),
    setInterval: realIo ? setInterval : (fn, delay) => timeout(fn, delay, true),
    clearInterval: realIo ? clearInterval : (key) => timers.delete(key),
  });
  function mount(props = {}) {
    const hook = { cursor: 0, slots: [], effects: [], pending: [], props: { roomId: '12', onConnect() {}, onVideosOff() {}, onVideosOn() {}, ...props } };
    hook.render = (props = {}) => {
      Object.assign(hook.props, props);
      hook.cursor = 0;
      current = hook;
      hook.result = module.exports.useSocketConnection(hook.props);
      hook.pending.splice(0).forEach((fn) => fn());
      return hook.result;
    };
    hook.unmount = () => hook.effects.forEach((effect) => effect.cleanup?.());
    hook.replay = () => { hook.unmount(); hook.effects.forEach((effect) => { effect.cleanup = effect.fn(); }); };
    hook.render();
    hook.render();
    return hook;
  }
  return { mount, sockets, advance, browser, timers };
}

test('transport retries never exhaust, with bounded exponential backoff', () => {
  const f = fixture(); const h = f.mount(); const s = f.sockets[0];
  assert.equal(s.options.reconnectionAttempts, Infinity);
  assert.equal(s.options.reconnectionDelay, 1000);
  assert.equal(s.options.reconnectionDelayMax, 5000);
  h.unmount(); f.advance(0);
});

test('Manager attempts update status; only Socket connect refreshes canonical song once', () => {
  const f = fixture(); let refreshes = 0;
  const h = f.mount({ onConnect: () => refreshes++ }); const s = f.sockets[0];
  s.io.emit('reconnect_attempt', 8);
  assert.equal(h.render().socketStatus.connectionAttempts, 8);
  s.io.emit('reconnect', 8);
  assert.equal(refreshes, 0);
  s.up();
  assert.equal(refreshes, 1);
  assert.equal(h.render().socketStatus.connected, true);
  assert.equal(h.result.socketStatus.connectionAttempts, 0);
  assert.equal(s.sent.filter(([event]) => event === 'request_current_song').length, 0, 'callback owns the refresh');
  h.unmount(); f.advance(0);
});

test('server disconnect reconnects after delay, repeated kicks back off to cap', () => {
  const f = fixture(); const h = f.mount(); const s = f.sockets[0];
  for (const delay of [1000, 2000, 4000, 5000, 5000]) {
    s.up(); s.down('io server disconnect');
    const before = s.connects;
    f.advance(delay - 1); assert.equal(s.connects, before);
    f.advance(1); assert.equal(s.connects, before + 1);
  }
  h.unmount(); f.advance(0);
});

test('explicit client disconnect does not retry, even on browser online', () => {
  const f = fixture(); const h = f.mount(); const s = f.sockets[0];
  s.up(); s.disconnect(); f.browser.emit('online'); f.advance(30000);
  assert.equal(s.connects, 0);
  h.unmount(); f.advance(0);
});

test('namespace/auth/room rejection is terminal; transient transport errors recover online', () => {
  const f = fixture(); const h = f.mount(); const s = f.sockets[0];
  s.receive('connect_error', new Error('transport unavailable'));
  f.browser.emit('online'); assert.equal(s.connects, 1);
  s.active = false; s.receive('connect_error', new Error('rejected by namespace middleware'));
  f.browser.emit('online'); f.advance(30000);
  assert.equal(s.connects, 1);
  h.unmount(); f.advance(0);
});

test('online coalesces pending server retry and reconnects immediately once', () => {
  const f = fixture(); const h = f.mount(); const s = f.sockets[0];
  s.up(); s.down('io server disconnect'); f.browser.emit('online');
  assert.equal(s.connects, 1); f.advance(10000); assert.equal(s.connects, 1);
  h.unmount(); f.advance(0);
});

test('StrictMode replay during pending connection reuses socket and reattaches handlers', () => {
  const f = fixture(); let refreshes = 0; let off = 0; let on = 0;
  const h = f.mount({ onConnect: () => refreshes++, onVideosOff: () => off++, onVideosOn: () => on++ });
  const s = f.sockets[0]; h.replay(); f.advance(0);
  assert.equal(f.sockets.length, 1); assert.equal(s.disconnects, 0);
  s.up(); assert.equal(refreshes, 1);
  s.receive('videos_turned_off', { status: 'off' }); assert.equal(h.render().isVideoOff, true); assert.equal(off, 1);
  s.receive('videos_turned_on'); assert.equal(h.render().isVideoOff, false); assert.equal(on, 1);
  h.unmount(); f.advance(0);
});

test('connected StrictMode replay attaches listeners and uses current callbacks', () => {
  const f = fixture(); const h = f.mount(); const s = f.sockets[0]; s.up(); h.replay();
  let off = 0; h.render({ onVideosOff: () => off++ });
  s.receive('videos_turned_off', {}); assert.equal(off, 1);
  assert.equal(s.listenerCount('connect'), 1);
  h.unmount(); f.advance(0);
});

test('same-room subscribers share transport; cleanup preserves other subscribers/listeners', () => {
  const f = fixture(); const a = f.mount(); const s = f.sockets[0]; s.up();
  let calls = 0; const b = f.mount({ onVideosOn: () => calls++ });
  const external = () => {}; s.on('videos_turned_on', external);
  a.unmount(); f.advance(0); s.receive('videos_turned_on');
  assert.equal(f.sockets.length, 1); assert.equal(s.disconnects, 0); assert.equal(calls, 1);
  b.unmount(); f.advance(0);
  assert.equal(s.disconnects, 1); assert.equal(s.listenerCount('videos_turned_on'), 1);
});

test('unmount clears timers, Manager and browser listeners and stops reconnect', () => {
  const f = fixture(); const h = f.mount(); const s = f.sockets[0]; s.up(); s.down('io server disconnect');
  h.unmount(); f.advance(100000);
  assert.equal(s.connects, 0); assert.equal(s.disconnects, 1);
  assert.equal(f.timers.size, 0); assert.equal(f.browser.listenerCount('online'), 0);
  assert.equal(s.io.listenerCount('reconnect_attempt'), 0);
  assert.equal(s.listenerCount('connect'), 0);
});

test('room changes disconnect old transport and cancel its pending retry', () => {
  const f = fixture(); const h = f.mount(); const s = f.sockets[0]; s.up(); s.down('io server disconnect');
  h.render({ roomId: '23' }); f.advance(30000);
  assert.equal(s.disconnects, 1); assert.equal(s.connects, 0);
  assert.equal(f.sockets.length, 2); assert.equal(f.sockets[1].options.query.roomId, '23');
  h.unmount(); f.advance(0);
});

test('full unmount followed by remount creates a live connection without stale callbacks', () => {
  const f = fixture(); let oldCalls = 0; let newCalls = 0;
  const a = f.mount({ onConnect: () => oldCalls++ }); const oldSocket = f.sockets[0];
  oldSocket.up(); a.unmount(); f.advance(0);
  const b = f.mount({ onConnect: () => newCalls++ });
  assert.equal(b.render().socketStatus.connected, false);
  f.sockets[1].up(); oldSocket.receive('connect');
  assert.equal(oldCalls, 1); assert.equal(newCalls, 1);
  b.unmount(); f.advance(0); assert.equal(f.timers.size, 0);
});

// Run the actual player's callback, not a test-only copy of its wire event.
function playerConnect() {
  const source = fs.readFileSync('src/components/video/VideoPlayer.tsx', 'utf8');
  const callback = source.match(/onConnect:\s*(\([^)]*\)\s*=>\s*\{[\s\S]*?\n {4}\})/)[1];
  return vm.runInNewContext(`(${callback})`, { roomId: '12' });
}

test('player connect callback requests the canonical backend check_now_playing event', () => {
  const sent = [];
  playerConnect()({ emit: (...args) => sent.push(args) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'check_now_playing');
  assert.equal(sent[0][1].roomId, '12');
});

// Optional real loopback integration uses an existing server package, never
// starts the application backend or loads .env / Redis / database configuration.
let Server;
try { ({ Server } = require('socket.io')); } catch {
  try {
    const path = require('node:path');
    const backendPackage = path.resolve(process.cwd(), '../be-ezinn/package.json');
    ({ Server } = createRequire(backendPackage)('socket.io'));
  } catch { /* optional: standalone checkout may not have a server package */ }
}
test('real Socket.IO: recovery survives more than five failed transport handshakes', { skip: !Server }, async () => {
  const http = require('node:http').createServer();
  let handshakes = 0;
  const server = new Server(http, {
    transports: ['websocket'],
    allowRequest: (_request, accept) => {
      handshakes++;
      accept(null, handshakes > 7);
    },
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  // Accelerate only the fixture clock; retain the production retry budget.
  const io = require('socket.io-client').io;
  const f = fixture((url, options) => io(url, {
    ...options, reconnectionDelay: 5, reconnectionDelayMax: 10, randomizationFactor: 0,
  }), `http://127.0.0.1:${http.address().port}`);
  let refreshes = 0;
  const h = f.mount({ onConnect: () => refreshes++ }); const s = f.sockets[0];
  try {
    await once(s, 'connect', { signal: AbortSignal.timeout(5000) });
    assert.equal(handshakes, 8); assert.equal(refreshes, 1);
    assert.equal(h.render().socketStatus.connected, true);
  } finally {
    h.unmount(); await new Promise((resolve) => setTimeout(resolve, 10)); s.disconnect();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('real Socket.IO: server disconnect recovers and refreshes exactly once per connect', { skip: !Server }, async () => {
  const http = require('node:http').createServer();
  const server = new Server(http, { transports: ['websocket'] });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const port = http.address().port;
  let connections = 0; let requests = 0; let peer;
  const requestsReceived = new EventEmitter();
  server.on('connection', (socket) => {
    connections++; peer = socket;
    socket.on('check_now_playing', () => {
      requests++;
      socket.emit('now_playing_status', { isPlaying: true, data: { video_id: `canonical-${connections}` } });
      requestsReceived.emit('request');
    });
  });
  const f = fixture(require('socket.io-client').io, `http://127.0.0.1:${port}`);
  let refreshes = 0;
  let h;
  try {
    const firstRequest = once(requestsReceived, 'request', { signal: AbortSignal.timeout(5000) });
    h = f.mount({ onConnect: (socket) => { refreshes++; playerConnect()(socket); } });
    const s = f.sockets[0];
    const firstCanonical = once(s, 'now_playing_status', { signal: AbortSignal.timeout(5000) });
    await firstRequest;
    await firstCanonical;
    const secondRequest = once(requestsReceived, 'request', { signal: AbortSignal.timeout(5000) });
    const canonical = once(s, 'now_playing_status', { signal: AbortSignal.timeout(5000) });
    peer.disconnect(true);
    await secondRequest;
    const [payload] = await canonical;
    assert.equal(payload.data.video_id, 'canonical-2');
    assert.equal(connections, 2); assert.equal(refreshes, 2); assert.equal(requests, 2);
  } finally {
    h?.unmount(); await new Promise((resolve) => setTimeout(resolve, 10));
    f.sockets.forEach((socket) => socket.disconnect());
    await new Promise((resolve) => server.close(resolve));
  }
});

test('real Socket.IO: transient transport close reconnects via Manager without duplicate refresh', { skip: !Server }, async () => {
  const http = require('node:http').createServer();
  const server = new Server(http, { transports: ['websocket'] });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  let peer;
  server.on('connection', (socket) => { peer = socket; });
  const f = fixture(require('socket.io-client').io, `http://127.0.0.1:${http.address().port}`);
  let refreshes = 0;
  const h = f.mount({ onConnect: () => refreshes++ });
  const s = f.sockets[0];
  try {
    await once(s, 'connect', { signal: AbortSignal.timeout(5000) });
    const reconnected = once(s, 'connect', { signal: AbortSignal.timeout(5000) });
    const attempt = once(s.io, 'reconnect_attempt', { signal: AbortSignal.timeout(5000) });
    peer.conn.close();
    const [number] = await attempt;
    assert.equal(h.render().socketStatus.connectionAttempts, number);
    await reconnected;
    assert.equal(refreshes, 2);
    assert.equal(h.render().socketStatus.connectionAttempts, 0);
  } finally {
    h.unmount(); await new Promise((resolve) => setTimeout(resolve, 10)); s.disconnect();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('real Socket.IO: middleware rejection stays stopped after online event', { skip: !Server }, async () => {
  const http = require('node:http').createServer();
  const server = new Server(http, { transports: ['websocket'] });
  let attempts = 0;
  server.use((_socket, next) => { attempts++; next(new Error('room access denied')); });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const f = fixture(require('socket.io-client').io, `http://127.0.0.1:${http.address().port}`);
  const h = f.mount(); const s = f.sockets[0];
  try {
    await once(s, 'connect_error', { signal: AbortSignal.timeout(5000) });
    assert.equal(s.active, false);
    f.browser.emit('online');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(attempts, 1); assert.equal(s.connected, false);
  } finally {
    h.unmount(); await new Promise((resolve) => setTimeout(resolve, 10)); s.disconnect();
    await new Promise((resolve) => server.close(resolve));
  }
});
