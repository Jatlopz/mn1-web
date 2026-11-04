import {isoWeekInfo} from './iso-calendar.js';

const SCALE=1000000n;
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
const fail=message=>{throw Error(message||'Datos de Telares no válidos. El original se conserva.');};
export function loomText(value){if(typeof value!=='string'||!value.trim()||value.trim().length>100||/[\x00-\x1f\x7f]/.test(value))fail('Usa un nombre de 1 a 100 caracteres.');return value.trim();}
export function loomNumber(value,{hours=false}={}){if(typeof value!=='string'||!/^\d+(?:[.,]\d{1,6})?$/.test(value.trim()))return null;const n=Number(value.trim().replace(',','.'));return Number.isFinite(n)&&n>=0&&n<=(hours?24:1000000000)?n:null;}
const fixed=value=>{const [whole,fraction='']=value.trim().replace(',','.').split('.');return BigInt(whole)*SCALE+BigInt(fraction.padEnd(6,'0'));};
const ratio=(a,b)=>b===0n?null:Number(a*100000000n/b)/1000000;
export function loomConfigKey(team){if(!safeId(team))fail();return 'mn1.loom.cfg.'+team;}
export function loomWeekKey(team,date){if(!safeId(team))fail();return 'mn1.l.'+team+'.'+isoWeekInfo(date).weekKey;}
export function createLoomConfig(){return {version:1,people:[],benches:[],machines:[]};}
export function normalizeLoomConfig(raw){
 if(!raw||raw.version!==1||!Array.isArray(raw.people)||!Array.isArray(raw.benches)||!Array.isArray(raw.machines)||raw.people.length>100||raw.benches.length>50||raw.machines.length>100)fail();
 const ids=new Set();const named=value=>{if(!safeId(value.id)||ids.has(value.id)||typeof value.enabled!=='boolean')fail();ids.add(value.id);return {id:value.id,name:loomText(value.name),enabled:value.enabled};};
 const people=raw.people.map(named),benches=raw.benches.map(named),benchIds=new Set(benches.map(b=>b.id));
 const machines=raw.machines.map(v=>{const m=named(v);if(v.benchId!==''&&!benchIds.has(v.benchId))fail();if(v.baseTarget!==''&&(loomNumber(v.baseTarget)===null||loomNumber(v.baseTarget)===0))fail('La meta debe ser mayor que cero, en metros para 12 horas.');return {...m,benchId:v.benchId,baseTarget:v.baseTarget};});
 return {version:1,people,benches,machines};
}
export function createLoomWeek(date){const info=isoWeekInfo(date);return {version:1,week:info.weekKey,startDate:info.startDate,schedule:[],captures:[]};}
export function loomDays(date){const info=isoWeekInfo(date),start=new Date(info.startDate+'T00:00:00Z');return Array.from({length:7},(_,i)=>{const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});}
export function captureIdentity(row){return row.date+'|'+row.shift+'|'+row.machineId;}
export function loomMetric(row){
 if(row.state!=='recorded')return null;
 if(loomNumber(row.actual)===null||loomNumber(row.baseTarget)===null||loomNumber(row.baseTarget)===0||loomNumber(row.hours,{hours:true})===null||loomNumber(row.hours,{hours:true})===0)fail('Completa producción, meta positiva y horas mayores que cero.');
 const actual=fixed(row.actual)*SCALE*12n,target=fixed(row.baseTarget)*fixed(row.hours);
 return {actual:Number(fixed(row.actual))/1e6,target:Number(target)/12e12,efficiency:ratio(actual,target),actualExact:actual,targetExact:target};
}
export function normalizeLoomWeek(raw,date){
 const expected=createLoomWeek(date);if(!raw||raw.version!==1||raw.week!==expected.week||raw.startDate!==expected.startDate||!Array.isArray(raw.schedule)||!Array.isArray(raw.captures)||raw.schedule.length>100||raw.captures.length>1400)fail();
 const schedules=new Set(),captures=new Set();const schedule=raw.schedule.map(v=>{const key=v.benchId+'|'+v.shift;if(!safeId(v.benchId)||!['TA','TC'].includes(v.shift)||!safeId(v.personId)||schedules.has(key))fail();schedules.add(key);return {benchId:v.benchId,shift:v.shift,personId:v.personId};});
 const rows=raw.captures.map(v=>{if(!v||isoWeekInfo(v.date).weekKey!==expected.week||!['TA','TC'].includes(v.shift)||!safeId(v.machineId)||!['recorded','inactive','pending'].includes(v.state))fail();const key=captureIdentity(v);if(captures.has(key))fail('Hay capturas duplicadas para la misma máquina y turno.');captures.add(key);
 const row={date:v.date,shift:v.shift,machineId:v.machineId,machineName:loomText(v.machineName),benchId:v.benchId,benchName:v.state==='pending'&&v.benchId===''?'':loomText(v.benchName),personId:v.personId,personName:v.personName,state:v.state,actual:v.actual,baseTarget:v.baseTarget,hours:v.hours,note:typeof v.note==='string'?v.note:''};
 if((row.benchId!==''&&!safeId(row.benchId))||(row.state!=='pending'&&!safeId(row.benchId))||row.note.length>500)fail();if(v.state==='recorded'){if(!safeId(row.personId))fail('Selecciona la persona responsable.');row.personName=loomText(row.personName);loomMetric(row);}else if(row.state==='inactive'){if(row.actual!==''||row.personId!==''||row.personName!=='')fail();}else{if(row.actual!==''||(row.baseTarget!==''&&loomNumber(row.baseTarget)===null)||(row.hours!==''&&loomNumber(row.hours,{hours:true})===null))fail();if(row.personId!==''){if(!safeId(row.personId))fail();row.personName=loomText(row.personName);}else if(row.personName!=='')fail();}return row;});
 return {...expected,schedule,captures:rows};
}
export function saveLoomShift(week,config,date,shift,entries){
 normalizeLoomConfig(config);const current=normalizeLoomWeek(week,date);if(!['TA','TC'].includes(shift)||!Array.isArray(entries))fail();
 const next={...current,captures:current.captures.filter(r=>r.date!==date||r.shift!==shift)};const seen=new Set();
 for(const entry of entries){const machine=config.machines.find(m=>m.id===entry.machineId&&m.enabled);if(!machine||seen.has(entry.machineId))fail();seen.add(entry.machineId);
 if(entry.state==='pending'&&entry.actual.trim()!=='')fail('Confirma Capturado para incluir la producción ingresada.');
 const bench=config.benches.find(b=>b.id===entry.benchId);if(!bench&&entry.state!=='pending')fail('Asigna una bancada a cada telar.');const person=config.people.find(p=>p.id===entry.personId),old=current.captures.find(r=>r.date===date&&r.shift===shift&&r.machineId===machine.id),hasPerson=entry.state!=='inactive'&&Boolean(entry.personId);
 next.captures.push({date,shift,machineId:machine.id,machineName:old?.machineName||machine.name,benchId:bench?.id||'',benchName:old&&old.benchId===bench?.id?old.benchName:bench?.name||'',personId:hasPerson?person?.id:'',personName:hasPerson?(old&&old.personId===person?.id?old.personName:person?.name):'',state:entry.state,actual:entry.actual,baseTarget:entry.baseTarget,hours:entry.hours,note:entry.note||''});
 }
 // Archived machines' historical captures are retained even when not present in the form.
 next.captures.push(...current.captures.filter(r=>r.date===date&&r.shift===shift&&!seen.has(r.machineId)));
 return normalizeLoomWeek(next,date);
}
export function loomDashboard(week,{shift='',personId='',date=''}={}){
 const selected=week.captures.filter(r=>(!shift||r.shift===shift)&&(!date||r.date===date)&&(!personId||r.personId===personId));let actual=0n,target=0n;const people=new Map(),daily=new Map();
 for(const row of selected){const m=loomMetric(row);if(!m)continue;actual+=m.actualExact;target+=m.targetExact;for(const [map,key,name] of [[people,row.personId,row.personName],[daily,row.date+' '+row.shift,row.date+' '+row.shift]]){if(!map.has(key))map.set(key,{id:key,name,actual:0n,target:0n,count:0});const a=map.get(key);a.actual+=m.actualExact;a.target+=m.targetExact;a.count++;}}
 const result=(a,t)=>({actual:Number(a)/12e12,target:Number(t)/12e12,efficiency:ratio(a,t),gap:Number(a-t)/12e12});const unpack=map=>[...map.values()].map(r=>({...result(r.actual,r.target),id:r.id,name:r.name,count:r.count}));
 return {...result(actual,target),recorded:selected.filter(r=>r.state==='recorded').length,inactive:selected.filter(r=>r.state==='inactive').length,pending:selected.filter(r=>r.state==='pending').length,people:unpack(people),daily:unpack(daily).sort((a,b)=>a.id.localeCompare(b.id))};
}
