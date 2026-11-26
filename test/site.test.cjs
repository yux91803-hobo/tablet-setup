// 这个仓库的根目录整个由 Cloudflare Pages 发布到 https://tablet.liming-work.com/ ，平板装机脚本从那里下载文件。
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
// 装到平板或云电脑上的文件
const CODE=['setup.sh','ib.sh','dsh-tablet.sh','dsh-task.sh','dsh-tablet-profile.yml',...walk(path.join(root,'liming-gateway')),...walk(path.join(root,'skills'))]
  .map(f=>path.isAbsolute(f)?f:path.join(root,f));

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
