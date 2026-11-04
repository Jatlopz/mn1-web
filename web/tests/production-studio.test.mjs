import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultCatalog,normalizeCatalog} from '../public/plant-catalog.js';
import {createProductionReport,productionDraftKey} from '../public/production-model.js';
import {reconcileProductionCatalog,productionPreviewRows,saveProductionDraft,productionOrderedRows,normalizeProductionOrder,productionChartRows,productionOrderKey,productionChartGroups,normalizeProductionDefaults,productionDefaultsFor,applyProductionDefaults,productionDefaultsKey,productionWasteBar} from '../public/production-studio.js';
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

test('orden editable respeta posiciones, agrega procesos nuevos y no altera los datos',()=>{
 const report={rows:{extrusion:{name:'Extrusión',target:'100'},'conversion-1':{name:'Conversión 1'},otros:{name:'Otro'},'conversion-3':{name:'Conversión 3'},nuevo:{name:'Conversión 2'}}},before=JSON.stringify(report);
 assert.deepEqual(productionOrderedRows(report).map(([id])=>id),['extrusion','conversion-1','nuevo','conversion-3','otros']);
 const custom=['conversion-3','otros','extrusion','conversion-1','archivado'];assert.deepEqual(productionOrderedRows(report,custom).map(([id])=>id),['conversion-3','otros','extrusion','conversion-1','nuevo']);assert.equal(JSON.stringify(report),before);
 assert.ok(productionOrderKey('a'.repeat(48)).length<=64);assert.notEqual(productionOrderKey('equipo-a'),productionOrderKey('equipo-b'));assert.throws(()=>normalizeProductionOrder(['a','a']));assert.throws(()=>normalizeProductionOrder(['__proto__']));assert.deepEqual(normalizeProductionOrder(['a']),['a']);
});
test('gráfica calcula umbrales exactos, excluye vacíos y mantiene valores mayores de 100',()=>{
 const rows=Object.fromEntries([0,79.99,80,89.99,90,100,145].map((value,i)=>['p'+i,{name:'Proceso '+i,target:'100',actual:String(value),includeEfficiency:true}]));rows.vacio={target:'',actual:'',includeEfficiency:true};rows.excluido={target:'100',actual:'50',includeEfficiency:false};rows.incompleto={target:'0',actual:'2',includeEfficiency:true};
 const chart=productionChartRows({rows});assert.deepEqual(chart.map(r=>r.level),['low','low','warning','warning','good','good','good']);assert.equal(chart.at(-1).efficiency,145);assert.equal(chart[0].efficiency,0);assert.equal(productionChartRows({rows},['p6'])[0].id,'p6');
});

test('la gráfica reúne procesos numerados del mismo tipo sin separar conversiones',()=>{
 const make=name=>({name,target:'100',actual:'90',includeEfficiency:true});const report={rows:{a:make('Conversión 3'),b:make('Extrusión'),c:make('Conversión 1'),d:make('Laminado'),e:make('Conversión 2')}};const groups=productionChartGroups(report,['a','b','c','d','e']);assert.deepEqual(groups.find(g=>g.name==='Conversión').rows.map(r=>r.name),['Conversión 1','Conversión 2','Conversión 3']);assert.deepEqual(groups.find(g=>g.name==='Procesos').rows.map(r=>r.name),['Extrusión','Laminado']);
});

test('valores mensuales heredan sin aplicar meses futuros ni modificar captura histórica',()=>{
 const defs=normalizeProductionDefaults({version:1,months:{'2026-10':{telares:{wasteTarget:'0,25',totalCount:'23',countKind:'machine'}},'2026-12':{telares:{wasteTarget:'0.3',totalCount:'24',countKind:'station'}}}});assert.equal(productionDefaultsFor(defs,'2026-11','telares').wasteTarget,'0.25');assert.equal(productionDefaultsFor(defs,'2026-12','telares').totalCount,'24');const r=createProductionReport(defaultCatalog(),{...context,date:'2026-11-03'}),before=JSON.stringify(r);r.rows.telares.actual='99';r.rows.telares.wasteTarget='0.9';const next=applyProductionDefaults(r,defs);assert.equal(next.rows.telares.actual,'99');assert.equal(next.rows.telares.wasteTarget,'0.9');assert.equal(next.rows.telares.totalCount,'23');assert.equal(r.rows.telares.totalCount,'');assert.equal(applyProductionDefaults(r,defs,{replace:true}).rows.telares.wasteTarget,'0.25');assert.ok(before.includes('2026-11-03'));assert.ok(productionDefaultsKey('sacos').length<=64);
});
test('valores fijos rechazan porcentajes, cantidades y tipos inválidos sin truncar',()=>{
 for(const value of [{wasteTarget:'101',totalCount:'23',countKind:'machine'},{wasteTarget:'0.25',totalCount:'2.5',countKind:'machine'},{wasteTarget:'0.25',totalCount:'23',countKind:'other'}])assert.throws(()=>normalizeProductionDefaults({version:1,months:{'2026-11':{p:value}}}));assert.throws(()=>normalizeProductionDefaults({version:1,months:{'2026-13':{}}}));assert.equal(productionDefaultsFor(normalizeProductionDefaults(null),'2026-11','telares').totalCount,'23');
});

test('default de estatus usa su mes y conserva tipo ya capturado sin reemplazo explícito',()=>{
 const d=normalizeProductionDefaults({version:1,months:{'2026-10':{telares:{wasteTarget:'0.25',totalCount:'23',countKind:'machine'}},'2026-11':{telares:{wasteTarget:'0.5',totalCount:'24',countKind:'station'}}}}),r=createProductionReport(defaultCatalog(),{...context,date:'2026-11-01',efficiencyDate:'2026-10-31'});Object.assign(r.rows.telares,{countKind:'station',runningCount:'2',totalCount:''});const n=applyProductionDefaults(r,d);assert.equal(n.rows.telares.wasteTarget,'0.25');assert.equal(n.rows.telares.totalCount,'24');assert.equal(n.rows.telares.countKind,'station');const old=applyProductionDefaults({...r,rows:{telares:{...r.rows.telares,countKind:'machine',totalCount:'23'}}},d);assert.equal(old.rows.telares.countKind,'machine');const changed=applyProductionDefaults(old,d,{replace:true,month:'2026-11'});assert.equal(changed.rows.telares.countKind,'station');assert.equal(changed.rows.telares.wasteTarget,'0.25');
});

test('barra secundaria compara desperdicio sin dividir entre una meta cero',()=>{
 assert.equal(productionWasteBar({wasteActual:null,wasteTarget:.25}),null);
 assert.equal(productionWasteBar({wasteActual:1,wasteTarget:null}),null);
 for(const [actual,target,level] of [[.2,.25,'good'],[.25,.25,'good'],[.3,.25,'low'],[0,0,'good'],[1,0,'low']]){
 const bar=productionWasteBar({wasteActual:actual,wasteTarget:target});assert.equal(bar.level,level);assert.ok(Number.isFinite(bar.fill));assert.ok(bar.fill>=0&&bar.fill<=100);assert.ok(bar.marker>=0&&bar.marker<=100);assert.equal(bar.actual,actual);assert.equal(bar.target,target);
 }
});
