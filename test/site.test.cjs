// 这个仓库的根目录整个由 Cloudflare Pages 发布到 https://tablet.liming-work.com/ ，平板装机脚本从那里下载文件。
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
// 装到平板或云电脑上的文件
const CODE=[
  'setup.sh','ib.sh','crew.sh',
  ...walk(path.join(root,'liming-gateway')),
  ...walk(path.join(root,'liming-crew')),
  ...(fs.existsSync(path.join(root,'skills'))?walk(path.join(root,'skills')):[]),
].map(f=>path.isAbsolute(f)?f:path.join(root,f));

test('CODE 列表包含所有新件，且仓库里没有像 key 的字符串',()=>{
  const rels=new Set(CODE.map(f=>path.relative(root,f)));
  for(const want of ['setup.sh','ib.sh','crew.sh','skills/liming-crew/SKILL.md','skills/liming-crew/TEAM.template.md','liming-crew/package.json','liming-crew/cordis.patch.yml','liming-crew/lib/index.js','liming-crew/lib/views.js','liming-crew/lib/crew-client.js']){
    assert.ok(rels.has(want),'CODE 缺少：'+want);
  }
  const allFiles=d=>fs.readdirSync(d,{withFileTypes:true}).filter(e=>!(d===root&&e.name==='.git')).flatMap(e=>e.isDirectory()?allFiles(path.join(d,e.name)):[path.join(d,e.name)]);
  for(const f of allFiles(root)){
    const s=fs.readFileSync(f,'utf8');
    for(const re of [/ibssh_[A-Za-z0-9]{8,}/,/ibk_[A-Za-z0-9]{8,}/,/sk-[A-Za-z0-9]{16,}/]){
      assert.ok(!re.test(s),path.relative(root,f)+' 里像有密钥：'+re);
    }
  }
});

test('装出去的文件里不再出现旧地址（网站上的 /tablet/）和网站仓库的说明文档',()=>{
  for(const f of CODE){const s=fs.readFileSync(f,'utf8'),name=path.relative(root,f);
    assert.ok(!s.includes('liming-work.com/tablet'),name+' 还写着旧下载地址');
    assert.ok(!s.includes('docs/tablet.md'),name+' 还指向网站仓库的 docs/tablet.md，说明现在在这个仓库的 README');}
});

test('根目录有 404.html：缺的文件回 404（以后加了首页，Pages 也不会把首页当成缺的文件回 200），打开根地址能看到装机命令',()=>{
  const f=path.join(root,'404.html');
  assert.ok(fs.existsSync(f),'缺 404.html');
  const s=fs.readFileSync(f,'utf8');
  assert.ok(s.includes('curl -fsSL https://tablet.liming-work.com/setup.sh | bash'),'页面上要写装机命令');
  assert.match(s,/<meta name="viewport"/,'手机上能看');
});

test('README 和 AGENTS 不再提 dsh-task、dsh-tablet、Harness 的 tablet 配置',()=>{
  for(const name of ['README.md','AGENTS.md']){
    const s=fs.readFileSync(path.join(root,name),'utf8');
    assert.doesNotMatch(s,/dsh-task|dsh-tablet|profiles\/tablet|tablet 配置/,name+' 不应再提旧的 dsh-task/dsh-tablet/tablet 配置');
  }
});
