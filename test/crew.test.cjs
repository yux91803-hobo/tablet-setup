// crew.sh 测试（设计：docs/superpowers/specs/2026-11-27-crew-design.md）
// 假 ib：get 读 $FAKE_DIR/get-<m>.json；exec 用 bash -c 在本机执行，PATH 前面放假 hcom，调用记到 $FAKE_DIR/ib.log。
// 假 hcom：读 $FAKE_DIR/hcom/ 下的预设文件（缺省用 test/fixtures/hcom/），把参数和 stdin 记到 $FAKE_DIR/hcom.log。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

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
    bg=0
    want_json=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --timeout) shift 2 ;;
        --stdin) shift ;;
        --background) bg=1; shift ;;
        --json) want_json=1; shift ;;
        --) shift; break ;;
        -*) shift ;;
        *) [ -z "$m" ] && m=$1; shift ;;
      esac
    done
    cmd=\${1:-}
    if [ "$bg" = 1 ]; then
      mkdir -p "$FAKE_DIR/jobs"
      jid="job-\${m}-$$-\${RANDOM}"
      (
        set +e
        FAKE_MACHINE="$m" HOME="$FAKE_DIR/remote-home-$m" PATH="$FAKE_DIR/hcom-bin:$PATH" bash -c "$cmd" > "$FAKE_DIR/jobs/$jid.log" 2>&1
        rc=$?
        printf '%s\\n' "$rc" > "$FAKE_DIR/jobs/$jid.rc.tmp"
        mv -f "$FAKE_DIR/jobs/$jid.rc.tmp" "$FAKE_DIR/jobs/$jid.rc"
      ) </dev/null >/dev/null 2>&1 &
      pid=$!
      printf '%s\\n' "$pid" > "$FAKE_DIR/jobs/$jid.pid"
      if [ "$want_json" = 1 ]; then
        printf '{"jobId":"%s","pid":%s}\\n' "$jid" "$pid"
      else
        printf '%s\\n' "$jid"
      fi
    else
      FAKE_MACHINE="$m" HOME="$FAKE_DIR/remote-home-$m" PATH="$FAKE_DIR/hcom-bin:$PATH" bash -c "$cmd"
    fi
    ;;
  jobs)
    action=\${1:-}; shift || true
    m=\${1:-}; shift || true
    jid=\${1:-}; shift || true
    case "$action" in
      wait)
        while [ ! -f "$FAKE_DIR/jobs/$jid.rc" ]; do
          sleep 0.05
        done
        rc=$(cat "$FAKE_DIR/jobs/$jid.rc")
        exit "$rc"
        ;;
      logs)
        [ -f "$FAKE_DIR/jobs/$jid.log" ] && cat "$FAKE_DIR/jobs/$jid.log"
        ;;
      kill)
        if [ -f "$FAKE_DIR/jobs/$jid.pid" ]; then
          pid=$(cat "$FAKE_DIR/jobs/$jid.pid")
          pkill -TERM -P "$pid" 2>/dev/null || true
          kill -TERM "$pid" 2>/dev/null || true
        fi
        if [ ! -f "$FAKE_DIR/jobs/$jid.rc" ]; then
          printf '143\\n' > "$FAKE_DIR/jobs/$jid.rc"
        fi
        ;;
      *)
        echo "fake ib jobs: unexpected action $action" >&2
        exit 2
        ;;
    esac
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
fs.appendFileSync(path.join(fakeDir, 'hcom.log'), JSON.stringify({ machine, args, stdin, cwd: process.cwd() }) + '\\n');
const hcomDir = path.join(fakeDir, 'hcom');
const readOr = (name, fallback) => {
  const mp = path.join(hcomDir, machine + '-' + name);
  if (fs.existsSync(mp)) return fs.readFileSync(mp, 'utf8');
  const p = path.join(hcomDir, name);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  return fallback;
};
const nextFromSeq = (key, fallbackName, fallbackVal) => {
  const seqRaw = readOr(key + '-seq.json', '');
  if (seqRaw) {
    const seq = JSON.parse(seqRaw);
    const idxFile = path.join(fakeDir, machine + '-' + key + '.idx');
    const idx = fs.existsSync(idxFile) ? Number(fs.readFileSync(idxFile, 'utf8')) : 0;
    const item = seq[Math.min(idx, seq.length - 1)];
    fs.writeFileSync(idxFile, String(idx + 1));
    return typeof item === 'string' ? item : JSON.stringify(item);
  }
  return readOr(fallbackName, fallbackVal);
};
const sub = args[0];
if (sub === 'list') {
  if (fs.existsSync(path.join(fakeDir, machine + '-injected'))) {
    const after = readOr('list-after-inject.json', '');
    if (after) {
      process.stdout.write(after);
      process.exit(0);
    }
  }
  process.stdout.write(nextFromSeq('list', 'list.json', '[]'));
  process.exit(0);
}
if (sub === 'term') {
  if (args[1] === 'inject') {
    if (args.includes('<hcom>')) {
      fs.writeFileSync(path.join(fakeDir, machine + '-injected'), '1');
    }
    process.exit(0);
  }
  process.stdout.write(nextFromSeq('term', 'term.json', '{}'));
  process.exit(0);
}
if (sub === 'agy') {
  const resp = readOr('agy.json', JSON.stringify({ instances: ['keno'], names: ['crew-keno'] }));
  const codeFile = path.join(hcomDir, machine + '-agy.code');
  const code = fs.existsSync(codeFile) ? Number(fs.readFileSync(codeFile, 'utf8').trim()) : 0;
  process.stdout.write(resp);
  process.exit(code);
}
if (sub === 'kill') {
  process.exit(0);
}
if (sub === 'send') {
  process.stdout.write('Sent\\n');
  process.exit(0);
}
if (sub === 'events') {
  let raw = readOr('events.jsonl', '');
  let lines = raw.split('\\n').filter(Boolean).map(l => JSON.parse(l));
  const sqlIdx = args.indexOf('--sql');
  const sql = (sqlIdx !== -1 && args[sqlIdx + 1]) ? args[sqlIdx + 1] : '';
  if (sql) {
    const m = /id\\s*>\\s*(\\d+)/i.exec(sql);
    if (m) {
      const since = Number(m[1]);
      lines = lines.filter(e => Number(e.id) > since);
    }
  }
  const waitIdx = args.indexOf('--wait');
  if (waitIdx !== -1) {
    const waitSec = Number(args[waitIdx + 1] || '60');
    const delayMs = Number(readOr('wait-delay-ms', '0'));
    // 过滤：只保留 agent 发出的消息，或 listening/blocked 状态事件
    const matched = lines.filter(e => {
      if (e.type === 'message' && !String(e.instance || '').startsWith('ext_')) return true;
      if (e.type === 'status' && e.data && (e.data.status === 'listening' || e.data.status === 'blocked')) return true;
      return false;
    });
    if (matched.length > 0) {
      setTimeout(() => {
        process.stdout.write(JSON.stringify(matched[0]) + '\\n');
        process.exit(0);
      }, delayMs);
    } else {
      setTimeout(() => {
        process.stdout.write(JSON.stringify({ timed_out: true }) + '\\n');
        process.exit(1);
      }, Math.max(50, waitSec * 1000));
    }
    return;
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
    TMPDIR: os.tmpdir(),
    FAKE_DIR: d,
    LIMING_IB: ibPath,
    LIMING_CREW_STATE: stateDir,
  };

  const run = (args, opts = {}) => spawnSync('bash', [CREW, ...args], {
    env: { ...env, ...(opts.env || {}) },
    encoding: 'utf8',
    input: opts.input ?? '',
  });
  const spawnCrew = (args, opts = {}) => spawn('bash', [CREW, ...args], {
    env: { ...env, ...(opts.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ibLog = () => {
    const p = path.join(d, 'ib.log');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
  };
  const hcomLog = () => {
    const p = path.join(d, 'hcom.log');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  };
  return { d, stateDir, run, spawnCrew, ibLog, hcomLog };
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

test('screen 普通输出和 --json 都把邮箱换成「（邮箱已隐藏）」，start 出错打印画面也隐藏邮箱', (t) => {
  const term = JSON.parse(readFixture('term-remote.json'));
  term.lines[1] = '     ▀▀▀▀▀▀       someone@example.com (Google AI Pro)';
  term.input_text = '发给 other.user+tag@sub.example.org 的话';
  term.extra = { nested: 'contact a_b@test.co' };
  const { d, run } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture(),
      'li2-term.json': term,
    },
  });
  const txt = run(['screen', 'li2']);
  assert.equal(txt.status, 0, txt.stderr);
  assert.ok(!txt.stdout.includes('someone@example.com'), '普通输出不能露出邮箱');
  assert.ok(txt.stdout.includes('（邮箱已隐藏） (Google AI Pro)'), txt.stdout);

  const j = run(['screen', 'li2', '--json']);
  assert.equal(j.status, 0, j.stderr);
  assert.ok(!j.stdout.includes('someone@example.com'), '--json lines 不能露出邮箱');
  assert.ok(!j.stdout.includes('other.user+tag@sub.example.org'), '--json input_text 不能露出邮箱');
  assert.ok(!j.stdout.includes('a_b@test.co'), '--json 嵌套字段不能露出邮箱');
  const parsed = JSON.parse(j.stdout);
  assert.ok(parsed.lines[1].includes('（邮箱已隐藏）'));
  assert.equal(parsed.input_text, '发给 （邮箱已隐藏） 的话');
  assert.equal(parsed.extra.nested, 'contact （邮箱已隐藏）');

  // crew start 出错打印画面片段时同样隐藏邮箱
  const badTerm = {
    cursor: [5, 0],
    input_text: '',
    lines: ['Antigravity CLI', 'Logged in as someone@example.com', 'Unknown Modal'],
    prompt_empty: false,
    ready: false,
    size: [24, 80],
  };
  const rig2 = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list-seq.json': [[], makeCrewListFixture({ status: 'blocked' })],
      'li2-term-seq.json': [badTerm],
    },
  });
  const rs = rig2.run(['start', 'li2', path.join(d, 'ws-email-err')], {
    env: { LIMING_CREW_POLL_INTERVAL: '0.05', LIMING_CREW_START_TIMEOUT: '0.2' },
  });
  assert.equal(rs.status, 9, rs.stdout + rs.stderr);
  assert.ok(!rs.stderr.includes('someone@example.com'), 'start 出错画面不能露出邮箱');
  assert.ok(rs.stderr.includes('Logged in as （邮箱已隐藏）'), rs.stderr);
});

