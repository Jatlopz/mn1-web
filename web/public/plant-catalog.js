/* Catálogo de procesos compartido por las herramientas de cada planta. Sin datos operativos. */
export const PROCESS_LIMITS = Object.freeze({processes:40, options:40, name:100, id:48});
const ACTIONS = ['Producción','Arranque','Cambio de orden','Mantenimiento','Sin orden'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const unsafeIds = new Set(['__proto__','prototype','constructor']);
export const isProcessId = value => typeof value === 'string' && ID.test(value) && !unsafeIds.has(value);
export function catalogText(value, limit=100) {
 return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,limit) : '';
}
function plantId(value) {
 const id=String(value ?? 'sacos');
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(id)) throw Error('Identificador de planta no válido.');
 return id;
}
export function catalogKey(plant='sacos') { return 'mn1.catalog.plant.'+plantId(plant); }
export function defaultCatalog(plant='sacos') {
 const id=plantId(plant);
 const definitions=id==='sacos' ? [
  ['extrusion','Extrusión','kg',true],['telares','Telares','unidades',false],
  ['laminado','Laminado','m',true],['imprenta','Imprenta','m',true],
  ['slitter','Slitter','unidades',false],['conversion-1','Conversión 1','sacos',true],
  ['conversion-3','Conversión 3','sacos',true],['valvulado','Valvulado','unidades',false],
  ['liner','Liner','unidades',false],['costura','Costura','unidades',false],['empaque','Empaque','unidades',false],
 ] : [];
 return {version:1,plantId:id,processes:definitions.map(([id,name,unit,efficiency])=>({id,name,unit,efficiency,products:[],actions:[...ACTIONS],enabled:true}))};
}
function options(value) {
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>PROCESS_LIMITS.options)throw Error('Cada proceso admite hasta 40 opciones.');
 const seen=new Set(),result=[];
 for(const entry of value){const label=catalogText(entry);const key=label.toLocaleLowerCase('es');if(label&&!seen.has(key)){seen.add(key);result.push(label);}}
 return result;
}
export function normalizeCatalog(raw, plant='sacos') {
 const id=plantId(plant);
 if(raw===null||raw===undefined)return defaultCatalog(id);
 if(typeof raw!=='object'||Array.isArray(raw))throw Error('El catálogo no tiene un formato válido.');
 if(raw.version!==undefined&&raw.version!==1)throw Error('Versión de catálogo no compatible.');
 if(raw.plantId!==undefined&&raw.plantId!==id)throw Error('El catálogo pertenece a otra planta.');
 if(!Array.isArray(raw.processes)||raw.processes.length>PROCESS_LIMITS.processes)throw Error('El catálogo admite hasta 40 procesos.');
 const seen=new Set();
 const processes=raw.processes.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||!isProcessId(value.id))throw Error('Identificador de proceso no válido.');
  if(seen.has(value.id))throw Error('El catálogo contiene identificadores de proceso repetidos.');seen.add(value.id);
  const name=catalogText(value.name);if(!name)throw Error('Cada proceso necesita un nombre.');
  return {id:value.id,name,unit:catalogText(value.unit,24),efficiency:value.efficiency===true,products:options(value.products),actions:value.actions===undefined?[...ACTIONS]:options(value.actions),enabled:value.enabled!==false};
 });
 return {version:1,plantId:id,processes};
}
