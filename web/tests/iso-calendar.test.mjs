import test from 'node:test';
import assert from 'node:assert/strict';
import {isoWeekInfo,isoMonthWeeks,formatIsoCalendarDate} from '../public/iso-calendar.js';

test('25 de octubre de 2026 corresponde a la semana ISO43, lunes19 a domingo25',()=>{
 assert.deepEqual(isoWeekInfo('2026-10-25'),{date:'2026-10-25',week:43,weekYear:2026,weekKey:'2026-W43',weekday:7,startDate:'2026-10-19',endDate:'2026-10-25'});
 assert.equal(formatIsoCalendarDate('2026-10-25'),'25/octubre/2026');
 assert.equal(formatIsoCalendarDate('2026-10-25','en-US'),'25/October/2026');
});
test('el año ISO puede diferir del año calendario y admite semana53',()=>{
 for(const [date,year,week] of [['2015-12-31',2015,53],['2016-01-01',2015,53],['2016-01-04',2016,1],['2018-12-31',2019,1],['2020-12-31',2020,53],['2021-01-03',2020,53],['2021-01-04',2021,1],['2026-12-31',2026,53],['2027-01-01',2026,53],['2027-01-04',2027,1]]){const actual=isoWeekInfo(date);assert.equal(actual.weekYear,year,date);assert.equal(actual.week,week,date);}
});
test('valida fechas estrictas, bisiestos y no altera las fechas recibidas',()=>{
 for(const invalid of ['2026-02-29','2026-04-31','2026-13-01','2026-1-01','not-a-date','0000-01-01',null,{},new Date(NaN)])assert.throws(()=>isoWeekInfo(invalid));
 assert.equal(isoWeekInfo('2024-02-29').week,9);assert.equal(isoWeekInfo('2000-02-29').week,9);assert.throws(()=>isoWeekInfo('1900-02-29'));
 const date=new Date(2026,9,25,23,59),before=date.getTime();assert.equal(isoWeekInfo(date).date,'2026-10-25');assert.equal(date.getTime(),before);
});
test('el mes se organiza por semanas completas de lunes a domingo con número ISO',()=>{
 const weeks=isoMonthWeeks('2026-10');assert.equal(weeks.length,5);assert.equal(weeks[0].days[0],'2026-09-28');assert.equal(weeks.at(-1).days.at(-1),'2026-11-01');
 assert.deepEqual(weeks.map(row=>row.week),[40,41,42,43,44]);assert.ok(weeks.every(row=>row.days.length===7));
 assert.throws(()=>isoMonthWeeks('2026-13'));assert.throws(()=>isoMonthWeeks('2026-2'));
 const feb=isoMonthWeeks('2021-02');assert.equal(feb.length,4);assert.equal(feb[0].days[0],'2021-02-01');
});
test('Date se interpreta en la fecha local del teléfono, no en la fecha UTC',async()=>{
 const {execFileSync}=await import('node:child_process');const module=new URL('../public/iso-calendar.js',import.meta.url).href;
 for(const [zone,date,week] of [['UTC','2026-10-26',44],['America/Tegucigalpa','2026-10-25',43],['Pacific/Kiritimati','2026-10-26',44],['America/Los_Angeles','2026-10-25',43]]){
 const code='import {isoWeekInfo} from '+JSON.stringify(module)+'; console.log(JSON.stringify(isoWeekInfo(new Date("2026-10-26T00:30:00Z"))))';
 const out=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TZ:zone},encoding:'utf8'}));assert.equal(out.date,date,zone);assert.equal(out.week,week,zone);
 }
});

test('el cierre de la última semana del año9999 se puede presentar sin romper el calendario',()=>{
 const end=isoWeekInfo('9999-12-31').endDate;assert.equal(end,'10000-01-02');assert.equal(formatIsoCalendarDate(end),'02/enero/10000');
 assert.throws(()=>isoWeekInfo('10000-01-02'));assert.throws(()=>formatIsoCalendarDate('10000-13-02'));
});
