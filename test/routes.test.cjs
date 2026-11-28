// 引擎端 /liming-crew/* HTTP 路由与入参校验测试（liming-crew/lib/routes.js）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'liming-crew');
const loadRoutes = () => import(pathToFileURL(path.join(PLUGIN_DIR, 'lib/routes.js')).href);

async function startRouteServer(t, { fakeCrewBody, pets = false } = {}) {
  const { registerCrewRoutes } = await loadRoutes();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tablet-routes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const logFile = path.join(dir, 'crew.log');
  const stdinFile = path.join(dir, 'stdin.log');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });

  if (pets) {
    const wgDir = path.join(stateDir, 'pets/whale-girl');
    fs.mkdirSync(wgDir, { recursive: true });
    fs.writeFileSync(path.join(wgDir, 'pack.json'), JSON.stringify({ id: 'whale-girl', frames: { idle: { file: 'idle.png' } } }));
    // 合法 8 字节 PNG 头
    fs.writeFileSync(path.join(wgDir, 'idle.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  const fakeCrew = path.join(dir, 'crew');
  const script = fakeCrewBody || `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(logFile)}
case "$1" in
  status)
    cat <<'JSON'
{"at":"2026-11-28T02:00:00Z","machines":[{"machine":"li","state":"paused","cooldownUntil":null,"agent":null},{"machine":"li2","state":"running","cooldownUntil":null,"agent":{"name":"crew-keno","status":"blocked","context":"approval","detail":"Run this command?","ageSeconds":4,"remoteUrl":"https://antigravity.google.com/r/demo"}}]}
JSON
    ;;
  log)
    printf '%s\\n' '{"id":10,"instance":"ext_bigboss","type":"message","ts":"2026-11-28T01:59:00Z","data":{"from":"bigboss","text":"跑测试"}}'
    printf '%s\\n' '{"id":11,"instance":"keno","type":"message","ts":"2026-11-28T01:59:30Z","data":{"from":"keno","text":"准备 push"}}'
    ;;
  screen)
    printf '%s\\n' '{"lines":["Run this command?","  git push origin li2/demo","> Yes (y)","  No (n)"],"ready":false}'
    ;;
  send)
    cat > ${JSON.stringify(stdinFile)}
    echo "sent"
    ;;
  stop|approve)
    echo "ok $*"
    ;;
  *)
    exit 1
    ;;
esac
`;
  fs.writeFileSync(fakeCrew, script, { mode: 0o755 });

  // 模拟 DSH webServer.register({ kind, path, handler })
  const routes = [];
  const webServer = {
    register(def) {
      routes.push(def);
      return () => {
        const idx = routes.indexOf(def);
        if (idx >= 0) routes.splice(idx, 1);
      };
    },
  };
  const dispose = registerCrewRoutes(webServer, {
    crewBin: fakeCrew,
    stateDir,
    pluginDir: PLUGIN_DIR,
  });
  t.after(() => dispose());

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    const match = routes.find((r) => (r.kind === 'exact' ? pathname === r.path : pathname.startsWith(r.path)));
    if (!match) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    await match.handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return { baseUrl, dir, logFile, stdinFile, stateDir };
}

test('GET /liming-crew/state 聚合 status、事件与 blocked 机器的 screen，并报告宠物图是否就绪', async (t) => {
  const { baseUrl, logFile } = await startRouteServer(t, { pets: true });
  const res = await fetch(`${baseUrl}/liming-crew/state`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.unreachable, false);
  assert.equal(body.status.machines.length, 2);
  assert.equal(body.events.li2.length, 2);
  assert.ok(body.screens.li2 && Array.isArray(body.screens.li2.lines), 'blocked 机器应一并返回 screen');
  assert.equal(body.petsAvailable['whale-girl'], true);
  assert.equal(body.petsAvailable['pink-fish'], false);
  const calls = fs.readFileSync(logFile, 'utf8');
  assert.match(calls, /status --json/);
  assert.match(calls, /log li2 --last 20 --json/);
  assert.match(calls, /screen li2 --json/);
});

test('GET /liming-crew/state 上一次还没回来时跳过这一次（单飞防堆积）', async (t) => {
  const slowScript = `#!/usr/bin/env bash
if [ "$1" = "status" ]; then
  sleep 0.35
  echo '{"at":"2026-11-28T02:00:00Z","machines":[{"machine":"li","state":"paused","agent":null},{"machine":"li2","state":"paused","agent":null}]}'
fi
`;
  const { baseUrl } = await startRouteServer(t, { fakeCrewBody: slowScript });
  const [r1, r2] = await Promise.all([
    fetch(`${baseUrl}/liming-crew/state`).then((r) => r.json()),
    new Promise((resolve) => setTimeout(resolve, 60)).then(() => fetch(`${baseUrl}/liming-crew/state`).then((r) => r.json())),
  ]);
  assert.equal(r1.ok, true);
  assert.equal(r2.skipped, true, '上一次 state 还在跑时，第二次应跳过而不是并行堆积 crew 进程');
});

test('POST /liming-crew/send、stop、approve 与 GET /liming-crew/screen 校验入参并正确调 crew（正文走 stdin，不拼 shell）', async (t) => {
  const { baseUrl, logFile, stdinFile } = await startRouteServer(t);

  // 非法 machine 必须拒绝（400）
  for (const [method, url, body] of [
    ['POST', '/liming-crew/send', { machine: 'li; rm -rf /', text: 'hi' }],
    ['POST', '/liming-crew/send', { machine: 'li3', text: 'hi' }],
    ['POST', '/liming-crew/send', { machine: 'li2', text: '   ' }],
    ['POST', '/liming-crew/send', { machine: 'li2', text: 'A'.repeat(2001) }],
    ['POST', '/liming-crew/stop', { machine: 'evil' }],
    ['POST', '/liming-crew/approve', { machine: 'li2', decision: 'maybe' }],
    ['POST', '/liming-crew/approve', { machine: 'bad', decision: 'yes' }],
    ['GET', '/liming-crew/screen?machine=../etc', null],
  ]) {
    const res = await fetch(`${baseUrl}${url}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(res.status, 400, `${method} ${url} 应返回 400`);
  }
  assert.equal(fs.existsSync(logFile), false, '入参校验失败绝不能调 crew');

  // 合法 send：含特殊 shell 字符的正文走 stdin 逐字节送达
  const payloadText = '请检查 $(whoami) && `id` "引号"\n第二行';
  const sendRes = await fetch(`${baseUrl}/liming-crew/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ machine: 'li2', text: payloadText }),
  });
  assert.equal(sendRes.status, 200);
  const sendJson = await sendRes.json();
  assert.equal(sendJson.ok, true);
  assert.equal(fs.readFileSync(stdinFile, 'utf8'), payloadText, '正文必须经 stdin 原样传给 crew');

  // 合法 stop
  const stopRes = await fetch(`${baseUrl}/liming-crew/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ machine: 'li' }),
  });
  assert.equal(stopRes.status, 200);
  assert.equal((await stopRes.json()).ok, true);

  // 合法 approve
  const appRes = await fetch(`${baseUrl}/liming-crew/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ machine: 'li2', decision: 'yes' }),
  });
  assert.equal(appRes.status, 200);
  assert.equal((await appRes.json()).ok, true);

  // 合法 screen
  const scrRes = await fetch(`${baseUrl}/liming-crew/screen?machine=li2`);
  assert.equal(scrRes.status, 200);
  const scrJson = await scrRes.json();
  assert.equal(scrJson.ok, true);
  assert.ok(Array.isArray(scrJson.screen.lines));

  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
  assert.deepEqual(lines, [
    'send li2 --stdin',
    'stop li',
    'approve li2 yes',
    'screen li2 --json',
  ]);
});

