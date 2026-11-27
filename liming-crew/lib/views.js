// 纯函数视图与数据整理：不碰进程和文件，便于单测和插件自查工具检查。
const MAX_DATA_BYTES = 30 * 1024;
const MAX_STRIP_CHARS = 24;
const MAX_SCREEN_LINES = 12;
const MAX_EVENTS = 15;
const MAX_EVENT_CHARS = 120;

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

function clipChars(text, max) {
  const chars = Array.from(String(text ?? ''));
  if (chars.length <= max) return chars.join('');
  if (max <= 1) return chars.slice(0, max).join('');
  return chars.slice(0, max - 1).join('') + '…';
}

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

export function nowAgo(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '';
  const s = Math.max(0, Math.floor(Number(seconds)));
  if (s < 60) return '刚才';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

function formatBjHm(iso) {
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

function ctxLabel(ctx) {
  const c = String(ctx || '');
  if (c === 'tool:run_command' || c === 'tool:Bash') return '跑命令';
  if (c === 'tool:read_file') return '读文件';
  if (c === 'tool:edit_file' || c === 'tool:write_file' || c === 'tool:replace_file_content' || c === 'tool:multi_replace_file_content') return '改文件';
  if (c.startsWith('deliver:')) return '收消息';
  if (c.startsWith('tool:')) return c.slice(5);
  return c;
}

function shortMachineState(row) {
  if (!row || typeof row !== 'object') return '未知';
  if (row.state === 'cooldown') return '冷却中';
  if (row.state === 'starting') return '正在叫醒';
  if (row.state === 'paused') return '睡着';
  if (row.state === 'stopped') return '关机';
  if (row.state !== 'running') return '未知';
  const ag = row.agent;
  if (!ag) return '在线';
  if (ag.status === 'blocked') return '等审批';
  if (ag.status === 'active') return '干活中';
  if (ag.status === 'listening') return '空闲';
  return '在线';
}

export function stripText(status) {
  const machines = Array.isArray(status?.machines) ? status.machines.filter(m => m && m.machine) : [];
  if (machines.length === 0) return '团队：未知';
  const labels = machines.map(shortMachineState);
  const names = machines.map(m => String(m.machine));

  let text;
  if (labels.every(l => l === '睡着')) {
    text = `${names.join('、')} 都在睡`;
  } else if (labels.every(l => l === '空闲')) {
    text = `${names.join('、')} 都空闲`;
  } else if (labels.every(l => l === '未知')) {
    text = '团队：未知';
  } else {
    text = machines.map((m, i) => `${m.machine} ${labels[i]}`).join(' · ');
  }
  return clipChars(text, MAX_STRIP_CHARS);
}

function machineTone(row) {
  if (!row) return 'muted';
  if (row.state === 'cooldown') return 'warn';
  if (row.state !== 'running') return 'muted';
  if (!row.agent) return 'info';
  if (row.agent.status === 'blocked') return 'warn';
  if (row.agent.status === 'active') return 'info';
  if (row.agent.status === 'listening') return 'good';
  return 'muted';
}

function memberRow(row) {
  const m = row.machine;
  const st = row.state;
  const ag = row.agent;
  if (st === 'cooldown') {
    return {
      title: `${m} · 冷却中`,
      subtitle: row.cooldownUntil ? `预计 ${formatBjHm(row.cooldownUntil)} 恢复` : '暂不可用',
      trailing: '冷却',
      icon: 'clock',
      tone: 'warn',
    };
  }
  if (st === 'starting') {
    return { title: `${m} · 正在叫醒`, subtitle: '云电脑正在启动', trailing: '启动中', icon: 'running', tone: 'info' };
  }
  if (st === 'paused') {
    return { title: `${m} · 睡着`, subtitle: '发消息时会自动叫醒', trailing: '休眠', icon: 'pause', tone: 'muted' };
  }
  if (st === 'stopped') {
    return { title: `${m} · 已关机`, subtitle: '未运行', trailing: '关机', icon: 'power', tone: 'muted' };
  }
  if (st !== 'running') {
    return { title: `${m} · 状态未知`, subtitle: '暂时读不到机器信息', trailing: '未知', icon: 'question', tone: 'muted' };
  }
  if (!ag) {
    return { title: `${m} · 在线`, subtitle: '还没有运行 crew agent', trailing: '无成员', icon: 'cloud', tone: 'info' };
  }
  const cl = ctxLabel(ag.context);
  const statusText = ag.status === 'active'
    ? (cl ? `干活中（${cl}）` : '干活中')
    : ag.status === 'listening'
      ? (ag.stopped ? '空闲（刚叫停）' : '空闲')
      : ag.status === 'blocked'
        ? '等审批'
        : (ag.status || '在线');
  return {
    title: `${m} · ${statusText}`,
    subtitle: clipChars(ag.dir || ag.name || '运行中', 80),
    trailing: nowAgo(ag.ageSeconds) || '在线',
    icon: ag.status === 'blocked' ? 'warning' : 'robot',
    tone: machineTone(row),
  };
}

function isScreenApproval(screen) {
  const lines = Array.isArray(screen?.lines) ? screen.lines.map(l => String(l)) : [];
  if (lines.length === 0) return null;
  const joined = lines.join('\n');
  if (BLOCKED_NON_APPROVAL.some(m => joined.includes(m))) return false;
  const low = joined.toLowerCase();
  return APPROVAL_MARKERS.some(m => joined.includes(m) || (m === 'allow command?' && low.includes(m)));
}

function formatScreenLines(screen, maxLines = MAX_SCREEN_LINES, maxLineChars = 120) {
  const lines = Array.isArray(screen?.lines) ? screen.lines : [];
  const nonEmpty = [];
  for (const raw of lines) {
    const cleaned = String(raw ?? '').replace(/[ \t\r]+$/, '');
    if (cleaned.trim() !== '') nonEmpty.push(cleaned);
  }
  if (nonEmpty.length === 0) return '（暂无画面）';
  return nonEmpty.slice(-maxLines).map(l => clipChars(l, maxLineChars)).join('\n');
}

function formatEventItem(ev, agentName, maxChars = MAX_EVENT_CHARS) {
  const hm = formatBjHm(ev?.ts);
  const type = ev?.type;
  const data = ev?.data || {};
  const inst = String(ev?.instance || '');
  const base = agentName && agentName.startsWith('crew-') ? agentName.slice(5) : (agentName || '');

  let body = '';
  let icon = 'info';
  let tone;

  if (type === 'message') {
    const from = String(data.from || inst);
    const text = oneLine(data.text);
    const isOut = (base && (inst === base || from === base))
      || (agentName && (inst === agentName || from === agentName))
      || (!inst.startsWith('ext_') && from !== 'bigboss' && from !== 'dsh');
    if (isOut) {
      const mentions = Array.isArray(data.mentions) ? data.mentions : [];
      let target = mentions[0] || 'DSH';
      if (target === 'bigboss') target = 'DSH';
      body = `发给 ${target}：${text}`;
      icon = 'send';
      tone = 'info';
    } else {
      const who = from === 'bigboss' ? 'DSH' : from;
      body = `收到 ${who}：${text}`;
      icon = 'chat';
    }
  } else if (type === 'status') {
    const st = String(data.status || '');
    const ctx = String(data.context || '');
    const det = oneLine(data.detail);
    if (st === 'listening') {
      body = '空闲';
      icon = 'check';
      tone = 'good';
    } else if (st === 'blocked') {
      body = det ? `等审批：${det}` : '等审批';
      icon = 'warning';
      tone = 'warn';
    } else if (ctx === 'tool:run_command' || ctx === 'tool:Bash') {
      body = det ? `跑命令：${det}` : '跑命令';
      icon = 'terminal';
    } else if (ctx.startsWith('deliver:')) {
      const who = ctx.slice(8) === 'bigboss' ? 'DSH' : ctx.slice(8);
      body = `收到消息（${who}）`;
      icon = 'chat';
    } else if (ctx.startsWith('tool:')) {
      const label = ctxLabel(ctx);
      body = det ? `${label}：${det}` : label;
      icon = 'tool';
    } else {
      body = det ? `干活中：${det}` : '干活中';
      icon = 'running';
    }
  } else if (type === 'life') {
    const act = String(data.action || '');
    body = act === 'stopped' ? '已停止' : (act === 'started' || act === 'ready' ? '已启动' : `事件：${act}`);
    icon = 'info';
  } else {
    body = oneLine(JSON.stringify(data));
  }

  const title = clipChars(`${hm} ${body}`, maxChars);
  const item = { title, icon };
  if (tone) item.tone = tone;
  return item;
}

function normalizeEvents(log) {
  if (Array.isArray(log)) return log.filter(e => e && typeof e === 'object');
  if (typeof log === 'string') {
    const out = [];
    for (const line of log.split('\n')) {
      const s = line.trim();
      if (!s.startsWith('{')) continue;
      try { out.push(JSON.parse(s)); } catch {}
    }
    return out;
  }
  return [];
}

export function panelView(caps) {
  const hasV2 = !Array.isArray(caps?.components)
    || caps.components.length === 0
    || (caps.components.includes('form') && caps.components.includes('textField'));

  const children = [
    {
      type: 'callout',
      text: '只在面板开着时每 3 秒读云电脑，读的时候那台不会睡；关上面板就停。',
      tone: 'info',
    },
    {
      type: 'list',
      items: { $: 'data.members' },
    },
    {
      type: 'options',
      id: 'select',
      options: [
        { label: 'li', value: 'li' },
        { label: 'li2', value: 'li2' },
      ],
      selected: { $: 'data.selected' },
    },
    {
      type: 'text',
      text: { $: 'data.selectedSummary' },
    },
    {
      type: 'callout',
      text: { $: 'data.approvalNotice' },
      tone: { $: 'data.approvalTone' },
    },
    {
      type: 'list',
      items: { $: 'data.events' },
    },
    {
      type: 'text',
      text: { $: 'data.screenText' },
      ...(hasV2 ? { style: { size: 'mono' } } : {}),
    },
    ...(hasV2 ? [{
      type: 'form',
      submit: 'send',
      submitLabel: '插话',
      children: [
        {
          type: 'textField',
          label: '插话给当前机器',
          bind: 'data.form.message',
          placeholder: '输入要发给这台 Antigravity 的话',
          maxLength: 1000,
          required: true,
        },
      ],
    }] : []),
    {
      type: 'actions',
      items: { $: 'data.actionItems' },
    },
  ];

  if (!hasV2) {
    return { type: 'stack', children };
  }
  return {
    v: 2,
    type: 'stack',
    accent: 'app',
    children,
  };
}

export function panelData({ status, selected, screen, log } = {}) {
  const rawMachines = Array.isArray(status?.machines) ? status.machines : [];
  const byM = new Map();
  for (const row of rawMachines) {
    if (row && (row.machine === 'li' || row.machine === 'li2')) {
      byM.set(row.machine, row);
    }
  }
  const ordered = ['li', 'li2'].map(m => byM.get(m) || { machine: m, state: 'unknown', cooldownUntil: null, agent: null });
  const chosen = (selected === 'li' || selected === 'li2')
    ? selected
    : (ordered.find(r => r.state === 'running')?.machine || 'li2');
  const current = ordered.find(r => r.machine === chosen) || ordered[1];
  const agent = current?.agent || null;

  const screenApproval = isScreenApproval(screen);
  const isApproval = agent?.status === 'blocked' && screenApproval !== false;

  const actionItems = [
    { label: '叫停', action: 'stop', icon: 'stop' },
    { label: '网页', action: 'web', icon: 'globe' },
  ];
  if (isApproval) {
    actionItems.push(
      { label: '允许', action: 'approve-yes', icon: 'check' },
      { label: '拒绝', action: 'approve-no', icon: 'error' },
    );
  }

  let approvalNotice = `当前查看：${chosen}（无待审批操作）`;
  let approvalTone = 'info';
  if (isApproval) {
    approvalNotice = `${chosen} 正在等审批：请核对下方终端画面后再点「允许」或「拒绝」。`;
    approvalTone = 'warn';
  } else if (agent?.status === 'blocked' && screenApproval === false) {
    approvalNotice = `${chosen} 停在首次设置、条款或信任页：请到 InstaBox 的 Computer 页签亲自处理。`;
    approvalTone = 'warn';
  }

  const members = ordered.map(memberRow);
  const currentMember = memberRow(current);
  const selectedSummary = `${currentMember.title}${currentMember.subtitle ? ` · ${currentMember.subtitle}` : ''}`;

  const rawEvents = normalizeEvents(log);
  let eventLimit = MAX_EVENTS;
  let eventCharLimit = MAX_EVENT_CHARS;
  let screenLines = MAX_SCREEN_LINES;
  let screenLineChars = 120;

  const build = () => ({
    at: status?.at || null,
    selected: chosen,
    members,
    selectedSummary: clipChars(selectedSummary, 160),
    approvalNotice: clipChars(approvalNotice, 160),
    approvalTone,
    isApproval,
    remoteUrl: agent?.remoteUrl || null,
    events: rawEvents.slice(-eventLimit).map(e => formatEventItem(e, agent?.name || '', eventCharLimit)),
    screenText: formatScreenLines(screen, screenLines, screenLineChars),
    form: { message: '' },
    actionItems,
  });

  let data = build();
  while (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_DATA_BYTES) {
    if (screenLineChars > 40) {
      screenLineChars = Math.max(40, Math.floor(screenLineChars * 0.7));
    } else if (screenLines > 4) {
      screenLines = Math.max(4, screenLines - 2);
    } else if (eventCharLimit > 40) {
      eventCharLimit = Math.max(40, Math.floor(eventCharLimit * 0.7));
    } else if (eventLimit > 3) {
      eventLimit = Math.max(3, eventLimit - 3);
    } else {
      data.screenText = clipChars(data.screenText, 200);
      data.events = data.events.slice(-3);
      break;
    }
    data = build();
  }
  return data;
}
