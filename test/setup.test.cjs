// 装机脚本 setup.sh（设计：liming-work-site 仓库 docs/superpowers/specs/2026-11-26-tablet-cloud-direct-design.md；网关部分沿用 2026-11-25-tablet-dshgo-design.md）
// 假 instabox：按 INSTABOX_API_KEY 认是哪个账号（看不到别的账号的机器）；get 回机器信息；pull 给测试 zip（有 no-zip-<机器> 标记时报错）；
// exec --stdin <机器> -- bash -s 在那台自己的临时 HOME 里真的执行装机脚本送去的云端准备脚本（有 cooling-<机器> 标记时报冷却）。
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),tablet=root,setup=path.join(tablet,'setup.sh');
const tmp=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'tablet-setup-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
const KEYS={li2:'ibk_li2_SECRET_aaaa1111',li:'ibk_li_SECRET_bbbb2222'};
const REMOTE_ZIP='/data/workbuddy-gateway/releases/workbuddy2api-hub-v2.0.8.zip';
const FAKE_IB=`#!/usr/bin/env bash
acct=unknown
[ "\${INSTABOX_API_KEY-}" = "$KEY_LI2" ] && acct=li2
[ "\${INSTABOX_API_KEY-}" = "$KEY_LI" ] && acct=li
printf '%s %s\\n' "$acct" "$*" >> "$FAKE_DIR/instabox.log"
case "$1" in
  --version) echo "instabox 0.8.407"; exit 0;;
  get) [ "$acct" = "$2" ] || { echo '{"error":{"code":"not_found"}}' >&2; exit 1; }; printf '{"id":"m_%s","name":"%s","state":"suspended"}\\n' "$2" "$2";;
  pull) [ "$acct" = "$2" ] || exit 1; [ -f "$FAKE_DIR/no-zip-$2" ] && { echo "pull: no such file" >&2; exit 1; }; cp "$FAKE_ZIP" "$4";;
  exec) m=$2; [ "$acct" = "$m" ] || exit 1
    [ -f "$FAKE_DIR/cooling-$m" ] && { echo "error: $m is cooling down" >&2; exit 1; }
    HOME="$FAKE_DIR/home-$m" PATH="$FAKE_DIR/home-$m/bin:$PATH" LIMING_REMOTE_WS="$FAKE_DIR/ws-$m" bash -s;;
  *) echo "unexpected: $*" >&2; exit 2;;
esac
`;
function makeZip(file){
  const files={'wb-proxy/wb_proxy.py':'print("fake")\n','wb-proxy/bin/wb-tls-bridge-linux-arm64':'bin\n','wb-proxy/start-wb-proxy.sh':'#!/bin/sh\n'};
  const r=spawnSync('python3',['-c','import json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w")\nfor k,v in json.loads(sys.argv[2]).items(): z.writestr(k,v)\nz.close()',file,JSON.stringify(files)]);
  assert.equal(r.status,0,String(r.stderr));
  const buf=fs.readFileSync(file);return {size:String(buf.length),sha:crypto.createHash('sha256').update(buf).digest('hex')};
}
// 一台「云电脑」的 HOME：有 Harness（dsh 记参数）、网关 key、codex（可选配置）、npm（装 playwright-cli 时放一个假的进 bin）
function remoteHome(dir,m,{codexKey=false,codexConfig=null,codex=true,agy='logged-in'}={}){
  const h=path.join(dir,'home-'+m),bin=path.join(h,'bin');
  for(const p of ['.local/bin','.xin','bin'])fs.mkdirSync(path.join(h,p),{recursive:true});
  // 假 Harness：记参数；--from-default-profile 时像真的一样在 ~/.dsh/profiles/<名字> 建出模板
  fs.writeFileSync(path.join(h,'.local/bin/dsh'),'#!/bin/sh\necho "$*" >> "$HOME/dsh.log"\nn=\nwhile [ $# -gt 0 ]; do case "$1" in --profile) n=$2; shift;; --from-default-profile) f=1;; esac; shift; done\n[ -n "${f:-}" ] && [ -n "$n" ] && mkdir -p "$HOME/.dsh/profiles/$n" && echo "# shipped headless" > "$HOME/.dsh/profiles/$n/cordis.yml"\nexit 0\n',{mode:0o755});
  fs.writeFileSync(path.join(h,'.xin/harness.key'),'remote-harness-key\n',{mode:0o600});
  if(codexKey)fs.writeFileSync(path.join(h,'.xin/codex.key'),'remote-codex-key\n',{mode:0o600});
  if(codex)fs.writeFileSync(path.join(bin,'codex'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  // Antigravity 命令行装在 ~/.local/bin/agy；登录后 ~/.gemini/antigravity-cli 里有令牌文件
  if(agy){fs.writeFileSync(path.join(h,'.local/bin/agy'),'#!/bin/sh\nexit 0\n',{mode:0o755});
    if(agy==='logged-in'){fs.mkdirSync(path.join(h,'.gemini/antigravity-cli'),{recursive:true});fs.writeFileSync(path.join(h,'.gemini/antigravity-cli/antigravity-oauth-token'),'fake-token\n',{mode:0o600});}}
  if(codexConfig!==null){fs.mkdirSync(path.join(h,'.codex'),{recursive:true});fs.writeFileSync(path.join(h,'.codex/config.toml'),codexConfig,{mode:0o600});}
  fs.writeFileSync(path.join(bin,'npm'),`#!/bin/sh\necho "npm $*" >> "$HOME/remote.log"\ncase "$*" in *@playwright/cli*) printf '#!/bin/sh\\necho "playwright-cli $*" >> "$HOME/remote.log"\\n' > "${bin}/playwright-cli"; chmod +x "${bin}/playwright-cli";; esac\n`,{mode:0o755});
  return h;
}
const LI_CODEX='model = "deepseek-v4.1-flash"\nmodel_provider = "workbuddy"\n\n[model_providers.workbuddy]\nname = "WorkBuddy CN (li gateway)"\nbase_url = "http://127.0.0.1:8788/v1"\nwire_api = "responses"\n\n[features]\nx = true\n\n[mcp_servers.rea]\ncommand = "/x/rea.mjs"\n';
function rig(t,{input=[KEYS.li2,KEYS.li]}={}){
  const d=tmp(t),bin=path.join(d,'bin');fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'instabox'),FAKE_IB,{mode:0o755});
  fs.writeFileSync(path.join(bin,'dsh'),'#!/bin/sh\necho "$*" >> "$FAKE_DIR/dsh.log"\n',{mode:0o755});
  fs.writeFileSync(path.join(bin,'apt-get'),'#!/bin/sh\necho "$*" >> "$FAKE_DIR/apt.log"\n',{mode:0o755});
  fs.writeFileSync(path.join(bin,'npm'),'#!/bin/sh\necho "$*" >> "$FAKE_DIR/npm.log"\n',{mode:0o755});
  fs.writeFileSync(path.join(d,'tty'),input.join('\n')+'\n');
  const zip=path.join(d,'gw.zip'),z=makeZip(zip);
  remoteHome(d,'li2');remoteHome(d,'li',{codexKey:true,codexConfig:LI_CODEX});
  const home=path.join(d,'tablet-home');fs.mkdirSync(home);
  const env={PATH:process.env.PATH,HOME:home,FAKE_DIR:d,FAKE_ZIP:zip,KEY_LI2:KEYS.li2,KEY_LI:KEYS.li,LIMING_BASE:'file://'+tablet,
    LIMING_GW_DIR:path.join(d,'gw'),LIMING_PLUGIN_DIR:path.join(d,'plugin'),LIMING_IB_DIR:path.join(d,'keys'),LIMING_BIN_DIR:path.join(d,'usr-bin'),
    LIMING_SKILL_DIR:path.join(d,'skills/liming-cloud-computers'),LIMING_OLD_CLOUD_PLUGIN_DIR:path.join(d,'old-cloud-plugin'),LIMING_OLD_CLOUD_DIR:path.join(d,'old-cloud'),
    LIMING_INSTABOX:path.join(bin,'instabox'),LIMING_NPM:path.join(bin,'npm'),LIMING_DSH:path.join(bin,'dsh'),LIMING_APT:path.join(bin,'apt-get'),
    LIMING_TTY:path.join(d,'tty'),LIMING_ZIP_SIZE:z.size,LIMING_ZIP_SHA256:z.sha};
  const run=(...args)=>spawnSync('bash',[setup,...args],{env,encoding:'utf8',input:''});
  const lib=(code,...args)=>spawnSync('bash',['-c','source "$0"; '+code,setup,...args],{env:{...env,LIMING_SETUP_LIB:'1'},encoding:'utf8'});
  const read=f=>{try{return fs.readFileSync(path.join(d,f),'utf8');}catch{return '';}};
  const ibLog=()=>read('instabox.log').split('\n').filter(Boolean);
  return {d,env,run,lib,read,ibLog,zip,z,home};
}
const mode=f=>fs.statSync(f).mode&0o777;
const SECRETS=[...Object.values(KEYS),'remote-harness-key','remote-codex-key'];
const noSecrets=(r,extra=[])=>{const all=r.stdout+r.stderr;for(const s of [...SECRETS,...extra])assert.ok(!all.includes(s),'输出里不该有 '+s);};

