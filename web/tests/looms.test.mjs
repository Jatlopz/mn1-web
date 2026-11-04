import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoomConfig,normalizeLoomConfig,createLoomWeek,normalizeLoomWeek,saveLoomShift,loomMetric,loomDashboard,loomWeekKey,loomDays} from '../public/looms-model.js';
const config=()=>normalizeLoomConfig({version:1,people:[{id:'person-a',name:'Persona de prueba',enabled:true}],benches:[{id:'bench-a',name:'Bancada ficticia',enabled:true}],machines:[{id:'loom-a',name:'Telar ficticio',enabled:true,benchId:'bench-a',baseTarget:'1200'}]});
const entry=(overrides={})=>({machineId:'loom-a',benchId:'bench-a',personId:'person-a',baseTarget:'1200',actual:'600',hours:'6',state:'recorded',note:'',...overrides});
test('12 horas predeterminadas, metas proporcionales y cero real distinto de pendiente',()=>{
 assert.equal(loomMetric(entry()).efficiency,100);assert.equal(loomMetric(entry({hours:'12'})).efficiency,50);assert.equal(loomMetric(entry({actual:'0'})).efficiency,0);assert.equal(loomMetric(entry({state:'pending'})),null);assert.throws(()=>loomMetric(entry({hours:'0'})));assert.throws(()=>loomMetric(entry({actual:'-1'})));
});
test('semana ISO y claves de almacén respetan cambios de año y límite Android',()=>{
 assert.equal(createLoomWeek('2027-01-01').week,'2026-W53');assert.equal(loomDays('2026-11-04')[0],'2026-11-02');assert.equal(loomDays('2026-11-04').length,7);assert.ok(loomWeekKey('custom-11111111-1111-4111-8111-111111111111','2026-11-04').length<=64);assert.ok(loomWeekKey('a'.repeat(48),'2026-11-04').length<=64);assert.throws(()=>loomWeekKey('../','2026-11-04'));
});
test('configuración rechaza duplicados, metas inválidas y bancadas inexistentes',()=>{
 assert.deepEqual(createLoomConfig().machines,[]);const c=config();assert.throws(()=>normalizeLoomConfig({...c,machines:[...c.machines,c.machines[0]]}));assert.throws(()=>normalizeLoomConfig({...c,machines:[{...c.machines[0],baseTarget:'0'}]}));assert.throws(()=>normalizeLoomConfig({...c,machines:[{...c.machines[0],benchId:'missing'}]}));
});
test('captura guarda responsable histórico, mantiene otros días y no muta el original',()=>{
 const c=config(),w=createLoomWeek('2026-11-04');const a=saveLoomShift(w,c,'2026-11-04','TA',[entry()]);assert.equal(w.captures.length,0);c.people[0].name='Nombre cambiado';const b=saveLoomShift(a,c,'2026-11-05','TC',[entry({actual:'1200',hours:'12'})]);assert.equal(b.captures[0].personName,'Persona de prueba');assert.equal(b.captures[1].personName,'Nombre cambiado');assert.equal(a.captures.length,1);const pending=saveLoomShift(a,c,'2026-11-04','TA',[entry({state:'pending',actual:'',hours:'7',note:'Nota pendiente'})]);assert.equal(pending.captures[0].hours,'7');assert.equal(pending.captures[0].note,'Nota pendiente');assert.equal(loomDashboard(pending).efficiency,null);const corrected=saveLoomShift(a,c,'2026-11-04','TA',[entry({actual:'700'})]);assert.equal(corrected.captures[0].personName,'Persona de prueba');
});
test('dashboard pondera producción y metas, no promedia porcentajes ni inventa pendientes',()=>{
 const c=config(),a=saveLoomShift(createLoomWeek('2026-11-04'),c,'2026-11-04','TA',[entry({hours:'12',actual:'600'})]);const b=saveLoomShift(a,c,'2026-11-05','TC',[entry({hours:'6',actual:'600'})]);const d=loomDashboard(b);assert.equal(d.efficiency,66.666666);assert.equal(d.actual,1200);assert.equal(d.target,1800);assert.equal(d.recorded,2);assert.equal(d.people[0].efficiency,d.efficiency);assert.equal(loomDashboard(b,{shift:'TA'}).efficiency,50);assert.equal(loomDashboard(b,{personId:'missing'}).efficiency,null);
});
test('capturas duplicadas, semana incorrecta e inactivo con producción se rechazan',()=>{
 const c=config(),w=saveLoomShift(createLoomWeek('2026-11-04'),c,'2026-11-04','TA',[entry()]);assert.throws(()=>normalizeLoomWeek({...w,captures:[...w.captures,...w.captures]},'2026-11-04'));assert.throws(()=>normalizeLoomWeek(w,'2026-12-01'));assert.throws(()=>saveLoomShift(w,c,'2026-11-04','TA',[entry({state:'inactive'})]));
 const inactive=saveLoomShift(w,c,'2026-11-04','TA',[entry({state:'inactive',actual:'',personId:''})]);assert.equal(loomDashboard(inactive).inactive,1);assert.equal(loomDashboard(inactive).efficiency,null);
});
