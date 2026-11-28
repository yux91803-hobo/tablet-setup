// 引擎端 /liming-crew/* HTTP 路由：供三方小屋网页面板拉取真实 crew 状态、执行操作、读取插画与本机宠物精灵图。
// 遵循 DSH Go route-guard 契约：挂载在 webServer.register({ kind, path, handler }) 上，由宿主统一校验鉴权与 Host/Origin。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crewJson, crewJsonl, runCrew } from './crew-client.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_DIR = path.resolve(MODULE_DIR, '..');

const VALID_MACHINES = new Set(['li', 'li2']);
const VALID_DECISIONS = new Set(['yes', 'no']);
const VALID_PETS = new Set(['whale-girl', 'pink-fish']);
const PET_FILE_RE = /^[a-z0-9-]+\.(json|png)$/;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_SEND_CHARS = 2000;

const ASSET_ALLOWLIST = {
  'house-day.jpg': { rel: 'assets/house-day.jpg', type: 'image/jpeg', cache: 'public, max-age=3600' },
  'house-night.jpg': { rel: 'assets/house-night.jpg', type: 'image/jpeg', cache: 'public, max-age=3600' },
  'house-style.css': { rel: 'lib/house-style.css', type: 'text/css; charset=utf-8', cache: 'no-cache' },
  'house-engine.js': { rel: 'lib/house-engine.js', type: 'application/javascript; charset=utf-8', cache: 'no-cache' },
  'scene.js': { rel: 'lib/scene.js', type: 'application/javascript; charset=utf-8', cache: 'no-cache' },
};

function defaultStateDir() {
  return process.env.LIMING_CREW_STATE || path.join(os.homedir(), '.config', 'liming', 'crew');
}

function sendJson(res, statusCode, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const fail = (status, message) => {
      if (settled) return;
      settled = true;
      const err = new Error(message);
      err.statusCode = status;
      reject(err);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        fail(413, '请求体过大');
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          const err = new Error('请求必须是 JSON 对象');
          err.statusCode = 400;
          reject(err);
          return;
        }
        resolve(parsed);
      } catch {
        const err = new Error('JSON 解析失败');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', () => fail(400, '读取请求失败'));
  });
}

function readCachedStatus(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, 'status.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function checkPetsAvailable(dir) {
  const result = {};
  for (const petId of VALID_PETS) {
    try {
      const packPath = path.join(dir, 'pets', petId, 'pack.json');
      const parsed = JSON.parse(fs.readFileSync(packPath, 'utf8'));
      result[petId] = !!(parsed && typeof parsed === 'object');
    } catch {
      result[petId] = false;
    }
  }
  return result;
}