test('语法对、不含任何令牌或 key；默认校验值就是从 li 核对过的那份安装包',()=>{
  assert.equal(spawnSync('bash',['-n',setup]).status,0);
  // 仓库根目录整个由 Cloudflare Pages 发布，所以除了 .git 都要查（测试里的假 key 也别写成真 key 的样子）
  const walk=d=>fs.readdirSync(d,{withFileTypes:true}).filter(e=>!(d===root&&e.name==='.git')).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
  for(const f of walk(tablet)){const s=fs.readFileSync(f,'utf8');
    for(const re of [/ibssh_[A-Za-z0-9]{8,}/,/ibk_[A-Za-z0-9]{8,}/,/sk-[A-Za-z0-9]{16,}/])assert.ok(!re.test(s),path.relative(root,f)+' 里像有密钥：'+re);}
  const r=spawnSync('bash',['-c','source "$0"; echo "$ZIP_SIZE $ZIP_SHA256 $REMOTE_ZIP $INSTABOX_VERSION"',setup],{env:{PATH:process.env.PATH,LIMING_SETUP_LIB:'1'},encoding:'utf8'});
  assert.equal(r.stdout.trim(),'22962873 b322c73b9a18f09c6560bff0e4b748e9acdc26272c339b4f5fce2413bb500cc6 '+REMOTE_ZIP+' 0.8.407');
  assert.doesNotMatch(fs.readFileSync(setup,'utf8'),/liming-lease\/|CLOUD_FILES|LEASE_FILES|ibssh_/,'不再装旧插件、不再要 SSH 令牌');
});