test('log 把事件整理成中文一行一条；--mark 记下最后的事件号', (t) => {
  const events = readFixture('events.jsonl');
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
  assert.ok(lines.some(l => l.includes('19:38 收到 DSH：第六条测试')), r.stdout);
  assert.ok(lines.some(l => l.includes('19:38 跑命令：hcom send')), r.stdout);
  assert.ok(lines.some(l => l.includes('19:38 发给 DSH：串口波特率用 115200 还是 9600？')), r.stdout);
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
  for (const args of [['status', 'li3'], ['screen', 'prod'], ['log', 'foo'], ['screen'], ['log'], ['start', 'li3', '/tmp/x']]) {
    const r = run(args);
    assert.equal(r.status, 2, '参数 ' + args.join(' ') + ' 应退出 2，实际 ' + r.status);
  }
  assert.equal(ibLog().length, 0, '用法错误不该调 ib');
});

test('已有 crew agent 时 start 直接沿用', (t) => {
  const { run, hcomLog, stateDir } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture({ directory: '/data/workspace/demo' }),
    },
  });
  fs.writeFileSync(path.join(stateDir, 'li2.remote-url'), JSON.stringify({ name: 'crew-keno', url: 'https://antigravity.google.com/r/00000000-0000-0000-0000-000000000000-v2' }));
  const r = run(['start', 'li2', '/data/workspace/demo']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out, {
    machine: 'li2',
    name: 'crew-keno',
    dir: '/data/workspace/demo',
    remoteUrl: 'https://antigravity.google.com/r/00000000-0000-0000-0000-000000000000-v2',
    reused: true,
  });
  assert.ok(!hcomLog().some(c => c.args[0] === 'agy'), '已有 agent 不应再拉第二个');
});

