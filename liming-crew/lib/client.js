// DSH Go 网页端客户端薄外壳（参考 dsh-go examples/plugins/dsh-go-example-overlay 与 runtime/tests/route-probe）。
// 挂到两处：1）平板对话详情右栏页签（sidebar.right.pane.tab）；2）「全部功能 › 插件」整页（sidebar.panellist + main）。
window.__ModuleLoader__.load({
  id: 'liming-crew',
  factory: (require) => {
    const React = require('react');
    const { createElement: h, useEffect, useRef } = React;

    const NAME = 'liming-crew';
    const PANEL_ID = 'liming-crew';
    const TAB_ID = 'liming-crew:house';
    const CSS_ID = 'liming-crew-house-style';
    const POLL_MS = 3000;

    function resolveUrl(relPath) {
      return new URL(relPath, document.baseURI).toString();
    }

    function ensureStyle() {
      if (document.getElementById(CSS_ID)) return;
      const link = document.createElement('link');
      link.id = CSS_ID;
      link.rel = 'stylesheet';
      link.href = resolveUrl('liming-crew/assets/house-style.css');
      document.head.appendChild(link);
    }

    let modulesPromise = null;
    function loadEngineModules() {
      if (!modulesPromise) {
        modulesPromise = Promise.all([
          import(resolveUrl('liming-crew/assets/house-engine.js')),
          import(resolveUrl('liming-crew/assets/scene.js')),
        ]).then(([engine, scene]) => ({ engine, scene }));
      }
      return modulesPromise;
    }

    async function apiJson(relPath, opts = {}) {
      const res = await fetch(resolveUrl(relPath), {
        credentials: 'same-origin',
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        ...opts,
      });
      return res.json();
    }

    function CrewSidebarIcon({ size = 18 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.9,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M3 11.5L12 4l9 7.5' }),
        h('path', { d: 'M5.5 10.5V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-8.5' }),
        h('rect', { x: 9.2, y: 13.5, width: 5.6, height: 4, rx: 1 }),
      );
    }

    function CrewHouseShell({ layout }) {
      const hostRef = useRef(null);

      useEffect(() => {
        const node = hostRef.current;
        if (!node) return undefined;
        ensureStyle();

        let disposed = false;
        let inFlight = false;
        let demoMode = false;
        let prevScene = null;
        let timer = 0;
        let activeAbort = null;
        let mountedApi = null;
        let sceneMod = null;

        const pollOnce = async () => {
          if (disposed || inFlight || demoMode || document.hidden || !mountedApi || !sceneMod) return;
          inFlight = true;
          const controller = new AbortController();
          activeAbort = controller;
          try {
            const payload = await apiJson('liming-crew/state', { signal: controller.signal });
            if (disposed || demoMode) return;
            if (payload && payload.skipped && prevScene) return;
            const nextScene = sceneMod.sceneFromCrew(
              payload?.status || null,
              payload?.events || { li: [], li2: [] },
              prevScene,
              { screens: payload?.screens || {}, unreachable: !!payload?.unreachable }
            );
            prevScene = nextScene;
            mountedApi.applyLiveScene(nextScene, payload?.petsAvailable || null);
          } catch {
            if (!disposed && !demoMode && mountedApi && sceneMod && !prevScene) {
              const offline = sceneMod.sceneFromCrew(null, { li: [], li2: [] }, prevScene, { unreachable: true });
              prevScene = offline;
              mountedApi.applyLiveScene(offline, null);
            }
          } finally {
            if (activeAbort === controller) activeAbort = null;
            inFlight = false;
          }
        };

        const onVisChange = () => {
          if (document.hidden) {
            try { activeAbort?.abort(); } catch {}
          } else {
            pollOnce();
          }
        };
        document.addEventListener('visibilitychange', onVisChange);

        loadEngineModules().then(({ engine, scene }) => {
          if (disposed || !hostRef.current) return;
          sceneMod = scene;
          mountedApi = engine.mount(hostRef.current, {
            layout,
            assetBase: resolveUrl('liming-crew/assets'),
            petBase: resolveUrl('liming-crew/pets'),
            callbacks: {
              onDemoChange: (on) => {
                demoMode = !!on;
                if (!demoMode) pollOnce();
              },
              onSend: async (machine, text) => {
                try {
                  const res = await apiJson('liming-crew/send', {
                    method: 'POST',
                    body: JSON.stringify({ machine, text }),
                  });
                  if (res?.ok) pollOnce();
                  return res;
                } catch {
                  return { ok: false, error: `发给 ${machine} 失败` };
                }
              },
              onStop: async (machine) => {
                try {
                  const res = await apiJson('liming-crew/stop', {
                    method: 'POST',
                    body: JSON.stringify({ machine }),
                  });
                  if (res?.ok) pollOnce();
                  return res;
                } catch {
                  return { ok: false, error: `叫停 ${machine} 失败` };
                }
              },
              onApprove: async (machine, decision) => {
                try {
                  const res = await apiJson('liming-crew/approve', {
                    method: 'POST',
                    body: JSON.stringify({ machine, decision }),
                  });
                  if (res?.ok) pollOnce();
                  return res;
                } catch {
                  return { ok: false, error: '审批操作失败' };
                }
              },
              onOpenScreen: async (machine) => {
                try {
                  const res = await apiJson(`liming-crew/screen?machine=${encodeURIComponent(machine)}`);
                  const lines = Array.isArray(res?.screen?.lines) ? res.screen.lines : [];
                  return lines.map((l) => String(l ?? '').replace(/[ \t\r]+$/, '')).filter((l) => l.trim() !== '');
                } catch {
                  return ['（读取终端画面失败）'];
                }
              },
            },
          });
          pollOnce();
          timer = window.setInterval(pollOnce, POLL_MS);
        }).catch(() => {
          if (!disposed && hostRef.current) {
            hostRef.current.textContent = '团队面板资源加载失败，请重启本机引擎后重试。';
          }
        });

        return () => {
          disposed = true;
          document.removeEventListener('visibilitychange', onVisChange);
          if (timer) window.clearInterval(timer);
          try { activeAbort?.abort(); } catch {}
          if (mountedApi) mountedApi.destroy();
        };
      }, [layout]);

      return h('div', {
        ref: hostRef,
        'data-liming-crew-host': layout,
        style: { width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
      });
    }

    const RightPaneTab = () => h(CrewHouseShell, { layout: 'pane' });
    const RightPaneTitle = () => h('span', null, '团队');
    const FullPagePanel = () => h(CrewHouseShell, { layout: 'full' });

    return {
      name: NAME,
      inject: ['slots'],
      apply(ctx) {
        // 1. 对话详情右栏页签（副屏）
        ctx.inject(['sidebarRightTabs'], (inner) => {
          inner.effect(() => inner.get('sidebarRightTabs').register({
            id: TAB_ID,
            kind: 'liming-crew-house',
            priority: 'extension',
            title: () => '团队',
            guide: [{ id: 'liming-crew-house', order: 200, title: () => '团队' }],
          }), 'liming-crew: right pane tab');
        });
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: TAB_ID, label: () => '团队' },
          RightPaneTab
        ));
        ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab.title', key: TAB_ID, label: () => '团队' },
          RightPaneTitle
        ));

        // 2. 「全部功能 › 插件」整页入口
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 200, label: () => '团队' },
          CrewSidebarIcon
        ));
        ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: PANEL_ID, label: () => '团队' },
          FullPagePanel
        ));
      },
    };
  },
});