test('默认从 https://tablet.liming-work.com 下载（这个仓库由 Cloudflare Pages 发布到那里）',()=>{
  const r=spawnSync('bash',['-c','source "$0"; echo "$BASE"',setup],{env:{PATH:process.env.PATH,LIMING_SETUP_LIB:'1'},encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'https://tablet.liming-work.com');
  assert.match(fs.readFileSync(setup,'utf8'),/curl -fsSL https:\/\/tablet\.liming-work\.com\/setup\.sh \| bash/,'开头的用法说明也是新地址');
});

test('下载到的是网站首页（不存在的路径回首页）或内容不对就停，不留半截文件',t=>{
  const {d,lib}=rig(t),fake=path.join(d,'site');fs.mkdirSync(fake);
  fs.writeFileSync(path.join(fake,'package.json'),'\n  <!doctype html><title>Liming</title> "name": "liming-gateway"');
  fs.writeFileSync(path.join(fake,'other.js'),'console.log(1)\n');
  for(const [name,marker] of [['package.json','"name": "liming-gateway"'],['other.js','createSupervisor'],['missing.js','x']]){
    const dest=path.join(d,'out-'+name),r=lib('fetch_file "$1" "$2" "$3"','file://'+path.join(fake,name),dest,marker);
    assert.notEqual(r.status,0,name);assert.ok(!fs.existsSync(dest),name);
    assert.deepEqual(fs.readdirSync(d).filter(f=>f.startsWith('out-')),[]);}
  const ok=lib('fetch_file "$1" "$2" "$3"','file://'+path.join(tablet,'liming-gateway/lib/gateway.js'),path.join(d,'g.js'),'createSupervisor');
  assert.equal(ok.status,0,ok.stderr);
});

test('安装包大小或哈希不对就不装，已有的 current 原样不动',t=>{
  const {env,lib,zip,z}=rig(t),gw=env.LIMING_GW_DIR;
  const bad=spawnSync('bash',['-c','source "$0"; install_gateway "$1"',setup,zip],{env:{...env,LIMING_SETUP_LIB:'1',LIMING_ZIP_SIZE:String(Number(z.size)-1)},encoding:'utf8'});
  assert.notEqual(bad.status,0);assert.ok(!fs.existsSync(path.join(gw,'current')));
  fs.mkdirSync(path.join(gw,'old'),{recursive:true});fs.symlinkSync('old',path.join(gw,'current'));
  const again=spawnSync('bash',['-c','source "$0"; install_gateway "$1"',setup,zip],{env:{...env,LIMING_SETUP_LIB:'1',LIMING_ZIP_SHA256:'f'.repeat(64)},encoding:'utf8'});
  assert.notEqual(again.status,0);assert.equal(fs.readlinkSync(path.join(gw,'current')),'old');
  assert.equal(lib('verify_zip "$1"',zip).status,0,'对的安装包能过');
});

test('整套装一遍：两把 key 存好、网关经 InstaBox 从 li2 取、ib 和技能装上、两台云电脑准备好，输出里没有 key',t=>{
  const {d,env,run,read,ibLog}=rig(t);
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  // key：目录 700、文件 600，各自账号的那把
  assert.equal(mode(env.LIMING_IB_DIR),0o700);
  for(const m of ['li2','li']){const f=path.join(env.LIMING_IB_DIR,m+'.key');assert.equal(mode(f),0o600,m);assert.equal(fs.readFileSync(f,'utf8').trim(),KEYS[m]);}
  assert.ok(ibLog().includes('li2 get li2 --json')&&ibLog().includes('li get li --json'),'先用 get 核对 key（不会叫醒机器）');
  // 网关：从 li2 拉安装包
  assert.ok(ibLog().some(l=>l.startsWith('li2 pull li2 '+REMOTE_ZIP+' ')));
  assert.ok(fs.existsSync(path.join(env.LIMING_GW_DIR,'current/wb_proxy.py')));
  assert.equal(read('dsh.log'),'plugin --profile web add '+env.LIMING_PLUGIN_DIR+'\n');
  // ib 和技能
  assert.equal(fs.readFileSync(path.join(env.LIMING_BIN_DIR,'ib'),'utf8'),fs.readFileSync(path.join(tablet,'ib.sh'),'utf8'));
  assert.equal(mode(path.join(env.LIMING_BIN_DIR,'ib')),0o755);
  assert.equal(fs.readFileSync(path.join(env.LIMING_SKILL_DIR,'SKILL.md'),'utf8'),fs.readFileSync(path.join(tablet,'skills/liming-cloud-computers/SKILL.md'),'utf8'));
  // 两台云电脑：经 exec --stdin 跑准备脚本
  for(const m of ['li2','li'])assert.ok(ibLog().some(l=>l.startsWith(m+' exec '+m+' --stdin')&&l.endsWith('-- bash -s')),m);
  for(const m of ['li2','li']){
    const h=path.join(d,'home-'+m);
    assert.equal(fs.readFileSync(path.join(h,'.local/bin/dsh-tablet'),'utf8'),fs.readFileSync(path.join(tablet,'dsh-tablet.sh'),'utf8'),m+' 手动切主机用的包装脚本照旧');
    assert.equal(fs.readFileSync(path.join(h,'.dsh/profiles/web/cordis.patch.yml'),'utf8'),fs.readFileSync(path.join(tablet,'dsh-tablet-profile.yml'),'utf8'));
    // 平板 AI 交给 Harness 的任务：单独的 tablet 配置（Harness 自带的 headless 模板 + 网关线路）和 dsh-task
    assert.match(fs.readFileSync(path.join(h,'dsh.log'),'utf8'),/^--profile tablet --from-default-profile headless --dump-config$/m,m);
    assert.equal(fs.readFileSync(path.join(h,'.dsh/profiles/tablet/cordis.patch.yml'),'utf8'),fs.readFileSync(path.join(tablet,'dsh-tablet-profile.yml'),'utf8'),m);
    assert.equal(fs.readFileSync(path.join(h,'.local/bin/dsh-task'),'utf8'),fs.readFileSync(path.join(tablet,'dsh-task.sh'),'utf8'),m);
    assert.equal(mode(path.join(h,'.local/bin/dsh-task')),0o700,m);
    assert.equal(mode(path.join(h,'.config/liming/gateway.key')),0o600);
    assert.match(fs.readFileSync(path.join(h,'.profile'),'utf8'),/export LIMING_GATEWAY_KEY=/);
    const log=fs.readFileSync(path.join(h,'remote.log'),'utf8');
    assert.match(log,/npm i -g @playwright\/cli@0\.1\.25/);assert.match(log,/playwright-cli install-browser chromium/);
  }
  assert.equal(fs.readFileSync(path.join(d,'home-li/.config/liming/gateway.key'),'utf8'),'remote-codex-key\n','li 有 Codex 专用的 key 就用它');
  assert.equal(fs.readFileSync(path.join(d,'home-li2/.config/liming/gateway.key'),'utf8'),'remote-harness-key\n','没有就用 harness.key');
  assert.match(r.stdout,/li2：.*准备好了/);assert.match(r.stdout,/li：.*准备好了/);
  noSecrets(r);
});

test('云端：Codex 已有本机网关线路就只补 env_key（先备份）；没有线路就补一整段并设成默认；已经配好就不动',t=>{
  const {d,run}=rig(t);
  assert.equal(run().status,0);
  const li=fs.readFileSync(path.join(d,'home-li/.codex/config.toml'),'utf8');
  assert.match(li,/\[model_providers\.workbuddy\]\nenv_key = "LIMING_GATEWAY_KEY"\n/);
  assert.ok(li.includes('[mcp_servers.rea]\ncommand = "/x/rea.mjs"\n'),'别的配置原样保留');
  assert.equal(li.replace('env_key = "LIMING_GATEWAY_KEY"\n',''),LI_CODEX,'只多这一行');
  assert.equal(fs.readdirSync(path.join(d,'home-li/.codex')).filter(f=>f.startsWith('config.toml.bak-liming')).length,1);
  const li2=fs.readFileSync(path.join(d,'home-li2/.codex/config.toml'),'utf8');
  assert.match(li2,/^model_provider = "workbuddy"\nmodel = "deepseek-v4\.1-flash"\n/);
  assert.match(li2,/\[model_providers\.workbuddy\]\nname = .*\nbase_url = "http:\/\/127\.0\.0\.1:8788\/v1"\nwire_api = "responses"\nenv_key = "LIMING_GATEWAY_KEY"\n/);
  assert.equal(mode(path.join(d,'home-li2/.codex/config.toml')),0o600);
  // 再跑一次：都不动、不多备份、.profile 不重复加
  const before={li:fs.readFileSync(path.join(d,'home-li/.codex/config.toml'),'utf8'),li2};
  const r=run('--skip-li');assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(fs.readFileSync(path.join(d,'home-li2/.codex/config.toml'),'utf8'),before.li2);
  assert.equal(fs.readFileSync(path.join(d,'home-li2/.profile'),'utf8').match(/LIMING_GATEWAY_KEY=/g).length,1);
});

test('云端：顶层已经指定了别的模型线路就不改默认，只补上网关线路并说明',t=>{
  const {d,lib}=rig(t);
  const h=remoteHome(d,'li9',{codexConfig:'model_provider = "openai"\nmodel = "gpt-x"\n'});
  const script=lib('remote_script li9 "$1" "$2" "$3"',path.join(tablet,'dsh-tablet.sh'),path.join(tablet,'dsh-task.sh'),path.join(tablet,'dsh-tablet-profile.yml'));
  assert.equal(script.status,0,script.stderr);
  const r=spawnSync('bash',['-s'],{input:script.stdout,encoding:'utf8',env:{PATH:path.join(h,'bin')+':'+process.env.PATH,HOME:h,LIMING_REMOTE_WS:path.join(d,'ws-li9')}});
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.stderr,'','准备脚本运行时不该有 bash 警告（比如 here-document 没写在命令替换里面）');
  const cfg=fs.readFileSync(path.join(h,'.codex/config.toml'),'utf8');
  assert.match(cfg,/^model_provider = "openai"\nmodel = "gpt-x"\n/);
  assert.match(cfg,/\[model_providers\.workbuddy\][\s\S]*env_key = "LIMING_GATEWAY_KEY"/);
  assert.match(r.stdout,/^LMC codex provider-added-not-default$/m);
});