test('首次设置画面：退出码 3，关掉 agent，没按任何键', (t) => {
  const { d, run, hcomLog } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'suspended' } },
    hcomFiles: {
      'li2-list-seq.json': [[], makeCrewListFixture({ status: 'blocked' })],
      'li2-term-seq.json': [JSON.parse(readFixture('term-onboarding.json'))],
    },
  });
  const projDir = path.join(d, 'ws-onboard');
  const r = run(['start', 'li2', projDir], { env: { LIMING_CREW_POLL_INTERVAL: '0.05', LIMING_CREW_START_TIMEOUT: '2' } });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /首次设置/);
  const calls = hcomLog();
  assert.ok(calls.some(c => c.args[0] === 'kill' && c.args[1] === 'crew-keno'), '应 kill 掉 agent');
  assert.ok(!calls.some(c => c.args[0] === 'term' && c.args[1] === 'inject'), '不能按任何键');
});

test('服务条款画面：退出码 3，没按任何键', (t) => {
  const { d, run, hcomLog } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list-seq.json': [[], makeCrewListFixture({ status: 'blocked' })],
      'li2-term-seq.json': [JSON.parse(readFixture('term-terms.json'))],
    },
  });
  const r = run(['start', 'li2', path.join(d, 'ws-terms')], { env: { LIMING_CREW_POLL_INTERVAL: '0.05', LIMING_CREW_START_TIMEOUT: '2' } });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const calls = hcomLog();
  assert.ok(calls.some(c => c.args[0] === 'kill'), '应 kill 掉 agent');
  assert.ok(!calls.some(c => c.args[0] === 'term' && c.args[1] === 'inject'), '不能按任何键');
});

