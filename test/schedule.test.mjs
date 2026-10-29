import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSchedule,nextScheduledAt,isCaptureDue} from '../public/schedule.js';
const now=Date.parse('2026-10-29T01:00:00Z'); // Korea 10:00.
const base={daily:1,paused:0,last_attempt:'2026-10-29T00:00:00Z'};
test('existing registrations retain the 24-hour interval',()=>{
 assert.equal(nextScheduledAt(base,now),'2026-10-30T00:00:00.000Z');
 assert.equal(isCaptureDue(base,now),false);
});
test('hourly intervals trigger exactly at the boundary',()=>{
 const site={...base,interval_hours:2};
 assert.equal(isCaptureDue(site,Date.parse(base.last_attempt)+7200000-1),false);
 assert.equal(isCaptureDue(site,Date.parse(base.last_attempt)+7200000),true);
 for(const flag of [{daily:0},{paused:1}])assert.equal(nextScheduledAt({...site,...flag},now),null);
});
test('daily clocks use Korea time independently of the server timezone',()=>{
 const site={...base,schedule_mode:'daily_time',daily_time:'10:30'};
 assert.equal(nextScheduledAt(site,now),'2026-10-29T01:30:00.000Z');
 assert.equal(isCaptureDue(site,Date.parse('2026-10-29T01:29:59Z')),false);
 assert.equal(isCaptureDue(site,Date.parse('2026-10-29T01:30:00Z')),true);
});
test('one attempt fulfills a daily slot, including failures and manual captures',()=>{
 const site={...base,schedule_mode:'daily_time',daily_time:'09:00',error:'failed'};
 assert.equal(nextScheduledAt(site,now),'2026-10-30T00:00:00.000Z');
 assert.equal(nextScheduledAt({...site,last_attempt:'2026-10-29T00:15:00Z'},now),'2026-10-30T00:00:00.000Z');
});
test('missed days coalesce into one catch-up; midnight crosses the UTC date correctly',()=>{
 const site={...base,last_attempt:'2026-10-25T00:00:00Z',schedule_mode:'daily_time',daily_time:'00:00'};
 assert.equal(isCaptureDue(site,now),true);
 assert.equal(nextScheduledAt({...site,last_attempt:new Date(now).toISOString()},now),'2026-10-29T15:00:00.000Z');
 assert.equal(isCaptureDue({...site,paused:1},now),false);
});
test('first capture is immediate and no schedule repeats after a completed slot',()=>{
 assert.equal(nextScheduledAt({...base,last_attempt:null,schedule_mode:'daily_time',daily_time:'23:59'},now),new Date(now).toISOString());
 assert.equal(nextScheduledAt({...base,last_attempt:'2026-10-30T00:00:00Z',schedule_mode:'daily_time',daily_time:'09:00'},now),'2026-10-31T00:00:00.000Z');
});
test('invalid schedule inputs are rejected before database mutations',()=>{
 for(const interval_hours of [0,-1,1.5,721,'2',null])assert.throws(()=>validateSchedule({interval_hours}));
 for(const daily_time of ['9:00','24:00','12:60','00:00:00','',null])assert.throws(()=>validateSchedule({daily_time}));
 assert.throws(()=>validateSchedule({schedule_mode:'invalid'}));
 assert.deepEqual(validateSchedule({daily_time:'09:30'},{partial:true}),{daily_time:'09:30'});
 assert.deepEqual(validateSchedule({}, {partial:true}),{});
 assert.equal(validateSchedule({interval_hours:720,daily_time:'23:59'}).interval_hours,720);
});
test('minute intervals preserve legacy hours and trigger at a minute boundary',()=>{
 const site={...base,interval_minutes:5,interval_hours:24};
 assert.equal(isCaptureDue(site,Date.parse(base.last_attempt)+5*60000-1),false);
 assert.equal(isCaptureDue(site,Date.parse(base.last_attempt)+5*60000),true);
 assert.equal(validateSchedule({interval_hours:2}).interval_minutes,120);
 assert.equal(validateSchedule({interval_minutes:5}).interval_hours,5/60);
 for(const interval_minutes of [0,-1,1.5,43201,'5',null])assert.throws(()=>validateSchedule({interval_minutes}));
 assert.throws(()=>validateSchedule({interval_hours:1,interval_minutes:5}));
});