test('云端：没装 Codex 就不建它的配置；没有网关 key 照样装浏览器，并报出来',t=>{
  const {d,lib}=rig(t);
  const h=remoteHome(d,'li8',{codex:false});fs.rmSync(path.join(h,'.xin'),{recursive:true});
  const script=lib('remote_script li8 "$1" "$2" "$3"',path.join(tablet,'dsh-tablet.sh'),path.join(tablet,'dsh-task.sh'),path.join(tablet,'dsh-tablet-profile.yml'));
  const r=spawnSync('bash',['-s'],{input:script.stdout,encoding:'utf8',env:{PATH:path.join(h,'bin')+':'+process.env.PATH,HOME:h,LIMING_REMOTE_WS:path.join(d,'ws-li8')}});
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.stderr,'');
  assert.match(r.stdout,/^LMC gateway-key missing$/m);assert.match(r.stdout,/^LMC codex none$/m);assert.match(r.stdout,/^LMC browser ok$/m);
  assert.ok(!fs.existsSync(path.join(h,'.codex')));
  assert.match(r.stdout,/^LMC done$/m);
});

test('清掉旧的云端任务插件：平板上卸载 liming-cloud、删掉旧的令牌和台账；云电脑上卸载 liming-lease、删掉写 key',t=>{
  const {d,env,run,read}=rig(t);
  fs.mkdirSync(path.join(env.LIMING_OLD_CLOUD_PLUGIN_DIR,'lib'),{recursive:true});fs.writeFileSync(path.join(env.LIMING_OLD_CLOUD_PLUGIN_DIR,'package.json'),'{}');
  fs.mkdirSync(env.LIMING_OLD_CLOUD_DIR);fs.writeFileSync(path.join(env.LIMING_OLD_CLOUD_DIR,'secrets.json'),'{"machines":{"li2":{"sshTarget":"ibssh_old-token@x"}}}');
  for(const m of ['li2','li']){const h=path.join(d,'home-'+m);fs.mkdirSync(path.join(h,'.liming-lease/lib'),{recursive:true});fs.mkdirSync(path.join(h,'.liming-cloud'));fs.writeFileSync(path.join(h,'.liming-cloud/lease.key'),'old-write-key\n');}
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  assert.ok(!fs.existsSync(env.LIMING_OLD_CLOUD_PLUGIN_DIR));assert.ok(!fs.existsSync(env.LIMING_OLD_CLOUD_DIR));
  assert.ok(read('dsh.log').includes('plugin --profile web remove liming-cloud\n'));
  for(const m of ['li2','li']){const h=path.join(d,'home-'+m);
    assert.ok(!fs.existsSync(path.join(h,'.liming-lease')));assert.ok(!fs.existsSync(path.join(h,'.liming-cloud')));
    assert.ok(fs.readFileSync(path.join(h,'dsh.log'),'utf8').includes('plugin --profile web remove liming-lease'));}
  assert.match(r.stdout,/旧的云端任务插件已删掉/);
  noSecrets(r,['ibssh_old-token','old-write-key']);
});