test('信任画面且没同意：退出码 4，没按键', (t) => {
  const { d, run, hcomLog } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list-seq.json': [[], makeCrewListFixture({ status: 'blocked' })],
      'li2-term-seq.json': [JSON.parse(readFixture('term-trust.json'))],
    },
  });
  const r = run(['start', 'li2', path.join(d, 'ws-trust-no')], { env: { LIMING_CREW_POLL_INTERVAL: '0.05', LIMING_CREW_START_TIMEOUT: '2' } });
  assert.equal(r.status, 4, r.stdout + r.stderr);
  const calls = hcomLog();
  assert.ok(calls.some(c => c.args[0] === 'kill'), '应 kill 掉 agent');
  assert.ok(!calls.some(c => c.args[0] === 'term' && c.args[1] === 'inject'), '没同意不能按任何键');
});

test('信任画面且同意过：只按一次回车，之后成功；光标不在允许行时以 9 退出且不按键', (t) => {
  const { d, run, hcomLog, stateDir } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-term-seq.json': [
        JSON.parse(readFixture('term-trust.json')),
        JSON.parse(readFixture('term-remote.json')),
      ],
    },
  });
  const projDir = path.join(d, 'ws-trust-yes');
  fs.writeFileSync(path.join(d, 'hcom/li2-list-seq.json'), JSON.stringify([
    [],
    makeCrewListFixture({ status: 'blocked' }),
    makeCrewListFixture({ status: 'listening', directory: projDir }),
  ]));
  fs.writeFileSync(path.join(stateDir, 'trust-ok'), '1\n');
  const r = run(['start', 'li2', projDir], { env: { LIMING_CREW_POLL_INTERVAL: '0.05', LIMING_CREW_START_TIMEOUT: '3' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.reused, false);
  assert.equal(out.name, 'crew-keno');
  const injects = hcomLog().filter(c => c.args[0] === 'term' && c.args[1] === 'inject');
  assert.equal(injects.length, 1, '只按一次回车');
  assert.deepEqual(injects[0].args, ['term', 'inject', 'crew-keno', '--enter']);

  // 光标不在 Yes, I trust this folder 行时，退出 9 且不按键
  const badTrust = JSON.parse(readFixture('term-trust.json'));
  badTrust.lines = badTrust.lines.map(l => l.replace('> Yes, I trust this folder', '  Yes, I trust this folder').replace('  No, exit', '> No, exit'));
  const rig2 = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list-seq.json': [[], makeCrewListFixture({ status: 'blocked' })],
      'li2-term-seq.json': [badTrust],
    },
  });
  fs.writeFileSync(path.join(rig2.stateDir, 'trust-ok'), '1\n');
  const r2 = rig2.run(['start', 'li2', path.join(rig2.d, 'ws-bad-trust')], { env: { LIMING_CREW_POLL_INTERVAL: '0.05', LIMING_CREW_START_TIMEOUT: '2' } });
  assert.equal(r2.status, 9, r2.stdout + r2.stderr);
  assert.ok(!rig2.hcomLog().some(c => c.args[0] === 'term' && c.args[1] === 'inject'), '光标不对时不能按键');
});

test('从画面里取出远程控制链接，并写进 status.json', (t) => {
  const { d, run, stateDir } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-term-seq.json': [JSON.parse(readFixture('term-remote.json'))],
    },
  });
  const projDir = path.join(d, 'ws-remote');
  fs.writeFileSync(path.join(d, 'hcom/li2-list-seq.json'), JSON.stringify([
    [],
    makeCrewListFixture({ status: 'listening', directory: projDir }),
  ]));
  const r = run(['start', 'li2', projDir], { env: { LIMING_CREW_POLL_INTERVAL: '0.05', LIMING_CREW_START_TIMEOUT: '2' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  const wantUrl = 'https://antigravity.google.com/r/00000000-0000-0000-0000-000000000000-v2';
  assert.equal(out.remoteUrl, wantUrl);
  assert.equal(out.dir, projDir);
  const st = JSON.parse(fs.readFileSync(path.join(stateDir, 'status.json'), 'utf8'));
  const li2 = st.machines.find(x => x.machine === 'li2');
  assert.equal(li2.agent.remoteUrl, wantUrl);
});

test('认不出的画面：超时后退出码 9，并打出画面', (t) => {
  const unknownTerm = {
    cursor: [5, 0],
    input_text: '',
    lines: ['Unknown New Antigravity Modal v9', 'Please confirm something mysterious', ''],
    prompt_empty: false,
    ready: false,
    size: [24, 80],
  };
  const { d, run, hcomLog } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list-seq.json': [[], makeCrewListFixture({ status: 'blocked' })],
      'li2-term-seq.json': [unknownTerm],
    },
  });
  const r = run(['start', 'li2', path.join(d, 'ws-unknown')], { env: { LIMING_CREW_POLL_INTERVAL: '0.05', LIMING_CREW_START_TIMEOUT: '0.2' } });
  assert.equal(r.status, 9, r.stdout + r.stderr);
  assert.match(r.stderr, /Unknown New Antigravity Modal v9/);
  assert.ok(!hcomLog().some(c => c.args[0] === 'term' && c.args[1] === 'inject'), '认不出的画面不能按键');
});

