# tablet-setup

站长自用安卓平板（DSH Go）的装机文件：装机脚本、网关插件、`ib`、技能「云电脑」，以及放到 li、li2 上的两个包装脚本（`dsh-task` 给平板 AI 交任务给 Harness，`dsh-tablet` 手动切主机用）和网关线路配置。仓库根目录由 Cloudflare Pages 发布到 https://tablet.liming-work.com/ ，装机脚本从那里下载文件。站长看的说明在 [README.md](README.md)。

2026-11-26 从 liming-work-site 搬出来（站长：平板单独一个仓库，改平板不再跑网站的测试和部署）。以前的设计和取舍在 liming-work-site 仓库：`docs/superpowers/specs/2026-11-25-tablet-dshgo-design.md`（网关）、`docs/superpowers/specs/2026-11-26-tablet-cloud-direct-design.md`（平板 AI 直接操控 li、li2），以及那边 `docs/CHANGES.md` 11-25、11-26 的条目。

## 沟通

- 用中文；时间用北京时间。
- 站长不看 PR：从写代码到上线全流程交给当前接手的 AI，做完告诉站长改了什么、线上是否已更新、他要在平板上做什么。
- Claude Code 与 Codex 轮流接手。开始先读本文件和 [CHANGES.md](CHANGES.md) 最新几条，核对远端与工作区的实际进度。提交和 PR 写清实际实现与复核责任，复核者不冒充作者。
- 遇到问题先去 GitHub 看成熟开源项目怎么做，不闭门造轮子；说明里写参考了哪个项目、哪个文件。找不到再自己设计，并写明「没找到现成做法」。

## 测试

- `node --test test/*.test.cjs`（要 Node 22、python3、bash）和 `shellcheck setup.sh ib.sh dsh-tablet.sh dsh-task.sh`。GitHub Actions 在每个 PR 和 main 上跑这两样（`.github/workflows/test.yml`）。
- 新行为先写测试、看到红，再写代码。测试不过不合并；不跳过、不删测试来变绿。

## 上线

1. 从最新 main 开 `claude/...` 或 `codex/...` 分支。
2. 本地测试全过 → 开 PR → Actions 绿了，AI 自己合并。
3. 合并后 Cloudflare Pages 一两分钟内发布 main。核对线上文件和仓库逐字节一致，缺的路径回 404：

   ```
   for f in setup.sh ib.sh dsh-tablet.sh dsh-task.sh dsh-tablet-profile.yml liming-gateway/package.json liming-gateway/cordis.patch.yml liming-gateway/lib/index.js liming-gateway/lib/gateway.js skills/liming-cloud-computers/SKILL.md; do
     curl -fsS "https://tablet.liming-work.com/$f" | cmp - "$f" && echo "一致 $f"; done
   curl -s -o /dev/null -w '%{http_code}\n' https://tablet.liming-work.com/no-such-file   # 应为 404
   ```

4. 告诉站长结果。平板上要用新版的，写清让他重跑装机命令。

## 规矩

- 仓库公开，根目录下每个文件都会发布出去：不提交任何 key、令牌、网关程序和账号。装机脚本只写死原版网关安装包的大小和 SHA-256；测试里的假 key 写成不像真 key 的样子。
- 加、删、改名下载的文件，要同步 `setup.sh` 里 `fetch_file` 那几行：每个文件带一个内容标记，下到网页或错文件就停。
- `404.html` 别删：没有它，Pages 一旦有了首页就会把首页当成缺的文件、回 200。
- InstaBox：调 API 前先读 https://instabox.sh/llms.txt ；删机器或快照前必须先问站长。平板 AI 的 key 只有 `machines:read`、`machines:write`。
- 云电脑分工（站长 2026-11-26）：li 用 Codex 和 Antigravity，li2 用 Harness 和 Antigravity；云上的 Claude Code 不用。Antigravity 的谷歌账号由站长自己在两台上各登一个。
- 小芯、天启已停用（2026-11-26），云电脑上它们的服务关了、文件留着（包括 `~/.xin` 和 Harness 的 headless 配置，里面有天启的 purge 插件和人设，平板 AI 不用它）。网关 workbuddy-gateway 别停，云上的 Codex、Harness 要用它。
- li、li2 上的 `~/.local/bin/dsh` 是小芯装的启动脚本，会把 `DSH_HOME` 强制设成 `~/.dsh`；所以平板 AI 的 Harness 用 `~/.dsh/profiles/tablet` 这份单独的配置，而不是另起一个 `DSH_HOME`。
- 不要用会话里的凭据去登录站长的网关面板。
