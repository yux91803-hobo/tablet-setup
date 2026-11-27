// crew.sh 测试（设计：docs/superpowers/specs/2026-11-27-crew-design.md）
// 假 ib：get 读 $FAKE_DIR/get-<m>.json；exec 用 bash -c 在本机执行，PATH 前面放假 hcom，调用记到 $FAKE_DIR/ib.log。
// 假 hcom：读 $FAKE_DIR/hcom/ 下的预设文件（缺省用 test/fixtures/hcom/），把参数和 stdin 记到 $FAKE_DIR/hcom.log。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CREW = path.join(ROOT, 'crew.sh');
const FIXTURES = path.join(ROOT, 'test/fixtures/hcom');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function makeCrewListFixture(overrides = {}) {
  const list = JSON.parse(readFixture('list.json'));
  list[0].tag = 'crew';
  list[0].name = 'crew-keno';
  list[0].base_name = 'keno';
  Object.assign(list[0], overrides);
  return list;
}

const FAKE_IB = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_DIR/ib.log"
sub=\${1:-}
shift || true
case "$sub" in
  get)
    m=\${1:-}
    f="$FAKE_DIR/get-$m.json"
    if [ ! -f "$f" ]; then
      echo '{"error":{"code":"not_found"}}' >&2
      exit 1
    fi
    cat "$f"
    ;;
  exec)
    m=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --timeout) shift 2 ;;
        --stdin) shift ;;
        --background) shift ;;
        --) shift; break ;;
        -*) shift ;;
        *) [ -z "$m" ] && m=$1; shift ;;
      esac
    done
    cmd=\${1:-}
    FAKE_MACHINE="$m" HOME="$FAKE_DIR/remote-home-$m" PATH="$FAKE_DIR/hcom-bin:$PATH" bash -c "$cmd"
    ;;
  *)
    echo "fake ib: unexpected subcommand: $sub" >&2
    exit 2
    ;;
esac
`;

const FAKE_HCOM = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const fakeDir = process.env.FAKE_DIR;
const machine = process.env.FAKE_MACHINE || 'unknown';
const stdin = fs.readFileSync(0, 'utf8');
fs.appendFileSync(path.join(fakeDir, 'hcom.log'), JSON.stringify({ machine, args, stdin }) + '\\n');
const hcomDir = path.join(fakeDir, 'hcom');
const readOr = (name, fallback) => {
  const mp = path.join(hcomDir, machine + '-' + name);
  if (fs.existsSync(mp)) return fs.readFileSync(mp, 'utf8');
  const p = path.join(hcomDir, name);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  return fallback;
};
const sub = args[0];
if (sub === 'list') {
  process.stdout.write(readOr('list.json', '[]'));
  process.exit(0);
}
if (sub === 'term') {
  if (args[1] === 'inject') {
    process.exit(0);
  }
  process.stdout.write(readOr('term.json', '{}'));
  process.exit(0);
}
if (sub === 'events') {
  let raw = readOr('events.jsonl', '');
  let lines = raw.split('\\n').filter(Boolean).map(l => JSON.parse(l));
  const sqlIdx = args.indexOf('--sql');
  if (sqlIdx !== -1 && args[sqlIdx + 1]) {
    const m = /id\\s*>\\s*(\\d+)/i.exec(args[sqlIdx + 1]);
    if (m) {
      const since = Number(m[1]);
      lines = lines.filter(e => Number(e.id) > since);
    }
  }
  const lastIdx = args.indexOf('--last');
  if (lastIdx !== -1 && args[lastIdx + 1]) {
    const n = Number(args[lastIdx + 1]);
    if (Number.isFinite(n) && n > 0) lines = lines.slice(-n);
  }
  for (const e of lines) process.stdout.write(JSON.stringify(e) + '\\n');
  process.exit(0);
}
process.stderr.write('fake hcom: unexpected args ' + JSON.stringify(args) + '\\n');
process.exit(2);
`;