test('--model、--effort 原样传给 agy，团队身份说明 DSH 在 hcom 里叫 bigboss', (t) => {
  const { d, run, hcomLog } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-term-seq.json': [JSON.parse(readFixture('term-remote.json'))],
    },
  });
  const projDir = path.join(d, 'ws-opts');
  fs.writeFileSync(path.join(d, 'hcom/li2-list-seq.json'), JSON.stringify([
    [],
    makeCrewListFixture({ status: 'listening', directory: projDir }),
  ]));
  const r = run(['start', 'li2', projDir, '--model', 'gemini-4-neon-high', '--effort', 'xhigh'], { env: { LIMING_CREW_POLL_INTERVAL: '0.05', LIMING_CREW_START_TIMEOUT: '2' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const calls = hcomLog();
  const agyCall = calls.find(c => c.args[0] === 'agy');
  assert.ok(agyCall, '应调用 hcom agy');
  assert.equal(agyCall.cwd, projDir, '应在项目目录里执行');
  assert.ok(agyCall.args.includes('--headless'));
  assert.ok(agyCall.args.includes('--json'));
  assert.ok(agyCall.args.includes('--tag') && agyCall.args[agyCall.args.indexOf('--tag') + 1] === 'crew');
  assert.ok(agyCall.args.includes('--remote-control'));
  assert.ok(agyCall.args.includes('--model') && agyCall.args[agyCall.args.indexOf('--model') + 1] === 'gemini-4-neon-high');
  assert.ok(agyCall.args.includes('--effort') && agyCall.args[agyCall.args.indexOf('--effort') + 1] === 'xhigh');
  const sysVal = agyCall.args[agyCall.args.indexOf('--hcom-system-prompt') + 1] || '';
  assert.match(sysVal, /DSH/);
  assert.match(sysVal, /bigboss/);
  assert.match(sysVal, /@bigboss/);
  const promptVal = agyCall.args[agyCall.args.indexOf('--hcom-prompt') + 1] || '';
  assert.match(promptVal, /TEAM\.md/);
  assert.match(promptVal, /@bigboss/);
});

test('send 的文字原样到达，且文字不出现在 ib 和 hcom 的命令行参数里', (t) => {
  const cases = [
    '他说"好"',
    '$HOME',
    '`id`',
    '-n 开头',
    '第一行\n第二行',
    '中文和 emoji 🚀✨',
  ];
  let firstSendIb = null;
  for (const msg of cases) {
    const { run, ibLog, hcomLog } = rig(t, {
      machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
      hcomFiles: { 'li2-list.json': makeCrewListFixture() },
    });
    const r = run(['send', 'li2', msg]);
    assert.equal(r.status, 0, msg + ': ' + r.stderr);
    const sendCall = hcomLog().find(c => c.args[0] === 'send');
    assert.ok(sendCall, '应调用 hcom send');
    assert.equal(sendCall.stdin, msg, 'stdin 必须逐字节一致：' + JSON.stringify(msg));
    assert.ok(sendCall.args.includes('--from') && sendCall.args[sendCall.args.indexOf('--from') + 1] === 'bigboss');
    assert.ok(sendCall.args.includes('@crew-keno'));
    assert.ok(!sendCall.args.includes('--stdin'), 'hcom 0.7.31 走管道不传 --stdin');
    assert.ok(!sendCall.args.join(' ').includes(msg), '文字不能出现在 hcom 参数里');
    const sendIb = ibLog().find(l => l.includes('hcom send'));
    assert.ok(sendIb && sendIb.startsWith('exec li2 --stdin --timeout 60 -- '), '应经 ib exec --stdin 发送');
    assert.ok(sendIb.includes('hcom send --from bigboss @crew-keno'));
    if (firstSendIb === null) firstSendIb = sendIb;
    assert.equal(sendIb, firstSendIb, 'ib 参数里只应有固定命令，不能含用户文字');
  }
  // --stdin 模式也逐字节原样到达
  const raw = '单引号\'双引号"$HOME`id`\n-n 第二行\n';
  const rig2 = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: { 'li2-list.json': makeCrewListFixture() },
  });
  const r2 = rig2.run(['send', 'li2', '--stdin'], { input: raw });
  assert.equal(r2.status, 0, r2.stderr);
  const s2 = rig2.hcomLog().find(c => c.args[0] === 'send');
  assert.equal(s2.stdin, raw);
  assert.equal(rig2.ibLog().find(l => l.includes('hcom send')), firstSendIb);
});

