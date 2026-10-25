import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCatalog, normalizeCatalog, catalogKey } from '../public/plant-catalog.js';
import { createProductionReport, normalizeProductionReport, calculateEfficiency, validateProductionReport, productionDraftKey } from '../public/production-model.js';

const catalog = () => normalizeCatalog({processes:[{id:'mixing',name:'Proceso de prueba',unit:'kg',efficiency:true,products:[],actions:[],enabled:true}]}, 'sacos');
const context = {teamId:'fixture-team',teamName:'Equipo de prueba',plantId:'sacos',date:'2026-10-24',efficiencyShift:'TA',statusShift:'TC'};
function completed() {
 const c=catalog(),r=createProductionReport(c,context);
 r.rows.mixing={...r.rows.mixing,active:false,target:'80',actual:'100',wasteTarget:'0,25',wasteActual:'1,5'};
 return {c,r};
}
test('el catálogo inicial confirma unidades y no inventa procesos de otra planta',()=>{
 const c=defaultCatalog('sacos');
 assert.equal(c.processes.length,11);assert.equal(c.processes.filter(p=>p.efficiency).length,5);
 const units=Object.fromEntries(c.processes.map(p=>[p.id,p.unit]));
 assert.equal(units.extrusion,'kg');assert.equal(units.imprenta,'m');assert.equal(units.laminado,'m');assert.equal(units['conversion-1'],'sacos');assert.equal(units['conversion-3'],'sacos');
 assert.deepEqual(defaultCatalog('polietileno').processes,[]);
 assert.notEqual(catalogKey('sacos'),catalogKey('polietileno'));
 c.processes[0].actions.push('Prueba');assert.ok(!defaultCatalog('sacos').processes[0].actions.includes('Prueba'));
});
test('agregar y archivar procesos conserva IDs, opciones y datos del reporte existente',()=>{
 const {c,r}=completed();
 const changed=normalizeCatalog({...c,processes:[{...c.processes[0],enabled:false,unit:'lb',name:'Nombre nuevo'}, {id:'packing',name:'Empaque nuevo',unit:'unidades',efficiency:false}]});
 assert.equal(changed.processes[0].id,'mixing');assert.equal(changed.processes[0].enabled,false);
 const fresh=createProductionReport(changed,context);assert.ok(!Object.hasOwn(fresh.rows,'mixing'));assert.ok(Object.hasOwn(fresh.rows,'packing'));
 const restored=normalizeProductionReport(r,changed,context);
 assert.equal(restored.rows.mixing.actual,'100');assert.equal(restored.rows.mixing.unit,'kg');assert.equal(restored.rows.mixing.name,'Proceso de prueba');
 assert.equal(restored.catalogSnapshot.processes.find(p=>p.id==='mixing').name,'Proceso de prueba');
});
test('el catálogo permite unidades y opciones editables pero rechaza IDs duplicados y límites excedidos',()=>{
 const c=normalizeCatalog({processes:[{id:'test',name:' Proceso ',unit:'lb',efficiency:true,products:['Uno','Uno',' Dos '],actions:['A'],enabled:true}]});
 assert.equal(c.processes[0].unit,'lb');assert.deepEqual(c.processes[0].products,['Uno','Dos']);
 assert.throws(()=>normalizeCatalog({processes:[c.processes[0],c.processes[0]]}));
 assert.throws(()=>normalizeCatalog({processes:Array.from({length:41},(_,i)=>({id:'p'+i,name:'Proceso'}))}));
 assert.throws(()=>normalizeCatalog({processes:[{id:'../path',name:'Proceso'}]}));
});
test('eficiencia distingue cero de faltante, admite coma decimal y no limita resultados a 100%',()=>{
 const r=calculateEfficiency({target:'80',actual:'100',wasteTarget:'0,25',wasteActual:'1.50'});
 assert.equal(r.efficiency,125);assert.equal(r.wasteTarget,.25);assert.equal(r.wasteActual,1.5);assert.deepEqual(r.errors,[]);
 assert.equal(calculateEfficiency({target:'5',actual:'0'}).efficiency,0);
 assert.equal(calculateEfficiency({target:'',actual:'0'}).efficiency,null);
 assert.equal(calculateEfficiency({target:'0',actual:'0'}).efficiency,null);
 assert.equal(calculateEfficiency({target:'7,5',actual:'3,75'}).efficiency,50);
 assert.equal(calculateEfficiency({target:'5',actual:''}).efficiency,null);
 assert.equal(calculateEfficiency({target:'5',actual:'2'}).wasteActual,null);
});
test('los valores inválidos no generan porcentajes válidos ni descartan sus errores',()=>{
 for(const value of ['-1','NaN','Infinity','1e3','1,234.5','1 000']) {
  const result=calculateEfficiency({target:value,actual:'2'});assert.equal(result.efficiency,null);assert.ok(result.errors.length>0,value);
 }
 for(const value of ['-1','100.01','abc'])assert.ok(calculateEfficiency({target:'1',actual:'1',wasteActual:value}).errors.length>0);
 assert.equal(calculateEfficiency({target:'1',actual:'1',wasteActual:'0'}).wasteActual,0);
});
test('el reporte exige estatus confirmado sin inferir producción cero por estar inactivo',()=>{
 const {c,r}=completed();assert.deepEqual(validateProductionReport(r,c),[]);assert.equal(calculateEfficiency(r.rows.mixing).efficiency,125);
 r.rows.mixing.active=null;assert.ok(validateProductionReport(r,c).some(e=>/estado|estatus/i.test(e)));
 r.rows.mixing.active=true;r.rows.mixing.target='';assert.ok(validateProductionReport(r,c).some(e=>/meta/i.test(e)));
});
test('la exportación valida fecha, unidades y cantidades operativas sin sumar unidades diferentes',()=>{
 const {c,r}=completed();r.date='2026-02-30';assert.ok(validateProductionReport(r,c).some(e=>/fecha/i.test(e)));
 r.date='2026-10-24';r.rows.mixing.unit='';assert.ok(validateProductionReport(r,c).some(e=>/unidad/i.test(e)));
 r.rows.mixing.unit='kg';r.rows.mixing.runningCount='3';r.rows.mixing.totalCount='2';assert.ok(validateProductionReport(r,c).some(e=>/cantidades|cantidad|operativ/i.test(e)));
 r.rows.mixing.totalCount='4';assert.deepEqual(validateProductionReport(r,c),[]);
});
test('normalizar conserva fecha, valores incompletos y contexto de equipo y no mezcla borradores',()=>{
 const c=catalog(),r=createProductionReport(c,context);r.rows.mixing.target='0';r.rows.mixing.actual='';
 const loaded=normalizeProductionReport(JSON.parse(JSON.stringify(r)),c,context);
 assert.equal(loaded.date,context.date);assert.equal(loaded.rows.mixing.target,'0');assert.equal(loaded.rows.mixing.actual,'');assert.equal(loaded.rows.mixing.active,null);
 assert.throws(()=>normalizeProductionReport(r,c,{...context,teamId:'other-team'}),/equipo/i);
 assert.notEqual(productionDraftKey('team-one'),productionDraftKey('team-two'));
 assert.ok(productionDraftKey('custom-12345678-1234-1234-1234-123456789abc').length<=64);
 assert.throws(()=>productionDraftKey('../unsafe'));
});
