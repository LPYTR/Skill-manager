// Isolated browser acceptance checks. Never changes the user's real library.
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { Manager } from '../dist/core/manager.js';
import { buildServer } from '../dist/server.js';
import { guideFor } from '../web/guides.ts';
const { values } = parseArgs({ options: { playwright: { type:'string' }, browser:{ type:'string' }, output:{ type:'string' }, catalog:{type:'string'} } });
const { chromium } = await import(values.playwright ? pathToFileURL(values.playwright).href : 'playwright');
const temp = await fs.mkdtemp(path.join(os.tmpdir(),'skill-manager-ui-'));
const manager = await Manager.open({ home:path.join(temp,'manager'),userHome:path.join(temp,'user') });
let app, browser;
try {
  for (const [name,description,body] of [['apple-design','Apple interface design','正文检索独有词'],['imagegen','Generate or edit images',''],['documents','Create Word documents','']]) {
    const directory=path.join(temp,'fixtures',name); await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory,'SKILL.md'),`---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n${body}\n`);
    await manager.add(directory,{install:false});
  }
  if(values.catalog) {
    const catalog=JSON.parse((await fs.readFile(values.catalog,'utf8')).replace(/^\uFEFF/,''));
    const unknown=catalog.data.filter(skill=>!guideFor(skill).reviewed).map(skill=>skill.name);
    assert.deepEqual(unknown,[], 'Current catalog needs Chinese guides');
    console.log(JSON.stringify({guideCoverage:catalog.data.length,uniqueSkills:new Set(catalog.data.map(s=>s.name)).size}));
  }
  const unknown=guideFor({name:'unknown-skill',description:'Unsupported custom functionality',metadata:{}});
  assert.equal(unknown.reviewed,false); assert.match(unknown.prompt,/先读取/);
  app=await buildServer(manager); const address=await app.listen({host:'127.0.0.1',port:0});
  browser=await chromium.launch({headless:true,...(values.browser?{executablePath:values.browser}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:address});
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(address); await page.getByRole('button',{name:'查看 apple-design',exact:true}).waitFor();
  assert.equal(await page.locator('nav button').count(),2);
  assert.equal(await page.getByRole('button',{name:/添加 Skill|扫描本机|安装位置|需要关注|已安装/}).count(),0);
  for(const [query,expected] of [['材质','apple-design'],['生成图片','imagegen'],['正文检索独有词','apple-design']]) {
    await page.getByRole('textbox',{name:'搜索技能'}).fill(query);
    assert.equal(await page.locator('.skill-row').count(),1);
    await page.getByRole('button',{name:`查看 ${expected}`,exact:true}).waitFor();
  }
  await page.getByRole('button',{name:'清空搜索'}).click();
  await page.getByRole('button',{name:'查看 apple-design',exact:true}).click();
  await page.getByRole('heading',{name:'怎么调用',exact:true}).waitFor();
  assert.match(await page.locator('.prompt').innerText(),/apple-design.*\n.*Apple/s);
  await page.getByRole('button',{name:'复制调用提示词',exact:true}).click();
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/请使用「apple-design」技能/);
  await page.locator('.original summary').click(); await page.locator('.markdown h1').waitFor();
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.inspector').count(),0);
  await page.getByRole('button',{name:'收藏 apple-design',exact:true}).click();
  await page.getByRole('button',{name:'取消收藏 apple-design',exact:true}).waitFor();
  await page.getByRole('button',{name:/个人收藏/}).click(); assert.equal(await page.locator('.skill-row').count(),1);
  await page.reload(); await page.getByRole('button',{name:'取消收藏 apple-design',exact:true}).waitFor();
  await page.getByRole('button',{name:/个人收藏/}).click(); await page.getByRole('button',{name:'取消收藏 apple-design',exact:true}).click();
  await page.getByRole('heading',{name:'还没有收藏'}).waitFor();
  await page.getByRole('button',{name:/所有技能/}).click();
  await page.getByRole('textbox',{name:'搜索技能'}).fill('没有匹配的东西'); await page.getByRole('heading',{name:'没有找到相关技能'}).waitFor();
  await page.getByRole('button',{name:'清空搜索'}).click();
  await page.getByRole('button',{name:'查看 apple-design',exact:true}).click();
  if(values.output) {await fs.mkdir(values.output,{recursive:true});await page.screenshot({path:path.join(values.output,'skill-manager-light.png'),fullPage:true});}
  await page.getByRole('button',{name:'切换深色外观'}).click(); assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  if(values.output) await page.screenshot({path:path.join(values.output,'skill-manager-dark.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844}); await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(values.output) await page.screenshot({path:path.join(values.output,'skill-manager-narrow.png'),fullPage:true});
  await page.addStyleTag({content:'html{font-size:125%!important}'}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'关闭详情'}).click(); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['two navigation entries','no management UI','Chinese search','body search','Chinese guide','clipboard','original Markdown','keyboard dismiss','persistent favorites','empty states','dark mode','390px layout','larger text','reduced motion','no JS exceptions']}));
} finally {
  await browser?.close(); await app?.close(); manager.close();
  if(path.dirname(temp)!==os.tmpdir()||!path.basename(temp).startsWith('skill-manager-ui-')) throw new Error('Unsafe temporary directory');
  await fs.rm(temp,{recursive:true,force:true});
}
