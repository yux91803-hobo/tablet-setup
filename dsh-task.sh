#!/bin/sh
# 平板 AI 把一个任务交给这台电脑上的 Harness：在当前目录干活，做完把答复打到标准输出就退出。
# 用单独的 tablet 配置（Harness 自带的 headless 模板加本机网关线路），不带天启的人设和插件。
# 权限用 Harness 自带的 danger-full-access 档（完全放权、不问审批），和云上的 Codex、Antigravity 一样；
# 不设 DSH_PERMISSION_MODE 的话，模板组合出的默认权限对不上任何预设，权限插件不启用（li 上 0.2.2-rc.3 实测）。
# 用法：dsh-task "任务"；要拿对话号接着做，第一次加 --json（type 为 session 的那行有 sessionId），之后 dsh-task --session-id <对话号> "补充"。
# 由 https://tablet.liming-work.com/setup.sh 放到 ~/.local/bin/dsh-task，说明见 tablet-setup 仓库的 README。
XIN_HARNESS_KEY=$(cat "$HOME/.xin/harness.key" 2>/dev/null) && [ -n "$XIN_HARNESS_KEY" ] || {
  echo "dsh-task: 读不到 $HOME/.xin/harness.key，这台电脑的网关还没配好" >&2
  exit 78
}
export XIN_HARNESS_KEY
DSH_PERMISSION_MODE=danger-full-access
export DSH_PERMISSION_MODE
exec "$HOME/.local/bin/dsh" --profile tablet "$@"
