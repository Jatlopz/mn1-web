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

test('eficiencias vacías se omiten; una captura parcial exige completarse y cero real sí cuenta',async()=>{
 const {efficiencyRows}=await import('../public/production-model.js');
 const c=defaultCatalog('sacos'),r=createProductionReport(c,context);
 for(const row of Object.values(r.rows))row.active=false;
 assert.deepEqual(efficiencyRows(r),[]);
 assert.deepEqual(validateProductionReport(r,c),[]);
 r.rows.extrusion.target='100';
 assert.equal(efficiencyRows(r).length,1);
 assert.ok(validateProductionReport(r,c).some(e=>/producción real/i.test(e)));
 r.rows.extrusion.actual='0';r.rows.extrusion.efficiencyComment='Sin producción por avería';
 assert.equal(efficiencyRows(r)[0][1].actual,'0');assert.deepEqual(validateProductionReport(r,c),[]);
});

test('se exige una razón al obtener 90% o menos y se conserva al guardar',()=>{
 const {c,r}=completed();r.rows.mixing.target='100';
 for(const actual of ['0','89','90']){r.rows.mixing.actual=actual;r.rows.mixing.efficiencyComment='  ';assert.ok(validateProductionReport(r,c).some(e=>/razón|comentario/i.test(e)));}
 r.rows.mixing.actual='90.01';assert.deepEqual(validateProductionReport(r,c),[]);
 r.rows.mixing.actual='90';r.rows.mixing.efficiencyComment='Cambio de producto';
 assert.deepEqual(validateProductionReport(r,c),[]);
 assert.equal(normalizeProductionReport(r,c,context).rows.mixing.efficiencyComment,'Cambio de producto');
});

test('totales en vivo agrupan unidades y ponderan real/meta sin mezclar kg, metros y sacos',async()=>{
 const {productionTotals}=await import('../public/production-model.js');
 const r=createProductionReport(defaultCatalog('sacos'),context);
 Object.assign(r.rows['conversion-1'],{target:'100',actual:'50'});
 Object.assign(r.rows['conversion-3'],{target:'300',actual:'300'});
 Object.assign(r.rows.extrusion,{target:'1000',actual:'1100'});
 Object.assign(r.rows.laminado,{target:'200',actual:''});
 const totals=productionTotals(r);
 assert.deepEqual(totals.find(t=>t.unit==='sacos'),{unit:'sacos',target:400,actual:350,efficiency:87.5,processes:2,pending:0});
 assert.ok(Math.abs(totals.find(t=>t.unit==='kg').efficiency-110)<1e-10);
 assert.equal(totals.find(t=>t.unit==='m').pending,1);
 assert.equal(totals.find(t=>t.unit==='m').efficiency,null);
});


test('el reloj asigna turnos y fechas en los límites, medianoche y cambio de mes',async()=>{
 const {productionTimingFor}=await import('../public/production-model.js');
 const timing=iso=>productionTimingFor(new Date(iso));
 assert.deepEqual(timing('2026-10-25T06:00:00'),{date:'2026-10-25',efficiencyDate:'2026-10-24',efficiencyShift:'TC',statusShift:'TA',period:'day'});
 assert.equal(timing('2026-10-25T17:59:59').statusShift,'TA');
 assert.deepEqual(timing('2026-10-25T18:00:00'),{date:'2026-10-25',efficiencyDate:'2026-10-25',efficiencyShift:'TA',statusShift:'TC',period:'night'});
 assert.deepEqual(timing('2026-11-01T00:00:00'),{date:'2026-10-31',efficiencyDate:'2026-10-31',efficiencyShift:'TA',statusShift:'TC',period:'night'});
 assert.equal(timing('2026-11-01T05:59:59').date,'2026-10-31');
 assert.equal(timing('2028-03-01T07:00:00').efficiencyDate,'2028-02-29');
 assert.throws(()=>productionTimingFor(new Date('invalid')));
});

test('un reporte nuevo usa la hora; recuperar uno existente conserva fechas, turnos y captura',()=>{
 const c=catalog(),r=createProductionReport(c,{teamId:'fixture-team',teamName:'Prueba',now:new Date('2026-10-25T08:00:00')});
 assert.equal(r.timingMode,'automatic');assert.equal(r.efficiencyShift,'TC');assert.equal(r.statusShift,'TA');assert.equal(r.efficiencyDate,'2026-10-24');
 r.rows.mixing.target='100';r.rows.mixing.actual='101';
 const loaded=normalizeProductionReport(r,c,{teamId:r.teamId,now:new Date('2026-10-27T19:00:00')});
 assert.equal(loaded.efficiencyDate,'2026-10-24');assert.equal(loaded.date,'2026-10-25');assert.equal(loaded.efficiencyShift,'TC');assert.equal(loaded.rows.mixing.actual,'101');
 const old={...r};delete old.efficiencyDate;delete old.timingMode;
 const legacy=normalizeProductionReport(old,c,{teamId:r.teamId});assert.equal(legacy.efficiencyDate,r.date);assert.equal(legacy.timingMode,'manual');
});


test('el umbral obligatorio usa decimales exactos aunque el porcentaje binario quede encima de90',async()=>{
 const {requiresEfficiencyReason}=await import('../public/production-model.js');
 const {c,r}=completed();Object.assign(r.rows.mixing,{target:'0.3',actual:'0.27',efficiencyComment:''});
 assert.equal(requiresEfficiencyReason(r.rows.mixing),true);assert.ok(validateProductionReport(r,c).some(e=>/razón|comentario/i.test(e)));
 assert.equal(requiresEfficiencyReason({target:'0,3',actual:'0,27'}),true);
 assert.equal(requiresEfficiencyReason({target:'1',actual:'0.9000000000000000000001'}),false);
 assert.equal(requiresEfficiencyReason({target:'1',actual:'0.8999999999999999999999'}),true);
 assert.equal(requiresEfficiencyReason({target:'',actual:''}),false);
});
