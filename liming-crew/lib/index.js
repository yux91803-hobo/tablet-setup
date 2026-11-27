// DSH Go 原生插件 liming-crew：状态条只读本地缓存，面板打开时每 3 秒经 crew 取现场数据。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crewJson, crewJsonl, runCrew } from './crew-client.js';
import { panelData, panelView, stripText } from './views.js';

export const name = 'liming-crew';

function stateDir() {
  return process.env.LIMING_CREW_STATE || path.join(os.homedir(), '.config', 'liming', 'crew');
}

function readCachedStatus() {
  try {
    const raw = fs.readFileSync(path.join(stateDir(), 'status.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function pickRemoteUrl(status, machine) {
  const rows = Array.isArray(status?.machines) ? status.machines : [];
  const row = rows.find(r => r && r.machine === machine);
  const url = row?.agent?.remoteUrl;
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

export function apply(ctx) {
  ctx.inject(['dshGo'], (dshCtx) => {
    let selectedMachine = 'li2';
    let lastStatus = readCachedStatus();
    const activeRefreshers = new Set();

    // 状态条：每 15 秒只读本地 status.json，不调 crew、不唤醒云电脑
    dshCtx.dshGo.strip('crew-strip', (_scope, emit) => {
      const push = () => {
        const cached = readCachedStatus();
        if (cached) lastStatus = cached;
        emit({ text: stripText(cached), icon: 'robot' });
      };
      push();
      const timer = setInterval(push, 15_000);
      timer.unref?.();
      return () => clearInterval(timer);
    });

    // 面板「团队」：打开期间每 3 秒刷一次，关上就停；上一轮未完成就跳过
    dshCtx.dshGo.panel('crew', {
      view: (_scope, caps) => panelView(caps),
      data: (_scope, emit) => {
        let stopped = false;
        let busy = false;
        let controller = null;

        // 先用本地缓存立刻推一帧，避免打开面板时长时间空白
        emit(panelData({ status: readCachedStatus(), selected: selectedMachine, screen: null, log: [] }));

        const tick = async () => {
          if (stopped || busy) return;
          busy = true;
          controller = new AbortController();
          try {
            const status = await crewJson(['status', '--json'], { timeoutMs: 12_000, signal: controller.signal });
            if (stopped) return;
            if (status) lastStatus = status;
            const effectiveStatus = status || lastStatus;
            const rows = Array.isArray(effectiveStatus?.machines) ? effectiveStatus.machines : [];
            const cur = rows.find(r => r && r.machine === selectedMachine);
            let screen = null;
            let log = [];
            if (cur?.state === 'running' && cur?.agent) {
              const [sc, lg] = await Promise.all([
                crewJson(['screen', selectedMachine, '--json'], { timeoutMs: 10_000, signal: controller.signal }),
                crewJsonl(['log', selectedMachine, '--last', '15', '--json'], { timeoutMs: 10_000, signal: controller.signal }),
              ]);
              screen = sc;
              log = lg || [];
            }
            if (!stopped) {
              emit(panelData({ status: effectiveStatus, selected: selectedMachine, screen, log }));
            }
          } catch {
            // 忽略本轮取数失败，下一轮重试
          } finally {
            controller = null;
            busy = false;
          }
        };

        activeRefreshers.add(tick);
        tick();
        const timer = setInterval(tick, 3_000);
        timer.unref?.();

        return () => {
          stopped = true;
          activeRefreshers.delete(tick);
          clearInterval(timer);
          try { controller?.abort(); } catch {}
        };
      },
      actions: {
        select: (_scope, event) => {
          const val = event?.value?.value;
          if (val !== 'li' && val !== 'li2') return { toast: '机器名只认 li 或 li2' };
          selectedMachine = val;
          for (const fn of activeRefreshers) fn();
          return { patch: { selected: val } };
        },
        send: (_scope, event) => {
          const text = String(event?.value?.values?.['data.form.message'] ?? '').trim();
          if (!text) return { toast: '先输入要发的话' };
          const target = selectedMachine;
          return {
            pending: { label: `正在发给 ${target}`, timeoutMs: 30_000 },
            result: async (signal) => {
              const res = await runCrew(['send', target, '--stdin'], { stdin: text, timeoutMs: 25_000, signal });
              if (res.code === 0) return { toast: `已发给 ${target}`, patch: { form: { message: '' } } };
              if (res.code === 5) return { toast: `${target} 正在冷却` };
              if (res.code === 6) return { toast: `${target} 还没启动成员` };
              return { toast: `发给 ${target} 失败` };
            },
          };
        },
        stop: () => {
          const target = selectedMachine;
          return {
            pending: { label: `正在叫停 ${target}`, timeoutMs: 20_000 },
            result: async (signal) => {
              const res = await runCrew(['stop', target], { timeoutMs: 15_000, signal });
              if (res.code === 0) return { toast: `已叫停 ${target}` };
              if (res.code === 5) return { toast: `${target} 正在冷却` };
              if (res.code === 6) return { toast: `${target} 还没启动成员` };
              return { toast: `叫停 ${target} 失败` };
            },
          };
        },
        'approve-yes': () => {
          const target = selectedMachine;
          return {
            pending: { label: '正在允许', timeoutMs: 20_000 },
            result: async (signal) => {
              const res = await runCrew(['approve', target, 'yes'], { timeoutMs: 15_000, signal });
              if (res.code === 0) return { toast: `已允许 ${target}` };
              if (res.code === 7) return { toast: '现在没有等审批的操作' };
              return { toast: '允许操作失败' };
            },
          };
        },
        'approve-no': () => {
          const target = selectedMachine;
          return {
            pending: { label: '正在拒绝', timeoutMs: 20_000 },
            result: async (signal) => {
              const res = await runCrew(['approve', target, 'no'], { timeoutMs: 15_000, signal });
              if (res.code === 0) return { toast: `已拒绝 ${target}` };
              if (res.code === 7) return { toast: '现在没有等审批的操作' };
              return { toast: '拒绝操作失败' };
            },
          };
        },
        web: () => {
          const cached = lastStatus || readCachedStatus();
          const url = pickRemoteUrl(cached, selectedMachine);
          if (!url) return { toast: '这台还没有网页链接' };
          return { link: url };
        },
      },
    });
  });
}