test('key 填反了（li 的填给 li2）：说清楚看不到 li2、不存，再问一次；三次都不对就不接这台',t=>{
  const {env,run}=rig(t,{input:[KEYS.li,KEYS.li2,KEYS.li]});
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stderr,/看不到 li2/);
  assert.equal(fs.readFileSync(path.join(env.LIMING_IB_DIR,'li2.key'),'utf8').trim(),KEYS.li2);
  const bad=rig(t,{input:[KEYS.li,KEYS.li,KEYS.li,KEYS.li]});
  const r2=bad.run();assert.equal(r2.status,0,r2.stdout+r2.stderr);
  assert.ok(!fs.existsSync(path.join(bad.env.LIMING_IB_DIR,'li2.key')));
  assert.match(r2.stdout,/li2：没接/);
  noSecrets(r2);
});

test('重复跑：直接回车保留原来的 key；不再下载安装包、不碰 accounts、不重复挂插件',t=>{
  const {env,run,read,ibLog,d}=rig(t);
  assert.equal(run().status,0);
  fs.writeFileSync(path.join(env.LIMING_GW_DIR,'accounts/acct.json'),'{"keep":true}');
  fs.writeFileSync(path.join(d,'tty'),'\n\n');
  const pulls=ibLog().filter(l=>/ pull /.test(l)).length;
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  for(const m of ['li2','li'])assert.equal(fs.readFileSync(path.join(env.LIMING_IB_DIR,m+'.key'),'utf8').trim(),KEYS[m]);
  assert.equal(ibLog().filter(l=>/ pull /.test(l)).length,pulls);
  assert.equal(fs.readFileSync(path.join(env.LIMING_GW_DIR,'accounts/acct.json'),'utf8'),'{"keep":true}');
  assert.equal(read('dsh.log').split('\n').filter(Boolean).length,1,'网关插件只挂一次');
  // 云电脑上的 web 配置：内容没变就不再备份（以前靠配置开头的一句说明认自己的文件，说明改了以后每次重跑都多一份备份）
  for(const m of ['li2','li'])assert.deepEqual(fs.readdirSync(path.join(d,'home-'+m,'.dsh/profiles/web')).filter(f=>f.includes('.bak')),[],m);
});

