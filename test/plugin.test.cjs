// DSH Go 插件 liming-crew 测试（设计：docs/superpowers/specs/2026-11-27-crew-design.md）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'liming-crew');
const FIXTURES = path.join(ROOT, 'test/fixtures/hcom');

const loadViews = () => import(pathToFileURL(path.join(PLUGIN_DIR, 'lib/views.js')).href);
const loadClient = () => import(pathToFileURL(path.join(PLUGIN_DIR, 'lib/crew-client.js')).href);

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function collectBindings(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.$ === 'string') out.push(node.$);
  if (typeof node.bind === 'string') out.push(node.bind);
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) collectBindings(item, out);
    } else if (val && typeof val === 'object') {
      collectBindings(val, out);
    }
  }
  return out;
}

function hasPath(data, bindingPath) {
  assert.ok(bindingPath.startsWith('data.'), '绑定路径必须以 data. 开头：' + bindingPath);
  const parts = bindingPath.slice(5).split('.');
  let cur = data;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || !(p in cur)) return false;
    cur = cur[p];
  }
  return true;
}

test('stripText 各种状态都不超过 24 字', async () => {
  const { stripText, nowAgo } = await loadViews();
  assert.equal(nowAgo(10), '刚才');
  assert.equal(nowAgo(125), '2 分钟前');

  const cases = [
    null,
    {},
    { machines: [] },
    { machines: [{ machine: 'li', state: 'paused', agent: null }, { machine: 'li2', state: 'paused', agent: null }] },
    { machines: [{ machine: 'li', state: 'running', agent: { status: 'active' } }, { machine: 'li2', state: 'running', agent: { status: 'listening' } }] },
    { machines: [{ machine: 'li', state: 'running', agent: { status: 'blocked' } }, { machine: 'li2', state: 'cooldown', cooldownUntil: '2026-11-27T14:00:00Z', agent: null }] },
    { machines: [{ machine: 'li', state: 'stopped', agent: null }, { machine: 'li2', state: 'unknown', agent: null }] },
    { machines: [{ machine: 'li', state: 'starting', agent: null }, { machine: 'li2', state: 'starting', agent: null }] },
    { machines: [{ machine: 'li', state: 'running', agent: { status: 'listening' } }, { machine: 'li2', state: 'running', agent: { status: 'listening' } }] },
  ];
  for (const st of cases) {
    const txt = stripText(st);
    assert.equal(typeof txt, 'string');
    assert.ok(txt.length > 0, '状态条文案不能为空');
    assert.ok(Array.from(txt).length <= 24, `状态条超过 24 字（${Array.from(txt).length}）：${txt}`);
  }
  assert.equal(stripText(null), '团队：未知');
  assert.equal(stripText({ machines: [{ machine: 'li', state: 'paused', agent: null }, { machine: 'li2', state: 'paused', agent: null }] }), 'li、li2 都在睡');
  assert.equal(stripText({ machines: [{ machine: 'li', state: 'starting', agent: null }, { machine: 'li2', state: 'paused', agent: null }] }), 'li 正在叫醒 · li2 睡着');
  assert.equal(stripText({ machines: [{ machine: 'li', state: 'running', agent: { status: 'active' } }, { machine: 'li2', state: 'running', agent: { status: 'listening' } }] }), 'li 干活中 · li2 空闲');
});

test('panelData 把 starting 状态显示为「正在叫醒」', async () => {
  const { panelData } = await loadViews();
  const data = panelData({
    status: {
      at: '2026-11-27T11:40:00Z',
      machines: [
        { machine: 'li', state: 'starting', cooldownUntil: null, agent: null },
        { machine: 'li2', state: 'paused', cooldownUntil: null, agent: null },
      ],
    },
    selected: 'li',
    screen: null,
    log: [],
  });
  assert.equal(data.members[0].title, 'li · 正在叫醒');
  assert.match(data.selectedSummary, /正在叫醒/);
});

test('panelData 在 agent.stopped 为 true 时显示「空闲（刚叫停）」', async () => {
  const { panelData } = await loadViews();
  const data = panelData({
    status: {
      at: '2026-11-27T11:40:00Z',
      machines: [
        {
          machine: 'li2',
          state: 'running',
          cooldownUntil: null,
          agent: { name: 'crew-keno', status: 'listening', stopped: true, context: 'tool:run_command', detail: '', ageSeconds: 40, unread: 0, dir: '/data/workspace/demo', remoteUrl: null },
        },
      ],
    },
    selected: 'li2',
    screen: null,
    log: [],
  });
  const li2 = data.members.find(m => m.title.startsWith('li2'));
  assert.equal(li2.title, 'li2 · 空闲（刚叫停）');
});

