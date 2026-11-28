// 三方小屋场景映射纯函数测试（liming-crew/lib/scene.js）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'test/fixtures/hcom');
const loadScene = () => import(pathToFileURL(path.join(ROOT, 'liming-crew/lib/scene.js')).href);

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

test('sceneFromCrew 映射全部 8 种 crew 状态到对应小屋画面与动作标签', async () => {
  const { sceneFromCrew } = await loadScene();

  // 1. 睡着 + 正在叫醒
  const s1 = sceneFromCrew({
    at: '2026-11-28T02:00:00Z',
    machines: [
      { machine: 'li', state: 'paused', cooldownUntil: null, agent: null },
      { machine: 'li2', state: 'starting', cooldownUntil: null, agent: null },
    ],
  }, { li: [], li2: [] }, null);
  assert.equal(s1.machines.li.status, 'sleeping');
  assert.equal(s1.machines.li.spot, 'sofa');
  assert.equal(s1.machines.li.dim, true);
  assert.equal(s1.machines.li2.status, 'waking');
  assert.equal(s1.machines.li2.spot, 'sofa');
  assert.match(s1.machines.li2.actionTag, /叫醒/);

  // 2. 冷却 + 干活中（真实动作文字与兜底「干活中」）
  const s2 = sceneFromCrew({
    at: '2026-11-28T02:01:00Z',
    machines: [
      { machine: 'li', state: 'cooldown', cooldownUntil: '2026-11-28T03:30:00Z', agent: null },
      {
        machine: 'li2',
        state: 'running',
        cooldownUntil: null,
        agent: {
          name: 'crew-keno',
          status: 'active',
          context: 'tool:run_command',
          detail: 'node --test test/*.test.cjs',
          ageSeconds: 4,
          remoteUrl: 'https://antigravity.google.com/r/abc-123',
        },
      },
    ],
  }, { li: [], li2: [] }, s1);
  assert.equal(s2.machines.li.status, 'cooldown');
  assert.equal(s2.machines.li.spot, 'window');
  assert.match(s2.machines.li.actionTag, /11:30/);
  assert.equal(s2.machines.li2.status, 'working');
  assert.equal(s2.machines.li2.spot, 'li2Desk');
  assert.equal(s2.machines.li2.actionTag, '跑测试');
  assert.equal(s2.machines.li2.remoteUrl, 'https://antigravity.google.com/r/abc-123');

  // 干活中但拿不到动作细节 -> 兜底「干活中」；非 https remoteUrl 必须丢弃
  const s2b = sceneFromCrew({
    at: '2026-11-28T02:02:00Z',
    machines: [
      {
        machine: 'li',
        state: 'running',
        cooldownUntil: null,
        agent: { name: 'crew-nora', status: 'active', context: '', detail: '', remoteUrl: 'javascript:alert(1)' },
      },
      {
        machine: 'li2',
        state: 'running',
        cooldownUntil: null,
        agent: { name: 'crew-keno', status: 'listening', stopped: false, context: '', detail: '' },
      },
    ],
  }, { li: [], li2: [] }, s2);
  assert.equal(s2b.machines.li.status, 'working');
  assert.equal(s2b.machines.li.actionTag, '干活中');
  assert.equal(s2b.machines.li.remoteUrl, null);
  assert.equal(s2b.machines.li2.status, 'idle');
  assert.equal(s2b.machines.li2.spot, 'li2Desk');

  // 3. 等审批（blocked + term-approval.json）+ 刚叫停（stopped: true）
  const approvalTerm = JSON.parse(readFixture('term-approval.json'));
  const s3 = sceneFromCrew({
    at: '2026-11-28T02:03:00Z',
    machines: [
      {
        machine: 'li',
        state: 'running',
        cooldownUntil: null,
        agent: { name: 'crew-nora', status: 'listening', stopped: true, context: '', detail: '' },
      },
      {
        machine: 'li2',
        state: 'running',
        cooldownUntil: null,
        agent: { name: 'crew-keno', status: 'blocked', context: 'approval', detail: 'Run this command?' },
      },
    ],
  }, { li: [], li2: [] }, s2b, { screens: { li2: approvalTerm } });
  assert.equal(s3.machines.li.status, 'stopped');
  assert.match(s3.machines.li.actionTag, /叫停/);
  assert.equal(s3.machines.li2.status, 'approval');
  assert.equal(s3.machines.li2.spot, 'window');
  assert.ok(s3.approval, '等审批时必须生成右侧审批卡');
  assert.equal(s3.approval.machine, 'li2');
  assert.equal(s3.approval.isSetupPrompt, false);
  assert.match(s3.approval.cmd, /git push origin li2\/demo/, '审批命令必须写全');
  assert.equal(s3.dsh.mode, 'warn');

  // 4. 连不上（unreachable 或 state=unknown）
  const s4 = sceneFromCrew(null, { li: [], li2: [] }, s3, { unreachable: true });
  assert.equal(s4.machines.li.status, 'offline');
  assert.equal(s4.machines.li.offline, true);
  assert.equal(s4.machines.li.actionTag, '连不上');
  assert.equal(s4.machines.li2.status, 'offline');
  assert.equal(s4.machines.li2.actionTag, '连不上');

  // 5. 两台都睡着时，鱼缸自动进入 sleep 模式
  const s5 = sceneFromCrew({
    at: '2026-11-28T02:05:00Z',
    machines: [
      { machine: 'li', state: 'paused', cooldownUntil: null, agent: null },
      { machine: 'li2', state: 'paused', cooldownUntil: null, agent: null },
    ],
  }, { li: [], li2: [] }, s4);
  assert.equal(s5.dsh.mode, 'sleep');
});

