// 平板网关随 DSH 本机引擎启停的插件（liming-work-site 仓库 docs/superpowers/specs/2026-11-25-tablet-dshgo-design.md §4.1、§4.2）
// 假网关是真的 Python 进程：解析 --host/--port，/health 回 {"ok": true}，每次启动往 spawns.txt 记一行；
// 网关目录里的 fake-mode 文件写几个开关：exit（立刻退出）、ignore-stop（不理 SIGINT、SIGTERM）、never-ok（/health 永不 ok）、
// bridge（像真网关的 TLS 组件那样起一个子进程，只靠 atexit 收掉）。
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),http=require('node:http');
const {pathToFileURL}=require('node:url');
const lib=path.resolve(__dirname,'../liming-gateway/lib');
const gw=()=>import(pathToFileURL(path.join(lib,'gateway.js')).href);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const tmp=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'tablet-gw-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
async function waitFor(fn,ms=5000){const t0=performance.now();for(;;){const v=await fn();if(v||performance.now()-t0>ms)return v;await sleep(25);}}
const FAKE_PY=`import json, os, signal, sys, http.server
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
opt = lambda n: args[args.index(n) + 1]
mf = os.path.join(root, 'fake-mode')
modes = set(open(mf).read().split()) if os.path.exists(mf) else set()
with open(os.path.join(root, 'spawns.txt'), 'a') as f: f.write(str(os.getpid()) + '\\n')
with open(os.path.join(root, 'last-run.json'), 'w') as f:
    json.dump({'args': args, 'cwd': os.getcwd(), 'TZ': os.environ.get('TZ'), 'realm': os.environ.get('WB_PROXY_DEFAULT_REALM'), 'unbuffered': os.environ.get('PYTHONUNBUFFERED')}, f)
print('fake gateway up', flush=True)
if 'exit' in modes: sys.exit(3)
if 'ignore-stop' in modes:
    signal.signal(signal.SIGTERM, signal.SIG_IGN); signal.signal(signal.SIGINT, signal.SIG_IGN)
if 'bridge' in modes:
    import atexit, subprocess
    bridge = subprocess.Popen(['sleep', '300'])
    with open(os.path.join(root, 'bridge.pid'), 'w') as f: f.write(str(bridge.pid))
    atexit.register(bridge.kill)
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        ok = self.path == '/health' and 'never-ok' not in modes
        body = b'{"ok": true}' if ok else b'{"ok": false}'
        self.send_response(200 if ok else 503); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer((opt('--host'), int(opt('--port'))), H).serve_forever()
`;
function fakeGateway(t,mode){
  const dir=tmp(t);fs.mkdirSync(path.join(dir,'current'));fs.writeFileSync(path.join(dir,'current/wb_proxy.py'),FAKE_PY);
  if(mode)fs.writeFileSync(path.join(dir,'fake-mode'),mode);return dir;
}
const spawns=dir=>{try{return fs.readFileSync(path.join(dir,'spawns.txt'),'utf8').trim().split('\n').filter(Boolean).length;}catch{return 0;}};
const fast=(dir,port,extra={})=>({dir,port,host:'127.0.0.1',python:'python3',healthTimeoutMs:5000,healthIntervalMs:50,backoffMs:[50,50,50],restartWindowMs:60000,restartLimit:3,stopGraceMs:300,watchMs:100,...extra});
const readJson=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const pluginLog=dir=>{try{return fs.readFileSync(path.join(dir,'logs/plugin.log'),'utf8');}catch{return '';}};
function nodeServer(port,healthOk){
  return new Promise(r=>{const s=http.createServer((q,res)=>{const ok=healthOk&&q.url==='/health';res.writeHead(ok?200:404,{'content-type':'application/json'});res.end(ok?'{"ok":true}':'{}');});s.listen(port,'127.0.0.1',()=>r(s));});
}
const closeServer=s=>new Promise(r=>{s.closeAllConnections?.();s.close(()=>r());});
async function supervisor(t,opts){const {createSupervisor}=await gw();const s=createSupervisor(opts);t.after(()=>s.stop());return s;}

