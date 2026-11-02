const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loader() {
  const module = { exports: {} };
  let payload;
  const source = fs.readFileSync('src/components/video/fetchRoomNowPlaying.ts', 'utf8').replaceAll('import.meta.env', '({ VITE_API_BASE_URL: "http://fixture" })');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date: class extends Date { static now() { return 100000; } }, console,
    require(name) { if (name === 'axios') return { get: async () => ({ status: 200, data: { result: payload } }) }; return { devLog() {}, devError() {} }; },
  });
  return async data => { payload = data; return module.exports.fetchRoomNowPlaying('1'); };
}
test('REST preserves queue identity even for a paused snapshot', async () => {
  const get = loader(); const result = await get({ video_id: 'one', timestamp: 90000, currentTime: 10, status: 'pause' });
  assert.equal(result.nowPlaying.timestamp, 90000); assert.equal(result.shouldPlay, false);
});
test('REST keeps the backend position sample clock distinct from queue identity', async () => {
  const get = loader(); const result = await get({ video_id: 'one', timestamp: 90000, currentTime: 10, position_timestamp: 99000 });
  assert.equal(result.nowPlaying.position_timestamp, 99000); assert.equal(result.nowPlaying.timestamp, 90000);
});
test('legacy REST snapshots get a receive clock, not the original song-start clock', async () => {
  const get = loader(); const result = await get({ video_id: 'one', timestamp: 90000, currentTime: 10 });
  assert.equal(result.nowPlaying.position_timestamp, 100000);
});
