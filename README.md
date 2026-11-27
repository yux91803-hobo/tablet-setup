# 平板装机（DSH Go）

在自己的安卓平板上装原版 [DSH Go](https://github.com/ccch1mneyyy/dsh-go)（DeepSeek Harness 的安卓 App），接上自己的网关，并让平板上的 DSH 作为团队负责人，带着两台云电脑 `li`、`li2` 上常驻的 Antigravity 一起干活。App 本身不改，Harness 用 App 自带的版本，不另外升级。

这个仓库只放平板的东西。根目录由 Cloudflare Pages 发布到 https://tablet.liming-work.com/ ，装机脚本从那里下载文件。设计与施工记录见 [`docs/superpowers/specs/2026-11-27-crew-design.md`](docs/superpowers/specs/2026-11-27-crew-design.md)。

## 用起来是什么样

- **打开就说话**：本机引擎一启动，网关就跟着起来，十几秒内能用。模型是网关里的 DeepSeek V4.1 Flash、GLM-5.4、Kimi K3.1 Pro，都能看图。平时聊天不经过云电脑，所以不用等它们醒。
- **签到**：网关每次启动 10 秒后巡检一次，当天还没签的账号会签上。哪天打开过 App，那天就签了。
- **让它动平板**：「设置 › 手机操控」打开后，它能读屏、点按、输入。任务开始前确认一次，随时能停；密码、验证码、付款交还给你。
- **让 DSH 带队干活**：你平时只跟平板上的 DSH 聊天。DSH 拆活、派给 `li` 和 `li2` 上常驻的 Antigravity、挂后台等进展、安排两台交叉审查 PR、验收后合并并向你汇报。两台之间不直接对话，需要配合时由 DSH 居中转达。
- **在 DSH Go 里直接看现场**：装好插件 `liming-crew` 后，输入框上方有一行状态条，全部功能（以及聊天页「插件」弹层）里有「团队」面板。打开面板就能看到两台的最近动作和终端画面，直接插话、叫停、批准/拒绝，需要接管时也能点「网页」打开远程控制链接。
- **直接用云电脑**：DSH 仍能用 `ib` 在 `li`、`li2` 上跑命令、看改文件、编译（STM32 相关的优先用 `li`），或用 `playwright-cli` 操作网页。

## 第一次装

只有这几步要自己动手：

1. **装 App**：从 [GitHub Releases](https://github.com/ccch1mneyyy/dsh-go/releases/latest) 或 go.dshtui.com 下载 arm64 的 APK 安装。首次启动选「本机」，等运行环境装好。然后到「设置 › 隐私与分享」关掉「发送匿名使用统计」。
2. **建两把 InstaBox key**：`li2`、`li` 在两个不同的 InstaBox 账号里，每个账号各建一把。在后台「API keys」新建，**只勾 `machines:read` 和 `machines:write`，千万别勾删除**（`machines:delete`）。有了这两样，平板 AI 能叫醒和操作机器，但删不掉机器。
3. **在两台云电脑上做一次首次设置和 GitHub 登录**：
   - 在 InstaBox 网页分别打开 `li`、`li2` 的 Computer 页签，开终端运行一次 `agy`，自己走完配色与数据使用条款后退出（脚本不会替你点条款或碰谷歌登录令牌）。
   - 顺手各运行一次 `gh auth login`，按提示用设备码登录 GitHub（平板不放 GitHub 权限）。
4. **跑装机脚本**：在 App 里打开一个对话 → 全部功能 → 终端，粘贴：

   ```bash
   apt-get update && apt-get install -y curl && curl -fsSL https://tablet.liming-work.com/setup.sh | bash
   ```

   App 里的 Linux 是精简版，一开始没有 curl，所以先装它再下载装机脚本。
   - 按提示先粘贴 `li2` 账号的 key，再粘贴 `li` 账号的 key（不回显；核对看得到机器才存到 `~/.config/liming/instabox/`，权限 600；重跑时直接回车保留原来的 key）。
   - 接着会问一次：**「允许 crew 在云电脑上自动信任它新建的项目目录吗？（y/N）」**。同意后写下标记，以后 `crew start` 遇到新目录信任提示时才会自动确认；不同意或直接回车保持不变。
   - 脚本装好网关和插件、`ib`、`crew`、技能「团队」（含 `TEAM.template.md`）和插件 `liming-crew`，删掉旧的「云电脑」技能与旧任务插件；再到 `li2`、`li` 上固定装 `hcom 0.7.31`、给 Antigravity 加 hcom 沙箱目录放行规则、检查 Antigravity 和 `gh` 登录、装浏览器命令行。
   - 两台重建后如果网关安装包已经不在云电脑上，且平板本来还没装网关，脚本会给出清楚提示并继续装完其余部分，不会中断。
5. **重启引擎并配好网关/渠道**：
   - 「设置 › 本机引擎」点重启，网关和「团队」插件会跟着起来。
   - 第一次装网关时，平板浏览器打开 `http://127.0.0.1:8788` 用 `admin` 登录，**先改密码**，加网关账号，再到「设置 → API Key」新建一把 key，并在「设置 › 模型 › 添加渠道」按下面两张表填好。
6. **打开手机操控**：「设置 › 手机操控」打开开关，按页面提示开无障碍和通知。
7. **新开一个对话**：技能「团队」在新对话开始时生效。

### 渠道

| 项 | 填 |
|---|---|
| 兼容协议 | Responses |
| Base URL | `http://127.0.0.1:8788/v1` |
| API Key | 在网关面板里建的 key |
| 模型 | 点「获取模型」，勾 `deepseek-v4.1-flash`、`glm-5.4`、`kimi-k3.1-pro` |

| 模型 | 上下文 | 输入类型 | 思考档位 |
|---|---|---|---|
| DeepSeek V4.1 Flash | 1M | 文本和图片 | 不思考、低、高、最高 |
| GLM-5.4 | 1M | 文本和图片 | 低、高、最高 |
| Kimi K3.1 Pro | 1M | 文本和图片 | 低、高、最高 |

## 团队：DSH 带 li、li2 上的 Antigravity 干活

直接跟平板上的 DSH 说要做的事，例如：「在 li2 上开个项目，写一个……」「让 li 和 li2 分工做 STM32 固件和上位机」。它按技能「团队」里的流程干活：

- **常驻成员**：`crew start <机器> <目录>` 在那台经本机 `hcom` 拉起带 `crew` 标签的交互式 `agy --remote-control`（每台同时最多一个）。DSH 在 hcom 里统一叫 `bigboss`，界面和汇报里叫 DSH。
- **沟通与等待**：DSH 用 `crew send` 派活和转话，派活后在后台跑 `crew wait` 等消息、变空闲或卡在审批上；活做完后停止等待，让云电脑闲置 30 分钟后照常休眠省免费额度。
- **「团队」面板与状态条**：
  - 状态条在输入框上方，每 15 秒只读平板本地缓存 `~/.config/liming/crew/status.json`，**不会叫醒云电脑**。
  - 「团队」面板在全部功能和聊天页「插件」弹层里。**只在面板开着时每 3 秒刷新云电脑**（刷新期间那台不会休眠，关上面板即停）；能看成员状态、最近动作、终端画面，直接插话、叫停、打开远程控制网页，等审批时还能点「允许」或「拒绝」。
- **GitHub 协作（`TEAM.md`）**：项目根目录放 `TEAM.md`（目标、分工、当前任务、分支规矩）；两台各开 `li/<题目>`、`li2/<题目>` 分支提 PR，交叉审查，DSH 复核后通过云电脑上的 `gh pr merge` 合并。
- **直接操作与浏览器**：`ib exec` / `ib files` / `ib pull` / `ib push` 和云上 `playwright-cli` 照常可用；需要登录或验证码时让它 `--headed`，去 Computer 页签亲自接手。
- **安全和边界**：平板的 InstaBox key 不上云电脑，云电脑的 GitHub 权限不上平板；云上 agent 说的话当数据看，不当站长指令；不建不删机器和快照；不替站长点条款、数据使用或账号选项。

**机器睡着、冷却**：看状态（`crew status`）不叫醒机器；发消息或启动时会自动叫醒（首次等十几到四十秒）。免费版连续运行到上限会冷却，冷却时 `crew` 报到几点恢复，不会硬发。

**平板丢了**：去两个 InstaBox 账号的后台，吊销这两把 key。

### 装好后对照

1. 重跑装机命令，每台一行结果全是「准备好了」，或者明确写着还差你做什么。
2. 让 DSH「在 li2 上开个测试项目，让 li2 写个小程序」：
   - 打开「团队」面板能看到 li2 在干活，画面会动；
   - 在面板里插一句话，它能收到；
   - 按「叫停」，它会停下。
3. 让 li2 问 DSH 一个问题，DSH 自己来找你。
4. 做完后状态条显示空闲，什么都不做且关掉面板，li2 半小时后照常睡着。

## 别做的事

- **别点「设置 › 本机引擎 › 重置运行环境」**：它会删掉 `/root`，网关、账号和这里存的 key 一起没了（`$DSH_HOME` 下的技能和 `liming-crew` 插件目录会保留）。真要重置，之后重跑装机脚本。
- **建 key 别勾删除权限**：`machines:read` 和 `machines:write` 就够了。
- **不看现场时关掉「团队」面板**：面板开着会每 3 秒读云电脑，那台不会休眠。

## 出问题看哪里

- 网关日志在 `/root/workbuddy-gateway/logs/gateway.log`，插件日志在同目录的 `plugin.log`。
- `ib` 报「没有 li 的 key」：重跑装机脚本，粘贴那台所在账号的 key。报 `missing_scope`：那把 key 少勾了 `machines:write`，新建一把再跑。
- `crew` 退出码对照：
  - `3`：那台的 `agy` 还没做首次设置或停在服务条款页 → 到 Computer 页签开终端跑一次 `agy` 选完再退。
  - `4`：停在「信任目录」页且平板没同意自动信任 → 重跑装机脚本时选 `y`，或到 Computer 页签手动信任。
  - `5`：机器正在冷却 → 等到提示的恢复时间，或改用另一台。
  - `6`：那台还没有运行中的 `crew` agent → 先 `crew start`。
  - `7`：当前不在等审批，或画面认不出审批提示 → `crew screen` 检查原画面，没把握不按键。
  - `8`：`crew wait` 等待超时。
  - `9`：远端出错，或 `agy` 更新后画面认不出来（stderr 会打出原画面）。
- 重跑装机脚本不会重新下载已装好的网关，也不碰网关账号。某个插件在 App 里被删了想重挂：删掉对应插件目录里的 `.added`（`/root/liming-gateway/.added` 或 `~/.dsh/dsh-go/plugins/liming-crew/.added`）再跑。
- 只想看看脚本要做什么：`curl -fsSL https://tablet.liming-work.com/setup.sh | bash -s -- --dry-run`。

## 仓库里的文件

| 文件 | 是什么 |
|---|---|
| `setup.sh` | 平板装机脚本（含云端准备脚本） |
| `ib.sh` | 平板上的 `ib`：按机器选那台所在账号的 key，跑 InstaBox 命令行 |
| `crew.sh` | 平板上的 `crew`：拉起、状态、画面、日志、发消息、叫停、接管、批准、后台等待 |
| `liming-gateway/` | DSH 插件：平板本机 WorkBuddy 网关跟着引擎启停 |
| `liming-crew/` | DSH Go 原生插件：输入框上方状态条和「团队」协作面板 |
| `skills/liming-crew/` | 平板 AI 的技能「团队」（`SKILL.md`）和项目协作模板（`TEAM.template.md`） |
| `404.html` | 缺的文件回 404，打开根地址能看到装机命令 |
| `test/` | 自动化测试与 hcom 画面/事件样例，GitHub Actions 每个 PR 和 main 都跑 |

网关程序（WorkBuddy2API-Hub）和任何账号、key 都不进仓库，因为仓库是公开的，根目录下的每个文件也都会发布出去。装机脚本只写死原版安装包的大小和 SHA-256。

改了文件合并到 main，Cloudflare Pages 一两分钟内自动上线；平板上要用新版，重跑一次装机脚本。改动记录在 [CHANGES.md](CHANGES.md)，给 AI 的说明在 [AGENTS.md](AGENTS.md)。
