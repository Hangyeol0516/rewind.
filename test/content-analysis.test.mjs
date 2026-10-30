import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateOrganization,parseTags,normalizeContent,analyzeContent} from '../content-analysis.mjs';

test('organization input normalizes names and rejects invalid data before persistence', () => {
 assert.deepEqual(validateOrganization({tags:[' 뉴스 ','뉴스','업무'],group_name:' 읽을거리 '}),{tags:['뉴스','업무'],group_name:'읽을거리'});
 assert.deepEqual(validateOrganization({tags:[],group_name:''}),{tags:[],group_name:''});
 for (const tags of [null,'tag',[1],[' '],['a'.repeat(31)],Array(21).fill('tag')]) assert.throws(() => validateOrganization({tags}));
 for (const group_name of [null,12,'a'.repeat(61)]) assert.throws(() => validateOrganization({group_name}));
 assert.deepEqual(parseTags('bad JSON'),[]);
 assert.deepEqual(parseTags('["news",1]'),['news']);
});

test('normalized visible text ignores spacing and Unicode composition without hiding text changes', () => {
 assert.equal(normalizeContent('  Hello\n world\u200B\t '),'Hello world');
 const initial = analyzeContent({text:'뉴스\n 오늘 소식',scope:'main'},null,'https://example.com/');
 assert.equal(initial.content_change,'new');
 assert.equal(initial.content_hash.length,64);
 const previous = {id:'previous',...initial};
 const same = analyzeContent({text:' 뉴스   오늘 소식 ',scope:'main'},previous,'https://example.com/');
 assert.equal(same.content_change,'unchanged');
 assert.equal(same.compared_capture_id,'previous');
 const changed = analyzeContent({text:'뉴스 오늘 새로운 소식',scope:'main'},previous,'https://example.com/');
 assert.equal(changed.content_change,'changed');
 assert.match(changed.content_summary,/자동 갱신/);
 assert.notEqual(changed.content_hash,initial.content_hash);
});

test('missing baselines, imports, empty or truncated text never claim unchanged content', () => {
 for (const content of [null,{text:''},{text:'   '},{text:'some text',truncated:true}]) {
  assert.equal(analyzeContent(content).content_change,'unavailable');
  assert.equal(analyzeContent(content).content_hash,null);
 }
 const legacy = analyzeContent({text:'A'.repeat(500),scope:'body'},{id:'legacy'},'https://example.com/');
 assert.equal(legacy.content_change,'unavailable');
 assert.equal(legacy.content_excerpt.length,240);
 assert.equal(legacy.compared_capture_id,'legacy');
 assert.match(legacy.content_summary,/직전 기록/);
 const previous = {id:'a',...analyzeContent({text:'hello',scope:'main'},null,'https://example.com/')};
 assert.equal(analyzeContent({text:'hello',scope:'body'},previous,'https://example.com/').content_change,'unavailable');
 assert.equal(analyzeContent({text:'hello',scope:'main'},previous,'https://example.com/new').content_change,'unavailable');
 assert.equal(analyzeContent({text:'hello',scope:'main'},null,'https://example.com/').content_change,'new');
});
