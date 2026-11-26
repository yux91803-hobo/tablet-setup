// DSH（Cordis）插件：本机引擎加载时拉起平板上的 WorkBuddy 网关，卸载时停掉。
// 由 https://tablet.liming-work.com/setup.sh 装到 /root/liming-gateway；说明见 tablet-setup 仓库的 README。
import { createSupervisor } from './gateway.js';

export const name = 'liming-gateway';

export function apply(ctx, config = {}) {
  let logger = null;
  try { logger = typeof ctx.logger === 'function' ? ctx.logger(name) : null; } catch {}
  const supervisor = createSupervisor({ ...config, logger });
  ctx.effect(() => {
    supervisor.start().catch(err => { try { logger?.warn?.(String(err)); } catch {} });
    return () => supervisor.stop();
  });
}