test('send：立刻送到不注入；active 时绝不注入', (t) => {
  const fastEnv = { LIMING_CREW_SEND_POLL: '0.05', LIMING_CREW_SEND_WAIT: '0.15', LIMING_CREW_SEND_AFTER: '0.3' };
  // 立刻送到（unread_count=0）
  const r1Rig = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture({ status: 'listening', unread_count: 0 }),
      'li2-term.json': JSON.parse(readFixture('term-remote.json')),
    },
  });
  const r1 = r1Rig.run(['send', 'li2', '你好'], { env: fastEnv });
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(r1.stderr, '');
  assert.equal(r1Rig.hcomLog().filter(c => c.args[0] === 'term' && c.args[1] === 'inject').length, 0, '立刻送到不能注入');

  // agent 正在 active 且有未读：绝不注入
  const r2Rig = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture({ status: 'active', unread_count: 1 }),
      'li2-term.json': JSON.parse(readFixture('term-remote.json')),
    },
  });
  const r2 = r2Rig.run(['send', 'li2', '插句话'], { env: fastEnv });
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(r2.stderr, '');
  assert.equal(r2Rig.hcomLog().filter(c => c.args[0] === 'term' && c.args[1] === 'inject').length, 0, 'active 时绝不能注入');
});

test('send：空闲有未读且框里是模式提示时注入一次 <hcom> --enter；补一次仍未送到只提示不循环', (t) => {
  const fastEnv = { LIMING_CREW_SEND_POLL: '0.05', LIMING_CREW_SEND_WAIT: '0.15', LIMING_CREW_SEND_AFTER: '0.3' };
  for (const hint of [
    'Auto mode: edits & safe commands auto-approved (shift+tab to cycle)',
    'Best-of-N mode: multiple candidates (shift+tab to cycle)',
  ]) {
    const term = JSON.parse(readFixture('term-remote.json'));
    term.input_text = hint;
    term.ready = true;
    term.prompt_empty = false;
    const rRig = rig(t, {
      machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
      hcomFiles: {
        'li2-list.json': makeCrewListFixture({ status: 'listening', unread_count: 1 }),
        'li2-list-after-inject.json': makeCrewListFixture({ status: 'listening', unread_count: 0 }),
        'li2-term.json': term,
      },
    });
    const r = rRig.run(['send', 'li2', '干活吧'], { env: fastEnv });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '', '补一次后送到不应报排队提示');
    const injects = rRig.hcomLog().filter(c => c.args[0] === 'term' && c.args[1] === 'inject');
    assert.equal(injects.length, 1, '应注入恰好一次：' + hint);
    assert.deepEqual(injects[0].args, ['term', 'inject', 'crew-keno', '<hcom>', '--enter']);
    const execs = rRig.ibLog().filter(l => l.startsWith('exec '));
    assert.equal(execs.length, 2, '发送与确认唤醒应在同一次 ib exec 里完成（加上前置查 agent 共 2 次）');
  }

  // 补了一次仍未送到：只注入 1 次，stderr 提示下次空闲时送到，退出 0
  const stuckRig = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture({ status: 'listening', unread_count: 1 }),
      'li2-term.json': JSON.parse(readFixture('term-remote.json')),
    },
  });
  const rs = stuckRig.run(['send', 'li2', '还在吗'], { env: fastEnv });
  assert.equal(rs.status, 0, rs.stderr);
  assert.match(rs.stderr, /消息已排队，li2 下次空闲时送到/);
  const stuckInjects = stuckRig.hcomLog().filter(c => c.args[0] === 'term' && c.args[1] === 'inject');
  assert.equal(stuckInjects.length, 1, '只补一次，不能循环注入');
});

test('send：空闲有未读但框里是别的文字时不注入，提示清空后才会送到', (t) => {
  const fastEnv = { LIMING_CREW_SEND_POLL: '0.05', LIMING_CREW_SEND_WAIT: '0.15', LIMING_CREW_SEND_AFTER: '0.3' };
  const term = JSON.parse(readFixture('term-remote.json'));
  term.input_text = '站长自己打了一半的字';
  term.ready = true;
  term.prompt_empty = false;
  const rRig = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture({ status: 'listening', unread_count: 1 }),
      'li2-term.json': term,
    },
  });
  const r = rRig.run(['send', 'li2', '发条消息'], { env: fastEnv });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /消息已排队：li2 的输入框里有没发出的文字，清空后才会送到/);
  assert.equal(rRig.hcomLog().filter(c => c.args[0] === 'term' && c.args[1] === 'inject').length, 0, '有人打字时绝不能注入');
});

test('冷却时 send 以 5 退出，没 exec', (t) => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const { run, ibLog } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'stopped', cooldownUntil: future } },
  });
  const r = run(['send', 'li2', '你好']);
  assert.equal(r.status, 5, r.stderr);
  assert.ok(!ibLog().some(l => l.startsWith('exec ')), '冷却时不能 exec');
});

test('没有 agent 时 send 以 6 退出', (t) => {
  const { run } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: { 'li2-list.json': [] },
  });
  const r = run(['send', 'li2', '你好']);
  assert.equal(r.status, 6, r.stderr);
});

