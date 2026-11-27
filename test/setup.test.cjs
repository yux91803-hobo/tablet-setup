// 装机脚本 setup.sh（设计：docs/superpowers/specs/2026-11-27-crew-design.md；网关部分沿用 2026-11-25-tablet-dshgo-design.md）
// 假 instabox：按 INSTABOX_API_KEY 认是哪个账号（看不到别的账号的机器）；get 回机器信息；pull 给测试 zip（有 no-zip-<机器> 标记时报错）；
// exec --stdin <机器> -- bash -s 在那台自己的临时 HOME 里真的执行装机脚本送去的云端准备脚本（有 cooling-<机器> 标记时报冷却）。
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),tablet=root,setup=path.join(tablet,'setup.sh');
const tmp=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'tablet-setup-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
const KEYS={li2:'ibk_li2_SECRET_aaaa1111',li:'ibk_li_SECRET_bbbb2222'};
const REMOTE_ZIP='/data/workbuddy-gateway/releases/workbuddy2api-hub-v2.0.8.zip';
const BASE_CMDS=['bash','sh','python3','sed','grep','cat','tr','head','tail','cut','wc','mkdir','rm','mv','cp','chmod','cmp','date','uname','id','env','dirname','basename','mktemp','sleep','kill','touch','ls','true','false','echo','printf','test','['];
// 只把 bash 和基础工具放进假云电脑的 PATH，避免宿主机器上装的 codex、agy、gh、uv、hcom 混进测试
function makeBaseBin(dir){
  const b=path.join(dir,'base-bin');fs.mkdirSync(b,{recursive:true});
  const dirs=['/usr/bin','/bin'];
  for(const cmd of BASE_CMDS){
    for(const sd of dirs){
      const p=path.join(sd,cmd);
      if(fs.existsSync(p)){fs.symlinkSync(p,path.join(b,cmd));break;}
    }
  }
  return b;
}
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
    HOME="$FAKE_DIR/home-$m" PATH="$FAKE_DIR/home-$m/bin:$FAKE_DIR/base-bin" LIMING_REMOTE_WS="$FAKE_DIR/ws-$m" bash -s;;
  *) echo "unexpected: $*" >&2; exit 2;;