test('启动参数和环境照 li 的 workbuddy-gateway 服务',async()=>{
  const {gatewayCommand}=await gw();
  const c=gatewayCommand({dir:'/root/workbuddy-gateway',host:'127.0.0.1',port:8788,python:'python3'});
  assert.equal(c.command,'python3');
  assert.deepEqual(c.args,['/root/workbuddy-gateway/current/wb_proxy.py','--host','127.0.0.1','--port','8788',
    '--accounts-dir','/root/workbuddy-gateway/accounts','--usage-dir','/root/workbuddy-gateway/usage']);
  assert.equal(c.cwd,'/root/workbuddy-gateway/current');
  assert.equal(c.env.TZ,'Asia/Shanghai');assert.equal(c.env.WB_PROXY_DEFAULT_REALM,'cn');assert.equal(c.env.PYTHONUNBUFFERED,'1');
  assert.equal(c.env.PATH,process.env.PATH,'其余环境照引擎的');
  assert.deepEqual(gatewayCommand({}).args.slice(0,5),['/root/workbuddy-gateway/current/wb_proxy.py','--host','127.0.0.1','--port','8788'],'默认就是平板上的路径和端口');
});

test('没装网关就不启动，只在 plugin.log 记一笔',async t=>{
  const dir=tmp(t),s=await supervisor(t,fast(dir,await freePort()));
  assert.equal(await s.start(),'missing');
  assert.equal(spawns(dir),0);assert.match(pluginLog(dir),/wb_proxy\.py/);
});

test('正常启动：写入全天签到钟点、保留其他设置，环境里 TZ 是北京时间',async t=>{
  const dir=fakeGateway(t),port=await freePort(),{probeHealth}=await gw();
  fs.mkdirSync(path.join(dir,'accounts'));
  fs.writeFileSync(path.join(dir,'accounts/settings.json'),JSON.stringify({api_keys:[{k:'x'}],schedule:{travel:[9,21]}}));
  const s=await supervisor(t,fast(dir,port));
  assert.equal(await s.start(),'started');
  assert.equal(await probeHealth({host:'127.0.0.1',port,timeoutMs:1000}),true);
  const st=readJson(path.join(dir,'accounts/settings.json'));
  assert.deepEqual(st.schedule.checkin,[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]);
  assert.deepEqual(st.schedule.travel,[9,21]);assert.deepEqual(st.api_keys,[{k:'x'}]);
  const run=readJson(path.join(dir,'last-run.json'));
  assert.equal(run.TZ,'Asia/Shanghai');assert.equal(run.realm,'cn');assert.equal(run.unbuffered,'1');
  assert.deepEqual(run.args.slice(4),['--accounts-dir',path.join(dir,'accounts'),'--usage-dir',path.join(dir,'usage')]);
  for(const d of ['accounts','usage','logs'])assert.equal(fs.statSync(path.join(dir,d)).mode&0o777,0o700,d+' 只有自己能读');
});

test('签到钟点：已有就不覆盖，文件坏了不碰，没有文件就新建',async t=>{
  const {seedCheckinSchedule}=await gw(),dir=tmp(t),f=path.join(dir,'settings.json');
  fs.writeFileSync(f,'{"schedule":{"checkin":[9]}}');
  assert.equal(seedCheckinSchedule(dir),'kept');assert.equal(fs.readFileSync(f,'utf8'),'{"schedule":{"checkin":[9]}}');
  fs.writeFileSync(f,'{not json');
  assert.equal(seedCheckinSchedule(dir),'invalid');assert.equal(fs.readFileSync(f,'utf8'),'{not json');
  fs.writeFileSync(f,'{"schedule":"9,21"}');
  assert.equal(seedCheckinSchedule(dir),'invalid','schedule 不是对象时不替站长改');
  fs.rmSync(f);
  assert.equal(seedCheckinSchedule(dir),'seeded');assert.equal(readJson(f).schedule.checkin.length,24);
});

test('已有网关在答就沿用：不起第二个、不写设置，停止时也不去停它',async t=>{
  const dir=fakeGateway(t),port=await freePort(),{probeHealth}=await gw();
  const ext=await nodeServer(port,true);t.after(()=>closeServer(ext));
  const s=await supervisor(t,fast(dir,port));
  assert.equal(await s.start(),'adopted');
  assert.equal(spawns(dir),0);assert.ok(!fs.existsSync(path.join(dir,'accounts/settings.json')));
  await s.stop();
  assert.equal(await probeHealth({host:'127.0.0.1',port,timeoutMs:1000}),true);
});

test('沿用的网关没了（引擎重启时旧实例把它停了）就自己接手',async t=>{
  const dir=fakeGateway(t),port=await freePort(),{probeHealth}=await gw();
  const ext=await nodeServer(port,true);
  const s=await supervisor(t,fast(dir,port));
  assert.equal(await s.start(),'adopted');
  await closeServer(ext);
  assert.ok(await waitFor(async()=>spawns(dir)===1&&await probeHealth({host:'127.0.0.1',port,timeoutMs:500})),'在 watchMs 的几倍时间内接手');
  assert.ok(await waitFor(()=>s.state().mode==='started'),'守护自己的健康检查随后也确认起来了');
  assert.equal(spawns(dir),1);
});

