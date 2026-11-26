# 平板装机（DSH Go）

在自己的安卓平板上装原版 [DSH Go](https://github.com/ccch1mneyyy/dsh-go)（DeepSeek Harness 的安卓 App），接上自己的网关，平板上的 AI 还能自己操作 li、li2 两台云电脑。App 本身不改，Harness 用 App 自带的版本，不另外升级。

这个仓库只放平板的东西。根目录由 Cloudflare Pages 发布到 https://tablet.liming-work.com/ ，装机脚本从那里下载文件。2026-11-26 从 liming-work-site 搬出来，改平板不再跑网站的测试和部署。以前的设计：[平板版 DSH Go 第一步](https://github.com/yux91803-hobo/liming-work-site/blob/main/docs/superpowers/specs/2026-11-25-tablet-dshgo-design.md)、[平板 AI 直接操控 li、li2](https://github.com/yux91803-hobo/liming-work-site/blob/main/docs/superpowers/specs/2026-11-26-tablet-cloud-direct-design.md)。

## 用起来是什么样

- **打开就说话**：本机引擎一启动，网关就跟着起来，十几秒内能用。模型是网关里的 DeepSeek V4.1 Flash、GLM-5.4、Kimi K3.1 Pro，都能看图。平时聊天不经过云电脑，所以不用等它们醒。
- **签到**：网关每次启动 10 秒后巡检一次，当天还没签的账号会签上。哪天打开过 App，那天就签了。
- **让它动平板**：「设置 › 手机操控」打开后，它能读屏、点按、输入。任务开始前确认一次，随时能停；密码、验证码、付款交还给你。
- **让它动云电脑**：li、li2 是它的两台云电脑，它自己用，不用先问你。
  - 看文件、改文件、跑命令、编译（STM32 相关的用 li）。
  - 打开网页并操作。你想看的话，让它「开着界面」，然后在 InstaBox 网页打开那台机器的 Computer 页签，能看着它操作，也能点进去自己接手（登录、验证码）。
  - 大的编程活可以交给云上的 Codex。Codex 在云上后台跑，平板断开也不停；做完平板 AI 会收到通知，自己检查改动和测试，再告诉你结果。

  它用的是 InstaBox 官方命令行（平板上的 `ib`）和一份技能说明，聊天里能看到它执行的每条命令和结果。睡着的机器第一次用要等十几到四十秒叫醒。
- **手动切主机只留着调试**：对话列表底部点主机名还能切到 li2、li，日常用不着。

小芯、天启已经停用（2026-11-26）。云电脑上它们的后台服务已经关掉：li 上当天停了，li2 会在你重跑装机脚本时停。它们的文件没删，想恢复就在那台上运行 `systemctl --user enable --now xin-kernel-resident.service xin-reaper.timer`。

## 第一次装

只有这几步要自己动手：

1. **装 App**：从 [GitHub Releases](https://github.com/ccch1mneyyy/dsh-go/releases/latest) 或 go.dshtui.com 下载 arm64 的 APK 安装。首次启动选「本机」，等运行环境装好。然后到「设置 › 隐私与分享」关掉「发送匿名使用统计」。
2. **建两把 InstaBox key**：li2、li 在两个不同的 InstaBox 账号里，每个账号各建一把。在后台「API keys」新建，**只勾 `machines:read` 和 `machines:write`，千万别勾删除**（`machines:delete`）。有了这两样，平板 AI 能叫醒和操作机器，但删不掉机器。
   - 以前为云端任务建过的只读 key、写 key 用不上了，可以在后台吊销。
3. **跑装机脚本**：在 App 里打开一个对话 → 全部功能 → 终端，粘贴

   ```
   apt-get update && apt-get install -y curl && curl -fsSL https://tablet.liming-work.com/setup.sh | bash
   ```

   App 里的 Linux 是精简版，一开始没有 curl，所以这一行先用 apt 装上它，再下载装机脚本。

   按提示先粘贴 li2 账号的 key，再粘贴 li 账号的 key，粘贴时屏幕上不显示。
   - 脚本会先核对这把 key 看得到那台机器才存；填反了会提示重新粘贴。不接 li 就直接回车。
   - key 存在平板的 `~/.config/liming/instabox/`（权限 600），不会出现在任何输出里。
   - 重跑时直接回车，就保留原来的 key。

   脚本装好网关和插件、InstaBox 命令行、`ib`、技能，然后到 li2、li 上把 Codex 接上那台的网关、装好浏览器。以前装过的云端任务插件和旧 key，平板上和云电脑上都会顺手删掉。最后一台一行，告诉你准备好了没有；某台在冷却就稍后再跑一次。
4. **加网关账号**：「设置 › 本机引擎」点重启。然后用平板浏览器打开 `http://127.0.0.1:8788`，用 `admin` 登录。
   - **先改密码**：平板上别的 App 也能访问这个地址。
   - 再加网关账号。平板用自己单独的账号，别和 li2 共用一个，两个 IP 同时用容易被风控。
   - 最后在「设置 → API Key」新建一个 key。网关刚装好时不检查 key，建了以后才要求带 key。
5. **加渠道**：「设置 › 模型 › 添加渠道」，按下面两张表填。
6. **打开手机操控**：「设置 › 手机操控」打开开关，按页面提示开无障碍和通知。侧载的 App 开不了无障碍时，点「无障碍开关点不动？」，按手机品牌的说明「允许受限制的设置」。
7. **新开一个对话**：技能是新对话开始时读的。
8. **加主机（可选，只为调试）**：想手动连上云电脑看看时，「切换主机 › 管理远程主机 › 添加 SSH 主机」，按下面的表填，填完关掉「连接上次使用的主机」。这一步要用那台机器的 SSH 令牌（Connect → SSH tokens），装机脚本不用它。

### 渠道

| 项 | 填 |
|---|---|
| 兼容协议 | Responses |
| Base URL | `http://127.0.0.1:8788/v1` |
| API Key | 第 4 步在面板里建的 key |
| 模型 | 点「获取模型」，勾 `deepseek-v4.1-flash`、`glm-5.4`、`kimi-k3.1-pro` |

| 模型 | 上下文 | 输入类型 | 思考档位 |
|---|---|---|---|
| DeepSeek V4.1 Flash | 1M | 文本和图片 | 不思考、低、高、最高 |
| GLM-5.4 | 1M | 文本和图片 | 低、高、最高 |
| Kimi K3.1 Pro | 1M | 文本和图片 | 低、高、最高 |

### 远程主机（调试用，li2、li 各加一台）

| 项 | 填 |
|---|---|
| 主机 | 令牌行里 `@` 右边那段 |
| 用户名 | 令牌行里 `@` 左边那段（`ibssh_…`） |
| 端口 | 22 |
| 登录 | 选密码，随便填一个（令牌本身就是用户名）。连不上就把报错截图发给 AI |
| 实例管理 | 托管启动 |
| 启动命令 | `/data/home/.local/bin/dsh-tablet`，后面**不要**加 `web` |
| 工作目录 | `/data/workspace/tablet` |

## 云电脑：平板 AI 自己操作 li、li2

直接跟平板 AI 说要做的事，比如「看看 li2 上 /data/workspace 里有什么」「在 li 上编译这个工程」「在 li2 上打开某个网页帮我查」「把这个功能交给 li2 上的 Codex 做，做完你检查」。它按技能「云电脑」里写的办法做：

- **命令和文件**：`ib exec li2 -- '命令'`（一条最长 10 分钟），`ib files` 看文件，`ib pull`、`ib push` 拷文件。长命令放到云上后台跑，平板这边等它结束，结束时 AI 会收到通知。
- **浏览器**：云上的 Playwright 命令行（`playwright-cli`），多次操作用同一个浏览器，按页面结构点按、输入。平时不显示界面；你想看、或者要你登录时，它会开着界面并告诉你去 Computer 页签。
- **交给 Codex**：`ib agent prompt li2 --provider codex …`。Codex 用那台云电脑自己的网关，可以插话、中断、接着做。Codex 说做完了不算数，平板 AI 会自己看改动、跑测试。
- **Claude Code** 在云上还没登录，现在不用；云上的 Harness 也没给平板 AI 接线。
- **规矩**：不建、不删机器和快照（key 也没这个权限）；小芯、天启的服务已关、别再打开，留下的文件不动；网关别停，Codex 要用它。

**机器睡着、冷却**：用到时自动叫醒，第一次要等十几到四十秒。免费版一轮最多 120 到 480 分钟，到了会暂停、冷却一阵，那段时间用不了那台。AI 会看状态（`ib ls` 不叫醒机器），换另一台或者告诉你几点能用。

**平板丢了**：去两个 InstaBox 账号的后台，吊销这两把 key（还有调试用的 SSH 令牌，如果建过）。

### 装好后对照

1. 让 AI「看看 li2 的 /data/workspace 里有什么」：它跑 `ib`，回你目录列表。睡着的话先等一会儿。
2. 让 AI「在 li2 上打开 example.com，告诉我页面标题，开着界面」：同时在 InstaBox 网页里打开 li2 的 Computer 页签，能看到浏览器开着。
3. 让 AI「在 li2 上新建一个小工程，让 Codex 写个 hello world 程序并跑通，你检查一下」：Codex 在云上做，做完平板 AI 收到通知，自己检查后告诉你结果。
4. 什么都不做、空闲 30 分钟：li2、li 照常睡。

## 别做的事

- **别点「设置 › 本机引擎 › 重置运行环境」**：它会删掉 `/root`，网关、账号和这里存的 key 一起没了（技能目录会保留）。真要重置，之后重跑装机脚本、重新加网关账号。
- **手动连上云电脑用完切回「本机」**：一直连着，那台就不睡；到了免费版连续运行的上限（120 到 480 分钟）会被冷却。AI 自己用云电脑不需要切主机。
- **建 key 别勾删除权限**：`machines:read` 和 `machines:write` 就够了。

## 出问题看哪里

- 网关日志在 `/root/workbuddy-gateway/logs/gateway.log`，插件日志在同目录的 `plugin.log`。
- 插件 10 分钟内重启 3 次还起不来，就先停下，等下次重启引擎再试。日志写「8788 被其他程序占用」，说明端口被别的程序占了。
- `ib` 报「没有 li 的 key」：重跑装机脚本，粘贴那台所在账号的 key。报 `missing_scope`：那把 key 少勾了 `machines:write`，新建一把再跑。
- 云上的 Codex 报 401：那台的网关 key 没接上，重跑装机脚本；还不行，看那台的 `~/.config/liming/gateway.key` 在不在。报 400、说这个 Key 不允许该模型：到那台电脑的网关面板「设置 → API Key」，给对应的 key 在「允许模型」里加上它。
- 重跑装机脚本不会重新下载网关，也不碰账号。插件在 App 里被删了、想重新挂上，先删掉 `/root/liming-gateway/.added` 再跑。
- 只想看看脚本要做什么：`curl -fsSL https://tablet.liming-work.com/setup.sh | bash -s -- --dry-run`。

## 仓库里的文件

| 文件 | 是什么 |
|---|---|
| `setup.sh` | 装机脚本 |
| `liming-gateway/` | DSH 插件：网关跟着本机引擎启停 |
| `ib.sh` | 平板上的 `ib`：按机器选那台所在账号的 key，跑 InstaBox 命令行 |
| `skills/liming-cloud-computers/SKILL.md` | 平板 AI 的技能「云电脑」：怎么用 li、li2 |
| `dsh-tablet.sh` | 放到 li、li2 上的包装脚本（手动切主机用）：读本机网关 key，固定用 Harness 内置的 `web` 配置 |
| `dsh-tablet-profile.yml` | li、li2 上 `web` 配置的网关线路，手动维护 |
| `404.html` | 缺的文件回 404，打开根地址能看到装机命令 |
| `test/` | 测试，GitHub Actions 每个 PR 和 main 都跑 |

网关程序（WorkBuddy2API-Hub）和任何账号、key 都不进仓库，因为仓库是公开的，根目录下的每个文件也都会发布出去。装机脚本只写死原版安装包的大小和 SHA-256。

改了文件合并到 main，Cloudflare Pages 一两分钟内自动上线；平板上要用新版，重跑一次装机脚本。改动记录在 [CHANGES.md](CHANGES.md)，给 AI 的说明在 [AGENTS.md](AGENTS.md)。