test('stop 只发一个 ESC', (t) => {
  const { run, hcomLog } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: { 'li2-list.json': makeCrewListFixture() },
  });
  const r = run(['stop', 'li2']);
  assert.equal(r.status, 0, r.stderr);
  const inj = hcomLog().filter(c => c.args[0] === 'term' && c.args[1] === 'inject');
  assert.equal(inj.length, 1);
  assert.deepEqual(inj[0].args, ['term', 'inject', 'crew-keno', '\x1b']);
});

test('type 把换行变成空格，再按回车，且文字不出现在 ib 参数里', (t) => {
  const { run, ibLog, hcomLog } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: { 'li2-list.json': makeCrewListFixture() },
  });
  const text = '第一行 "$HOME"\n第二行 `id`';
  const r = run(['type', 'li2', text]);
  assert.equal(r.status, 0, r.stderr);
  const inj = hcomLog().filter(c => c.args[0] === 'term' && c.args[1] === 'inject');
  assert.equal(inj.length, 1);
  assert.deepEqual(inj[0].args, ['term', 'inject', 'crew-keno', '第一行 "$HOME" 第二行 `id`', '--enter']);
  for (const line of ibLog()) {
    assert.ok(!line.includes('第一行'), '文字不能出现在 ib 参数里');
  }
});

test('approve：不在审批时以 7 退出，没按键；在审批时 yes 按 y，no 按 n', (t) => {
  // 状态不是 blocked -> 退出 7，不按键
  const idleRig = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture({ status: 'listening' }),
      'li2-term.json': JSON.parse(readFixture('term-approval.json')),
    },
  });
  const rIdle = idleRig.run(['approve', 'li2', 'yes']);
  assert.equal(rIdle.status, 7, rIdle.stderr);
  assert.ok(!idleRig.hcomLog().some(c => c.args[0] === 'term' && c.args[1] === 'inject'));

  // 在审批时 yes 按 y
  const yesRig = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture({ status: 'blocked' }),
      'li2-term.json': JSON.parse(readFixture('term-approval.json')),
    },
  });
  const rYes = yesRig.run(['approve', 'li2', 'yes']);
  assert.equal(rYes.status, 0, rYes.stderr);
  const injYes = yesRig.hcomLog().filter(c => c.args[0] === 'term' && c.args[1] === 'inject');
  assert.equal(injYes.length, 1);
  assert.deepEqual(injYes[0].args, ['term', 'inject', 'crew-keno', 'y']);

  // 在审批时 no 按 n
  const noRig = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture({ status: 'blocked' }),
      'li2-term.json': JSON.parse(readFixture('term-approval.json')),
    },
  });
  const rNo = noRig.run(['approve', 'li2', 'no']);
  assert.equal(rNo.status, 0, rNo.stderr);
  const injNo = noRig.hcomLog().filter(c => c.args[0] === 'term' && c.args[1] === 'inject');
  assert.equal(injNo.length, 1);
  assert.deepEqual(injNo[0].args, ['term', 'inject', 'crew-keno', 'n']);
});

test('approve 认不出画面时不按键，以 7 退出', (t) => {
  // blocked 但是画面认不出审批提示（例如普通画面或条款/信任画面）
  for (const fx of ['term-idle.json', 'term-terms.json', 'term-trust.json']) {
    const r0 = rig(t, {
      machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
      hcomFiles: {
        'li2-list.json': makeCrewListFixture({ status: 'blocked' }),
        'li2-term.json': JSON.parse(readFixture(fx)),
      },
    });
    const res = r0.run(['approve', 'li2', 'yes']);
    assert.equal(res.status, 7, fx + ' 应以 7 退出');
    assert.ok(!r0.hcomLog().some(c => c.args[0] === 'term' && c.args[1] === 'inject'), fx + ' 不能按键');
  }
});