test('li2 上没有安装包就从 li 取',t=>{
  const {d,env,run,ibLog}=rig(t);fs.writeFileSync(path.join(d,'no-zip-li2'),'');
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  assert.ok(fs.existsSync(path.join(env.LIMING_GW_DIR,'current/wb_proxy.py')));
  assert.deepEqual(ibLog().filter(l=>/ pull /.test(l)).map(l=>l.split(' ')[0]),['li2','li']);
});

test('一台在冷却（exec 被拒）：说明是哪台、稍后重跑；平板上的部分和另一台照样装好',t=>{
  const {d,env,run}=rig(t);fs.writeFileSync(path.join(d,'cooling-li'),'');
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout+r.stderr,/li：.*没准备好.*稍后/);
  assert.match(r.stdout,/li2：.*准备好了/);
  assert.ok(fs.existsSync(path.join(env.LIMING_BIN_DIR,'ib')));
  assert.ok(!fs.existsSync(path.join(d,'home-li/.config/liming/gateway.key')));
});

test('远端 web 配置里已有别的补丁时先备份再换，内容不丢',t=>{
  const {d,run}=rig(t),prof=path.join(d,'home-li2/.dsh/profiles/web');
  fs.mkdirSync(prof,{recursive:true});fs.writeFileSync(path.join(prof,'cordis.patch.yml'),'# 站长自己的\n- id: something\n');
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  const baks=fs.readdirSync(prof).filter(f=>f.startsWith('cordis.patch.yml.bak'));
  assert.equal(baks.length,1);assert.equal(fs.readFileSync(path.join(prof,baks[0]),'utf8'),'# 站长自己的\n- id: something\n');
});

