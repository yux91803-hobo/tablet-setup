// 纯函数场景映射：把 crew status/events/screen 转换成「三方小屋」网页面板状态。
// 不依赖 DOM 或 Node 内置模块，引擎测试与浏览器前端共用同一份代码。

const APPROVAL_MARKERS = [
  'Run this command?',
  'Do you want to proceed?',
  'Allow calling this tool?',
  'Allow creation of this file?',
  'Allow access to this file?',
  'Allow administrator elevation?',
  'Allow remote debugging?',
  'Requesting permission for:',
  'Action Required',
  'allow command?',
];

const BLOCKED_NON_APPROVAL = [
  'Choose your color scheme',
  'Terms of Service',
  'Do you trust the contents of this project?',
];

const MACHINE_META = {
  li: { id: 'li', petName: '鲸娘', petId: 'whale-girl', desk: 'liDesk', color: '#2f72d9' },
  li2: { id: 'li2', petName: '小粉鱼', petId: 'pink-fish', desk: 'li2Desk', color: '#df5b93' },
};

function clipChars(text, max) {
  const chars = Array.from(String(text ?? ''));
  if (chars.length <= max) return chars.join('');
  if (max <= 1) return chars.slice(0, max).join('');
  return chars.slice(0, max - 1).join('') + '…';
}

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