test('wait：一台发来消息就结束，打印那条事件，更新 last-id，并 kill 另一台的等待任务', (t) => {
  const msgEv = { id: 52, instance: 'keno', type: 'message', ts: '2026-11-27T11:38:31', data: { from: 'keno', intent: 'request', text: '串口波特率用 115200 还是 9600？' } };
  const { run, stateDir, ibLog } = rig(t, {
    machines: {
      li: { id: 'm_li', name: 'li', state: 'running' },
      li2: { id: 'm_li2', name: 'li2', state: 'running' },
    },
    hcomFiles: {
      'li-list.json': makeCrewListFixture({ name: 'crew-lino', base_name: 'lino' }),
      'li2-list.json': makeCrewListFixture({ name: 'crew-keno', base_name: 'keno' }),
      'li-events.jsonl': '',
      'li2-events.jsonl': JSON.stringify(msgEv) + '\n',
      'li2-wait-delay-ms': '150',
    },
  });
  const r = run(['wait', 'li', 'li2'], { env: { LIMING_CREW_WAIT_SECONDS: '5' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.machine, 'li2');
  assert.equal(out.event.id, 52);
  assert.equal(out.event.data.text, '串口波特率用 115200 还是 9600？');
  assert.equal(fs.readFileSync(path.join(stateDir, 'li2.last-id'), 'utf8').trim(), '52');
  const kills = ibLog().filter(l => l.startsWith('jobs kill '));
  assert.ok(kills.some(l => l.startsWith('jobs kill li ')), '应 kill 掉另一台 li 的等待任务：' + JSON.stringify(kills));
});

test('wait：超时以 8 退出，并 kill 所有等待任务', (t) => {
  const { run, ibLog } = rig(t, {
    machines: {
      li: { id: 'm_li', name: 'li', state: 'running' },
      li2: { id: 'm_li2', name: 'li2', state: 'running' },
    },
    hcomFiles: {
      'li-list.json': makeCrewListFixture({ name: 'crew-lino', base_name: 'lino' }),
      'li2-list.json': makeCrewListFixture({ name: 'crew-keno', base_name: 'keno' }),
      'li-events.jsonl': '',
      'li2-events.jsonl': '',
    },
  });
  const r = run(['wait', 'li', 'li2'], { env: { LIMING_CREW_WAIT_SECONDS: '1' } });
  assert.equal(r.status, 8, r.stdout + r.stderr);
  const kills = ibLog().filter(l => l.startsWith('jobs kill '));
  assert.ok(kills.some(l => l.startsWith('jobs kill li ')), '超时应 kill li');
  assert.ok(kills.some(l => l.startsWith('jobs kill li2 ')), '超时应 kill li2');
});

test('wait：收到 SIGTERM 会 kill 所有等待任务', async (t) => {
  const { spawnCrew, ibLog } = rig(t, {
    machines: {
      li: { id: 'm_li', name: 'li', state: 'running' },
      li2: { id: 'm_li2', name: 'li2', state: 'running' },
    },
    hcomFiles: {
      'li-list.json': makeCrewListFixture({ name: 'crew-lino', base_name: 'lino' }),
      'li2-list.json': makeCrewListFixture({ name: 'crew-keno', base_name: 'keno' }),
      'li-events.jsonl': '',
      'li2-events.jsonl': '',
    },
  });
  const child = spawnCrew(['wait', 'li', 'li2'], { env: { LIMING_CREW_WAIT_SECONDS: '15' } });
  // 等两个后台任务都启动进入 jobs wait
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    const waits = ibLog().filter(l => l.startsWith('jobs wait '));
    if (waits.length >= 2) break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.ok(ibLog().filter(l => l.startsWith('jobs wait ')).length >= 2, '两台都应进入 jobs wait');
  child.kill('SIGTERM');
  const code = await new Promise(resolve => child.on('exit', (c, sig) => resolve(c ?? sig)));
  assert.notEqual(code, 0);
  const kills = ibLog().filter(l => l.startsWith('jobs kill '));
  assert.ok(kills.some(l => l.startsWith('jobs kill li ')), 'SIGTERM 应 kill li：' + JSON.stringify(kills));
  assert.ok(kills.some(l => l.startsWith('jobs kill li2 ')), 'SIGTERM 应 kill li2：' + JSON.stringify(kills));
});

test('wait：已经看过的事件（id 不大于 last-id）不算', (t) => {
  const oldEv = { id: 52, instance: 'keno', type: 'message', ts: '2026-11-27T11:38:31', data: { from: 'keno', text: '旧消息' } };
  const { run, stateDir } = rig(t, {
    machines: { li2: { id: 'm_li2', name: 'li2', state: 'running' } },
    hcomFiles: {
      'li2-list.json': makeCrewListFixture(),
      'li2-events.jsonl': JSON.stringify(oldEv) + '\n',
    },
  });
  fs.writeFileSync(path.join(stateDir, 'li2.last-id'), '52\n');
  const r = run(['wait', 'li2'], { env: { LIMING_CREW_WAIT_SECONDS: '1' } });
  assert.equal(r.status, 8, '已看过的事件不算，应超时退出 8：' + r.stdout + r.stderr);
});

test('wait：全部在冷却以 5 退出；--timeout 超过 50 分钟以 2 退出', (t) => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const { run, ibLog } = rig(t, {
    machines: {
      li: { id: 'm_li', name: 'li', state: 'stopped', cooldownUntil: future },
      li2: { id: 'm_li2', name: 'li2', state: 'stopped', cooldownUntil: future },
    },
  });
  const r = run(['wait', 'li', 'li2']);
  assert.equal(r.status, 5, r.stderr);
  assert.ok(!ibLog().some(l => l.startsWith('exec ')));
  const bad = run(['wait', 'li2', '--timeout', '51']);
  assert.equal(bad.status, 2);
});
