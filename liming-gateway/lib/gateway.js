// 平板网关守护：随 DSH 本机引擎启停 WorkBuddy 网关。只用 Node 自带模块。
// 启动参数和环境照 li 上的 workbuddy-gateway.service；重启次数上限照 systemd 的 StartLimitIntervalSec / StartLimitBurst。
// 网关单独一个进程组：它自己会起 TLS 组件子进程，只在 atexit 里收掉（SIGTERM 不会跑 atexit）。所以停止时对整组先发 SIGINT
// （网关当 Ctrl+C 正常退出），超时再整组 SIGKILL，最后再扫一遍；作用同 systemd 停服务时杀掉整个 cgroup。
// 设计：liming-work-site 仓库 docs/superpowers/specs/2026-11-25-tablet-dshgo-design.md §4.1、§4.2
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';

export const DEFAULTS = Object.freeze({
  dir: '/root/workbuddy-gateway', host: '127.0.0.1', port: 8788, python: 'python3',
  healthTimeoutMs: 60000, healthIntervalMs: 1000, backoffMs: [5000, 15000, 45000], restartWindowMs: 600000, restartLimit: 3,
  stopGraceMs: 5000, watchMs: 30000, logMaxBytes: 5 * 1024 * 1024, pluginLogMaxBytes: 1024 * 1024,
});
// 网关只在 schedule.checkin 列出的钟点签到（默认 9、21 点），平板不会一直开着，所以设成全天：一打开就签，当天签过的账号它自己跳过。
export const CHECKIN_ALL_DAY = Object.freeze(Array.from({ length: 24 }, (_, h) => h));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function gatewayCommand(opts = {}) {
  const o = { ...DEFAULTS, ...opts }, cur = path.join(o.dir, 'current');
  return {
    command: o.python,
    args: [path.join(cur, 'wb_proxy.py'), '--host', o.host, '--port', String(o.port),
      '--accounts-dir', path.join(o.dir, 'accounts'), '--usage-dir', path.join(o.dir, 'usage')],
    cwd: cur,
    env: { ...process.env, TZ: 'Asia/Shanghai', PYTHONUNBUFFERED: '1', WB_PROXY_DEFAULT_REALM: 'cn' },
  };
}

// 没有 schedule.checkin 时写入全天钟点（先写临时文件再改名，保留其他键）；已有就不动，文件读不懂也不动。
export function seedCheckinSchedule(accountsDir) {
  const file = path.join(accountsDir, 'settings.json');
  let data = {};
  if (fs.existsSync(file)) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 'invalid'; }
    if (!isObject(data)) return 'invalid';
  }
  if (data.schedule !== undefined && !isObject(data.schedule)) return 'invalid';
  if (data.schedule && Object.hasOwn(data.schedule, 'checkin')) return 'kept';
  data.schedule = { ...(data.schedule || {}), checkin: [...CHECKIN_ALL_DAY] };
  fs.mkdirSync(accountsDir, { recursive: true, mode: 0o700 });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  return 'seeded';
}