test('sceneFromCrew 首次打开不重放历史动画，只填群聊记录（含路由标签与北京时间）；后续仅对新事件放动画', async () => {
  const { sceneFromCrew } = await loadScene();
  const events = readFixture('events.jsonl').trim().split('\n').map(l => JSON.parse(l));
  const status = {
    at: '2026-11-27T11:39:00Z',
    machines: [
      { machine: 'li', state: 'paused', cooldownUntil: null, agent: null },
      {
        machine: 'li2',
        state: 'running',
        cooldownUntil: null,
        agent: { name: 'crew-keno', status: 'listening', context: '', detail: '' },
      },
    ],
  };

  // 首次打开（prev = null）：不放动画，但群聊记录保留历史消息并带路由标签与北京时间
  const first = sceneFromCrew(status, { li: [], li2: events }, null);
  assert.equal(first.initialized, true);
  assert.deepEqual(first.animations, [], '首次打开不能重放历史动画');
  assert.equal(first.maxEventIdByMachine.li2, 53);
  assert.ok(first.chat.length >= 4, '应把最近历史消息放进群聊记录');
  assert.ok(first.chat.some(c => c.route === 'DSH → li2' && c.time === '19:26'), 'bigboss 发给 li2 应标 DSH → li2 且转北京时间');
  assert.ok(first.chat.some(c => c.route === 'li2 → DSH' && c.time === '19:26'), 'keno 发回 bigboss 应标 li2 → DSH 且转北京时间');
  assert.ok(first.chat.every(c => !c.route.includes('bigboss')), '界面路由标签不能露出 bigboss');

  // 无新事件再次轮询：不重复放动画
  const same = sceneFromCrew(status, { li: [], li2: events }, first);
  assert.deepEqual(same.animations, []);

  // 新增两条事件（54: DSH -> li2，55: li2 -> DSH）：只给这两条新事件生成飞信动画
  const withNew = [
    ...events,
    { id: 54, instance: 'ext_bigboss', type: 'message', ts: '2026-11-27T11:40:00Z', data: { from: 'bigboss', text: '跑一下全量单测' } },
    { id: 55, instance: 'keno', type: 'message', ts: '2026-11-27T11:40:20Z', data: { from: 'keno', text: '101 项全绿' } },
  ];
  const next = sceneFromCrew(status, { li: [], li2: withNew }, same);
  assert.equal(next.maxEventIdByMachine.li2, 55);
  assert.equal(next.animations.length, 2, '应仅给 2 条新事件生成动画');
  assert.equal(next.animations[0].kind, 'flight');
  assert.equal(next.animations[0].from, 'dsh');
  assert.equal(next.animations[0].to, 'li2');
  assert.equal(next.animations[0].label, 'DSH → li2');
  assert.equal(next.animations[1].kind, 'flight');
  assert.equal(next.animations[1].from, 'li2');
  assert.equal(next.animations[1].to, 'dsh');
  assert.equal(next.animations[1].label, 'li2 → DSH');
  assert.ok(next.chat.some(c => c.text.includes('101 项全绿') && c.route === 'li2 → DSH'));
});

test('sceneFromCrew 识别非审批的首次设置/条款画面，不弹出伪审批按钮', async () => {
  const { sceneFromCrew } = await loadScene();
  const termsScreen = {
    lines: ['Terms of Service', 'Please accept to continue'],
    ready: false,
  };
  const s = sceneFromCrew({
    at: '2026-11-28T02:10:00Z',
    machines: [
      { machine: 'li', state: 'paused', cooldownUntil: null, agent: null },
      { machine: 'li2', state: 'running', cooldownUntil: null, agent: { name: 'crew-keno', status: 'blocked', context: '', detail: '' } },
    ],
  }, { li: [], li2: [] }, null, { screens: { li2: termsScreen } });
  assert.equal(s.approval.isSetupPrompt, true);
  assert.match(s.approval.note, /Computer/);
});