test('panelData 把 term-idle.json、events.jsonl 整理成面板数据，不超过 30 KiB（含压力测试）', async () => {
  const { panelData } = await loadViews();
  const term = JSON.parse(readFixture('term-idle.json'));
  const events = readFixture('events.jsonl').trim().split('\n').map(l => JSON.parse(l));
  const status = {
    at: '2026-11-27T11:40:00Z',
    machines: [
      { machine: 'li', state: 'paused', cooldownUntil: null, agent: null },
      {
        machine: 'li2',
        state: 'running',
        cooldownUntil: null,
        agent: {
          name: 'crew-keno',
          status: 'listening',
          context: '',
          detail: '',
          ageSeconds: 45,
          unread: 0,
          dir: '/data/workspace/hcom-test',
          remoteUrl: 'https://antigravity.google.com/r/00000000-0000-0000-0000-000000000000-v2',
        },
      },
    ],
  };

  const data = panelData({ status, selected: 'li2', screen: term, log: events });
  const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  assert.ok(bytes <= 30 * 1024, '正常数据超出 30 KiB：' + bytes);
  assert.equal(data.selected, 'li2');
  assert.equal(data.members.length, 2);
  assert.ok(data.events.length <= 15);
  assert.ok(data.screenText.split('\n').length <= 12);
  assert.ok(data.events.some(e => e.title.includes('DSH')), '事件里的 bigboss 界面应显示为 DSH');

  // 压力测试：2000 条超长事件 + 200 行超长画面
  const hugeEvents = Array.from({ length: 2000 }, (_, i) => ({
    id: i + 1,
    instance: 'keno',
    type: 'message',
    ts: '2026-11-27T11:38:31',
    data: { from: 'keno', text: '超长内容'.repeat(200) + '#' + i },
  }));
  const hugeScreen = {
    lines: Array.from({ length: 200 }, (_, i) => `第${i}行 ` + 'X'.repeat(500)),
  };
  const big = panelData({ status, selected: 'li2', screen: hugeScreen, log: hugeEvents });
  const bigBytes = Buffer.byteLength(JSON.stringify(big), 'utf8');
  assert.ok(bigBytes <= 30 * 1024, '压力测试数据超出 30 KiB：' + bigBytes);
  assert.ok(big.events.length <= 15, '动作最多保留 15 条');
  for (const ev of big.events) {
    assert.ok(Array.from(ev.title + (ev.subtitle || '')).length <= 125, '单条动作应截短');
  }
  assert.ok(big.screenText.split('\n').length <= 12, '画面最多保留 12 行');
});

test('panelData 在等审批时给出允许和拒绝', async () => {
  const { panelData } = await loadViews();
  const approvalTerm = JSON.parse(readFixture('term-approval.json'));
  const statusBlocked = {
    at: '2026-11-27T11:40:00Z',
    machines: [
      {
        machine: 'li2',
        state: 'running',
        cooldownUntil: null,
        agent: {
          name: 'crew-keno',
          status: 'blocked',
          context: 'approval',
          detail: 'Run this command?',
          ageSeconds: 5,
          unread: 0,
          dir: '/data/workspace/demo',
          remoteUrl: null,
        },
      },
    ],
  };
  const dBlocked = panelData({ status: statusBlocked, selected: 'li2', screen: approvalTerm, log: [] });
  const labels = dBlocked.actionItems.map(a => a.label);
  assert.ok(labels.includes('允许'), '等审批时应有允许按钮：' + JSON.stringify(labels));
  assert.ok(labels.includes('拒绝'), '等审批时应有拒绝按钮：' + JSON.stringify(labels));
  assert.ok(labels.includes('叫停'));
  assert.ok(labels.includes('网页'));
  assert.ok(dBlocked.actionItems.length <= 4);

  // 非审批时不应有允许和拒绝
  const statusIdle = structuredClone(statusBlocked);
  statusIdle.machines[0].agent.status = 'listening';
  const dIdle = panelData({ status: statusIdle, selected: 'li2', screen: JSON.parse(readFixture('term-idle.json')), log: [] });
  const idleLabels = dIdle.actionItems.map(a => a.label);
  assert.ok(!idleLabels.includes('允许'));
  assert.ok(!idleLabels.includes('拒绝'));
});

test('panelView 里的绑定路径都能在 panelData 的结果里找到', async () => {
  const { panelView, panelData } = await loadViews();
  const view = panelView({ protocol: 1, components: ['form', 'textField'] });
  assert.equal(view.v, 2);
  assert.equal(view.type, 'stack');
  const bindings = collectBindings(view);
  assert.ok(bindings.length > 0, '面板应使用数据绑定');
  const data = panelData({ status: null, selected: 'li2', screen: null, log: [] });
  for (const b of bindings) {
    assert.ok(hasPath(data, b), `panelData 缺少视图绑定路径：${b}`);
  }
});