test('--dry-run 只列步骤，什么都不改、什么命令都不跑',t=>{
  const {d,env,run}=rig(t);const before=fs.readdirSync(d).sort();
  const r=run('--dry-run');assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/key/);assert.match(r.stdout,/ib/);assert.match(r.stdout,/技能/);
  assert.deepEqual(fs.readdirSync(d).sort(),before);
  assert.ok(!fs.existsSync(env.LIMING_GW_DIR));assert.ok(!fs.existsSync(env.LIMING_IB_DIR));
});

test('--skip-li 只问 li2 的 key，不碰 li',t=>{
  const {d,run,ibLog}=rig(t,{input:[KEYS.li2]});
  const r=run('--skip-li');assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.stderr.match(/InstaBox key/g)?.length,1);
  assert.ok(!ibLog().some(l=>/ (get|exec|pull) li( |$)/.test(l)));
  assert.ok(!fs.existsSync(path.join(d,'home-li/.config/liming')));
});

test('一把 key 都没有：停下并说明去哪建 key',t=>{
  const {run}=rig(t,{input:['','']});
  const r=run();assert.notEqual(r.status,0);
  assert.match(r.stderr,/至少要一把/);assert.match(r.stderr,/machines:read/);
});

test('没装 InstaBox 命令行：用 npm 装指定版本；装完还找不到就说明是 PATH 的问题',t=>{
  const {d,env}=rig(t);
  const missing={...env,LIMING_INSTABOX:path.join(d,'no-such-instabox'),LIMING_SETUP_LIB:'1'};
  const r=spawnSync('bash',['-c','source "$0"; ensure_instabox',setup],{env:missing,encoding:'utf8'});
  assert.notEqual(r.status,0);
  assert.equal(fs.readFileSync(path.join(d,'npm.log'),'utf8'),'i -g instabox@0.8.407\n');
  assert.match(r.stderr,/PATH/);
  const ok=spawnSync('bash',['-c','source "$0"; ensure_instabox',setup],{env:{...env,LIMING_SETUP_LIB:'1'},encoding:'utf8'});
  assert.equal(ok.status,0,ok.stderr);
});

