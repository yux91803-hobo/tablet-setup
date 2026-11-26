// 平板（DSH Go）手动连 li、li2 时用的 web 配置补丁和包装脚本（设计：liming-work-site 仓库 docs/superpowers/specs/2026-11-25-tablet-dshgo-design.md §4.4）
// 配置补丁以前由网站仓库从天启的模型表生成；搬到这个仓库后改成手动维护，这里核对它的格式和该有的内容。
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const yml=path.join(root,'dsh-tablet-profile.yml');
const wrapper=path.join(root,'dsh-tablet.sh');
const task=path.join(root,'dsh-task.sh');
const profile=()=>fs.readFileSync(yml,'utf8');
const tmp=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'tablet-profile-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};

test('线路和模型：网关地址、key 走环境变量、三个模型都能看图、上下文 100 万',()=>{
  const text=profile();
  for(const want of ['- id: llm-pi-ai','      xin-gateway:','        apiKeyEnv: XIN_HARNESS_KEY','        api: openai-responses',
    '        baseURL: "http://127.0.0.1:8788/v1"','          - id: "deepseek-v4.1-flash"','          - id: "glm-5.4"','          - id: "kimi-k3.1-pro"',
    '              off: none','              max: max','- id: agent-default-model','    provider: xin-gateway','    model: "deepseek-v4.1-flash"','    reasoningEffort: high'])
    assert.ok(text.includes(want+'\n'),'缺少：'+want);
  assert.equal(text.match(/contextWindow: 1000000\n/g)?.length,3);
  assert.equal(text.match(/input: \["text","image"\]\n/g)?.length,3);
  assert.equal(text.match(/off: none\n/g)?.length,1,'只有 DeepSeek 能关掉思考');
  assert.ok(!text.includes('\t'),'YAML 里不能有制表符');
});

test('不带人设、purge、REA，也不写 key：平板那边只要线路和默认模型',()=>{
  const text=profile();
  for(const no of ['personaPrefix','system-prompt','dsh-purge','mcp-rea','apiKey:'])assert.ok(!text.includes(no),'不该有：'+no);
});

function fakeHome(t,key){
  const home=tmp(t);fs.mkdirSync(path.join(home,'.local/bin'),{recursive:true});
  fs.writeFileSync(path.join(home,'.local/bin/dsh'),'#!/bin/sh\nprintf \'%s\\n\' "$@" > "$HOME/args.txt"\nprintf \'%s\' "$XIN_HARNESS_KEY" > "$HOME/key-seen.txt"\nprintf \'%s\' "${DSH_PERMISSION_MODE-unset}" > "$HOME/perm-seen.txt"\n',{mode:0o755});
  if(key!=null){fs.mkdirSync(path.join(home,'.xin'));fs.writeFileSync(path.join(home,'.xin/harness.key'),key,{mode:0o600});}
  return home;
}

test('包装脚本把 DSH Go 追加的参数原样传给 dsh，固定用内置的 web 配置（dsh web 就是 dsh --profile web）；key 只进环境变量、不出现在输出里',t=>{
  assert.equal(spawnSync('sh',['-n',wrapper]).status,0);
  const home=fakeHome(t,'test-key-123\n');
  const r=spawnSync('sh',[wrapper,'--host','127.0.0.1','--port','0','--no-open','--note','a b'],{env:{PATH:process.env.PATH,HOME:home},encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(fs.readFileSync(path.join(home,'args.txt'),'utf8').split('\n').slice(0,-1),
    ['--profile','web','--host','127.0.0.1','--port','0','--no-open','--note','a b']);
  assert.equal(fs.readFileSync(path.join(home,'key-seen.txt'),'utf8'),'test-key-123');
  assert.ok(!(r.stdout+r.stderr).includes('test-key-123'));
});

test('这台电脑没有网关 key 时退出码 78、说明缺哪个文件，不启动 dsh',t=>{
  const home=fakeHome(t,null);
  const r=spawnSync('sh',[wrapper,'web'],{env:{PATH:process.env.PATH,HOME:home},encoding:'utf8'});
  assert.equal(r.status,78);assert.match(r.stderr,/harness\.key/);
  assert.ok(!fs.existsSync(path.join(home,'args.txt')));
});

test('dsh-task：在当前目录交给 Harness 一个任务，用单独的 tablet 配置、完全放权不问审批（Harness 自带的 danger-full-access 档）；参数原样接在后面，key 只进环境变量',t=>{
  assert.equal(spawnSync('sh',['-n',task]).status,0);
  const home=fakeHome(t,'test-key-456\n');
  const r=spawnSync('sh',[task,'--session-id','s-1','做 a b'],{env:{PATH:process.env.PATH,HOME:home},encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(fs.readFileSync(path.join(home,'args.txt'),'utf8').split('\n').slice(0,-1),
    ['--profile','tablet','--session-id','s-1','做 a b']);
  assert.equal(fs.readFileSync(path.join(home,'key-seen.txt'),'utf8'),'test-key-456');
  // 不设这个，自带模板组合出的默认权限对不上任何预设，权限插件不启用（li 上 rc.3 实测）
  assert.equal(fs.readFileSync(path.join(home,'perm-seen.txt'),'utf8'),'danger-full-access');
  assert.ok(!(r.stdout+r.stderr).includes('test-key-456'));
});

test('dsh-task：这台电脑没有网关 key 时退出码 78、说明缺哪个文件，不启动 dsh',t=>{
  const home=fakeHome(t,null);
  const r=spawnSync('sh',[task,'x'],{env:{PATH:process.env.PATH,HOME:home},encoding:'utf8'});
  assert.equal(r.status,78);assert.match(r.stderr,/harness\.key/);
  assert.ok(!fs.existsSync(path.join(home,'args.txt')));
});
