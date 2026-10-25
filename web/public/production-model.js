/* Cálculos y borradores de producción. No consulta Sysprod ni publica datos. */
import {defaultCatalog,normalizeCatalog,catalogText,isProcessId,PROCESS_LIMITS} from './plant-catalog.js';
const numericFields=['runningCount','totalCount','target','actual','wasteTarget','wasteActual'];
const text=(value,limit=100)=>catalogText(typeof value==='number'?String(value):value,limit);
function localDate(date=new Date()){return String(date.getFullYear()).padStart(4,'0')+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
/** Shift dates follow the shift's start day, including the hours after midnight. */
export function productionTimingFor(now=new Date()) {
 const clock=new Date(now);if(!Number.isFinite(clock.getTime()))throw Error('Hora del teléfono no válida.');
 const hour=clock.getHours(),day=hour>=6&&hour<18;
 const statusDay=new Date(clock);if(hour<6)statusDay.setDate(statusDay.getDate()-1);
 const efficiencyDay=new Date(statusDay);if(day)efficiencyDay.setDate(efficiencyDay.getDate()-1);
 return {date:localDate(statusDay),efficiencyDate:localDate(efficiencyDay),efficiencyShift:day?'TC':'TA',statusShift:day?'TA':'TC',period:day?'day':'night'};
}
function cleanCatalog(catalog,plant){return normalizeCatalog(catalog,plant??catalog?.plantId??'sacos');}
function defaultRow(process){return {name:process.name,active:null,product:'',action:'',comment:'',efficiencyComment:'',runningCount:'',totalCount:'',target:'',actual:'',wasteTarget:'',wasteActual:'',unit:process.unit,includeEfficiency:process.efficiency};}
export function productionDraftKey(teamId){if(!isProcessId(teamId))throw Error('Identificador de equipo no válido.');return 'mn1.production.'+teamId;}
export function createProductionReport(catalog,context={}) {
 const c=cleanCatalog(catalog??defaultCatalog(context.plantId),context.plantId);
 const processes=c.processes.filter(p=>p.enabled),timing=productionTimingFor(context.now??new Date());
 const timingMode=context.timingMode??(context.date||context.efficiencyShift||context.statusShift?'manual':'automatic');
 return {version:1,timingMode,efficiencyDate:text(context.efficiencyDate??context.date??timing.efficiencyDate,40),teamId:text(context.teamId,48),teamName:text(context.teamName),plantId:c.plantId,date:text(context.date??timing.date,40),efficiencyShift:text(context.efficiencyShift??timing.efficiencyShift,16),statusShift:text(context.statusShift??timing.statusShift,16),rows:Object.fromEntries(processes.map(p=>[p.id,defaultRow(p)])),catalogSnapshot:{...c,processes:processes.map(p=>({...p,products:[...p.products],actions:[...p.actions]}))},updatedAt:new Date().toISOString()};
}
function normalizeRow(raw,definition){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Fila de proceso no válida.');
 const row={...defaultRow(definition),name:text(raw.name??definition.name),active:raw.active===true?true:raw.active===false?false:null,product:text(raw.product,200),action:text(raw.action,100),comment:text(raw.comment,2000),efficiencyComment:text(raw.efficiencyComment??raw.comment,2000),unit:text(raw.unit??definition.unit,24),includeEfficiency:typeof raw.includeEfficiency==='boolean'?raw.includeEfficiency:definition.efficiency};
 for(const key of numericFields){const value=typeof raw[key]==='number'?String(raw[key]):raw[key]??'';if(typeof value!=='string'||value.length>64)throw Error('Dato numérico no válido o demasiado largo.');row[key]=value.trim();}
 return row;
}
export function normalizeProductionReport(raw,catalog,context={}) {
 if(raw===null||raw===undefined)return createProductionReport(catalog,context);
 if(typeof raw!=='object'||Array.isArray(raw)||raw.version!==1)throw Error('Formato o versión de reporte no compatible.');
 if(context.teamId&&raw.teamId&&context.teamId!==raw.teamId)throw Error('El borrador pertenece a otro equipo.');
 if(context.plantId&&raw.plantId&&context.plantId!==raw.plantId)throw Error('El borrador pertenece a otra planta.');
 const plant=context.plantId??raw.plantId??catalog?.plantId??'sacos';const c=cleanCatalog(catalog,plant);
 const base=createProductionReport(c,{...context,teamId:context.teamId??raw.teamId,teamName:context.teamName??raw.teamName});
 if(!raw.rows||typeof raw.rows!=='object'||Array.isArray(raw.rows)||Object.keys(raw.rows).length>PROCESS_LIMITS.processes)throw Error('Filas de reporte no válidas.');
 const snapshot=raw.catalogSnapshot?normalizeCatalog(raw.catalogSnapshot,plant):c;
 const definitions=[];
 const rows=Object.fromEntries(Object.entries(raw.rows).map(([id,value])=>{
  if(!isProcessId(id))throw Error('Identificador de proceso no válido.');
  const definition=snapshot.processes.find(p=>p.id===id)??c.processes.find(p=>p.id===id)??{id,name:text(value?.name)||id,unit:text(value?.unit,24),efficiency:value?.includeEfficiency===true,products:[],actions:[],enabled:true};
  definitions.push({...definition,products:[...definition.products],actions:[...definition.actions]});
  return [id,normalizeRow(value,definition)];
 }));
 return {...base,teamId:text(context.teamId??raw.teamId,48),teamName:text(context.teamName??raw.teamName),date:text(raw.date??base.date,40),efficiencyDate:text(raw.efficiencyDate??raw.date??base.efficiencyDate,40),timingMode:raw.timingMode==='automatic'?'automatic':'manual',efficiencyShift:text(raw.efficiencyShift??base.efficiencyShift,16),statusShift:text(raw.statusShift??base.statusShift,16),rows,catalogSnapshot:{version:1,plantId:plant,processes:definitions},updatedAt:typeof raw.updatedAt==='string'?raw.updatedAt:base.updatedAt};
}
function decimal(value){
 if(value===null||value===undefined||(typeof value==='string'&&!value.trim()))return {kind:'missing',value:null};
 const raw=typeof value==='number'?String(value):typeof value==='string'?value.trim():'';
 if(raw.length>64)return {kind:'invalid',value:null};
 if(!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(raw))return {kind:'invalid',value:null};
 const n=Number(raw.replace(',','.'));return Number.isFinite(n)&&n>=0?{kind:'number',value:n}:{kind:'invalid',value:null};
}
export function calculateEfficiency(row={}) {
 if(!row||typeof row!=='object')row={};
 const errors=[],target=decimal(row.target),actual=decimal(row.actual);let efficiency=null;
 if(target.kind==='missing')errors.push('Falta la meta.');else if(target.kind!=='number'||target.value<=0)errors.push('La meta debe ser un número mayor que cero, sin separadores de miles.');
 if(actual.kind==='missing')errors.push('Falta la producción real.');else if(actual.kind!=='number')errors.push('La producción real debe ser un número no negativo, sin separadores de miles.');
 if(target.kind==='number'&&target.value>0&&actual.kind==='number'){
  const result=actual.value/target.value*100;if(Number.isFinite(result))efficiency=result;else errors.push('La eficiencia excede el rango numérico permitido.');
 }
 const percentage=(key,label)=>{const parsed=decimal(row[key]);if(parsed.kind==='missing')return null;if(parsed.kind!=='number'||parsed.value>100){errors.push(label+' debe estar entre 0 y 100 %.');return null;}return parsed.value;};
 return {efficiency,wasteTarget:percentage('wasteTarget','La meta de desperdicio'),wasteActual:percentage('wasteActual','El desperdicio real'),errors};
}
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
export function validateProductionReport(report,catalog) {
 const errors=[];
 if(!report||typeof report!=='object'||Array.isArray(report))return ['Reporte no válido.'];
 if(report.version!==1)errors.push('Versión del reporte no compatible.');
 if(!isProcessId(report.teamId)||!text(report.teamName))errors.push('Selecciona un equipo válido.');
 if(!validDate(report.date)||!validDate(report.efficiencyDate??report.date))errors.push('Selecciona fechas válidas para eficiencias y estatus.');
 if(!text(report.efficiencyShift,16)||!text(report.statusShift,16))errors.push('Indica ambos turnos del reporte.');
 if(!report.rows||typeof report.rows!=='object'||Array.isArray(report.rows))return [...errors,'Agrega al menos un proceso.'];
 const entries=Object.entries(report.rows);
 if(!entries.length)errors.push('Agrega al menos un proceso.');
 if(entries.length>PROCESS_LIMITS.processes)errors.push('El reporte admite hasta 40 procesos.');
 let definitions=[];
 try{definitions=normalizeCatalog(report.catalogSnapshot??catalog,report.plantId??catalog?.plantId??'sacos').processes;}catch{errors.push('El catálogo del reporte no es válido.');}
 for(const [id,row] of entries){
  const process=definitions.find(p=>p.id===id);const label=text(row?.name??process?.name)||id;
  if(!isProcessId(id)||!row||typeof row!=='object'||Array.isArray(row)){errors.push(label+': fila de proceso no válida.');continue;}
  if(row.active!==true&&row.active!==false)errors.push(label+': confirma el estatus activo o inactivo.');
  if(typeof row.includeEfficiency!=='boolean')errors.push(label+': confirma si se incluye en eficiencias.');
  if(row.includeEfficiency===true&&hasEfficiencyInput(row)){const result=calculateEfficiency(row);for(const error of result.errors)errors.push(label+': '+error);if(!text(row.unit,24))errors.push(label+': indica la unidad de producción.');if(requiresEfficiencyReason(row)&&!text(row.efficiencyComment??row.comment,2000))errors.push(label+': agrega una razón o comentario porque la eficiencia es de 90 % o menos.');}
  const running=decimal(row.runningCount),total=decimal(row.totalCount);
  if(running.kind!=='missing'||total.kind!=='missing'){
   if(running.kind!=='number'||total.kind!=='number'||!Number.isSafeInteger(running.value)||!Number.isSafeInteger(total.value)||running.value>total.value)errors.push(label+': las cantidades operativas deben ser enteros no negativos y la cantidad activa no puede superar el total.');
  }
 }
 return errors;
}

/** A blank machine is omitted; a partially captured machine must still be validated. */
export function hasEfficiencyInput(row={}) {
 return ['target','actual','wasteTarget','wasteActual'].some(key=>row[key]!==null&&row[key]!==undefined&&String(row[key]).trim()!=='');
}
export function efficiencyRows(report) {
 return Object.entries(report?.rows??{}).filter(([,row])=>row.includeEfficiency===true&&hasEfficiencyInput(row));
}
/** Quantities are comparable only within the exact same editable unit. */
export function productionTotals(report) {
 const groups=new Map();
 for(const [,row] of efficiencyRows(report)){
  const unit=text(row.unit,24)||'Sin unidad';
  if(!groups.has(unit))groups.set(unit,{unit,target:0,actual:0,efficiency:null,processes:0,pending:0});
  const group=groups.get(unit),result=calculateEfficiency(row);
  if(result.efficiency===null){group.pending++;continue;}
  group.target+=decimal(row.target).value;group.actual+=decimal(row.actual).value;group.processes++;
 }
 return [...groups.values()].map(group=>({...group,efficiency:group.target>0?group.actual/group.target*100:null}));
}

/** Decimal comparison keeps the colour bands and required reason exact at their boundaries. */
function compareEfficiencyTo(row,percent) {
 const target=decimal(row.target),actual=decimal(row.actual);
 if(target.kind!=='number'||target.value<=0||actual.kind!=='number')return null;
 const parts=value=>{const [whole,fraction='']=String(value).trim().replace(',','.').split('.');return {integer:BigInt((whole||'0')+fraction),scale:fraction.length};};
 const t=parts(row.target),a=parts(row.actual),scale=Math.max(t.scale,a.scale);
 const left=a.integer*10n**BigInt(scale-a.scale)*100n,right=t.integer*10n**BigInt(scale-t.scale)*BigInt(percent);
 return left<right?-1:left>right?1:0;
}
export function requiresEfficiencyReason(row={}) {
 const comparison=compareEfficiencyTo(row,90);return comparison!==null&&comparison<=0;
}
export function efficiencyBand(row={}) {
 const lower=compareEfficiencyTo(row,80);if(lower===null)return 'empty';
 if(lower<0)return 'critical';return compareEfficiencyTo(row,90)<0?'warning':'normal';
}
export const PRODUCTION_REPORT_TITLE='Reporte de estatus y eficiencias de planta';
/** Presentation only: inactive values remain in the draft for later use. */
export function productionStatusDisplay(row={}) {
 const active=row.active===true;
 return {active,status:active?'En funcionamiento':row.active===false?'Inactivo':'Sin confirmar',
  productAction:active?[row.product,row.action].filter(Boolean).join(' · '):'',
  observations:active?[row.runningCount!==''&&row.runningCount!=null&&row.totalCount!==''&&row.totalCount!=null?row.runningCount+'/'+row.totalCount+' unidades activas':'',row.comment].filter(Boolean).join(' · '):''};
}
