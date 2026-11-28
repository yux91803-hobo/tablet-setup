// DSH Go 插件 liming-crew：状态条每 15 秒只读本地缓存；「团队」三方小屋网页面板走 /liming-crew/* 路由。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerCrewRoutes } from './routes.js';
import { stripText } from './views.js';

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

export function apply(ctx) {
  // 1. 输入框上方状态条：每 15 秒只读本地 status.json，不调 crew、不唤醒云电脑
  ctx.inject(['dshGo'], (dshCtx) => {
    dshCtx.dshGo.strip('crew-strip', (_scope, emit) => {
      const push = () => {
        emit({ text: stripText(readCachedStatus()), icon: 'robot' });
      };
      push();
      const timer = setInterval(push, 15_000);
      timer.unref?.();
      return () => clearInterval(timer);
    });

    if (typeof dshCtx.dshGo.on === 'function') {
      dshCtx.dshGo.on('crew-strip', () => ({
        toast: `${stripText(readCachedStatus())}（在「团队」面板看三方小屋）`,
      }));
    }
  });

  // 2. 网页面板宿主路由（/liming-crew/*），由宿主 webServer 统一鉴权与生命周期回收
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => registerCrewRoutes(webCtx.get('webServer')),
      'liming-crew: routes'
    );
  });
}
