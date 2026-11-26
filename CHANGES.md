# 改动记录

最新的在最上面。搬出来以前的记录（2026-11-25、11-26）在 liming-work-site 仓库的 `docs/CHANGES.md`。

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
