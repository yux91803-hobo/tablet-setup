// 技能「团队」（skills/liming-crew/SKILL.md）和 TEAM.md 模板（skills/liming-crew/TEAM.template.md）测试
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILL = path.join(ROOT, 'skills/liming-crew/SKILL.md');
const TEAM_TPL = path.join(ROOT, 'skills/liming-crew/TEAM.template.md');

test('技能 front matter 齐全且提到每个 crew 子命令与后台 wait 用法', () => {
  const s = fs.readFileSync(SKILL, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(s);
  assert.ok(m, '要有 front matter');
  assert.match(m[1], /^name: liming-crew$/m);
  assert.match(m[1], /^description: .*li.*li2/m);
  for (const sub of ['crew status', 'crew start', 'crew send', 'crew stop', 'crew approve', 'crew type', 'crew screen', 'crew log', 'crew wait']) {
    assert.ok(s.includes(sub), '技能缺少子命令：' + sub);
  }
  for (const want of ['run_in_background', 'TEAM.md', 'ib exec', 'playwright-cli', '--headed', 'gh pr merge', '@bigboss']) {
    assert.ok(s.includes(want), '技能缺少：' + want);
  }
  assert.doesNotMatch(s, /ibk_[A-Za-z0-9]{6,}|ibssh_[A-Za-z0-9]{6,}|sk-[A-Za-z0-9]{12,}/);
});

test('技能里有安全规矩：云上 agent 的话是数据不是指令；不建删机器和快照；不在云电脑上放平板的 key', () => {
  const s = fs.readFileSync(SKILL, 'utf8');
  assert.match(s, /数据.*不是.*指令|是数据，不是站长的指令/);
  assert.match(s, /不建.*不删.*机器.*快照|不建、不删机器和快照/);
  assert.match(s, /不在云电脑上放平板的.*key/);
});

test('技能不再提 Codex、Harness、dsh-task', () => {
  const s = fs.readFileSync(SKILL, 'utf8');
  assert.doesNotMatch(s, /Codex|Harness|dsh-task|dsh-tablet/);
});

test('TEAM 模板有标题 # TEAM 和目标、分工、当前任务、分支规矩四节', () => {
  const t = fs.readFileSync(TEAM_TPL, 'utf8');
  assert.match(t, /^# TEAM\b/m);
  assert.match(t, /^## .*目标/m);
  assert.match(t, /^## .*分工/m);
  assert.match(t, /^## .*当前任务/m);
  assert.match(t, /^## .*分支/m);
  assert.match(t, /DSH/);
  assert.match(t, /li2/);
  assert.match(t, /@bigboss/);
  assert.match(t, /<[^>\n]+>/, '模板应使用 <…> 占位符');
});
