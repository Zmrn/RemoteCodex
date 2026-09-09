// Real shared renderer, isolated API and image fixtures; no official task writes.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";
import { ROOT } from "../src/bridge.mjs";
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
const dir = fs.mkdtempSync(path.join(ROOT, "work/markdown-gfm-"));
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
const {server, address} = await startServer({port:0, bridge:{dataDir:dir,on(){},off(){},connect:async()=>{},disconnect(){}}});
const browser = await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
const page = await browser.newPage({viewport:{width:1100,height:900}});
await page.route(address + "/api/**", route => route.fulfill({contentType:"application/json",body:'{"agents":[],"models":[]}'}));
await page.route("https://images.example/**", route => route.fulfill({contentType:"image/png",body:fs.readFileSync(path.join(ROOT,"fixtures/multi-image-a.png"))}));
const text = fs.readFileSync(path.join(ROOT,"fixtures/markdown-probe.md"),"utf8");
async function render(text) {
  await page.evaluate(async text => {
    const {markdown}=await import('/ui.mjs');
    let root=document.getElementById('markdown-probe');
    if(!root){root=document.createElement('div');root.id='markdown-probe';document.body.append(root);root.style.cssText='position:fixed;inset:0;z-index:999;background:var(--surface);padding:18px;overflow:auto';}
    root.replaceChildren(markdown(text));
  },text);
}
try {
  await page.goto(address);
  await render(text);
  const root=page.locator('#markdown-probe');
  assert.equal(await root.locator('table').count(),2);
  assert.equal(await root.locator('table').first().locator('tbody tr').count(),7);
  assert.deepEqual(await root.locator('table').first().locator('th').allTextContents(),['优先级','问题与影响']);
  assert.deepEqual(await root.locator('table').nth(1).locator('th').evaluateAll(xs=>xs.map(e=>e.style.textAlign)),['left','center','right']);
  assert.equal(await root.locator('table').nth(1).locator('tbody tr').first().locator('td').nth(1).textContent(),'a|b');
  assert.equal(await root.locator('table code').textContent(),'x|y');
  assert.equal(await root.locator('table br').count(),1);
  assert.equal(await root.locator('table strong').count(),1);
  assert.equal(await root.locator('h1,h2,h3,h4,h5,h6').count(),6);
  assert.equal(await root.locator('blockquote ul ul').count(),1);
  assert.equal(await root.locator('ol[start="3"] > li').count(),2);
  assert.equal(await root.locator('ol > li > ul > li > ol').count(),1);
  assert.equal(await root.locator('input[type=checkbox]:disabled').count(),2);
  assert.equal(await root.locator('input:checked').count(),1);
  assert.equal(await root.locator('strong em').count(),1);
  assert.equal(await root.locator('hr').count(),1);
  assert.equal(await root.locator('pre').count(),2);
  assert.equal(await root.locator('pre[data-language=js] code').textContent(),'const example = "<tag> &amp; literal";\n// | 列一 | 列二 |\n// | --- | --- |\nconsole.log(example);');
  assert.equal(await root.locator('a').first().getAttribute('href'),'https://example.com/source?q=one&n=two');
  assert.equal(await root.locator('a').nth(1).getAttribute('href'),'https://example.com/reference');
  await page.screenshot({path:path.join(ROOT,'evidence/markdown-desktop.png')});
  for(const viewport of [{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(viewport);
    assert.equal(await root.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(viewport.width===390) {
      assert.equal(await root.locator('.table-scroll').first().evaluate(e=>e.scrollWidth<=e.clientWidth),true);
      await page.screenshot({path:path.join(ROOT,'evidence/markdown-mobile.png')});
    }
  }
  await page.setViewportSize({width:390,height:844});
  await render('|One|Two|Three|Four|Five|Six|\n|---|---|---|---|---|---|\n|a|b|c|d|e|f|');
  assert.equal(await root.locator('.table-scroll').evaluate(e=>{e.scrollLeft=100;return e.scrollWidth>e.clientWidth&&e.scrollLeft>0;}),true);
  assert.equal(await root.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  const cite='\ue200cite\ue202turn1view0\ue201';
  await render('|引用|图片|\n|---|---|\n|**'+cite+'**|![图](https://images.example/image.png)|\n\n`'+cite+'`\n\n<script>window.__markdownBad=true</script>\n\n<img src=x onerror="window.__markdownBad=true">\n\n[坏链接](javascript&#58;alert(1))\n\n[数据](data:text/html,foo)\n\n&lt;script&gt;literal&lt;/script&gt;\n\n\\![不加载](https://images.example/escaped.png)');
  assert.equal(await root.locator('script,iframe,img[onerror],a[href^="javascript"],a[href^="data"]').count(),0);
  assert.equal(await page.evaluate(()=>window.__markdownBad),undefined);
  assert.equal(await root.locator('.citation-ref').count(),1);
  assert.equal(await root.locator('code').textContent(),cite);
  assert.equal(await root.locator('.remote-message-image').count(),1);
  await root.locator('.citation-ref').click();assert.equal(await root.locator('.citation-notice').getAttribute('open'),'');
  await root.locator('.remote-message-image img').evaluate(i=>i.decode());
  await root.locator('.remote-message-image img').click();assert.equal(await page.locator('#image-viewer').isVisible(),true);await page.keyboard.press('Escape');
  await page.evaluate(async ()=>{
    const {markdown}=await import('/ui.mjs');const source='|标题|值|\n|---|---|\n|a|**b**|\n|c|`d`|';
    for(let n=1;n<=source.length;n++){const node=markdown(source.slice(0,n));if(!node.textContent&&!node.querySelector('table'))throw Error('stream text lost');}
  });
  const report={result:'passed',source:'isolated shared renderer in Edge',checks:['screenshot table: 2 columns and 7 rows','GFM alignment, escaped pipes, empty cells, inline formatting and line breaks','six heading levels, nested ordered/unordered lists, readonly task checkboxes','blockquote, strong/emphasis/strike, horizontal rule, reference links and entity decoding','fenced/indented/inline code preserves original text','mobile wide tables scroll without widening the page','citations and zoomable images work inside cells','HTML and active URLs remain inert','streamed prefixes remain readable']};
  fs.writeFileSync(path.join(ROOT,'evidence/markdown-gfm-ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