test('云端：小芯、天启已停用——它们的用户级常驻服务（xin-kernel-resident、xin-reaper）关掉并停下，文件不删；没有就不动',t=>{
  const {d,lib}=rig(t);
  const h=remoteHome(d,'li7',{codexConfig:LI_CODEX});
  const units=path.join(h,'.config/systemd/user');fs.mkdirSync(units,{recursive:true});
  for(const u of ['xin-kernel-resident.service','xin-reaper.timer','xin-reaper.service'])fs.writeFileSync(path.join(units,u),'[Unit]\n');
  fs.writeFileSync(path.join(h,'bin/systemctl'),'#!/bin/sh\necho "systemctl $*" >> "$HOME/remote.log"\n',{mode:0o755});
  const script=lib('remote_script li7 "$1" "$2" "$3"',path.join(tablet,'dsh-tablet.sh'),path.join(tablet,'dsh-task.sh'),path.join(tablet,'dsh-tablet-profile.yml'));
  const run=()=>spawnSync('bash',['-s'],{input:script.stdout,encoding:'utf8',env:{PATH:path.join(h,'bin')+':'+process.env.PATH,HOME:h,LIMING_REMOTE_WS:path.join(d,'ws-li7')}});
  const r=run();assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');
  const log=fs.readFileSync(path.join(h,'remote.log'),'utf8');
  assert.match(log,/^systemctl --user disable --now xin-kernel-resident\.service$/m,'逐个关：缺一个不影响另一个');
  assert.match(log,/^systemctl --user disable --now xin-reaper\.timer$/m);
  assert.match(log,/^systemctl --user stop xin-reaper\.service$/m);
  assert.match(r.stdout,/^LMC xin-services stopped$/m);
  for(const u of ['xin-kernel-resident.service','xin-reaper.timer'])assert.ok(fs.existsSync(path.join(units,u)),u+' 文件留着，想恢复能再开');
  // 没有这些服务的机器：不调 systemctl
  const h2=remoteHome(d,'li6');fs.writeFileSync(path.join(h2,'bin/systemctl'),'#!/bin/sh\necho "systemctl $*" >> "$HOME/remote.log"\n',{mode:0o755});
  const r2=spawnSync('bash',['-s'],{input:lib('remote_script li6 "$1" "$2" "$3"',path.join(tablet,'dsh-tablet.sh'),path.join(tablet,'dsh-task.sh'),path.join(tablet,'dsh-tablet-profile.yml')).stdout,encoding:'utf8',env:{PATH:path.join(h2,'bin')+':'+process.env.PATH,HOME:h2,LIMING_REMOTE_WS:path.join(d,'ws-li6')}});
  assert.equal(r2.status,0,r2.stderr);assert.match(r2.stdout,/^LMC xin-services none$/m);
  assert.doesNotMatch(fs.readFileSync(path.join(h2,'remote.log'),'utf8'),/systemctl/);
});

test('装机结果里说明哪台停了小芯、天启的后台服务',t=>{
  const {d,run}=rig(t);
  const units=path.join(d,'home-li2/.config/systemd/user');fs.mkdirSync(units,{recursive:true});
  fs.writeFileSync(path.join(units,'xin-reaper.timer'),'[Unit]\n');
  fs.writeFileSync(path.join(d,'home-li2/bin/systemctl'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/li2：准备好了.*停了小芯、天启的后台服务/);
  assert.doesNotMatch(r.stdout,/li：准备好了.*停了小芯/);
});

test('云端：tablet 配置只在第一次从模板建，重跑不重建；配置里原有的自定义先备份再换成网关线路',t=>{
  const {d,run}=rig(t);
  assert.equal(run().status,0);
  const tp=path.join(d,'home-li2/.dsh/profiles/tablet');
  fs.writeFileSync(path.join(tp,'cordis.patch.yml'),'# 站长自己改的\n');
  const r=run('--skip-li');assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(fs.readFileSync(path.join(d,'home-li2/dsh.log'),'utf8').match(/--from-default-profile/g).length,1,'只建一次');
  const baks=fs.readdirSync(tp).filter(f=>f.startsWith('cordis.patch.yml.bak'));
  assert.equal(baks.length,1);assert.equal(fs.readFileSync(path.join(tp,baks[0]),'utf8'),'# 站长自己改的\n');
  assert.equal(fs.readFileSync(path.join(tp,'cordis.patch.yml'),'utf8'),fs.readFileSync(path.join(tablet,'dsh-tablet-profile.yml'),'utf8'));
});

test('装机结果里说明哪台的 Antigravity 还没登录、哪台没装',t=>{
  const {d,run}=rig(t);
  fs.rmSync(path.join(d,'home-li2/.gemini'),{recursive:true,force:true});
  fs.rmSync(path.join(d,'home-li/.local/bin/agy'));
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/li2：准备好了.*Antigravity 还没登录/);
  assert.match(r.stdout,/li：准备好了.*没装 Antigravity/);
});