test('意外退出按退避重启，10 分钟内最多 3 次，之后停下不再起',async t=>{
  const dir=fakeGateway(t,'exit'),s=await supervisor(t,fast(dir,await freePort()));
  assert.equal(await s.start(),'unhealthy');
  assert.ok(await waitFor(()=>s.state().gaveUp));
  assert.equal(spawns(dir),4);assert.equal(s.state().restarts,3);
  await sleep(300);assert.equal(spawns(dir),4);
});

test('端口被不是网关的程序占着：有限次数后停下，日志写明端口被占用',async t=>{
  const dir=fakeGateway(t),port=await freePort();
  const other=await nodeServer(port,false);t.after(()=>closeServer(other));
  const s=await supervisor(t,fast(dir,port));
  await s.start();
  assert.ok(await waitFor(()=>s.state().gaveUp));
  assert.ok(spawns(dir)<=4);
  assert.match(pluginLog(dir),new RegExp(port+'.*占用'));
});

test('健康检查超时：返回 unhealthy，进程留着',async t=>{
  const dir=fakeGateway(t,'never-ok'),s=await supervisor(t,fast(dir,await freePort(),{healthTimeoutMs:500}));
  assert.equal(await s.start(),'unhealthy');
  assert.ok(alive(s.state().pid));
});

test('停止：先发 SIGINT（网关当 Ctrl+C 正常退出），不理就 SIGKILL；停了以后不再重启',async t=>{
  const dir=fakeGateway(t,'ignore-stop'),s=await supervisor(t,fast(dir,await freePort()));
  assert.equal(await s.start(),'started');
  const pid=s.state().pid,t0=performance.now();
  await s.stop();
  assert.ok(performance.now()-t0<1300,'在 stopGraceMs 加 1 秒内停完');
  assert.equal(alive(pid),false);
  await sleep(300);assert.equal(spawns(dir),1);
});

async function bridgeOf(t,dir){
  assert.ok(await waitFor(()=>fs.existsSync(path.join(dir,'bridge.pid'))),'假网关起了子进程');
  const pid=Number(fs.readFileSync(path.join(dir,'bridge.pid'),'utf8'));t.after(()=>{try{process.kill(pid,'SIGKILL');}catch{}});return pid;
}

test('停止时连网关自己起的子进程（TLS 组件）一起收掉，不在平板上留孤儿进程',async t=>{
  const dir=fakeGateway(t,'bridge'),s=await supervisor(t,fast(dir,await freePort()));
  assert.equal(await s.start(),'started');
  const bridge=await bridgeOf(t,dir);assert.ok(alive(bridge));
  await s.stop();
  assert.ok(await waitFor(()=>!alive(bridge),2000),'子进程跟着网关一起停了');
});

test('网关不理停止信号时，SIGKILL 打到整组进程，子进程也不留',async t=>{
  const dir=fakeGateway(t,'ignore-stop bridge'),s=await supervisor(t,fast(dir,await freePort()));
  assert.equal(await s.start(),'started');
  const bridge=await bridgeOf(t,dir);
  await s.stop();
  assert.ok(await waitFor(()=>!alive(bridge),2000));
});

test('网关日志超过 5 MB 就在启动时轮换',async t=>{
  const dir=fakeGateway(t),port=await freePort();
  fs.mkdirSync(path.join(dir,'logs'));fs.writeFileSync(path.join(dir,'logs/gateway.log'),Buffer.alloc(6*1024*1024,97));
  const {logMaxBytes,...opts}=fast(dir,port);
  const s=await supervisor(t,opts);
  assert.equal(await s.start(),'started');
  assert.equal(fs.statSync(path.join(dir,'logs/gateway.log.1')).size,6*1024*1024);
  assert.ok(fs.statSync(path.join(dir,'logs/gateway.log')).size<1024);
});

test('插件挂载：effect 里启动，清理函数里停止',async t=>{
  const dir=fakeGateway(t),port=await freePort(),{probeHealth}=await gw();
  const plugin=await import(pathToFileURL(path.join(lib,'index.js')).href);
  assert.equal(plugin.name,'liming-gateway');
  const effects=[];plugin.apply({effect:fn=>effects.push(fn)},fast(dir,port));
  assert.equal(effects.length,1);
  const dispose=effects[0]();
  assert.ok(await waitFor(()=>probeHealth({host:'127.0.0.1',port,timeoutMs:500})));
  await dispose();
  assert.equal(await probeHealth({host:'127.0.0.1',port,timeoutMs:500}),false);
});
