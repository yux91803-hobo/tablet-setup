# 改动记录

最新的在最上面。搬出来以前的记录（2026-11-25、11-26）在 liming-work-site 仓库的 `docs/CHANGES.md`。

## 2026-11-27 crew 第一版：平板 DSH 带 li、li2 上的 Antigravity 组队干活

- **站长说的**：平时只和 DSH 聊天，由 DSH 拆活、派活、验收、汇报；两台 Antigravity 之间**不直接对话，由 DSH 居中转达**；随时能在 **DSH Go 里**看到两台 Antigravity 的真实工作过程，不想跳去 Antigravity 网页，还要能插话、叫停和批准。
- **做了什么**：
  - **清理旧云端准备**：删掉 `dsh-task.sh`、`dsh-tablet.sh`、`dsh-tablet-profile.yml`、`test/profile.test.cjs` 和旧技能 `skills/liming-cloud-computers/`；`setup.sh` 不再碰 Codex 配置、Harness、网关 key、旧租约插件和小芯/天启服务。
  - **新增 `crew.sh`**：封装平板经 `ib exec` 调用远端 hcom 的 9 个子命令——`status`（只读不叫醒，写本地缓存 `status.json`）、`screen`、`log`（中文格式化与 `--mark`）、`start`（拉起或沿用带 `crew` 标签的常驻 `agy --remote-control`，识别首次设置/服务条款/信任目录，提取远程控制链接）、`send`（文字一律走 stdin）、`stop`（发 Esc）、`type`（接管打字走 stdin）、`approve`（仅在 `blocked` 且认出审批提示时按 `y`/`n`）、`wait`（`ib exec --background` + `ib jobs wait` 并行等，任一台命中、超时或收到 SIGTERM/SIGINT 时 `ib jobs kill` 清理全部等待）。
  - **新的云端准备（`setup.sh`）**：每台云电脑固定装 `hcom==0.7.31`、向 `~/.gemini/antigravity-cli/settings.json` 写最小目录放行规则、检查 Antigravity 和 `gh` 登录、装 `playwright-cli` 和 Chromium；不碰谷歌登录令牌文件。
  - **技能「团队」与模板**：新增 `skills/liming-crew/SKILL.md` 和 `skills/liming-crew/TEAM.template.md`，写清开新项目、后台 `crew wait` 跟进、交叉审查与 `gh pr merge`、汇报和安全规矩。
  - **DSH Go 原生插件 `liming-crew/`**：状态条 `crew-strip`（每 15 秒只读本地 `status.json`，不叫醒机器，文案 ≤ 24 字）和「团队」面板 `crew`（v2 视图，打开期间每 3 秒刷新，数据 ≤ 30 KiB，含成员卡、机器切换、最近动作、终端画面要点、插话表单、叫停/网页以及审批时的允许/拒绝按钮，慢操作走延后效果）。
  - **装机脚本与文档**：`setup.sh` 下载并安装 `crew`、技能「团队」、`TEAM.template.md` 和 `liming-crew` 插件（清掉旧技能目录），问一次是否允许自动信任新目录；两台都取不到网关安装包时给出新提示并继续装其余部分；同步更新 `README.md`、`AGENTS.md`、`.github/workflows/test.yml` 和 `test/`。