function sendFileBuffer(res, filePath, contentType, cacheControl) {
  try {
    const buf = fs.readFileSync(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', cacheControl || 'no-cache');
    res.end(buf);
  } catch {
    sendJson(res, 404, { ok: false, error: '文件不存在' });
  }
}

function mapActionError(action, machine, res) {
  if (res.timedOut) return `${action} ${machine} 超时`;
  if (res.code === 5) return `${machine} 正在冷却`;
  if (res.code === 6) return `${machine} 还没启动成员`;
  if (res.code === 7) return `${machine} 当前没有等审批的操作`;
  const detail = String(res.stderr || '').trim().split('\n')[0];
  return detail || `${action} ${machine} 失败（退出码 ${res.code}）`;
}

export function registerCrewRoutes(webServer, opts = {}) {
  const getStateDir = () => opts.stateDir || defaultStateDir();
  const pluginDir = opts.pluginDir || DEFAULT_PLUGIN_DIR;
  const crewOpts = (extra = {}) => ({
    ...(opts.crewBin ? { bin: opts.crewBin } : {}),
    ...extra,
  });

  let stateInFlight = false;
  let lastSnapshot = null;
  const activeControllers = new Set();

  const trackController = (req) => {
    const controller = new AbortController();
    activeControllers.add(controller);
    const onClose = () => {
      if (!req.complete) {
        try { controller.abort(); } catch {}
      }
    };
    req.on('close', onClose);
    return {
      signal: controller.signal,
      cleanup: () => {
        activeControllers.delete(controller);
        req.off?.('close', onClose);
      },
    };
  };

  const handleState = async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: '仅支持 GET' });
      return;
    }
    const dir = getStateDir();
    const petsAvailable = checkPetsAvailable(dir);
    // 上一次还没回来就跳过这一次，返回最近缓存避免并行堆积 crew 进程
    if (stateInFlight) {
      sendJson(res, 200, {
        ok: true,
        skipped: true,
        unreachable: lastSnapshot ? lastSnapshot.unreachable : false,
        status: lastSnapshot?.status || readCachedStatus(dir),
        events: lastSnapshot?.events || { li: [], li2: [] },
        screens: lastSnapshot?.screens || {},
        petsAvailable,
      });
      return;
    }

    stateInFlight = true;
    const { signal, cleanup } = trackController(req);
    try {
      const status = await crewJson(['status', '--json'], crewOpts({ timeoutMs: 12_000, signal }));
      if (!status) {
        const fallback = {
          ok: false,
          unreachable: true,
          status: lastSnapshot?.status || readCachedStatus(dir),
          events: lastSnapshot?.events || { li: [], li2: [] },
          screens: lastSnapshot?.screens || {},
          petsAvailable,
        };
        lastSnapshot = fallback;
        sendJson(res, 200, fallback);
        return;
      }

      const events = { li: [], li2: [] };
      const screens = {};
      const rows = Array.isArray(status.machines) ? status.machines : [];
      await Promise.all(
        rows.map(async (row) => {
          const m = row?.machine;
          if (!VALID_MACHINES.has(m)) return;
          if (row.state === 'running' && row.agent) {
            const tasks = [
              crewJsonl(['log', m, '--last', '20', '--json'], crewOpts({ timeoutMs: 10_000, signal })),
            ];
            if (row.agent.status === 'blocked') {
              tasks.push(crewJson(['screen', m, '--json'], crewOpts({ timeoutMs: 10_000, signal })));
            }
            const [lg, sc] = await Promise.all(tasks);
            events[m] = Array.isArray(lg) ? lg : (lastSnapshot?.events?.[m] || []);
            if (sc) screens[m] = sc;
          }
        })
      );

      const snapshot = {
        ok: true,
        unreachable: false,
        status,
        events,
        screens,
        petsAvailable,
      };
      lastSnapshot = snapshot;
      sendJson(res, 200, snapshot);
    } catch {
      sendJson(res, 200, {
        ok: false,
        unreachable: true,
        status: lastSnapshot?.status || readCachedStatus(dir),
        events: lastSnapshot?.events || { li: [], li2: [] },
        screens: lastSnapshot?.screens || {},
        petsAvailable,
      });
    } finally {
      cleanup();
      stateInFlight = false;
    }
  };

  const handleSend = async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: '仅支持 POST' });
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
      return;
    }
    const machine = body.machine;
    if (!VALID_MACHINES.has(machine)) {
      sendJson(res, 400, { ok: false, error: '机器名只认 li 或 li2' });
      return;
    }
    if (typeof body.text !== 'string') {
      sendJson(res, 400, { ok: false, error: '正文必须是文字' });
      return;
    }
    const trimmed = body.text.trim();
    if (!trimmed) {
      sendJson(res, 400, { ok: false, error: '发送内容不能为空' });
      return;
    }
    if (Array.from(body.text).length > MAX_SEND_CHARS) {
      sendJson(res, 400, { ok: false, error: `发送内容不能超过 ${MAX_SEND_CHARS} 字` });
      return;
    }

    const { signal, cleanup } = trackController(req);
    try {
      const r = await runCrew(['send', machine, '--stdin'], crewOpts({ stdin: body.text, timeoutMs: 25_000, signal }));
      if (r.code === 0) {
        sendJson(res, 200, { ok: true, message: `已发给 ${machine}` });
      } else {
        sendJson(res, 200, { ok: false, code: r.code, error: mapActionError('发给', machine, r) });
      }
    } finally {
      cleanup();
    }
  };

  const handleStop = async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: '仅支持 POST' });
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
      return;
    }
    const machine = body.machine;
    if (!VALID_MACHINES.has(machine)) {
      sendJson(res, 400, { ok: false, error: '机器名只认 li 或 li2' });
      return;
    }
    const { signal, cleanup } = trackController(req);
    try {
      const r = await runCrew(['stop', machine], crewOpts({ timeoutMs: 15_000, signal }));
      if (r.code === 0) {
        sendJson(res, 200, { ok: true, message: `已叫停 ${machine}` });
      } else {
        sendJson(res, 200, { ok: false, code: r.code, error: mapActionError('叫停', machine, r) });
      }
    } finally {
      cleanup();
    }
  };

  const handleApprove = async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: '仅支持 POST' });
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
      return;
    }
    const machine = body.machine;
    const decision = body.decision;
    if (!VALID_MACHINES.has(machine)) {
      sendJson(res, 400, { ok: false, error: '机器名只认 li 或 li2' });
      return;
    }
    if (!VALID_DECISIONS.has(decision)) {
      sendJson(res, 400, { ok: false, error: '审批决定只认 yes 或 no' });
      return;
    }
    const { signal, cleanup } = trackController(req);
    try {
      const r = await runCrew(['approve', machine, decision], crewOpts({ timeoutMs: 15_000, signal }));
      if (r.code === 0) {
        sendJson(res, 200, { ok: true, message: decision === 'yes' ? `已允许 ${machine}` : `已拒绝 ${machine}` });
      } else {
        sendJson(res, 200, { ok: false, code: r.code, error: mapActionError(decision === 'yes' ? '允许' : '拒绝', machine, r) });
      }
    } finally {
      cleanup();
    }
  };

  const handleScreen = async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: '仅支持 GET' });
      return;
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const machine = url.searchParams.get('machine');
    if (!VALID_MACHINES.has(machine)) {
      sendJson(res, 400, { ok: false, error: '机器名只认 li 或 li2' });
      return;
    }
    const { signal, cleanup } = trackController(req);
    try {
      const screen = await crewJson(['screen', machine, '--json'], crewOpts({ timeoutMs: 12_000, signal }));
      if (!screen) {
        sendJson(res, 200, { ok: false, error: `读取 ${machine} 终端画面失败` });
        return;
      }
      sendJson(res, 200, { ok: true, machine, screen });
    } finally {
      cleanup();
    }
  };

  const handleAssets = (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: '仅支持 GET' });
      return;
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const rawRel = url.pathname.slice('/liming-crew/assets/'.length);
    if (!rawRel || rawRel.includes('/') || rawRel.includes('\\') || rawRel.includes('..')) {
      sendJson(res, 404, { ok: false, error: '资源不存在' });
      return;
    }
    const entry = ASSET_ALLOWLIST[rawRel];
    if (!entry) {
      sendJson(res, 404, { ok: false, error: '资源不存在' });
      return;
    }
    sendFileBuffer(res, path.join(pluginDir, entry.rel), entry.type, entry.cache);
  };

  const handlePets = (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: '仅支持 GET' });
      return;
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const rest = url.pathname.slice('/liming-crew/pets/'.length);
    const parts = rest.split('/');
    if (parts.length !== 2) {
      sendJson(res, 404, { ok: false, error: '宠物资源不存在' });
      return;
    }
    const [petId, file] = parts;
    if (!VALID_PETS.has(petId) || !PET_FILE_RE.test(file)) {
      sendJson(res, 404, { ok: false, error: '宠物资源不存在' });
      return;
    }
    const baseDir = path.resolve(getStateDir(), 'pets', petId);
    const fullPath = path.resolve(baseDir, file);
    if (!fullPath.startsWith(baseDir + path.sep)) {
      sendJson(res, 404, { ok: false, error: '宠物资源不存在' });
      return;
    }
    const contentType = file.endsWith('.json') ? 'application/json; charset=utf-8' : 'image/png';
    sendFileBuffer(res, fullPath, contentType, 'public, max-age=3600');
  };

  const disposers = [
    webServer.register({ kind: 'exact', path: '/liming-crew/state', handler: handleState }),
    webServer.register({ kind: 'exact', path: '/liming-crew/send', handler: handleSend }),
    webServer.register({ kind: 'exact', path: '/liming-crew/stop', handler: handleStop }),
    webServer.register({ kind: 'exact', path: '/liming-crew/approve', handler: handleApprove }),
    webServer.register({ kind: 'exact', path: '/liming-crew/screen', handler: handleScreen }),
    webServer.register({ kind: 'prefix', path: '/liming-crew/assets/', handler: handleAssets }),
    webServer.register({ kind: 'prefix', path: '/liming-crew/pets/', handler: handlePets }),
  ];

  return () => {
    for (const c of activeControllers) {
      try { c.abort(); } catch {}
    }
    activeControllers.clear();
    for (const d of disposers) {
      try { d?.(); } catch {}
    }
  };
}
