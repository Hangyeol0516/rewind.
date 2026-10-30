import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {capturePage} from '../capture-browser.mjs';
import {analyzeContent} from '../content-analysis.mjs';

test('production capture extracts rendered main text while excluding hidden and navigation text', async t => {
 const directory = await mkdtemp(resolve(tmpdir(),'rewind-content-capture-'));
 const server = http.createServer((req,res) => {
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end('<title>Owned content fixture</title><nav>Navigation noise</nav><main><h1>오늘의 소식</h1><p>본문 문장이에요.</p><p style="display:none">Hidden noise</p></main>');
 });
 await new Promise(ready => server.listen(0,'127.0.0.1',ready));
 t.after(async () => { await new Promise(done => server.close(done)); await rm(directory,{recursive:true,force:true}); });
 const origin = `http://127.0.0.1:${server.address().port}`;
 const result = await capturePage({url:origin+'/',path:resolve(directory,'main.png'),
  verifyUrl:async url => { assert.ok(url.startsWith(origin+'/')); },
  env:{...process.env,LD_LIBRARY_PATH:[resolve(import.meta.dirname,'../data/browser-libs/usr/lib/x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},
 });
 assert.equal(result.content.scope,'main');
 assert.match(result.content.text,/오늘의 소식/);
 assert.match(result.content.text,/본문 문장이에요/);
 assert.doesNotMatch(result.content.text,/Hidden noise|Navigation noise/);
 assert.equal(result.content.truncated,false);
 assert.equal(analyzeContent(result.content,null,origin).content_change,'new');
 assert.ok(result.buffer.length > 0);
});