test('manifest 的状态条和面板 id 与 index.js 里登记的一致', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'package.json'), 'utf8'));
  const patch = fs.readFileSync(path.join(PLUGIN_DIR, 'cordis.patch.yml'), 'utf8');
  const src = fs.readFileSync(path.join(PLUGIN_DIR, 'lib/index.js'), 'utf8');
  assert.equal(pkg.name, 'liming-crew');
  assert.equal(pkg.type, 'module');
  assert.match(patch, /name:\s*liming-crew/);
  assert.match(src, /export const name\s*=\s*['"]liming-crew['"]/);
  assert.match(src, /ctx\.inject\(\s*\[\s*['"]dshGo['"]\s*\]/);

  const stripIds = (pkg.dshGo?.contributes?.['composer.strip'] || []).map(x => x.id);
  const panelIds = (pkg.dshGo?.contributes?.panels || []).map(x => x.id);
  assert.deepEqual(stripIds, ['crew-strip']);
  assert.deepEqual(panelIds, ['crew']);
  for (const id of stripIds) {
    assert.match(src, new RegExp(`\\.strip\\(\\s*['"]${id}['"]`), 'index.js 必须登记状态条 ' + id);
  }
  for (const id of panelIds) {
    assert.match(src, new RegExp(`\\.panel\\(\\s*['"]${id}['"]`), 'index.js 必须登记面板 ' + id);
  }
});

test('crew-client 超时会杀掉子进程', async (t) => {
  const { runCrew } = await loadClient();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tablet-plugin-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const pidFile = path.join(d, 'child.pid');
  const fakeCrew = path.join(d, 'crew');
  fs.writeFileSync(fakeCrew, `#!/usr/bin/env bash\necho $$ > ${JSON.stringify(pidFile)}\nexec sleep 60\n`, { mode: 0o755 });

  const t0 = performance.now();
  const res = await runCrew(['status'], { bin: fakeCrew, timeoutMs: 250 });
  const elapsed = performance.now() - t0;
  assert.equal(res.timedOut, true);
  assert.notEqual(res.code, 0);
  assert.ok(elapsed < 2000, '超时后应尽快返回，实际 ' + elapsed + 'ms');

  await new Promise(r => setTimeout(r, 150));
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  assert.equal(alive, false, '超时后子进程必须被杀掉，PID ' + pid + ' 仍存活');
});

test('index.js 状态条只读 status.json 不调 crew；面板插话用延后效果，网页按钮无链接时 toast', async (t) => {
  const plugin = await import(pathToFileURL(path.join(PLUGIN_DIR, 'lib/index.js')).href);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tablet-plugin-idx-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const crewLog = path.join(d, 'crew.log');
  const fakeCrew = path.join(d, 'crew');
  fs.writeFileSync(fakeCrew, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(crewLog)}\ncat >> ${JSON.stringify(path.join(d, 'stdin.log'))}\nexit 0\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(d, 'status.json'), JSON.stringify({
    at: '2026-11-27T12:00:00Z',
    machines: [
      { machine: 'li', state: 'paused', cooldownUntil: null, agent: null },
      { machine: 'li2', state: 'running', cooldownUntil: null, agent: { name: 'crew-keno', status: 'listening', context: '', detail: '', ageSeconds: 10, unread: 0, dir: '/data/workspace/demo', remoteUrl: null } },
    ],
  }));

  const prevState = process.env.LIMING_CREW_STATE;
  const prevBin = process.env.LIMING_CREW_BIN;
  process.env.LIMING_CREW_STATE = d;
  process.env.LIMING_CREW_BIN = fakeCrew;
  t.after(() => {
    if (prevState === undefined) delete process.env.LIMING_CREW_STATE; else process.env.LIMING_CREW_STATE = prevState;
    if (prevBin === undefined) delete process.env.LIMING_CREW_BIN; else process.env.LIMING_CREW_BIN = prevBin;
  });

  const strips = {};
  const panels = {};
  plugin.apply({
    inject(deps, fn) {
      assert.deepEqual(deps, ['dshGo']);
      fn({
        dshGo: {
          strip: (id, handler) => { strips[id] = handler; },
          panel: (id, def) => { panels[id] = def; },
        },
      });
    },
  });

  const stripEmits = [];
  const disposeStrip = strips['crew-strip']({}, (payload) => stripEmits.push(payload));
  disposeStrip();
  assert.equal(stripEmits.length, 1);
  assert.equal(stripEmits[0].text, 'li 睡着 · li2 空闲');
  assert.equal(fs.existsSync(crewLog), false, '状态条只读 status.json，不能调 crew');

  // web 按钮无链接时返回 toast
  assert.deepEqual(panels.crew.actions.web(), { toast: '这台还没有网页链接' });

  // send 返回延后效果，result 经 stdin 调 crew send
  const eff = panels.crew.actions.send({}, { value: { values: { 'data.form.message': '你好 li2' } } });
  assert.ok(eff.pending && typeof eff.result === 'function');
  const settled = await eff.result(new AbortController().signal);
  assert.match(settled.toast, /已发给 li2/);
  assert.equal(fs.readFileSync(crewLog, 'utf8').trim(), 'send li2 --stdin');
  assert.equal(fs.readFileSync(path.join(d, 'stdin.log'), 'utf8'), '你好 li2');
});