function rig(t, { machines = {}, hcomFiles = {} } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tablet-crew-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const binDir = path.join(d, 'bin');
  const hcomBin = path.join(d, 'hcom-bin');
  const hcomDir = path.join(d, 'hcom');
  const stateDir = path.join(d, 'state');
  const homeDir = path.join(d, 'home');
  for (const dir of [binDir, hcomBin, hcomDir, stateDir, homeDir, path.join(d, 'remote-home-li'), path.join(d, 'remote-home-li2')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const ibPath = path.join(binDir, 'ib');
  fs.writeFileSync(ibPath, FAKE_IB, { mode: 0o755 });
  fs.writeFileSync(path.join(hcomBin, 'hcom'), FAKE_HCOM, { mode: 0o755 });

  for (const [m, data] of Object.entries(machines)) {
    if (data !== null) {
      fs.writeFileSync(path.join(d, `get-${m}.json`), JSON.stringify(data));
    }
  }
  for (const [name, content] of Object.entries(hcomFiles)) {
    fs.writeFileSync(path.join(hcomDir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }

  const env = {
    PATH: process.env.PATH,
    HOME: homeDir,
    FAKE_DIR: d,
    LIMING_IB: ibPath,
    LIMING_CREW_STATE: stateDir,
  };

  const run = (args, opts = {}) => spawnSync('bash', [CREW, ...args], {
    env: { ...env, ...(opts.env || {}) },
    encoding: 'utf8',
    input: opts.input ?? '',
  });
  const ibLog = () => {
    const p = path.join(d, 'ib.log');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
  };
  const hcomLog = () => {
    const p = path.join(d, 'hcom.log');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  };
  return { d, stateDir, run, ibLog, hcomLog };
}

test('两台都睡着时 status 只调 ib get，不 exec', (t) => {
  const { run, ibLog } = rig(t, {
    machines: {
      li: { id: 'm_li', name: 'li', state: 'suspended', cooldownUntil: null },
      li2: { id: 'm_li2', name: 'li2', state: 'stopped', cooldownUntil: null },
    },
  });
  const r = run(['status', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  const byM = Object.fromEntries(data.machines.map(m => [m.machine, m]));
  assert.equal(byM.li.state, 'paused');
  assert.equal(byM.li.agent, null);
  assert.equal(byM.li2.state, 'stopped');
  assert.equal(byM.li2.agent, null);
  assert.ok(ibLog().some(l => l === 'get li --json'));
  assert.ok(ibLog().some(l => l === 'get li2 --json'));
  assert.ok(!ibLog().some(l => l.startsWith('exec ')), '睡着/关机不能 exec 叫醒');
});

test('冷却到将来的时间记为 cooldown，过去的时间不算冷却', (t) => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const past = new Date(Date.now() - 3600_000).toISOString();
  const { run, ibLog } = rig(t, {
    machines: {
      li: { id: 'm_li', name: 'li', state: 'stopped', cooldownUntil: future },
      li2: { id: 'm_li2', name: 'li2', state: 'starting', cooldownUntil: past },
    },
  });
  const r = run(['status', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const byM = Object.fromEntries(JSON.parse(r.stdout).machines.map(m => [m.machine, m]));
  assert.equal(byM.li.state, 'cooldown');
  assert.equal(byM.li.cooldownUntil, future);
  assert.equal(byM.li2.state, 'paused', '过去的冷却时间不算冷却，starting 不 exec');
  assert.equal(byM.li2.cooldownUntil, null);
  assert.ok(!ibLog().some(l => l.startsWith('exec ')));
  const txt = run(['status']);
  assert.equal(txt.status, 0, txt.stderr);
  assert.match(txt.stdout, /li：冷却到 \d{2}:\d{2}/);
  assert.match(txt.stdout, /li2：睡着/);
});

test('ib get 失败记为 unknown，退出码仍是 0，另一台照常', (t) => {
  const { run } = rig(t, {
    machines: {
      li: null,
      li2: { id: 'm_li2', name: 'li2', state: 'running', cooldownUntil: null },
    },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture(),
    },
  });
  const r = run(['status', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const byM = Object.fromEntries(JSON.parse(r.stdout).machines.map(m => [m.machine, m]));
  assert.equal(byM.li.state, 'unknown');
  assert.equal(byM.li.agent, null);
  assert.equal(byM.li2.state, 'running');
  assert.equal(byM.li2.agent.name, 'crew-keno');
});

test('只认带 crew 标签的 agent，那台还有别的 agent 也不认错', (t) => {
  const other = JSON.parse(readFixture('list.json'))[0];
  other.name = 'solo';
  other.base_name = 'solo';
  other.tag = null;
  other.status = 'active';
  const stoppedCrew = makeCrewListFixture({ name: 'crew-old', base_name: 'old', status: 'stopped' })[0];
  const liveCrew = makeCrewListFixture({ name: 'crew-keno', base_name: 'keno', status: 'active', status_context: 'tool:run_command', status_detail: 'npm test', status_age_seconds: 125 })[0];
  const { run } = rig(t, {
    machines: {
      li2: { id: 'm_li2', name: 'li2', state: 'running', cooldownUntil: null },
    },
    hcomFiles: {
      'li2-list.json': [other, stoppedCrew, liveCrew],
    },
  });
  const r = run(['status', 'li2', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout).machines[0];
  assert.equal(m.agent.name, 'crew-keno');
  assert.equal(m.agent.status, 'active');
  assert.equal(m.agent.context, 'tool:run_command');
  assert.equal(m.agent.detail, 'npm test');
  assert.equal(m.agent.ageSeconds, 125);
  const txt = run(['status', 'li2']);
  assert.equal(txt.status, 0, txt.stderr);
  assert.match(txt.stdout, /li2：干活中（跑命令）· 2 分钟前/);
});

test('status --json 写出 status.json，字段齐全', (t) => {
  const { run, stateDir } = rig(t, {
    machines: {
      li: { id: 'm_li', name: 'li', state: 'suspended', cooldownUntil: null },
      li2: { id: 'm_li2', name: 'li2', state: 'running', cooldownUntil: null },
    },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture({ unread_count: 2 }),
    },
  });
  const r = run(['status', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const file = path.join(stateDir, 'status.json');
  assert.ok(fs.existsSync(file), '应写出 status.json');
  const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(cached, out);
  assert.ok(typeof out.at === 'string' && !Number.isNaN(Date.parse(out.at)));
  assert.equal(out.machines.length, 2);
  const li2 = out.machines.find(x => x.machine === 'li2');
  assert.deepEqual(Object.keys(li2).sort(), ['agent', 'cooldownUntil', 'machine', 'state']);
  assert.deepEqual(Object.keys(li2.agent).sort(), ['ageSeconds', 'context', 'detail', 'dir', 'name', 'remoteUrl', 'status', 'unread']);
  assert.equal(li2.agent.dir, '/data/workspace/hcom-test');
  assert.equal(li2.agent.unread, 2);
  assert.equal(li2.agent.remoteUrl, null);
  assert.deepEqual(fs.readdirSync(stateDir).filter(f => f.includes('.tmp')), [], '不留临时文件');
});

test('screen 打印画面文字，去掉行尾空白', (t) => {
  const term = JSON.parse(readFixture('term-idle.json'));
  term.lines[1] = '  已通过 hcom 向 @dsh 发送消息   \t ';
  const { run } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture(),
      'li2-term.json': term,
    },
  });
  const r = run(['screen', 'li2']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('  已通过 hcom 向 @dsh 发送消息\n'));
  for (const line of r.stdout.split('\n')) {
    assert.equal(line, line.replace(/[ \t\r]+$/, ''), '行尾不能有空白：' + JSON.stringify(line));
  }
  const j = run(['screen', 'li2', '--json']);
  assert.equal(j.status, 0, j.stderr);
  assert.deepEqual(JSON.parse(j.stdout), term);
});

test('log 把事件整理成中文一行一条；--mark 记下最后的事件号', (t) => {
  const events = readFixture('events.jsonl').replaceAll('bigboss', 'dsh');
  const { run, stateDir, hcomLog } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture(),
      'li2-events.jsonl': events,
    },
  });
  const r = run(['log', 'li2', '--last', '10', '--since', '47', '--mark']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.ok(lines.some(l => l.includes('19:38 收到 dsh：第六条测试')), r.stdout);
  assert.ok(lines.some(l => l.includes('19:38 跑命令：hcom send')), r.stdout);
  assert.ok(lines.some(l => l.includes('19:38 发给 dsh：串口波特率用 115200 还是 9600？')), r.stdout);
  assert.ok(lines.some(l => l === '19:38 空闲'), r.stdout);
  assert.equal(fs.readFileSync(path.join(stateDir, 'li2.last-id'), 'utf8').trim(), '53');
  const evCall = hcomLog().find(c => c.args[0] === 'events');
  assert.ok(evCall.args.includes('--last') && evCall.args.includes('10'));
  const sqlArg = evCall.args[evCall.args.indexOf('--sql') + 1] || '';
  assert.match(sqlArg, /id\s*>\s*47/);
  const j = run(['log', 'li2', '--since', '50', '--json']);
  assert.equal(j.status, 0, j.stderr);
  const parsed = j.stdout.trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(parsed.map(e => e.id), [51, 52, 53]);
});

test('机器名不是 li 或 li2 就以 2 退出', (t) => {
  const { run, ibLog } = rig(t);
  for (const args of [['status', 'li3'], ['screen', 'prod'], ['log', 'foo'], ['screen'], ['log']]) {
    const r = run(args);
    assert.equal(r.status, 2, '参数 ' + args.join(' ') + ' 应退出 2，实际 ' + r.status);
  }
  assert.equal(ibLog().length, 0, '用法错误不该调 ib');
});
