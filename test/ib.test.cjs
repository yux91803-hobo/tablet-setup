// 平板上的 ib（ib.sh，装成 /usr/local/bin/ib）：li、li2 在两个 InstaBox 账号里，
// ib 用法和 instabox 一样，按参数里的机器名选那台所在账号的 key，只经环境变量交给 instabox，从不打印。
// 以及平板 AI 读的技能 skills/liming-cloud-computers/SKILL.md。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const IB = path.join(__dirname, '../ib.sh');
const SKILL = path.join(__dirname, '../skills/liming-cloud-computers/SKILL.md');
const KEYS = { li: 'ibk_li_SECRET_1111', li2: 'ibk_li2_SECRET_2222' };

function rig(t, { keys = KEYS, exitCode = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tablet-ib-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const keyDir = path.join(dir, 'keys');
  fs.mkdirSync(keyDir, { mode: 0o700 });
  for (const [m, k] of Object.entries(keys)) fs.writeFileSync(path.join(keyDir, `${m}.key`), `${k}\n`, { mode: 0o600 });
  const log = path.join(dir, 'calls.jsonl');
  // 假的 instabox：把收到的 key 和参数记进文件（不打到输出），输出里只说「跑了」
  const fake = path.join(dir, 'instabox');
  fs.writeFileSync(fake, `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ key: process.env.INSTABOX_API_KEY || null, argv: process.argv.slice(2) }) + '\\n');
process.stdout.write('ran ' + process.argv.slice(2).join(' ') + '\\n');
process.exit(${exitCode});
`, { mode: 0o755 });
  const run = (...args) => {
    const r = spawnSync('sh', [IB, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, LIMING_IB_DIR: keyDir, LIMING_INSTABOX: fake } });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    fs.rmSync(log, { force: true });
    return { ...r, calls };
  };
  return { run, keyDir };
}

const noKeys = r => { for (const k of Object.values(KEYS)) { assert.ok(!r.stdout.includes(k), r.stdout); assert.ok(!r.stderr.includes(k), r.stderr); } };

test('ib：按参数里的机器名选那台所在账号的 key，参数原样交给 instabox', (t) => {
  const { run } = rig(t);
  let r = run('exec', 'li2', '--', 'ls -la');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, [{ key: KEYS.li2, argv: ['exec', 'li2', '--', 'ls -la'] }]);
  r = run('agent', 'prompt', 'li', '--provider', 'codex', '--cwd', '/data/workspace/li2-notes', '修 li2 的 bug');
  assert.deepEqual(r.calls, [{ key: KEYS.li, argv: ['agent', 'prompt', 'li', '--provider', 'codex', '--cwd', '/data/workspace/li2-notes', '修 li2 的 bug'] }]);
  r = run('exec', 'li2', '--', 'grep', 'li', 'notes.txt');
  assert.equal(r.calls[0].key, KEYS.li2, '第一个机器名算数');
  noKeys(r);
});

test('ib：「li2:/路径」这种写法也认得出机器', (t) => {
  const { run } = rig(t);
  const r = run('cp', './a.txt', 'li2:/data/workspace/a.txt');
  assert.deepEqual(r.calls, [{ key: KEYS.li2, argv: ['cp', './a.txt', 'li2:/data/workspace/a.txt'] }]);
});

test('ib：没写机器名（比如 ib ls）就两个账号各跑一次，前面标出是哪个账号', (t) => {
  const { run } = rig(t);
  const r = run('ls');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls.map(c => c.key), [KEYS.li2, KEYS.li]);
  assert.ok(r.calls.every(c => c.argv.join(' ') === 'ls'));
  assert.match(r.stdout, /== li2 ==[\s\S]*ran ls[\s\S]*== li ==[\s\S]*ran ls/);
  noKeys(r);
});

test('ib：看帮助只跑一次', (t) => {
  const { run } = rig(t);
  for (const h of ['help', '--help', '-h']) assert.equal(run(h).calls.length, 1, h);
  assert.equal(run('exec', '--help').calls.length, 1);
});

test('ib：缺那台的 key 就报错退出 2，提示重跑装机脚本，不去调 instabox；instabox 的退出码原样传回', (t) => {
  const { run } = rig(t, { keys: { li2: KEYS.li2 } });
  const r = run('exec', 'li', '--', 'ls');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /li.*装机脚本/);
  assert.equal(r.calls.length, 0);
  const only = run('ls');
  assert.deepEqual(only.calls.map(c => c.key), [KEYS.li2], '没有 key 的账号跳过');
  const failing = rig(t, { exitCode: 3 });
  assert.equal(failing.run('exec', 'li', '--', 'false').status, 3);
});

test('ib：key 只经环境变量交给 instabox，脚本里不用 env 带参数、不开 set -x', () => {
  const src = fs.readFileSync(IB, 'utf8');
  assert.doesNotMatch(src, /\benv\s+INSTABOX_API_KEY=/);
  assert.doesNotMatch(src, /set\s+-[a-z]*x/);
  assert.equal(spawnSync('sh', ['-n', IB]).status, 0);
});

test('技能：front matter 有 name 和 description，正文讲 ib、长任务、浏览器、交给 Codex 再自己检查；不含 key', () => {
  const s = fs.readFileSync(SKILL, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(s);
  assert.ok(m, '要有 front matter');
  assert.match(m[1], /^name: liming-cloud-computers$/m);
  assert.match(m[1], /^description: .*li.*li2/m);
  for (const want of ['ib exec', 'run_in_background', 'ib jobs wait', 'playwright-cli', '--headed', 'ib agent prompt', '--provider codex', 'git diff', 'Computer']) assert.ok(s.includes(want), want);
  assert.doesNotMatch(s, /ibk_[A-Za-z0-9]{6,}|ibssh_[A-Za-z0-9]{6,}|sk-[A-Za-z0-9]{12,}/);
  assert.ok(Buffer.byteLength(s) < 8 * 1024, '技能正文别太长');
});
