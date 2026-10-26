/** Shared central inventory, without seed counts, team assignments or operational status. */
export const REGISTRY_FLOWS=Object.freeze({entry:'Entrada',exit:'Salida'});
export const REGISTRY_CYCLES=Object.freeze({permanent:'Permanentes',seasonal:'Temporada'});
export const RESOURCE_KINDS=Object.freeze({machine:'Máquina',station:'Estación',activity:'Proceso sin recursos fijos'});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=()=>{throw Error('El catálogo recibido no es válido. No se modificó ningún dato.');};
const id=value=>{if(typeof value!=='string'||!UUID.test(value))fail();return value;};
const name=value=>{if(typeof value!=='string'||!value.trim()||value.trim().length>100||/[\x00-\x1f\x7f]/.test(value))throw Error('Usa un nombre de 1 a 100 caracteres, sin saltos de línea.');return value.trim();};
const bool=value=>{if(typeof value!=='boolean')fail();return value;};
const enumeration=(value,options)=>{if(!Object.hasOwn(options,value))fail();return value;};
const order=value=>{if(!Number.isSafeInteger(value)||value<1)fail();return value;};
export function validateProcessDraft(value){return {name:name(value.name),flow:enumeration(value.flow,REGISTRY_FLOWS),cycle:enumeration(value.cycle,REGISTRY_CYCLES),defaultKind:enumeration(value.defaultKind,RESOURCE_KINDS),enabled:bool(value.enabled)};}
export function validateResourceDraft(value){return {name:name(value.name),kind:enumeration(value.kind,{machine:1,station:1}),enabled:bool(value.enabled)};}
export function normalizeRegistry(raw,plantId){
 if(!raw||raw.version!==1||raw.plantId!==plantId||!Number.isSafeInteger(raw.revision)||raw.revision<0||!Array.isArray(raw.processes)||raw.processes.length>100)fail();
 const processIds=new Set(),resourceIds=new Set();let resources=0;
 const processes=raw.processes.map(value=>{
  const processId=id(value.id);if(processIds.has(processId))fail();processIds.add(processId);if(typeof value.code!=='string'||!value.code||value.code.length>100||!Array.isArray(value.resources))fail();
  return {id:processId,code:value.code,...validateProcessDraft(value),ordinal:order(value.ordinal),resources:value.resources.map(resource=>{const resourceId=id(resource.id);if(resourceIds.has(resourceId)||++resources>1000)fail();resourceIds.add(resourceId);return {id:resourceId,...validateResourceDraft(resource),ordinal:order(resource.ordinal)};}).sort((a,b)=>a.ordinal-b.ordinal)};
 }).sort((a,b)=>a.ordinal-b.ordinal);
 return {version:1,plantId,revision:raw.revision,processes};
}
export function registrySummary(catalog){const result={processes:0,machines:0,stations:0,archived:0};for(const process of catalog.processes){if(!process.enabled){result.archived++;continue;}result.processes++;for(const resource of process.resources)if(resource.enabled)result[resource.kind==='machine'?'machines':'stations']++;}return result;}
export function filterRegistry(catalog,{flow,cycle,includeArchived=false,query=''}={}){const search=query.trim().toLocaleLowerCase('es');return catalog.processes.filter(p=>(!flow||p.flow===flow)&&(!cycle||p.cycle===cycle)&&(includeArchived||p.enabled)&&(!search||p.name.toLocaleLowerCase('es').includes(search)||p.resources.some(r=>r.name.toLocaleLowerCase('es').includes(search))));}
