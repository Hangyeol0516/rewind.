import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateDiff} from '../public/diff.js';

test('identical images and threshold boundary do not count as changes',()=>{
 const before=new Uint8ClampedArray([255,255,255,255,0,0,0,255]);
 assert.equal(calculateDiff(before,before).changed,0);
 const after=new Uint8ClampedArray([223,255,255,255,0,0,0,255]);
 assert.equal(calculateDiff(before,after,32).changed,0);
 assert.equal(calculateDiff(before,after,31).changed,1);
});
test('changed pixels are highlighted, untouched pixels stay transparent',()=>{
 const before=new Uint8ClampedArray([255,255,255,255,0,0,0,255]);
 const after=new Uint8ClampedArray([0,0,0,255,0,0,0,255]);
 const result=calculateDiff(before,after);
 assert.equal(result.changed,1);assert.equal(result.total,2);
 assert.equal(result.overlay[3],160);assert.equal(result.overlay[7],0);
 assert.equal(calculateDiff(after,before).changed,1);
});
test('transparent pixels are composited onto white before comparison',()=>{
 assert.equal(calculateDiff(new Uint8ClampedArray([0,0,0,0]),new Uint8ClampedArray([255,255,255,255])).changed,0);
});
test('invalid dimensions and thresholds are rejected',()=>{
 assert.throws(()=>calculateDiff(new Uint8ClampedArray(4),new Uint8ClampedArray(8)));
 assert.throws(()=>calculateDiff(new Uint8ClampedArray(3),new Uint8ClampedArray(3)));
 assert.throws(()=>calculateDiff(new Uint8ClampedArray(4),new Uint8ClampedArray(4),-1));
});