export function formatBjHm(iso) {
  if (!iso) return '--:--';
  const raw = String(iso).trim();
  const normalized = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`;
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) return raw.slice(11, 16) || '--:--';
  const d = new Date(ms + 8 * 3600 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function isScreenApproval(screen) {
  const lines = Array.isArray(screen?.lines) ? screen.lines.map((l) => String(l)) : [];
  if (lines.length === 0) return null;
  const joined = lines.join('\n');
  if (BLOCKED_NON_APPROVAL.some((m) => joined.includes(m))) return false;
  const low = joined.toLowerCase();
  return APPROVAL_MARKERS.some((m) => joined.includes(m) || (m === 'allow command?' && low.includes(m)));
}

export function extractApprovalCommand(screen, fallbackDetail = '') {
  const rawLines = Array.isArray(screen?.lines) ? screen.lines.map((l) => String(l).replace(/[ \t\r]+$/, '')) : [];
  if (rawLines.length > 0) {
    // 找到审批提示行之后、选项（> Yes / No / Press enter）之前的完整命令内容
    let promptIdx = -1;
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (APPROVAL_MARKERS.some((m) => line.includes(m) || line.toLowerCase().includes(m.toLowerCase()))) {
        promptIdx = i;
      }
    }
    if (promptIdx >= 0) {
      const collected = [];
      for (let i = promptIdx + 1; i < rawLines.length; i++) {
        const trimmed = rawLines[i].trim();
        if (!trimmed) {
          if (collected.length > 0) break;
          continue;
        }
        if (/^(>\s*)?(Yes|No)\b/i.test(trimmed) || /Press enter to confirm/i.test(trimmed) || /^─{8,}/.test(trimmed)) {
          break;
        }
        collected.push(trimmed);
      }
      if (collected.length > 0) return collected.join('\n');
    }
    const nonEmpty = rawLines.map((l) => l.trim()).filter((l) => l && !/^─{8,}/.test(l) && !/^\?\s*for shortcuts/.test(l));
    if (nonEmpty.length > 0) return nonEmpty.slice(-6).join('\n');
  }
  return oneLine(fallbackDetail) || '（请点开终端核对完整操作）';
}

export function extractActionLabel(agent, machineEvents = []) {
  const ctx = String(agent?.context || '');
  let detail = oneLine(agent?.detail || '');
  if (!detail && Array.isArray(machineEvents)) {
    for (let i = machineEvents.length - 1; i >= 0; i--) {
      const ev = machineEvents[i];
      if (ev?.type === 'status' && ev?.data?.detail) {
        detail = oneLine(ev.data.detail);
        break;
      }
    }
  }
  if (ctx === 'tool:run_command' || ctx === 'tool:Bash') {
    if (/\b(test|pytest|vitest|jest|mocha|cargo test|go test|flutter test)\b/i.test(detail)) return '跑测试';
    if (/\b(build|make|cmake|cargo build|npm run build|vite build|gcc|arm-none-eabi)\b/i.test(detail)) return '跑构建';
    if (/\b(git|gh)\b/i.test(detail)) return 'git 操作';
    if (/\bhcom\s+send\b/i.test(detail)) return '发消息';
    if (/\b(shellcheck|eslint|analyze|lint)\b/i.test(detail)) return '跑检查';
    return '跑命令';
  }
  if (ctx === 'tool:read_file' || ctx === 'tool:view_file') return '读文件';
  if (
    ctx === 'tool:edit_file' ||
    ctx === 'tool:write_file' ||
    ctx === 'tool:replace_file_content' ||
    ctx === 'tool:multi_replace_file_content'
  ) {
    return '改文件';
  }
  if (ctx === 'tool:grep_search' || ctx === 'tool:find_by_name' || ctx === 'tool:search_web') return '查资料';
  if (ctx.startsWith('deliver:')) return '收消息';
  if (ctx.startsWith('tool:')) return clipChars(ctx.slice(5), 10) || '干活中';
  if (detail) return clipChars(detail, 10);
  return '干活中';
}

function normalizeEventsByMachine(events) {
  const out = { li: [], li2: [] };
  if (Array.isArray(events)) {
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue;
      const m = ev.machine === 'li' || ev.machine === 'li2' ? ev.machine : null;
      if (m) out[m].push(ev);
    }
  } else if (events && typeof events === 'object') {
    for (const m of ['li', 'li2']) {
      if (Array.isArray(events[m])) {
        out[m] = events[m].filter((e) => e && typeof e === 'object');
      }
    }
  }
  return out;
}

function parseTimestampMs(iso) {
  if (!iso) return 0;
  const raw = String(iso).trim();
  const normalized = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? 0 : ms;
}

function classifyMessageEvent(ev, machineId, agentName) {
  const data = ev?.data || {};
  const inst = String(ev?.instance || '');
  const from = String(data.from || inst);
  const text = oneLine(data.text);
  if (!text) return null;
  const base = agentName && agentName.startsWith('crew-') ? agentName.slice(5) : (agentName || '');
  const isFromMachine =
    (base && (inst === base || from === base)) ||
    (agentName && (inst === agentName || from === agentName)) ||
    (!inst.startsWith('ext_') && from !== 'bigboss' && from !== 'dsh');

  const route = isFromMachine ? `${machineId} → DSH` : `DSH → ${machineId}`;
  const cls = machineId === 'li' ? 'r-li' : 'r-li2';
  return {
    id: Number(ev.id) || 0,
    machine: machineId,
    direction: isFromMachine ? 'to-dsh' : 'to-machine',
    from: isFromMachine ? machineId : 'dsh',
    to: isFromMachine ? 'dsh' : machineId,
    route,
    cls,
    relay: !isFromMachine,
    text,
    ts: ev.ts || '',
    tsMs: parseTimestampMs(ev.ts),
    time: formatBjHm(ev.ts),
  };
}

function sanitizeHttpsUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return trimmed.startsWith('https://') ? trimmed : null;
}

function formatTerminalLines(screen) {
  const lines = Array.isArray(screen?.lines) ? screen.lines : [];
  const cleaned = lines
    .map((l) => String(l ?? '').replace(/[ \t\r]+$/, ''))
    .filter((l) => l.trim() !== '');
  return cleaned.length > 0 ? cleaned : ['（暂无终端画面，点击「终端」可实时刷新）'];
}

export function sceneFromCrew(status, events, prev, opts = {}) {
  const chatLimit = Number.isFinite(opts.chatLimit) ? Math.max(5, opts.chatLimit) : 30;
  const screens = opts.screens && typeof opts.screens === 'object' ? opts.screens : {};
  const unreachable = opts.unreachable === true || !status || typeof status !== 'object';
  const rows = Array.isArray(status?.machines) ? status.machines : [];
  const byMachine = new Map();
  for (const row of rows) {
    if (row && (row.machine === 'li' || row.machine === 'li2')) {
      byMachine.set(row.machine, row);
    }
  }

  const eventsByM = normalizeEventsByMachine(events);
  const prevInit = !!(prev && prev.initialized);
  const prevMax = {
    li: Number(prev?.maxEventIdByMachine?.li) || 0,
    li2: Number(prev?.maxEventIdByMachine?.li2) || 0,
  };
  const nextMax = { li: prevMax.li, li2: prevMax.li2 };

  const machines = {};
  const terminal = {};
  let approval = null;
  const animations = [];
  const collectedChat = [];

  for (const id of ['li', 'li2']) {
    const meta = MACHINE_META[id];
    const row = byMachine.get(id) || null;
    const mEvents = eventsByM[id] || [];
    const screen = screens[id] || null;
    const agent = row?.agent || null;
    const agentName = agent?.name || '';

    for (const ev of mEvents) {
      const evId = Number(ev.id) || 0;
      if (evId > nextMax[id]) nextMax[id] = evId;
      if (ev.type === 'message') {
        const msg = classifyMessageEvent(ev, id, agentName);
        if (msg) {
          collectedChat.push(msg);
          if (prevInit && evId > prevMax[id]) {
            animations.push({
              kind: 'flight',
              eventId: evId,
              machine: id,
              from: msg.from,
              to: msg.to,
              color: meta.color,
              cls: id === 'li2' ? 'is-pink' : '',
              label: msg.route,
              text: msg.text,
            });
          }
        }
      }
    }

    let mState;
    if (unreachable || !row || row.state === 'unknown' || row.state === 'error') {
      mState = {
        id,
        petName: meta.petName,
        status: 'offline',
        spot: meta.desk,
        actionTag: '连不上',
        offline: true,
        dim: false,
        cooldownUntil: null,
        remoteUrl: null,
        agentName: null,
        dir: null,
      };
    } else if (row.state === 'paused' || row.state === 'stopped') {
      mState = {
        id,
        petName: meta.petName,
        status: 'sleeping',
        spot: 'sofa',
        actionTag: row.state === 'stopped' ? '已关机' : '睡着',
        offline: false,
        dim: true,
        cooldownUntil: null,
        remoteUrl: null,
        agentName: null,
        dir: null,
      };
    } else if (row.state === 'starting') {
      mState = {
        id,
        petName: meta.petName,
        status: 'waking',
        spot: 'sofa',
        actionTag: '正在叫醒',
        offline: false,
        dim: false,
        cooldownUntil: null,
        remoteUrl: null,
        agentName: null,
        dir: null,
      };
    } else if (row.state === 'cooldown') {
      const hm = row.cooldownUntil ? formatBjHm(row.cooldownUntil) : '';
      mState = {
        id,
        petName: meta.petName,
        status: 'cooldown',
        spot: 'window',
        actionTag: hm ? `冷却 · ${hm}恢复` : '冷却中',
        offline: false,
        dim: false,
        cooldownUntil: row.cooldownUntil || null,
        remoteUrl: null,
        agentName: null,
        dir: null,
      };
    } else if (!agent) {
      mState = {
        id,
        petName: meta.petName,
        status: 'idle',
        spot: meta.desk,
        actionTag: '在线（无成员）',
        offline: false,
        dim: false,
        cooldownUntil: null,
        remoteUrl: null,
        agentName: null,
        dir: null,
      };
    } else if (agent.status === 'blocked') {
      const screenIsApproval = isScreenApproval(screen);
      const isSetupPrompt = screenIsApproval === false;
      mState = {
        id,
        petName: meta.petName,
        status: 'approval',
        spot: 'window',
        actionTag: isSetupPrompt ? '需手工确认' : '等审批',
        offline: false,
        dim: false,
        cooldownUntil: null,
        remoteUrl: sanitizeHttpsUrl(agent.remoteUrl),
        agentName: agent.name || null,
        dir: agent.dir || null,
      };
      if (!approval) {
        approval = {
          machine: id,
          petName: meta.petName,
          isSetupPrompt,
          title: isSetupPrompt
            ? `${meta.petName}（${id}）停在首次设置或条款页`
            : `${meta.petName}（${id}）在二楼敲玻璃 · 等你拍板`,
          cmd: extractApprovalCommand(screen, agent.detail),
          note: isSetupPrompt
            ? '请到 InstaBox 的 Computer 页签亲自处理，插件不会代点条款或账号选项。'
            : '请核对完整命令后再点「批准执行」或「拒绝」。',
        };
      }
      if (prevInit && prev?.machines?.[id]?.status !== 'approval') {
        animations.push({ kind: 'approval', machine: id });
      }
    } else if (agent.stopped === true) {
      mState = {
        id,
        petName: meta.petName,
        status: 'stopped',
        spot: meta.desk,
        actionTag: '刚叫停',
        offline: false,
        dim: false,
        cooldownUntil: null,
        remoteUrl: sanitizeHttpsUrl(agent.remoteUrl),
        agentName: agent.name || null,
        dir: agent.dir || null,
      };
      if (prevInit && prev?.machines?.[id]?.status !== 'stopped') {
        animations.push({ kind: 'stop', machine: id });
      }
    } else if (agent.status === 'active') {
      mState = {
        id,
        petName: meta.petName,
        status: 'working',
        spot: meta.desk,
        actionTag: extractActionLabel(agent, mEvents),
        offline: false,
        dim: false,
        cooldownUntil: null,
        remoteUrl: sanitizeHttpsUrl(agent.remoteUrl),
        agentName: agent.name || null,
        dir: agent.dir || null,
      };
    } else {
      mState = {
        id,
        petName: meta.petName,
        status: 'idle',
        spot: meta.desk,
        actionTag: '空闲',
        offline: false,
        dim: false,
        cooldownUntil: null,
        remoteUrl: sanitizeHttpsUrl(agent.remoteUrl),
        agentName: agent.name || null,
        dir: agent.dir || null,
      };
    }

    machines[id] = mState;
    terminal[id] = screen
      ? formatTerminalLines(screen)
      : (prev?.terminal?.[id] || ['（点击「终端」或桌上的电脑拉取实时画面）']);
  }

  // 合并历史与最新群聊记录（按事件时间排序，去重，保留最近 chatLimit 条）
  const chatMap = new Map();
  if (Array.isArray(prev?.chat)) {
    for (const c of prev.chat) {
      if (c && c.key) chatMap.set(c.key, c);
    }
  }
  for (const m of collectedChat) {
    const key = `${m.machine}:${m.id}:${m.ts}`;
    chatMap.set(key, {
      key,
      route: m.route,
      cls: m.cls,
      relay: m.relay,
      text: m.text,
      time: m.time,
      tsMs: m.tsMs,
      id: m.id,
    });
  }
  const chat = [...chatMap.values()]
    .sort((a, b) => (a.tsMs - b.tsMs) || (a.id - b.id))
    .slice(-chatLimit);

  // DSH 鱼缸全局姿态
  const bothSleeping = machines.li.status === 'sleeping' && machines.li2.status === 'sleeping';
  const anyStopped = machines.li.status === 'stopped' || machines.li2.status === 'stopped';
  const latestFlight = [...animations].reverse().find((a) => a.kind === 'flight') || null;
  let dshMode = 'normal';
  let dshIntent = 'idle';
  let dshLookAt = 'center';
  let dshCaption = '';

  if (approval) {
    dshMode = 'warn';
    dshIntent = 'warn';
    dshLookAt = 'up';
    dshCaption = approval.isSetupPrompt
      ? `${approval.machine} 停在设置页，请到 Computer 页签处理`
      : `${approval.petName} 等你拍板，请看右侧审批卡`;
  } else if (bothSleeping) {
    dshMode = 'sleep';
    dshIntent = 'sleep';
    dshLookAt = 'center';
    dshCaption = '';
  } else if (latestFlight) {
    dshMode = 'normal';
    dshIntent = latestFlight.from === 'dsh' ? 'dispatch' : 'idle';
    dshLookAt = latestFlight.machine;
    dshCaption = `${latestFlight.label}：${clipChars(latestFlight.text, 24)}`;
  } else if (anyStopped) {
    dshMode = 'stop';
    dshIntent = 'stop';
    dshLookAt = machines.li2.status === 'stopped' ? 'li2' : 'li';
    dshCaption = `已叫停 ${dshLookAt}`;
  } else if (unreachable) {
    dshMode = 'normal';
    dshIntent = 'idle';
    dshCaption = '暂时连不上 crew，稍后自动重试';
  }

  return {
    initialized: true,
    at: status?.at || null,
    unreachable,
    maxEventIdByMachine: nextMax,
    machines,
    approval,
    terminal,
    chat,
    animations,
    dsh: {
      mode: dshMode,
      intent: dshIntent,
      lookAt: dshLookAt,
      caption: dshCaption,
    },
  };
}
