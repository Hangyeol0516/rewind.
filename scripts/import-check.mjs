// Run against an isolated test server with REWIND_DATA_DIR pointing to its data.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
if (!process.env.REWIND_DATA_DIR) throw new Error('Use an isolated REWIND_DATA_DIR shared with the test server.');
const base = process.env.REWIND_URL || 'http://127.0.0.1:4318';
const db = new DatabaseSync(resolve(process.env.REWIND_DATA_DIR,'rewind.sqlite'));
const id = randomUUID();
db.prepare('INSERT INTO sites (id,url,title,created_at,daily,last_attempt,error) VALUES (?,?,?,?,1,?,?)').run(id,`https://example.com/?import-test=${id}`,'Import test',new Date().toISOString(),new Date().toISOString(),'웹사이트가 HTTP 403를 반환했어요.');
const browser = await chromium.launch({env:{...process.env,LD_LIBRARY_PATH:resolve('data/browser-libs/usr/lib/x86_64-linux-gnu')}});
const page = await browser.newPage({viewport:{width:390,height:844}});
const errors=[]; page.on('pageerror',error=>errors.push(error.message));
const api = async (path,method,data) => {
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 return {status:response.status,body:await response.json()};
};
try {
 await page.goto(`${base}/?site=${id}`);
 await page.locator('#import-error-image').waitFor();
 assert.match(await page.locator('.error-banner strong').textContent(),/403/);
 await page.locator('#fix-site-address').click();
 assert.equal(await page.locator('#site-address').inputValue(),`https://example.com/?import-test=${id}`);
 await page.keyboard.press('Escape');
 const invalid=await api(`/api/sites/${id}`,'PATCH',{display_name:'Must not change',url:'http://127.0.0.1'});
 assert.equal(invalid.status,400);
 assert.equal(db.prepare('SELECT display_name FROM sites WHERE id=?').get(id).display_name,null);
 const malformed=await api(`/api/sites/${id}/import`,'POST',{image:'data:image/png;base64,YWJj'});
 assert.equal(malformed.status,400);
 await page.locator('#import-error-image').click();
 const source=new PNG({width:1024,height:768});
 for(let i=0;i<source.data.length;i+=4){source.data[i]=70;source.data[i+1]=110;source.data[i+2]=60;source.data[i+3]=255;}
 await page.evaluate(()=>{const decode=window.createImageBitmap.bind(window);window.createImageBitmap=async(file,...args)=>{if(file.name==='older-selection.png')await new Promise(resolve=>setTimeout(resolve,250));return decode(file,...args);};});
 const older=new PNG({width:1024,height:768});for(let i=0;i<older.data.length;i+=4){older.data[i]=220;older.data[i+3]=255;}
 await page.locator('#import-file').setInputFiles({name:'older-selection.png',mimeType:'image/png',buffer:PNG.sync.write(older)});
 await page.locator('#import-file').setInputFiles({name:'screenshot.png',mimeType:'image/png',buffer:PNG.sync.write(source)});
 await page.waitForFunction(()=>!document.querySelector('#save-import').disabled);
 await page.waitForTimeout(350);
 const pixel=await page.evaluate(async()=>{const image=new Image();image.src=document.querySelector('#import-preview').src;await image.decode();const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=1000;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(100,100,1,1).data];});
 assert.deepEqual(pixel,[70,110,60,255],'latest image selection wins over a slower previous decode');
 assert.equal(await page.locator('#import-pause').isChecked(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#save-import').click();
 await page.waitForFunction(()=>!document.querySelector('#import-dialog').open);
 await page.locator('.moment').waitFor();
 assert.match(await page.locator('.moment-date').textContent(),/직접 가져옴/);
 const record=db.prepare('SELECT * FROM captures WHERE site_id=?').get(id);
 assert.equal(record.source,'import');
 assert.equal(db.prepare('SELECT daily FROM sites WHERE id=?').get(id).daily,0);
 const response=await fetch(base+`/captures/${record.id}.png`);
 const saved=PNG.sync.read(Buffer.from(await response.arrayBuffer()));
 assert.equal(saved.width,1440); assert.equal(saved.height,1000);
 assert.deepEqual(errors,[]);
 console.log('PASS: actionable 403 guidance, safe URL validation, screenshot upload, resizing, explicit pause, source attribution, mobile, PNG validation');
} catch (error) {
 console.log(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,wide:[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,id:el.id,cls:el.className,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width})).filter(el=>el.right>innerWidth+1||el.width>innerWidth+1).slice(0,20)})));
 await page.screenshot({path:'test-results/import-failure.png',fullPage:true});throw error;
} finally {
 await browser.close();
 await api(`/api/sites/${id}`,'DELETE');
 db.close();
}
