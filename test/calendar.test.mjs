import test from 'node:test';
import assert from 'node:assert/strict';
import {monthCells,monthRange} from '../public/calendar.js';
test('calendar places dates on weekdays and handles leap years and year rollover',()=>{
 const leap=monthCells('2028-02');assert.equal(leap.filter(Boolean).length,29);assert.equal(leap.indexOf('2028-02-01'),2);assert.ok(leap.includes('2028-02-29'));
 assert.equal(monthCells('2027-02').filter(Boolean).length,28);
 assert.equal(new Date(monthRange('2026-12').to).getFullYear(),2027);
 assert.equal(monthCells('2026-11')[0],'2026-11-01');
 for(const bad of ['2026-13','2026-00','2026-1','invalid','1969-12'])assert.throws(()=>monthRange(bad));
});