- **取舍与偏离计划的地方**：
  1. **hcom 外部收件人统一用 `bigboss`**：原计划用 `@dsh` / `--from dsh`。实测 hcom 0.7.31 即使外部发件人已用 `--from dsh` 发过消息，`hcom send @dsh` 仍报错 `No active agent for @dsh`；核对 hcom 源码 `src/shared/constants.rs` 确认外部收件人写死为 `SENDER = "bigboss"`。经复核者（DSH）确认，hcom 通信统一改用 `--from bigboss` 和 `@bigboss`，`crew wait` 改为过滤该 agent 发出的消息及 `listening`/`blocked` 状态；界面、日志输出和文档里仍称 DSH。
  2. **`hcom send` 走管道不加 `--stdin`**：原计划任务 4 写了 `hcom send --from dsh @<名字> --stdin`。hcom 0.7.31 的 `hcom send` 不带 `--stdin` 参数，省略 `-- 消息` 时自动从 stdin 读取；实现改为直接管道传入 `hcom send --from bigboss @<名字>`，测试仍校验文字逐字节到达且不出现在 `ib` 和 `hcom` 参数里。
  3. **Antigravity 沙箱放行规则不用 `unsandboxed(hcom)`**：查 Antigravity 权限文档 CLI 一节确认，`unsandboxed(...)` 仅对商业/企业账号生效，个人账号（Google AI Pro）会忽略并告警。经复核者确认，改为往 `~/.gemini/antigravity-cli/settings.json` 的 `permissions.allow` 仅追加 3 条最小目录规则：`write_file(<HOME>/.hcom)`、`read_file(<HOME>/.local/bin)`、`read_file(<HOME>/.local/share/uv/tools/hcom)`；不加一刀切的 `command(hcom)`（沿用 hcom 自带的按子命令放行规则），也不放开整个 `~/.local`。
  4. **任务 1 同步清理已删旧技能引用**：任务 1 删除 `skills/liming-cloud-computers/` 后，同步去掉 `setup.sh` 对该文件的下载安装和 `test/ib.test.cjs` 里对应的 2 项测试，并在 `test/site.test.cjs` 对 `skills/` 缺失做判断，避免中间提交测试失败（新技能在任务 7/9 接回）。
  5. **测试 PATH 隔离**：`test/setup.test.cjs` 的假云电脑改为只把假命令目录和基础工具符号链接目录（`base-bin`）放进 PATH，修好 li2 上因宿主机装有 `codex`/`agy`/`gh`/`uv`/`hcom` 导致的基线测试失败。
- **参考项目和文档**：
  - hcom 0.7.31（`https://github.com/aannoo/hcom`，`src/shared/constants.rs`、`src/pty/screen.rs` 的 `is_antigravity_approval_visible`、`hcom --help`）；
  - Antigravity 文档（`https://antigravity.google/docs/permissions.md`、`sandbox.md`、`cli/reference.md`）；
  - DSH Go 插件文档与自查工具（`ccch1mneyyy/dsh-go` 的 `docs/plugins/slots.md`、`components.md`、`stability.md`、`actions.md`、`inputs.md`、`styles.md` 与 `app/assets/skills/dsh-go-plugin/kit/bin/check.mjs`）；
  - InstaBox 文档（`https://instabox.sh/docs/idle-suspend.md`、`instabox` CLI 的 `exec --background` 与 `jobs wait|logs|kill`）。
- **验证**：
  - `node --test test/*.test.cjs` 86/86 全部通过；新增和改动测试均先红后绿；
  - `shellcheck setup.sh ib.sh crew.sh` 无警告（ShellCheck 0.10.0，li2）；
  - `kit/bin/check.mjs liming-crew --load --lang zh`、`--budget panel`、`--budget strip` 均 0 错误、0 警告（仅 2 条深色模式自动对比度校正提示）；
  - `bash setup.sh --dry-run` 通过；
  - li2 上未嵌套拉起真实 crew agent，实测与平板验收待复核者（任务 11）和站长完成。
- **谁做的**：实现 Antigravity（Gemini 4 Neon XHigh，li2），复核 Claude Code。

## 2026-11-26 深夜 云电脑按机器分工：li 用 Codex、Antigravity，li2 用 Harness、Antigravity

- **站长说的**：「云上的 Claude Code 我不用，还有两台电脑上的谷歌反重力 Antigravity，我需要用，我到时候给两台电脑都登上不同谷歌会员账号。li 上目前只用 Codex 和反重力，li2 目前只用 Harness 和反重力。」
- **技能「云电脑」**：按机器分工写清楚。
  - Codex 只派给 li。
  - Harness 只用 li2，经新的 `dsh-task`。
  - Antigravity 两台都用：`agy -p … --dangerously-skip-permissions --output-format json`，用 `conversation_id` 接着做；没登录就请站长到那台的 Computer 页签登录，额度用完换另一台。
  - 云上的 Claude Code 不用。
- **Harness 不用天启那份配置**：li2 的 `headless` 配置带着天启接进来的 purge 插件和人设。装机脚本在云电脑上第一次跑时，用 `dsh --profile tablet --from-default-profile headless` 从 Harness 自带模板建一份 `tablet` 配置，补丁和 `web` 一样（本机网关线路、默认模型）。
  - 没用单独的 `DSH_HOME`：小芯装的 `~/.local/bin/dsh` 启动脚本会把它强制设回 `~/.dsh`。这是在 li 上实测踩到的。
  - `dsh-task` 设 `DSH_PERMISSION_MODE=danger-full-access`，是 Harness 自带的「完全放权、不问审批」档，和云上的 Codex、Antigravity 一样。不设的话，模板组合出的默认权限对不上任何预设，权限插件不启用，Harness 会报警告。
