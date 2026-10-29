// Controlled local fixtures: tests the production capture path without accessing
// OP.GG or changing its browser identity/network route.
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {PNG} from 'pngjs';
import {capturePage,CaptureFailure} from '../capture-browser.mjs';
const directory=await mkdtemp(resolve(tmpdir(),'rewind-capture-check-'));
const requests=[];
const server=http.createServer((req,res)=>{
 requests.push({url:req.url,headers:req.headers});
 if(req.url==='/deny') {res.writeHead(403,{'Content-Type':'text/html','Server':'FixtureCloudFront','x-amz-cf-id':'fixture-request-id'});return res.end('<title>Request blocked</title><body>Fixture access denied.</body>');}
 if(req.url==='/tall' || req.url==='/infinite') {res.writeHead(200,{'Content-Type':'text/html'});return res.end(`<style>body{margin:0;height:${req.url==='/tall'?3200:22000}px;background:white}footer{position:absolute;top:3000px;background:red;width:100%;height:100px}</style><title>Tall fixture</title><footer>Bottom of page</footer>`);}
 res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>Fixture success</title><body><h1>Capture works</h1><p>This is an owned local fixture.</p><img src="/private-resource"></body>');
});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const origin=`http://127.0.0.1:${server.address().port}`;
const verifyUrl=async value=>{if(!value.startsWith(origin+'/')||value.endsWith('/private-resource'))throw new Error('Fixture URL blocked');};
const env={...process.env,LD_LIBRARY_PATH:[resolve('data/browser-libs/usr/lib/x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')};
try {
 const success=await capturePage({url:origin+'/',path:resolve(directory,'success.png'),env,verifyUrl});
 assert.equal(success.title,'Fixture success');assert.ok((await stat(resolve(directory,'success.png'))).size>0);
 assert.equal(success.details.blocked_resources.length,1);
 assert.equal(success.details.response.status,200);
 await assert.rejects(capturePage({url:origin+'/deny',path:resolve(directory,'deny.png'),env,verifyUrl}),error=>{
  assert.ok(error instanceof CaptureFailure);assert.equal(error.details.stage,'upstream_http_error');
  assert.equal(error.details.response.status,403);assert.equal(error.details.response.headers['x-amz-cf-id'],'fixture-request-id');
  assert.match(error.details.response.text,/Fixture access denied/);assert.match(error.details.request.headers['user-agent'],/HeadlessChrome/);
  assert.ok(!('cookie' in error.details.request.headers));return true;
 });
 await assert.rejects(stat(resolve(directory,'deny.png')));
 await assert.rejects(capturePage({url:'http://127.0.0.1/',path:resolve(directory,'blocked.png'),env}),error=>error.details.stage==='url_validation');
 assert.ok(requests.some(req=>req.url==='/deny'));
 assert.ok(!requests.some(req=>req.url==='/private-resource'));
 const viewport=await capturePage({url:origin+'/tall',path:resolve(directory,'viewport.png'),env,verifyUrl});assert.equal(PNG.sync.read(viewport.buffer).height,1000);
 const full=await capturePage({url:origin+'/tall',path:resolve(directory,'full.png'),captureMode:'full_page',env,verifyUrl});const fullPng=PNG.sync.read(full.buffer);assert.equal(fullPng.width,1440);assert.equal(fullPng.height,3200);assert.equal(full.details.capture.truncated,false);assert.equal(fullPng.data[(3050*1440+100)*4],255);assert.equal(fullPng.data[(3050*1440+100)*4+1],0);
 const limited=await capturePage({url:origin+'/infinite',path:resolve(directory,'limited.png'),captureMode:'full_page',env,verifyUrl});assert.equal(PNG.sync.read(limited.buffer).height,20000);assert.equal(limited.details.capture.truncated,true);
 console.log('PASS: viewport/full-page dimensions, bottom content, bounded long page; unchanged production browser settings, real fixture screenshot, upstream 403 attribution, no error screenshot, no credential logging, resource guard, initial URL guard');
} finally {await new Promise(done=>server.close(done));await rm(directory,{recursive:true,force:true});}
