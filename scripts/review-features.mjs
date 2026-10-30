// Read-only deployment verification: all browser mutation requests are blocked.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.env.REWIND_URL;
if(!base)throw new Error('Set REWIND_URL to the deployment to inspect.');
const directory=resolve('test-results/features');await mkdir(directory,{recursive:true});
const browser=await chromium.launch({env:{...process.env,LD_LIBRARY_PATH:[resolve('data/browser-libs/usr/lib/x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'ko-KR'});
const errors=[],mutations=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',route=>{if(!['GET','HEAD'].includes(route.request().method())){mutations.push(route.request().url());return route.abort();}return route.continue();});
try {
 const response=await page.goto(base+'/?view=list');assert.equal(response.status(),200);await page.locator('#archive[aria-busy=false]').waitFor();
 const {sites}=await page.evaluate(()=>fetch('/api/sites').then(r=>r.json()));
 const before=await readFile(resolve(directory,'live-before.json'),'utf8').then(JSON.parse).catch(()=>null);
 if(before)for(const prior of before){const current=sites.find(s=>s.id===prior.id);assert.ok(current,'site preserved');for(const id of prior.records)assert.ok(current.captures.some(c=>c.id===id),'record preserved');}
 assert.ok(sites.every(s=>Array.isArray(s.tags)&&typeof s.group_name==='string'));
 const attempts=await page.evaluate(()=>fetch('/api/attempts?limit=1').then(r=>({ok:r.ok,json:r.json()})).then(async r=>({ok:r.ok,...await r.json})));
 assert.equal(attempts.ok,true);assert.ok(Array.isArray(attempts.attempts));
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:width<600?844:1000});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(directory,`live-list-${width}.png`)});
  if(width<600)await page.locator('#mobile-menu').click();
  await page.locator('#open-activity').click();await page.locator('#activity-results[aria-busy=false]').waitFor();
  await page.screenshot({path:resolve(directory,`live-activity-${width}.png`)});
  await page.keyboard.press('Escape');
  if(width<600)await page.waitForFunction(()=>document.activeElement.id==='mobile-menu');
 }
 const first=sites.find(s=>s.captures.length);
 if(first){await page.locator(`.card-title[data-site="${first.id}"]`).click();await page.locator('#change-filter').waitFor();await page.selectOption('#change-filter','unavailable');await page.screenshot({path:resolve(directory,'live-changes-390.png')});}
 assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
 const result={http:200,sites:sites.length,records:sites.reduce((n,s)=>n+s.captures.length,0),existingRecordsPreserved:!!before,mutations:mutations.length,widths:[1440,390]};
 await writeFile(resolve(directory,'live-result.json'),JSON.stringify(result,null,2));console.log(result);
}finally{await browser.close();}
