const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('../apps/mobile/node_modules/typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const edgeDir = join(__dirname, '../supabase/functions/send-push');
const { buildAlertRequest, buildLiveActivityRequest } = require(join(edgeDir, 'apns.ts'));
const { buildMessage, prefColumn } = require(join(edgeDir, 'messages.ts'));
const { secureEqual } = require(join(edgeDir, 'auth.ts'));

const config = {
  key: 'unused',
  keyId: 'YDV8WF53XN',
  teamId: '5LBPG5TUKP',
  bundleId: 'app.hither.mobile',
  env: 'production',
};

const alert = buildAlertRequest(config, 'jwt', 'device-token', {
  title: '集合',
  body: '請集合',
  data: { category: 'leader_commands' },
});
assert.equal(alert.url, 'https://api.push.apple.com/3/device/device-token');
assert.equal(alert.init.headers.authorization, 'bearer jwt');
assert.equal(alert.init.headers['apns-topic'], 'app.hither.mobile');
assert.equal(alert.init.headers['apns-push-type'], 'alert');
assert.equal(alert.init.headers['apns-priority'], '10');

const live = buildLiveActivityRequest(config, 'jwt', 'activity-token', {
  event: 'update',
  timestamp: 1_700_000_000,
  contentState: {
    gatheringTitle: '台北車站',
    distanceMeters: 320,
    etaSeconds: 240,
    progress: 0.72,
    gatheredCount: 3,
    memberCount: 4,
    accentHex: '#58D68D',
    travelMode: 'walk',
    memberEmojis: ['🐑', '🦊'],
    memberArrived: [true, false],
  },
});
assert.equal(live.init.headers['apns-topic'], 'app.hither.mobile.push-type.liveactivity');
assert.equal(live.init.headers['apns-push-type'], 'liveactivity');
assert.equal(live.init.headers['apns-priority'], '5');
assert.deepEqual(JSON.parse(live.init.body), {
  aps: {
    timestamp: 1_700_000_000,
    event: 'update',
    'content-state': {
      gatheringTitle: '台北車站',
      distanceMeters: 320,
      etaSeconds: 240,
      progress: 0.72,
      gatheredCount: 3,
      memberCount: 4,
      accentHex: '#58D68D',
      travelMode: 'walk',
      memberEmojis: ['🐑', '🦊'],
      memberArrived: [true, false],
    },
  },
});

assert.deepEqual(
  buildMessage({
    category: 'leader_commands',
    group_id: 'g1',
    sender_id: 'u1',
    type: 'custom',
    message: '入口集合',
  }),
  { title: '隊長：自訂指令', body: '入口集合' },
);
assert.deepEqual(
  buildMessage({ category: 'arrival', group_id: 'g1', sender_id: 'u1' }),
  { title: '隊友已抵達', body: '一位隊友已抵達集合點' },
);
assert.deepEqual(
  buildMessage({ category: 'straggler', group_id: 'g1', sender_id: 'u1' }),
  { title: '隊友已脫隊', body: '一位隊友已離開主隊伍' },
);
assert.equal(prefColumn('arrival'), 'journey');
assert.equal(prefColumn('straggler'), 'journey');

assert.equal(secureEqual('same-secret', 'same-secret'), true);
assert.equal(secureEqual('same-secret', 'wrong-secret'), false);
assert.equal(secureEqual('short', 'much-longer'), false);

const index = readFileSync(join(edgeDir, 'index.ts'), 'utf8');
for (const fragment of [
  'x-hither-webhook-secret',
  'secureEqual',
  'subgroup_id',
  'live_activity_sessions',
  'memberArrived',
  'target_user_id',
  'SUPABASE_SECRET_KEYS',
]) {
  assert.ok(index.includes(fragment), `index.ts must contain ${fragment}`);
}

console.log('send-push contract: 7 checks passed');