esac
`;
function makeZip(file){
  const files={'wb-proxy/wb_proxy.py':'print("fake")\n','wb-proxy/bin/wb-tls-bridge-linux-arm64':'bin\n','wb-proxy/start-wb-proxy.sh':'#!/bin/sh\n'};
  const r=spawnSync('python3',['-c','import json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w")\nfor k,v in json.loads(sys.argv[2]).items(): z.writestr(k,v)\nz.close()',file,JSON.stringify(files)]);
  assert.equal(r.status,0,String(r.stderr));
  const buf=fs.readFileSync(file);return {size:String(buf.length),sha:crypto.createHash('sha256').update(buf).digest('hex')};
}
// 一台「云电脑」的 HOME：有 npm（装 playwright-cli 时放一个假的进 bin）、可选 Antigravity、uv、hcom、gh
function remoteHome(dir,m,{agy='logged-in',hcom='0.7.31',uv=true,gh='logged-in',settings=null}={}){
  const h=path.join(dir,'home-'+m),bin=path.join(h,'bin'),lbin=path.join(h,'.local/bin');
  for(const p of ['.local/bin','bin'])fs.mkdirSync(path.join(h,p),{recursive:true});
  // Antigravity 命令行装在 ~/.local/bin/agy；登录后 ~/.gemini/antigravity-cli 里有令牌文件
  if(agy){fs.writeFileSync(path.join(lbin,'agy'),'#!/bin/sh\nexit 0\n',{mode:0o755});
    if(agy==='logged-in'){fs.mkdirSync(path.join(h,'.gemini/antigravity-cli'),{recursive:true});fs.writeFileSync(path.join(h,'.gemini/antigravity-cli/antigravity-oauth-token'),'fake-token\n',{mode:0o600});}}
  if(settings!==null){
    fs.mkdirSync(path.join(h,'.gemini/antigravity-cli'),{recursive:true});
    fs.writeFileSync(path.join(h,'.gemini/antigravity-cli/settings.json'),typeof settings==='string'?settings:JSON.stringify(settings,null,2),{mode:0o600});
  }
  if(hcom){
    fs.writeFileSync(path.join(lbin,'hcom'),`#!/bin/sh\necho "hcom ${hcom}"\n`,{mode:0o755});
  }
  if(uv){
    fs.writeFileSync(path.join(bin,'uv'),`#!/bin/sh\necho "uv $*" >> "$HOME/remote.log"\ncase "$*" in *"tool install"*hcom==*) ver=\${*##*hcom==}; ver=\${ver%% *}; printf '#!/bin/sh\\necho "hcom %s"\\n' "$ver" > "$HOME/.local/bin/hcom"; chmod +x "$HOME/.local/bin/hcom";; esac\n`,{mode:0o755});
  }
  if(gh){
    const rc=gh==='logged-in'?0:1;
    fs.writeFileSync(path.join(bin,'gh'),`#!/bin/sh\necho "gh $*" >> "$HOME/remote.log"\nexit ${rc}\n`,{mode:0o755});
  }
  fs.writeFileSync(path.join(bin,'npm'),`#!/bin/sh\necho "npm $*" >> "$HOME/remote.log"\ncase "$*" in *@playwright/cli*) printf '#!/bin/sh\\necho "playwright-cli $*" >> "$HOME/remote.log"\\n' > "${bin}/playwright-cli"; chmod +x "${bin}/playwright-cli";; esac\n`,{mode:0o755});
  return h;
}
function rig(t,{input=[KEYS.li2,KEYS.li]}={}){
  const d=tmp(t),bin=path.join(d,'bin'),curlBin=path.join(d,'curl-bin');
  fs.mkdirSync(bin);fs.mkdirSync(curlBin);
  makeBaseBin(d);
  const realCurl=spawnSync('which',['curl'],{encoding:'utf8'}).stdout.trim()||'/usr/bin/curl';
  fs.writeFileSync(path.join(curlBin,'curl'),`#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$FAKE_DIR/curl.log"\nexec ${JSON.stringify(realCurl)} "$@"\n`,{mode:0o755});
  fs.writeFileSync(path.join(bin,'instabox'),FAKE_IB,{mode:0o755});
  fs.writeFileSync(path.join(bin,'dsh'),'#!/bin/sh\necho "$*" >> "$FAKE_DIR/dsh.log"\n',{mode:0o755});
  fs.writeFileSync(path.join(bin,'apt-get'),'#!/bin/sh\necho "$*" >> "$FAKE_DIR/apt.log"\n',{mode:0o755});
  fs.writeFileSync(path.join(bin,'npm'),'#!/bin/sh\necho "$*" >> "$FAKE_DIR/npm.log"\n',{mode:0o755});
  fs.writeFileSync(path.join(d,'tty'),input.join('\n')+'\n');
  const zip=path.join(d,'gw.zip'),z=makeZip(zip);
  remoteHome(d,'li2');remoteHome(d,'li');
  const home=path.join(d,'tablet-home');fs.mkdirSync(home);
  const env={PATH:curlBin+':'+process.env.PATH,HOME:home,FAKE_DIR:d,FAKE_ZIP:zip,KEY_LI2:KEYS.li2,KEY_LI:KEYS.li,LIMING_BASE:'file://'+tablet,
    LIMING_GW_DIR:path.join(d,'gw'),LIMING_PLUGIN_DIR:path.join(d,'plugin'),LIMING_IB_DIR:path.join(d,'keys'),LIMING_BIN_DIR:path.join(d,'usr-bin'),
    LIMING_OLD_CLOUD_PLUGIN_DIR:path.join(d,'old-cloud-plugin'),LIMING_OLD_CLOUD_DIR:path.join(d,'old-cloud'),
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

test('装机不再下载 dsh-task、dsh-tablet 和 dsh-tablet-profile.yml',t=>{
  const {run,read}=rig(t);
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  const downloads=read('curl.log');
  assert.ok(downloads.includes('file://'),'记录到了 file:// 下载');
  for(const old of ['dsh-task.sh','dsh-tablet.sh','dsh-tablet-profile.yml']){
    assert.ok(!downloads.includes(old),'不该再下载 '+old);
  }
});

test('云端准备不再碰 Codex、Harness、网关 key 和小芯的服务',t=>{
  const {d,run}=rig(t);
  const origCodex='model_provider = "orig"\n';
  const origProfile='# 原有 profile\n';
  const origGwKey='orig-gateway-key\n';
  const origDshPatch='# 原有 dsh 补丁\n';
  for(const m of ['li2','li']){
    const h=path.join(d,'home-'+m);
    fs.mkdirSync(path.join(h,'.codex'),{recursive:true});
    fs.writeFileSync(path.join(h,'.codex/config.toml'),origCodex,{mode:0o600});
    fs.mkdirSync(path.join(h,'.dsh/profiles/web'),{recursive:true});
    fs.writeFileSync(path.join(h,'.dsh/profiles/web/cordis.patch.yml'),origDshPatch);
    fs.writeFileSync(path.join(h,'.profile'),origProfile);
    fs.mkdirSync(path.join(h,'.config/liming'),{recursive:true});
    fs.writeFileSync(path.join(h,'.config/liming/gateway.key'),origGwKey,{mode:0o600});
    fs.mkdirSync(path.join(h,'.xin'),{recursive:true});
    fs.writeFileSync(path.join(h,'.xin/harness.key'),'remote-harness-key\n',{mode:0o600});
    fs.writeFileSync(path.join(h,'.xin/codex.key'),'remote-codex-key\n',{mode:0o600});
    fs.writeFileSync(path.join(h,'.local/bin/dsh'),'#!/bin/sh\necho "$*" >> "$HOME/dsh.log"\n',{mode:0o755});
    fs.writeFileSync(path.join(h,'bin/codex'),'#!/bin/sh\nexit 0\n',{mode:0o755});
    fs.mkdirSync(path.join(h,'.config/systemd/user'),{recursive:true});
    fs.writeFileSync(path.join(h,'.config/systemd/user/xin-kernel-resident.service'),'[Unit]\n');
    fs.writeFileSync(path.join(h,'.config/systemd/user/xin-reaper.timer'),'[Unit]\n');
    fs.writeFileSync(path.join(h,'bin/systemctl'),'#!/bin/sh\necho "systemctl $*" >> "$HOME/systemctl.log"\n',{mode:0o755});
  }
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  for(const m of ['li2','li']){
    const h=path.join(d,'home-'+m);
    assert.equal(fs.readFileSync(path.join(h,'.codex/config.toml'),'utf8'),origCodex,m+' .codex/config.toml 不应变动');
    assert.equal(fs.readFileSync(path.join(h,'.dsh/profiles/web/cordis.patch.yml'),'utf8'),origDshPatch,m+' .dsh/ 不应变动');
    assert.ok(!fs.existsSync(path.join(h,'.dsh/profiles/tablet')),m+' 不应建 tablet 配置');
    assert.equal(fs.readFileSync(path.join(h,'.profile'),'utf8'),origProfile,m+' .profile 不应变动');
    assert.equal(fs.readFileSync(path.join(h,'.config/liming/gateway.key'),'utf8'),origGwKey,m+' gateway.key 不应变动');
    assert.ok(!fs.existsSync(path.join(h,'dsh.log')),m+' 不应调远端 dsh');
    assert.ok(!fs.existsSync(path.join(h,'systemctl.log')),m+' 不应调 systemctl');
  }
  assert.doesNotMatch(r.stdout,/Codex|Harness|手动切主机|小芯/);
  noSecrets(r);
});

test('整套装一遍：两把 key 存好、网关经 InstaBox 从 li2 取、ib 装上、两台云电脑准备好，输出里没有 key',t=>{
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
  // ib
  assert.equal(fs.readFileSync(path.join(env.LIMING_BIN_DIR,'ib'),'utf8'),fs.readFileSync(path.join(tablet,'ib.sh'),'utf8'));
  assert.equal(mode(path.join(env.LIMING_BIN_DIR,'ib')),0o755);
  // 两台云电脑：经 exec --stdin 跑准备脚本
  for(const m of ['li2','li'])assert.ok(ibLog().some(l=>l.startsWith(m+' exec '+m+' --stdin')&&l.endsWith('-- bash -s')),m);
  for(const m of ['li2','li']){
    const h=path.join(d,'home-'+m);
    const log=fs.readFileSync(path.join(h,'remote.log'),'utf8');
    assert.match(log,/npm i -g @playwright\/cli@0\.1\.25/);assert.match(log,/playwright-cli install-browser chromium/);
  }
  assert.match(r.stdout,/li2：准备好了/);assert.match(r.stdout,/li：准备好了/);
  noSecrets(r);
});

test('清掉平板上旧的云端任务插件：卸载 liming-cloud、删掉旧的令牌和台账',t=>{
  const {env,run,read}=rig(t);
  fs.mkdirSync(path.join(env.LIMING_OLD_CLOUD_PLUGIN_DIR,'lib'),{recursive:true});fs.writeFileSync(path.join(env.LIMING_OLD_CLOUD_PLUGIN_DIR,'package.json'),'{}');
  fs.mkdirSync(env.LIMING_OLD_CLOUD_DIR);fs.writeFileSync(path.join(env.LIMING_OLD_CLOUD_DIR,'secrets.json'),'{"machines":{"li2":{"sshTarget":"ibssh_old-token@x"}}}');
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  assert.ok(!fs.existsSync(env.LIMING_OLD_CLOUD_PLUGIN_DIR));assert.ok(!fs.existsSync(env.LIMING_OLD_CLOUD_DIR));
  assert.ok(read('dsh.log').includes('plugin --profile web remove liming-cloud\n'));
  assert.match(r.stdout,/旧的云端任务插件已删掉/);
  noSecrets(r,['ibssh_old-token']);
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
  assert.ok(!fs.existsSync(path.join(d,'home-li/remote.log')));
});

test('--dry-run 只列步骤，什么都不改、什么命令都不跑',t=>{
  const {d,env,run}=rig(t);const before=fs.readdirSync(d).sort();
  const r=run('--dry-run');assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/key/);assert.match(r.stdout,/ib/);
  assert.doesNotMatch(r.stdout,/Codex|Harness|dsh-task|dsh-tablet|小芯/);
  assert.deepEqual(fs.readdirSync(d).sort(),before);
  assert.ok(!fs.existsSync(env.LIMING_GW_DIR));assert.ok(!fs.existsSync(env.LIMING_IB_DIR));
});

test('--skip-li 只问 li2 的 key，不碰 li',t=>{
  const {d,run,ibLog}=rig(t,{input:[KEYS.li2]});
  const r=run('--skip-li');assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.stderr.match(/InstaBox key/g)?.length,1);
  assert.ok(!ibLog().some(l=>/ (get|exec|pull) li( |$)/.test(l)));
  assert.ok(!fs.existsSync(path.join(d,'home-li/remote.log')));
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

test('装机结果里说明哪台的 Antigravity 还没登录、哪台没装',t=>{
  const {d,run}=rig(t);
  fs.rmSync(path.join(d,'home-li2/.gemini'),{recursive:true,force:true});
  fs.rmSync(path.join(d,'home-li/.local/bin/agy'));
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/li2：准备好了.*Antigravity 还没登录/);
  assert.match(r.stdout,/li：准备好了.*没装 Antigravity/);
});

test('云端准备：已是 0.7.31 时不重装 hcom；缺失或版本不对时固定装 hcom==0.7.31',t=>{
  const {d,run}=rig(t);
  // li2 已有 0.7.31，li 没装 hcom
  fs.rmSync(path.join(d,'home-li/.local/bin/hcom'));
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  const logLi2=fs.readFileSync(path.join(d,'home-li2/remote.log'),'utf8');
  assert.doesNotMatch(logLi2,/uv tool install/,'已是 0.7.31 不应重装');
  const logLi=fs.readFileSync(path.join(d,'home-li/remote.log'),'utf8');
  assert.match(logLi,/uv tool install --force hcom==0\.7\.31/,'版本必须钉死 0.7.31');
  assert.match(r.stdout,/li2：准备好了\n/);
  assert.match(r.stdout,/li：准备好了\n/);
});

test('云端准备：放行 hcom 的规则只加一次，原有设置不动，重跑结果相同',t=>{
  const {d,run}=rig(t);
  const cfgPath=path.join(d,'home-li2/.gemini/antigravity-cli/settings.json');
  const orig={
    permissions:{allow:['command(git status)','command(hcom send)'],deny:['command(rm -rf /)']},
    trustedWorkspaces:['/data/workspace/demo'],
    customFlag:true,
  };
  fs.writeFileSync(cfgPath,JSON.stringify(orig,null,2),{mode:0o600});
  const r1=run('--skip-li');assert.equal(r1.status,0,r1.stdout+r1.stderr);
  const after1=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
  assert.deepEqual(after1.trustedWorkspaces,orig.trustedWorkspaces,'原有 trustedWorkspaces 不动');
  assert.equal(after1.customFlag,true,'原有自定义字段不动');
  assert.deepEqual(after1.permissions.deny,orig.permissions.deny,'原有 deny 不动');
  assert.ok(after1.permissions.allow.includes('command(git status)'),'原有 allow 不动');
  assert.ok(after1.permissions.allow.includes(`write_file(${path.join(d,'home-li2/.hcom')})`),'应挂 ~/.hcom 读写进沙箱');
  assert.ok(after1.permissions.allow.includes(`read_file(${path.join(d,'home-li2/.local/bin')})`),'应挂 ~/.local/bin 只读进沙箱');
  assert.ok(after1.permissions.allow.includes(`read_file(${path.join(d,'home-li2/.local/share/uv/tools/hcom')})`),'应挂 ~/.local/share/uv/tools/hcom 只读进沙箱');
  assert.ok(!after1.permissions.allow.includes('command(hcom)'),'不加一刀切的 command(hcom)');
  assert.ok(!after1.permissions.allow.includes(`read_file(${path.join(d,'home-li2/.local')})`),'不放开整个 ~/.local');
  // 重跑：不重复加规则，内容完全一致
  fs.writeFileSync(path.join(d,'tty'),'\n');
  const r2=run('--skip-li');assert.equal(r2.status,0,r2.stdout+r2.stderr);
  const after2=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
  assert.deepEqual(after2,after1,'重跑结果应幂等');
  assert.equal(after2.permissions.allow.filter(x=>x===`write_file(${path.join(d,'home-li2/.hcom')})`).length,1,'不重复添加');
});

test('云端准备：没登录 GitHub 时汇总提示 gh auth login；不碰谷歌登录令牌文件',t=>{
  const {d,run}=rig(t);
  const tok=path.join(d,'home-li2/.gemini/antigravity-cli/antigravity-oauth-token');
  const oldMtime=new Date('2026-01-01T00:00:00Z');
  fs.utimesSync(tok,oldMtime,oldMtime);
  // li 上 gh 未登录
  fs.writeFileSync(path.join(d,'home-li/bin/gh'),'#!/bin/sh\nexit 1\n',{mode:0o755});
  const r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/li：准备好了；GitHub 还没登录（在这台的 Computer 页签运行 gh auth login）/);
  assert.equal(fs.readFileSync(tok,'utf8'),'fake-token\n','令牌内容不能变');
  assert.equal(fs.statSync(tok).mtimeMs,oldMtime.getTime(),'令牌修改时间不能变');
});
