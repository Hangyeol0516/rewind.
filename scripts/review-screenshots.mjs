// Read-only live screenshots. Mutation requests are explicitly blocked in this browser.
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.REWIND_URL,stage=process.env.REVIEW_STAGE||'before';
if(!base)throw new Error('Set REWIND_URL to the site to review (read-only).');
const directory=resolve('test-results',`usability-${stage}`);await mkdir(directory,{recursive:true});
const browser=await chromium.launch({env:{...process.env,LD_LIBRARY_PATH:resolve('data/browser-libs/usr/lib/x86_64-linux-gnu')}});
const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul'});
const mutations=[];await page.route('**/api/**',route=>{if(!['GET','HEAD'].includes(route.request().method())){mutations.push(route.request().url());return route.abort();}return route.continue();});
try{
 await page.goto(`${base}/?view=list`);await page.locator('#archive[aria-busy=false]').waitFor();
 const {sites}=await page.evaluate(()=>fetch('/api/sites').then(r=>r.json()));
 const manifest=sites.map(site=>({id:site.id,records:site.captures.map(c=>c.id)}));
 await writeFile(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2));
 if(stage==='after'){
  const before=JSON.parse(await readFile(resolve('test-results/usability-before/manifest.json'),'utf8'));
  for(const prior of before){const current=manifest.find(s=>s.id===prior.id);assert.ok(current,'existing site preserved');for(const id of prior.records)assert.ok(current.records.includes(id),'existing record preserved');}
 }
 const first=sites.find(s=>s.captures.length>1)||sites[0];
 for(const width of[1440,390]){
  await page.setViewportSize({width,height:width===1440?1000:844});await page.goto(`${base}/?view=list`);await page.locator('#archive[aria-busy=false]').waitFor();
  await page.screenshot({path:resolve(directory,`list-${width}.png`),fullPage:true});
  if(first){
   await page.locator(`.card-title[data-site="${first.id}"]`).click();await page.locator('#viewer-title').waitFor();
   await page.screenshot({path:resolve(directory,`detail-${width}.png`),fullPage:true});
   if(first.captures.length>1){for(const mode of['compare','split','diff']){
    await page.locator(`#${mode}-mode`).click();if(mode==='diff')await page.locator('#diff-summary[data-ready=true]').waitFor();
    await page.screenshot({path:resolve(directory,`${mode}-${width}.png`),fullPage:true});
   }}
  }
  await page.locator(width<=700?'#mobile-add':first?'#add-from-viewer':'#add-site').click();await page.screenshot({path:resolve(directory,`add-${width}.png`)});await page.locator('#close-dialog').click();
  if(first)await page.locator('#back-to-archive').click();
  await page.locator('#search').fill('rewind-no-result-screenshot');await page.screenshot({path:resolve(directory,`empty-${width}.png`)});
 }
 assert.deepEqual(mutations,[]);console.log(JSON.stringify({stage,sites:manifest.length,records:manifest.reduce((n,s)=>n+s.records.length,0),mutations:mutations.length,directory}));
}finally{await browser.close();}