// 网关的 /health 不用认证，服务在答时 ok 恒为 true。
export function probeHealth({ host = DEFAULTS.host, port = DEFAULTS.port, timeoutMs = 2000 } = {}) {
  return new Promise(resolve => {
    const req = http.get({ host, port, path: '/health', timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(body).ok === true); } catch { resolve(false); } });
      res.on('error', () => resolve(false));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function portOpen(host, port, timeoutMs = 1000) {
  return new Promise(resolve => {
    const s = net.connect({ host, port });
    const done = v => { s.destroy(); resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

function rotate(file, maxBytes) {
  try { if (fs.statSync(file).size > maxBytes) fs.renameSync(file, file + '.1'); } catch {}
}

const human = ms => (ms >= 1000 ? Math.round(ms / 1000) + ' 秒' : ms + ' 毫秒');

// 给网关所在的整组进程发信号（网关是组长）；组不在了就退回只发给它自己。
function signalGroup(c, sig) {
  try { process.kill(-c.pid, sig); return true; } catch {}
  try { return c.kill(sig); } catch { return false; }
}
// 网关退出后，组里可能还剩它起的子进程（比如 TLS 组件），一并收掉。
function sweepGroup(c) {
  if (c.pid) try { process.kill(-c.pid, 'SIGKILL'); } catch {}
}

export function createSupervisor(options = {}) {
  const o = { ...DEFAULTS, ...options };
  const logsDir = path.join(o.dir, 'logs'), gatewayLog = path.join(logsDir, 'gateway.log'), pluginLog = path.join(logsDir, 'plugin.log');
  let child = null, mode = 'idle', stopped = false, gaveUp = false, restartTimes = [], restartTimer = null, watchTimer = null;

  function log(msg) {
    try { o.logger?.info?.(msg); } catch {}
    try {
      fs.mkdirSync(logsDir, { recursive: true, mode: 0o700 });
      rotate(pluginLog, o.pluginLogMaxBytes);
      fs.appendFileSync(pluginLog, new Date().toISOString() + ' ' + msg + '\n', { mode: 0o600 });
    } catch {}
  }
  const healthy = (timeoutMs = 2000) => probeHealth({ host: o.host, port: o.port, timeoutMs });
  const program = path.join(o.dir, 'current', 'wb_proxy.py');

  async function start() {
    stopped = false; gaveUp = false; restartTimes = [];
    if (!fs.existsSync(program)) { mode = 'missing'; log('没装网关：缺 ' + program + '，先跑装机脚本'); return mode; }
    if (await healthy()) { mode = 'adopted'; log(o.port + ' 上已有网关在答，沿用'); watch(); return mode; }
    return launch();
  }

  async function launch() {
    if (stopped) return mode;
    for (const d of ['accounts', 'usage', 'logs']) {
      const p = path.join(o.dir, d);
      fs.mkdirSync(p, { recursive: true });
      fs.chmodSync(p, 0o700);
    }
    const seeded = seedCheckinSchedule(path.join(o.dir, 'accounts'));
    if (seeded === 'seeded') log('签到钟点设为全天：打开 App 就签到，当天签过的账号跳过');
    else if (seeded === 'invalid') log('accounts/settings.json 读不懂，签到钟点没改');
    rotate(gatewayLog, o.logMaxBytes);
    const c = spawnChild();
    if (!c) { mode = 'unhealthy'; return 'unhealthy'; }
    mode = 'starting';
    const outcome = await waitHealthy(c);
    if (outcome === 'ok') {
      if (child === c) mode = 'started';
      log('网关已启动（pid ' + c.pid + '）');
      return 'started';
    }
    if (outcome === 'timeout') { if (child === c) mode = 'unhealthy'; log('网关 ' + human(o.healthTimeoutMs) + '内没通过健康检查，进程留着'); }
    return 'unhealthy';
  }

  function spawnChild() {
    const cmd = gatewayCommand(o);
    let fd;
    try { fd = fs.openSync(gatewayLog, 'a', 0o600); } catch (err) { log('打不开网关日志：' + err.message); return null; }
    let c;
    try { c = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env, stdio: ['ignore', fd, fd], detached: true }); }
    catch (err) { log('网关启动失败：' + err.message); return null; }
    finally { fs.closeSync(fd); }
    child = c;
    const startedAt = Date.now();
    let gone = false;
    const onGone = (code, signal, err) => { if (!gone) { gone = true; onExit(c, startedAt, code, signal, err); } };
    c.on('error', err => onGone(null, null, err));
    c.on('exit', (code, signal) => onGone(code, signal, null));
    return c;
  }

  async function waitHealthy(c) {
    const deadline = Date.now() + o.healthTimeoutMs;
    while (Date.now() < deadline) {
      if (stopped) return 'stopped';
      if (child !== c) return 'exited';
      if (await healthy(Math.min(2000, o.healthTimeoutMs))) return 'ok';
      if (child !== c) return 'exited';
      await sleep(o.healthIntervalMs);
    }
    return 'timeout';
  }

  async function onExit(c, startedAt, code, signal, err) {
    if (child === c) child = null;
    if (stopped) return;
    sweepGroup(c);
    log(err ? '网关启动失败：' + err.message : '网关退出了（' + (signal ? '信号 ' + signal : '退出码 ' + code) + '）');
    if (!err && Date.now() - startedAt < 3000 && await portOpen(o.host, o.port) && !(await healthy(1000)))
      log(o.port + ' 被其他程序占用，网关起不来');
    scheduleRestart();
  }

  function scheduleRestart() {
    if (stopped) return;
    const now = Date.now();
    restartTimes = restartTimes.filter(t => now - t < o.restartWindowMs);
    if (restartTimes.length >= o.restartLimit) {
      gaveUp = true; mode = 'gave-up';
      log(human(o.restartWindowMs) + '内已重启 ' + o.restartLimit + ' 次，先停下；下次引擎重启时再试');
      return;
    }
    const delay = o.backoffMs[Math.min(restartTimes.length, o.backoffMs.length - 1)];
    restartTimes.push(now);
    mode = 'restarting';
    log(human(delay) + '后重启网关');
    restartTimer = setTimeout(() => { restartTimer = null; launch().catch(err => log('重启失败：' + err.message)); }, delay);
    restartTimer.unref?.();
  }

  // 沿用别人起的网关时（引擎重启时旧实例可能随后把它停掉），连续两次不通就自己拉起。
  function watch() {
    let misses = 0;
    const tick = async () => {
      watchTimer = null;
      if (stopped || mode !== 'adopted') return;
      misses = (await healthy(Math.min(2000, o.watchMs))) ? 0 : misses + 1;
      if (stopped || mode !== 'adopted') return;
      if (misses >= 2) { log('沿用的网关没了，自己拉起'); launch().catch(err => log('拉起失败：' + err.message)); return; }
      watchTimer = setTimeout(tick, o.watchMs);
      watchTimer.unref?.();
    };
    watchTimer = setTimeout(tick, o.watchMs);
    watchTimer.unref?.();
  }

  async function stop() {
    stopped = true;
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
    const c = child;
    if (c && c.exitCode === null && c.signalCode === null && c.pid) {
      await new Promise(resolve => {
        const kill = setTimeout(() => signalGroup(c, 'SIGKILL'), o.stopGraceMs);
        c.once('exit', () => { clearTimeout(kill); resolve(); });
        if (!signalGroup(c, 'SIGINT')) { clearTimeout(kill); resolve(); }
      });
      sweepGroup(c);
      log('网关已停止');
    }
    child = null;
    if (mode !== 'missing') mode = 'stopped';
  }

  return { start, stop, state: () => ({ mode, pid: child?.pid ?? null, restarts: restartTimes.length, gaveUp }) };
}
