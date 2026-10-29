import { chromium } from 'playwright';
import { assertPublicUrl } from './lib.mjs';

const requestFields = new Set(['accept','accept-language','user-agent','sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform','upgrade-insecure-requests']);
const responseFields = new Set(['server','content-type','via','x-cache','x-amz-cf-id','cf-ray']);
const pick = (headers, fields) => Object.fromEntries(Object.entries(headers).filter(([name]) => fields.has(name.toLowerCase())));
const safeUrl = value => { try { const url = new URL(value); return url.origin+url.pathname; } catch { return '[invalid URL]'; } };

export class CaptureFailure extends Error {
 constructor(message, details) { super(message); this.name='CaptureFailure'; this.details=details; }
}

// URL verification is injected only by the local fixture tests. Production uses
// assertPublicUrl for the initial URL and every redirect/resource, as before.
export async function capturePage({url,path,captureMode='viewport',env=process.env,verifyUrl=assertPublicUrl}) {
 const started=Date.now();
 const details={url:safeUrl(url),started_at:new Date(started).toISOString(),stage:'url_validation',blocked_resources:[]};
 let browser;
 try {
  if (!['viewport','full_page'].includes(captureMode)) throw new Error('촬영 범위가 올바르지 않아요.');
  await verifyUrl(url);
  details.stage='browser_launch';
  browser=await chromium.launch({headless:true,env});
  details.browser_version=browser.version();
  const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,locale:'ko-KR',timezoneId:'Asia/Seoul',colorScheme:'light',serviceWorkers:'block',acceptDownloads:false});
  await context.route('**/*',async route => {
   try { await verifyUrl(route.request().url()); await route.continue(); }
   catch(error) {
    if(details.blocked_resources.length<30) details.blocked_resources.push({url:safeUrl(route.request().url()),reason:error.message});
    await route.abort().catch(()=>{});
   }
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
  page.on('requestfailed',request=>{
   if(request.isNavigationRequest() && request.frame()===page.mainFrame()) details.navigation_failure=request.failure()?.errorText;
  });
  details.stage='navigation';
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  if(!response) throw new Error('사이트에서 HTTP 응답을 받지 못했어요.');
  details.request={method:response.request().method(),headers:pick(await response.request().allHeaders(),requestFields)};
  details.response={status:response.status(),url:safeUrl(response.url()),headers:pick(response.headers(),responseFields),server_address:await response.serverAddr().catch(()=>null),tls:await response.securityDetails().catch(()=>null)};
  if(response.status()>=400) {
   details.stage='upstream_http_error';
   details.response.title=(await page.title()).slice(0,200);
   details.response.text=(await page.locator('body').innerText({timeout:1500}).catch(()=>'')).slice(0,1500);
   const source=details.response.headers.server;
   throw new Error(`원본 사이트${source ? ` (${source})` : ''}가 HTTP ${response.status()}를 반환했어요.`);
  }
  details.stage='render_wait';
  await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{});
  await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,2000))]));
  const maxHeight=20000;
  if(captureMode==='full_page') {
   details.stage='page_scroll';
   // Bounded scrolling loads ordinary lazy images without following infinite feeds forever.
   await page.evaluate(async limit=>{
    const until=Date.now()+7000;
    for(let y=0;y<Math.min(document.documentElement.scrollHeight,limit) && Date.now()<until;y+=850) {
     window.scrollTo(0,y); await new Promise(resolve=>setTimeout(resolve,120));
    }
    window.scrollTo(0,0);
   },maxHeight);
   await page.waitForLoadState('networkidle',{timeout:2000}).catch(()=>{});
  }
  const title=(await page.title()).slice(0,200)||new URL(url).hostname;
  const pageHeight=await page.evaluate(()=>Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0,1000));
  const height=captureMode==='full_page' ? Math.min(pageHeight,maxHeight) : 1000;
  details.capture={mode:captureMode,width:1440,height,truncated:captureMode==='full_page' && pageHeight>maxHeight};
  details.stage='screenshot';
  const buffer=await page.screenshot({path,fullPage:captureMode==='full_page',...(captureMode==='full_page' ? {clip:{x:0,y:0,width:1440,height}} : {}),animations:'disabled',timeout:15000});
  details.stage='saved';details.elapsed_ms=Date.now()-started;
  return {title,buffer,details};
 } catch(error) {
  details.elapsed_ms=Date.now()-started;details.error=error.message;
  throw new CaptureFailure(error.message,details);
 } finally { if(browser) await browser.close().catch(()=>{}); }
}
