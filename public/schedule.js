// Shared by the scheduler and the UI. Daily clock times are explicitly Korea time.
export const SCHEDULE_TIMEZONE = 'Asia/Seoul';
export const DEFAULT_SCHEDULE = {schedule_mode:'interval',interval_hours:24,interval_minutes:1440,daily_time:'09:00'};
const MINUTE=60000, HOUR=60*MINUTE, DAY=24*HOUR, KST=9*HOUR;

export function validateSchedule(input, {partial=false}={}) {
 const result=partial ? {} : {...DEFAULT_SCHEDULE};
 if(input.schedule_mode!==undefined) {
  if(!['interval','daily_time'].includes(input.schedule_mode)) throw new Error('촬영 방식은 간격 또는 매일 지정 시각으로 선택해 주세요.');
  result.schedule_mode=input.schedule_mode;
 }
 if(input.daily_time!==undefined) {
  if(typeof input.daily_time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.daily_time)) throw new Error('촬영 시각을 00:00~23:59 사이에서 선택해 주세요.');
  result.daily_time=input.daily_time;
 }
 if(input.interval_hours!==undefined && (!Number.isInteger(input.interval_hours)||input.interval_hours<1||input.interval_hours>720)) throw new Error('촬영 간격은 1~720시간 사이의 정수로 입력해 주세요.');
 if(input.interval_minutes!==undefined && (!Number.isInteger(input.interval_minutes)||input.interval_minutes<1||input.interval_minutes>43200)) throw new Error('촬영 간격은 1~43,200분 사이의 정수로 입력해 주세요.');
 if(input.interval_hours!==undefined && input.interval_minutes!==undefined && input.interval_minutes!==input.interval_hours*60) throw new Error('분과 시간 간격이 서로 맞지 않아요.');
 if(input.interval_minutes!==undefined || input.interval_hours!==undefined) {
  result.interval_minutes=input.interval_minutes ?? input.interval_hours*60;
  result.interval_hours=result.interval_minutes/60;
 }
 return result;
}
export function scheduleOf(site) {
 const minutes=Number.isInteger(site.interval_minutes) && site.interval_minutes>=1 && site.interval_minutes<=43200 ? site.interval_minutes : Number.isInteger(site.interval_hours) && site.interval_hours>=1 && site.interval_hours<=720 ? site.interval_hours*60 : 1440;
 return {
  schedule_mode:site.schedule_mode==='daily_time' ? 'daily_time' : 'interval',
  interval_minutes:minutes,interval_hours:minutes/60,
  daily_time:typeof site.daily_time==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(site.daily_time) ? site.daily_time : '09:00',
 };
}
export function scheduleLabel(site) {
 const config=scheduleOf(site);
 return config.schedule_mode==='daily_time' ? `매일 ${config.daily_time}` : config.interval_minutes%60===0 ? `매 ${config.interval_minutes/60}시간` : `매 ${config.interval_minutes}분`;
}
function clockSlot(time, now) {
 const local=new Date(now+KST), [hour,minute]=time.split(':').map(Number);
 return Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),hour,minute)-KST;
}
export function nextScheduledAt(site, now=Date.now()) {
 if(!site.daily || site.paused) return null;
 const config=scheduleOf(site), parsed=Date.parse(site.last_attempt), last=Number.isFinite(parsed)?parsed:-Infinity;
 if(config.schedule_mode==='interval') return new Date(Math.max(now,last+config.interval_minutes*MINUTE)).toISOString();
 const today=clockSlot(config.daily_time,now), latest=today<=now ? today : today-DAY;
 if(last<latest) return new Date(now).toISOString();
 const anchor=Math.max(now,last), candidate=clockSlot(config.daily_time,anchor);
 return new Date(candidate>anchor ? candidate : candidate+DAY).toISOString();
}
export function isCaptureDue(site, now=Date.now()) {
 const next=nextScheduledAt(site,now);
 return next!==null && Date.parse(next)<=now;
}
