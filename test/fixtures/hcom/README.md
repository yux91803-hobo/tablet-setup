# hcom 输出样例

给 crew 和插件的测试用。2026-11-27 在 li2 上采集（hcom 0.7.31，Antigravity CLI 1.5.18），账号信息、机器指纹已去掉。

- `list.json`：`hcom list --json`，一个常驻 agent（当时没打标签）。
- `term-idle.json`：`hcom term <名字> --json`，agent 闲着、输入框是空的。
- `events.jsonl`：`hcom events --last 14`，含收消息、跑命令、回消息、变空闲。外部发件人当时叫 bigboss，crew 里改用 dsh。
- `term-onboarding.json`、`term-terms.json`、`term-trust.json`、`term-remote.json`：按当天看到的屏幕整理的四种画面：首次设置选配色、服务条款与数据使用、信任目录、开好远程控制（链接换成了全 0）。
