import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultCatalog,normalizeCatalog} from '../public/plant-catalog.js';
import {createProductionReport,productionDraftKey} from '../public/production-model.js';
import {reconcileProductionCatalog,productionPreviewRows,saveProductionDraft} from '../public/production-studio.js';
const context={teamId:'champions',teamName:'Equipo de prueba',plantId:'sacos',date:'2026-10-24'};

test('aplicar un catálogo conserva el borrador original y los valores de procesos existentes',()=>{
 const catalog=defaultCatalog('sacos'),report=createProductionReport(catalog,context);
 report.rows.extrusion={...report.rows.extrusion,target:'100',actual:'125',unit:'kg',active:true,comment:'Dato de prueba'};
 const before=JSON.stringify(report);
 const nextCatalog=normalizeCatalog({...catalog,processes:catalog.processes.map(p=>p.id==='extrusion'?{...p,name:'Extrusión revisada',unit:'m'}:p.id==='telares'?{...p,enabled:false}:p).concat({id:'auxiliar',name:'Proceso auxiliar',unit:'unidades',efficiency:false,products:[],actions:[],enabled:true})},'sacos');
 const next=reconcileProductionCatalog(report,nextCatalog);
 assert.equal(JSON.stringify(report),before);
 assert.equal(next.rows.extrusion.actual,'125');
 assert.equal(next.rows.extrusion.unit,'kg','No se reinterpretan cantidades al cambiar la unidad predeterminada');
 assert.equal(next.rows.extrusion.name,'Extrusión revisada');
 assert.equal(next.rows.telares,undefined);
 assert.equal(report.rows.telares.name,'Telares');
 assert.equal(next.rows.auxiliar.active,null);
 assert.equal(next.date,report.date);
});

test('vista previa usa la misma eficiencia, diferencia cero de vacío y muestra el estado confirmado',()=>{
 const report=createProductionReport(defaultCatalog('sacos'),context);
 report.rows.extrusion={...report.rows.extrusion,target:'80',actual:'100',active:false,wasteActual:'0',wasteTarget:'',runningCount:'0',totalCount:'2'};
 const [row]=productionPreviewRows(report);
 assert.equal(row.efficiency,125);
 assert.equal(row.status,'Inactivo');
 assert.equal(row.wasteActual,0);
 assert.equal(row.wasteTarget,null);
 assert.equal(row.counts,'0/2');
 assert.equal(productionPreviewRows(report).find(r=>r.id==='telares').status,'Sin confirmar');
});

test('guardar borrador persiste sólo el equipo seleccionado y no muta su objeto',async()=>{
 const report=createProductionReport(defaultCatalog('sacos'),context),before=JSON.stringify(report),data=new Map([['mn1.production.espartanos','otro borrador']]);
 const stored=await saveProductionDraft({putText:async(k,v)=>data.set(k,v)},report);
 assert.equal(JSON.stringify(report),before);
 assert.equal(data.get('mn1.production.espartanos'),'otro borrador');
 assert.equal(JSON.parse(data.get(productionDraftKey(report.teamId))).teamId,'champions');
 assert.deepEqual(stored.rows,report.rows);
});

test('un error de guardado conserva el borrador completo para reintentar',async()=>{
 const report=createProductionReport(defaultCatalog('sacos'),context);report.rows.extrusion.comment='Conservar esta nota';
 const before=JSON.stringify(report);
 await assert.rejects(saveProductionDraft({putText:async()=>{throw Error('Sin espacio');}},report),/Sin espacio/);
 assert.equal(JSON.stringify(report),before);
});

test('el resumen compacto conserva productos, acciones y cantidades sin modificar la captura',async()=>{
 const {productionRowSummary}=await import('../public/production-studio.js');
 const row={product:'Producto de prueba',action:'Arranque',runningCount:'0',totalCount:'3',comment:'Comentario completo'};
 const before=JSON.stringify(row);
 assert.equal(productionRowSummary(row),'Producto de prueba · Arranque · 0/3');
 assert.equal(productionRowSummary({...row,product:'',action:'',runningCount:'',totalCount:''}),'Comentario completo');
 assert.equal(productionRowSummary({product:'',action:'',runningCount:'',totalCount:'',comment:''}),'Sin producto ni comentario');
 assert.equal(JSON.stringify(row),before);
});

test('iniciar un nuevo turno respalda antes de reemplazar y no arrastra producción del anterior',async()=>{
 const {beginNextProductionReport}=await import('../public/production-studio.js');
 const old=createProductionReport(defaultCatalog('sacos'),context);old.rows.extrusion.target='100';old.rows.extrusion.actual='80';old.rows.extrusion.unit='lb';old.rows.extrusion.efficiencyComment='Paro';
 const before=JSON.stringify(old),data=new Map([[productionDraftKey(old.teamId),before]]),writes=[];
 const next=await beginNextProductionReport({putText:async(k,v)=>{writes.push(k);data.set(k,v);}},old,{...context,teamId:old.teamId,teamName:old.teamName,plantId:'sacos'},new Date('2026-10-25T19:00:00'));
 assert.match(writes[0],/^mn1\.production\.history\./);assert.equal(data.get(writes[0]),before);assert.equal(JSON.stringify(old),before);
 assert.equal(next.timingMode,'automatic');assert.equal(next.efficiencyShift,'TA');assert.equal(next.statusShift,'TC');assert.equal(next.date,'2026-10-25');
 assert.equal(next.rows.extrusion.target,'');assert.equal(next.rows.extrusion.actual,'');assert.equal(next.rows.extrusion.active,null);assert.equal(next.rows.extrusion.efficiencyComment,'');assert.equal(next.rows.extrusion.unit,'lb');
 await assert.rejects(beginNextProductionReport({putText:async()=>{throw Error('Sin espacio');}},old,context),/Sin espacio/);assert.equal(JSON.stringify(old),before);
});

test('productos recordados sugieren sin duplicar mayúsculas o espacios',async()=>{
 const {productionProductOptions,normalizeProductionProducts,productionProductsKey}=await import('../public/production-studio.js');
 assert.deepEqual(productionProductOptions(['Tape 720D'],[' tape   720D ','Otro producto'],['']),['Tape 720D','Otro producto']);
 assert.deepEqual({...normalizeProductionProducts(JSON.parse('{"extrusion":["Uno","uno"],"__proto__":["inseguro"]}'))},{extrusion:['Uno']});
 assert.notEqual(productionProductsKey('sacos'),productionProductsKey('polietileno'));
});
test('Conversión 1 y 3 quedan consecutivas sin cambiar el reporte',async()=>{
 const {productionOrderedRows}=await import('../public/production-studio.js');
 const report={rows:{'conversion-3':{},extrusion:{},'conversion-1':{},telares:{}}},before=JSON.stringify(report);
 assert.deepEqual(productionOrderedRows(report).map(([id])=>id),['extrusion','conversion-1','conversion-3','telares']);
 assert.equal(JSON.stringify(report),before);
});