- **装机结果多两项**：哪台的 Harness 没装或 tablet 配置没建成；哪台没装 Antigravity、还没登录（看 `~/.gemini/antigravity-cli` 里有没有登录令牌）。
- **修了一个上次留下的问题**：上次把 `dsh-tablet-profile.yml` 开头的说明改成「手动维护」，可装机脚本是靠旧说明里的一个文件名认「这是我们自己的配置」。标记没了以后，每次重跑都多备份一份 web 配置。现在改成内容有变才备份，先写了测试看到红。
- **验证**：
  - 本地 `node --test test/*.test.cjs` 52/52；新加和改动的测试都是先红后绿。ShellCheck 0.11.0 没有警告。
  - 在 li 上实跑（用会话里 li 账号的 key）：新的云端准备脚本各项 ok，重跑不再多备份。`dsh-task --json` 建出了文件，用 sessionId 接着改也成了，没有权限警告。`agy -p … --output-format json` 建出了文件，结果里有 `conversation_id`；`agy models` 能列出模型。
  - li2 要等站长重跑装机命令（会话里没有 li2 账号的 key）。
- **谁做的**：Claude Code 实现并自查，没有独立复核。

## 2026-11-26 从网站仓库搬出来，单独发布到 tablet.liming-work.com

- **为什么**：站长问「为啥不建一个新仓库搞这个？不然你这部署还要跑之前的东西。」平板文件放在网站仓库时，只改一个平板文件，也要先跑网站的 1150 项单测和 15 组浏览器测试，再整站部署，大约 20 分钟。这里只有平板自己的 47 项测试，几十秒跑完。
- **站长做的**：建了这个仓库；在 Cloudflare 后台用 Pages 连上它，自定义域名 `tablet.liming-work.com`。Pages 发布的是仓库根目录。
- **做了什么**：
  - 从 liming-work-site 搬来 `site/tablet/` 的全部文件（放在根目录）和 4 组测试，测试只改了路径。
  - 装机命令换成 `curl -fsSL https://tablet.liming-work.com/setup.sh | bash`，插件和包装脚本里写的地址、说明也指到这里。
  - `dsh-tablet-profile.yml` 以前由网站仓库从天启的模型表生成。天启停用以后，那份模型表没有别的用处，所以这里改成手动维护；测试照旧核对格式和内容，去掉核对生成器的 2 项。
  - 加 `404.html`：缺的文件一律回 404，打开根地址能看到装机命令。
  - 密钥检查改成查整个仓库（除了 `.git`），因为根目录下的文件都会发布出去；测试里那个假令牌改成不像真令牌的写法。
  - 加 GitHub Actions：每个 PR 和 main 跑单测和 ShellCheck。
  - 说明：`README.md`（给站长）、`AGENTS.md`（给 AI，`CLAUDE.md` 引用它）。
  - 网站仓库那边删掉平板文件。旧地址 `liming-work.com/tablet/setup.sh` 只留一个提示脚本，运行后只告诉你新命令，什么都不装。
- **取舍**：
  - 用 Cloudflare Pages 发布，不用 GitHub 的原始文件地址或 jsDelivr：平板在国内，后两个不稳。Pages 连着仓库，推到 main 就上线，GitHub 里不用放 Cloudflare 的密钥。
  - 不在网站的发布流程里加「只改平板就跳过测试」的判断：那又是一层特殊规则，和刚删掉的「要不要跑小芯联调」是一类东西。
  - 根目录整个发布，README 和测试也能下载到：仓库本来就公开，这样不用改 Pages 的输出目录设置。仓库刚建时自带的 README 写的是「内容由网站仓库维护，这里只做发布」，没照这个做：那样改平板还得走网站仓库的流程。
  - 旧地址留提示脚本，不转到新地址：转过去等于两个地址都能用。也不能什么都不留：网站会把首页当成缺的文件返回，`curl … | bash` 就会把网页当命令跑。
- **验证**：本地 `node --test test/*.test.cjs` 47/47；新加和改动的 4 项（默认下载地址、装出去的文件里不再有旧地址、404 页、密钥检查覆盖测试文件）都是先红后绿。ShellCheck 0.11.0 没有警告。
- **谁做的**：Claude Code 实现并自查，没有独立复核。
