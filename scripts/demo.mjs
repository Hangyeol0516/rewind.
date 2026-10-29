// Records a real demo using Wikipedia's random-article URL. Keeps the archive.
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {rename,writeFile} from 'node:fs/promises';
const base=process.env.REWIND_URL||'http://127.0.0.1:4317';
const browser=await chromium.launch({env:{...process.env,LD_LIBRARY_PATH:[resolve(process.env.REWIND_DATA_DIR||'data','browser-libs/usr/lib/x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:'test-results/demo',size:{width:1440,height:1000}}});
const page=await context.newPage();
const target='https://en.wikipedia.org/wiki/Special:Random';
let id;
const read=async()=> (await(await fetch(base+'/api/sites')).json()).sites;
async function wait(count){
 for(let i=0;i<100;i++){
  const site=(await read()).find(s=>s.id===id);
  if(site?.error&&!site.capturing)throw new Error(site.error);
  if(site?.captures.length>=count&&!site.capturing)return site;
  await page.waitForTimeout(1000);
 }
 throw new Error('Capture timeout');
}
try {
 await page.goto(base);
 const existing=(await read()).find(s=>s.url===target);
 if(existing){id=existing.id;await page.goto(`${base}/?site=${id}`);}
 else{
  await page.locator('#add-site').click();
  await page.locator('#url').fill(target);
  await page.waitForTimeout(1000);
  await page.locator('#submit-url').click();
  await page.waitForFunction(()=>!document.querySelector('#add-dialog').open);
  id=(await read()).find(s=>s.url===target).id;
 }
 const first=await wait(1);
 if(first.captures.length<2){
  await page.waitForFunction(()=>document.querySelector('#capture-now')&&!document.querySelector('#capture-now').disabled);
  await page.locator('#capture-now').click();
 }
 const site=await wait(2);
 await page.goto(`${base}/?site=${id}&mode=compare`);
 await page.locator('.compare-range').waitFor();
 await page.locator('#daily').uncheck();
 await page.waitForTimeout(1000);
 await page.locator('#viewer').scrollIntoViewIfNeeded();
 await page.waitForTimeout(1000);
 for(const value of [5,20,35,50,65,80,95,80,65,50]){
  await page.locator('.compare-range').fill(String(value));
  await page.waitForTimeout(400);
 }
 await page.screenshot({path:'docs/demo.png',fullPage:false});
 await page.waitForTimeout(1000);
 console.log(JSON.stringify({id,url:`${base}/?site=${id}&mode=compare`,captures:site.captures.map(c=>({title:c.title,date:c.created_at}))}));
 await writeFile('test-results/demo-details.json',JSON.stringify({id,captures:site.captures},null,2));
}finally{
 const video=page.video();
 await context.close();
 await rename(await video.path(),'docs/demo.webm');
 await browser.close();
}