test('静态素材路由 /liming-crew/assets/* 与 /liming-crew/pets/* 白名单放行并阻止路径穿越', async (t) => {
  const { baseUrl } = await startRouteServer(t, { pets: true });

  // 白名单里的插画与资源可读
  const dayRes = await fetch(`${baseUrl}/liming-crew/assets/house-day.jpg`);
  assert.equal(dayRes.status, 200);
  assert.match(dayRes.headers.get('content-type') || '', /image\/jpeg/);

  const packRes = await fetch(`${baseUrl}/liming-crew/pets/whale-girl/pack.json`);
  assert.equal(packRes.status, 200);
  const pack = await packRes.json();
  assert.equal(pack.id, 'whale-girl');

  const pngRes = await fetch(`${baseUrl}/liming-crew/pets/whale-girl/idle.png`);
  assert.equal(pngRes.status, 200);
  assert.match(pngRes.headers.get('content-type') || '', /image\/png/);

  // 缺失与路径穿越必须 404
  for (const badPath of [
    '/liming-crew/assets/../package.json',
    '/liming-crew/assets/secret.txt',
    '/liming-crew/pets/whale-girl/../../keys',
    '/liming-crew/pets/other-pet/pack.json',
    '/liming-crew/pets/pink-fish/pack.json',
  ]) {
    const r = await fetch(`${baseUrl}${badPath}`);
    assert.equal(r.status, 404, `${badPath} 应返回 404`);
  }
});
