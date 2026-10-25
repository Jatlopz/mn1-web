import { defaultCatalog, normalizeCatalog, catalogKey } from './plant-catalog.js';
import { createProductionReport, normalizeProductionReport, calculateEfficiency, validateProductionReport, productionDraftKey, hasEfficiencyInput, efficiencyRows, productionTotals, productionTimingFor, requiresEfficiencyReason, productionStatusDisplay, PRODUCTION_REPORT_TITLE } from './production-model.js';

const clone = value => JSON.parse(JSON.stringify(value));
const fmt = value => value === null ? 'Sin datos' : new Intl.NumberFormat('es-HN', {maximumFractionDigits:2}).format(value);
const plantName = id => id === 'sacos' ? 'Sacos' : id === 'polietileno' ? 'Polietileno' : id;
const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : value;

/** Applying a catalogue is explicit. Existing values retain their original measurement unit. */
export function reconcileProductionCatalog(report, catalog) {
  const next = createProductionReport(catalog, report);
  for (const [id, row] of Object.entries(next.rows)) {
    if (report.rows[id]) next.rows[id] = {...clone(report.rows[id]), name:row.name};
  }
  return next;
}
export function productionPreviewRows(report) {
  return Object.entries(report.rows).map(([id,row]) => ({id,statusDisplay:productionStatusDisplay(row),name:row.name || id,status:row.active === true?'En funcionamiento':row.active === false?'Inactivo':'Sin confirmar',product:row.product || 'Sin indicar',action:row.action || '',comment:row.comment || '',counts:row.runningCount !== '' || row.totalCount !== '' ? `${row.runningCount || '—'}/${row.totalCount || '—'}` : '',...calculateEfficiency(row),includeEfficiency:row.includeEfficiency&&hasEfficiencyInput(row),efficiencyComment:row.efficiencyComment??row.comment,unit:row.unit,target:row.target,actual:row.actual}));
}
export function productionRowSummary(row) {
  const counts = row.runningCount !== '' || row.totalCount !== '' ? (row.runningCount || '—')+'/'+(row.totalCount || '—') : '';
  return [row.product,row.action,counts].filter(Boolean).join(' · ') || row.comment || 'Sin producto ni comentario';
}
export async function saveProductionDraft(storage, report) {
  if (!storage) throw Error('No hay almacenamiento disponible.');
  const next = {...clone(report),updatedAt:new Date().toISOString()};
  await storage.putText(productionDraftKey(next.teamId),JSON.stringify(next));
  return next;
}

/** Starts a new shift without relabelling or losing the previous capture. */
export async function beginNextProductionReport(storage, previous, context, now=new Date()) {
 const next=createProductionReport(previous.catalogSnapshot,{teamId:context.teamId,teamName:context.teamName,plantId:context.plantId,now});
 for(const [id,row] of Object.entries(next.rows))if(previous.rows[id]){row.unit=previous.rows[id].unit;row.includeEfficiency=previous.rows[id].includeEfficiency;}
 await storage.putText('mn1.production.history.'+crypto.randomUUID().replaceAll('-',''),JSON.stringify(previous));
 await storage.putText(productionDraftKey(next.teamId),JSON.stringify(next));
 return next;
}

export function createProductionStudio(getServices) {
  const doc=document;
  const node=(tag,className,text)=>{const e=doc.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
  const button=(text,className,fn)=>{const e=node('button',className,text);e.type='button';if(fn)e.addEventListener('click',fn);return e;};
  const root=node('section','production-studio');root.id='production-studio';root.hidden=true;root.tabIndex=-1;root.setAttribute('aria-labelledby','production-title');
  const shell=node('div','prod-shell'),header=node('header','prod-header');
  const back=button('← Herramientas','prod-back',()=>void close());
  const heading=node('div','prod-title-wrap');heading.append(node('p','prod-eyebrow','CONTROL DE PLANTA'));
  const title=node('h1','','Eficiencias y estatus');title.id='production-title';heading.append(title);
  const catalogButton=button('Catálogo','prod-secondary',()=>openCatalog());header.append(back,heading,catalogButton);
  const context=node('p','prod-context');
  const metadata=node('div','prod-metadata');
  function field(label,type='text') {const wrap=node('label','prod-field');wrap.append(node('span','',label));const input=node('input');input.type=type;wrap.append(input);return {wrap,input};}
  const date=field('Fecha de estatus','date'),effDate=field('Fecha de eficiencias','date'),effShift=field('Turno de eficiencias'),statusShift=field('Turno de estatus');effShift.input.maxLength=16;statusShift.input.maxLength=16;
  metadata.append(effDate.wrap,effShift.wrap,date.wrap,statusShift.wrap);
  const timingCard=node('div','prod-timing-card'),timingCopy=node('div'),timingTitle=node('strong'),timingDescription=node('p','prod-hint');timingCopy.append(timingTitle,timingDescription);
  const fresh=button('Nuevo reporte','prod-secondary',()=>newReportDialog.showModal());timingCard.append(timingCopy,fresh);
  const timingEditor=node('details','prod-timing-editor');timingEditor.append(node('summary','','Fechas y turnos'),node('p','prod-hint','Se detectan al iniciar un nuevo reporte. Puedes corregirlos aquí sin cambiar la captura.'),metadata);
  const newReportDialog=node('dialog','prod-catalog-dialog');newReportDialog.setAttribute('aria-labelledby','prod-new-title');const newTitle=node('h2','','Nuevo reporte del turno actual');newTitle.id='prod-new-title';
  newReportDialog.append(newTitle,node('p','prod-hint','Se guardará una copia del borrador anterior. La nueva captura tendrá los turnos y fechas detectados por la hora del teléfono, sin producción precargada.'),button('Cancelar','prod-secondary',()=>newReportDialog.close()),button('Iniciar nuevo reporte','prod-primary',()=>void newReport()));doc.body.append(newReportDialog);
  const tabs=node('nav','prod-tabs');tabs.setAttribute('aria-label','Secciones del reporte');
  const panels={};const tabButtons={};
  const statusPanel=node('section','prod-panel'),effPanel=node('section','prod-panel'),previewPanel=node('section','prod-panel');
  for(const [id,label,panel] of [['status','Estatus',statusPanel],['efficiency','Eficiencias',effPanel],['preview','Reporte',previewPanel]]){
    panels[id]=panel;panel.id='prod-panel-'+id;panel.setAttribute('aria-label',label);
    tabButtons[id]=button(label,'prod-tab',()=>selectTab(id));tabButtons[id].setAttribute('aria-controls',panel.id);tabs.append(tabButtons[id]);
  }
  const feedback=node('p','prod-feedback');feedback.id='production-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const errors=node('div','prod-errors');errors.setAttribute('role','alert');errors.hidden=true;
  const catalogNotice=node('div','prod-catalog-notice');catalogNotice.hidden=true;catalogNotice.append(node('p','','El catálogo cambió. Tu borrador conserva los datos anteriores.'));
  const applyCatalogButton=button('Aplicar catálogo al borrador','prod-secondary',()=>void applyCatalog());catalogNotice.append(applyCatalogButton);
  const footer=node('footer','prod-footer');
  const save=button('Guardar borrador','prod-secondary',()=>void guardedSave());
  const download=button('Descargar PDF','prod-secondary',()=>void exportReport('onDownload'));
  const share=button('Compartir PDF','prod-primary',()=>void exportReport('onShare'));
  footer.append(save,download,share);
  const privacy=node('p','prod-privacy','Captura manual de Sysprod. Borrador y catálogo guardados en este teléfono; el envío se confirma al compartir.');
  shell.append(header,context,timingCard,timingEditor,tabs,catalogNotice,feedback,errors,statusPanel,effPanel,previewPanel,footer,privacy);root.append(shell);doc.body.append(root);
  let report=null,catalog=null,contextValue=null,busy=false,dirty=false,tab='status',priorAppHidden=false,queue=Promise.resolve(),catalogChanged=false;
  const expandedProcesses=new Set(),expandedCounts=new Set();
  const app=doc.getElementById('app');
  const catalogDialog=node('dialog','prod-catalog-dialog');catalogDialog.setAttribute('aria-labelledby','prod-catalog-title');
  const catalogHead=node('div','prod-dialog-head'),catalogTitle=node('h2','','Catálogo de procesos');catalogTitle.id='prod-catalog-title';
  const catalogClose=button('×','prod-icon',()=>catalogDialog.close());catalogClose.setAttribute('aria-label','Cerrar catálogo');catalogHead.append(catalogTitle,catalogClose);
  const catalogHint=node('p','prod-hint','Este catálogo se reutiliza en los equipos de esta planta. Quitar un proceso lo archiva sin borrar los reportes anteriores.');
  const processLabel=node('label','prod-field');processLabel.append(node('span','','Proceso'));const processSelect=node('select');processLabel.append(processSelect);
  const newProcess=button('+ Agregar proceso','prod-secondary',()=>loadProcess(null));
  const processName=field('Nombre del proceso'),unit=field('Unidad de producción');processName.input.maxLength=100;unit.input.maxLength=24;unit.input.setAttribute('list','prod-units');
  const units=node('datalist');units.id='prod-units';for(const value of ['sacos','m','kg','unidades']){const o=node('option');o.value=value;units.append(o);}
  const efficiencyLabel=node('label','prod-check');const efficiencyInput=node('input');efficiencyInput.type='checkbox';efficiencyLabel.append(efficiencyInput,node('span','','Incluir en eficiencias por defecto'));
  const productsLabel=node('label','prod-field');productsLabel.append(node('span','','Productos (uno por línea)'));const products=node('textarea');products.rows=4;products.maxLength=4100;productsLabel.append(products);
  const actionsLabel=node('label','prod-field');actionsLabel.append(node('span','','Acciones o estados (uno por línea)'));const actions=node('textarea');actions.rows=4;actions.maxLength=4100;actionsLabel.append(actions);
  const catalogError=node('p','prod-feedback');catalogError.setAttribute('role','status');const catalogSave=button('Guardar proceso','prod-primary',()=>void saveProcess());
  const archive=button('Quitar proceso','prod-danger',()=>void archiveProcess());const catalogFoot=node('div','prod-dialog-actions');catalogFoot.append(archive,catalogSave);
  catalogDialog.append(catalogHead,catalogHint,processLabel,newProcess,processName.wrap,unit.wrap,units,efficiencyLabel,productsLabel,actionsLabel,catalogError,catalogFoot);root.append(catalogDialog);
  let editedProcessId=null;
  processSelect.addEventListener('change',()=>loadProcess(processSelect.value));
  catalogDialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  function message(text,error=false){feedback.textContent=text;feedback.dataset.tone=error?'error':'info';}
  function lock(value){busy=value;root.setAttribute('aria-busy',String(value));for(const e of root.querySelectorAll('button,input,select,textarea'))e.disabled=value;}
  function serial(operation){const task=queue.then(operation);queue=task.catch(()=>{});return task;}
  const stamp=()=>{dirty=true;report.updatedAt=new Date().toISOString();};
  function selectTab(id){tab=id;for(const [key,panel] of Object.entries(panels)){panel.hidden=key!==id;tabButtons[key].setAttribute('aria-pressed',String(key===id));}if(id==='preview')renderPreview();}
  for(const [input,key] of [[date.input,'date'],[effDate.input,'efficiencyDate'],[effShift.input,'efficiencyShift'],[statusShift.input,'statusShift']])input.addEventListener('input',()=>{if(!report)return;report[key]=input.value;report.timingMode='manual';stamp();renderTiming();if(tab==='preview')renderPreview();});
  function selectInput(label,value,options,onChange){const wrap=node('label','prod-field');wrap.append(node('span','',label));const select=node('select');const values=[...new Set(['',...options,value])];for(const item of values){const option=node('option','',item||'Sin indicar');option.value=item;select.append(option);}select.value=value;select.addEventListener('change',()=>onChange(select.value));wrap.append(select);return wrap;}
  function inputField(label,value,onChange,{numeric=false,list=null,multiline=false,max=200}={}){
    const wrap=node('label','prod-field');wrap.append(node('span','',label));const input=node(multiline?'textarea':'input');if(!multiline){input.type='text';if(numeric)input.inputMode='decimal';}else input.rows=2;input.value=value;input.maxLength=max;
    if(list){const dl=node('datalist');dl.id='prod-list-'+crypto.randomUUID();for(const value of list){const option=node('option');option.value=value;dl.append(option);}input.setAttribute('list',dl.id);wrap.append(dl);}
    input.addEventListener('input',()=>onChange(input.value));wrap.append(input);return wrap;
  }
  function definition(id){return report.catalogSnapshot?.processes.find(p=>p.id===id)||catalog.processes.find(p=>p.id===id)||{id,name:report.rows[id]?.name||id,products:[],actions:[]};}
  function rowEdit(id,key,value){report.rows[id][key]=value;stamp();}
  function renderStatus(){
    for(const detail of statusPanel.querySelectorAll('[data-process-id]')){if(detail.open)expandedProcesses.add(detail.dataset.processId);else expandedProcesses.delete(detail.dataset.processId);}
    for(const detail of statusPanel.querySelectorAll('[data-count-process-id]')){if(detail.open)expandedCounts.add(detail.dataset.countProcessId);else expandedCounts.delete(detail.dataset.countProcessId);}
    statusPanel.replaceChildren();const intro=node('div','prod-panel-intro');intro.append(node('div','', 'Procesos y máquinas'));
    const allOff=button('Marcar todos inactivos','prod-text-button',()=>{if(!confirm('¿Confirmar todos los procesos como inactivos? No se borrará la producción ingresada.'))return;for(const row of Object.values(report.rows))row.active=false;stamp();renderStatus();});intro.append(allOff);statusPanel.append(intro,node('p','prod-hint','Confirma el estado de cada proceso para el turno de estatus. Apagarlo no cambia la eficiencia del turno reportado.'));
    if(!Object.keys(report.rows).length){statusPanel.append(node('p','prod-empty','Agrega procesos al catálogo y aplícalos al borrador para comenzar.'));return;}
    for(const [id,row] of Object.entries(report.rows)){
      const process=definition(id),card=node('article','prod-process');card.dataset.state=row.active===true?'on':row.active===false?'off':'unknown';
      const head=node('div','prod-process-head'),copy=node('div');copy.append(node('h2','',row.name||process.name));const status=node('span','prod-machine-status',row.active===true?'En funcionamiento':row.active===false?'Inactivo':'Sin confirmar');copy.append(status);
      const toggle=button('','prod-switch',()=>{row.active=row.active===true?false:true;stamp();renderStatus();});toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(row.active===true));toggle.setAttribute('aria-label',(row.active===true?'Apagar ':'Activar ')+(row.name||process.name));toggle.append(node('span','prod-switch-thumb'));head.append(copy,toggle);card.append(head);
      if(row.active===null)card.append(button('Confirmar inactivo','prod-text-button',()=>{row.active=false;stamp();renderStatus();}));
      const productSummary=node('p','prod-product-summary');
      const updateSummary=()=>{productSummary.textContent=productionRowSummary(row);productSummary.title=productSummary.textContent;};updateSummary();card.append(productSummary);
      const editor=node('details','prod-status-details');editor.dataset.processId=id;editor.open=expandedProcesses.has(id);editor.append(node('summary','','Producto y comentario'));
      const edit=(key,value)=>{rowEdit(id,key,value);updateSummary();};
      const fields=node('div','prod-row-fields');fields.append(inputField('Producto (elige o escribe)',row.product,v=>edit('product',v),{list:process.products,max:200}),selectInput('Acción / estado',row.action,process.actions,v=>edit('action',v)));
      const counts=node('details','prod-counts');counts.dataset.countProcessId=id;counts.open=expandedCounts.has(id);counts.append(node('summary','','Cantidad de máquinas en funcionamiento'));const countFields=node('div','prod-two-fields');countFields.append(inputField('Activas',row.runningCount,v=>edit('runningCount',v),{numeric:true,max:12}),inputField('Total',row.totalCount,v=>edit('totalCount',v),{numeric:true,max:12}));counts.append(countFields);
      editor.append(fields,counts,inputField('Comentario',row.comment,v=>edit('comment',v),{multiline:true,max:2000}));card.append(editor);statusPanel.append(card);
    }
  }
  function renderTotals(target){
    target.replaceChildren(node('h3','','Totales capturados por unidad'));
    const totals=productionTotals(report);
    if(!totals.length){target.append(node('p','prod-hint','Los totales aparecerán al ingresar meta y producción real. Las máquinas vacías no se incluirán.'));return;}
    for(const total of totals){const item=node('div','prod-total-row');item.append(node('strong','',total.unit),node('span','','Meta '+fmt(total.target)+' · Real '+fmt(total.actual)),node('output','',total.efficiency===null?'Sin datos':fmt(total.efficiency)+' %'));target.append(item);if(total.pending)target.append(node('p','prod-hint',total.pending+' proceso(s) con captura incompleta; todavía no se suman.'));}
  }
  function renderEfficiency(){
    const summary=node('div','prod-totals');summary.setAttribute('aria-live','polite');
    effPanel.replaceChildren(node('h2','prod-panel-title','Eficiencias del turno'),summary,node('p','prod-hint','Ingresa meta y producción real sin separadores de miles. Las máquinas sin captura se omiten del reporte. Si falta uno de los dos datos, debes completarlo. En desperdicio, 0.25 equivale a 0.25 %.'));
    const updateTotals=()=>renderTotals(summary);
    for(const [id,row] of Object.entries(report.rows)){
      const card=node('article','prod-efficiency-card'),head=node('div','prod-process-head'),label=node('label','prod-check'),check=node('input');check.type='checkbox';check.checked=row.includeEfficiency;label.append(check,node('strong','',row.name||id));head.append(label);card.append(head);
      const content=node('div','prod-efficiency-fields');content.hidden=!row.includeEfficiency;
      const outcome=node('output','prod-efficiency-result');outcome.setAttribute('aria-label','Eficiencia de '+(row.name||id));
      const reason=inputField('Razón / comentario de eficiencia',row.efficiencyComment??row.comment??'',v=>rowEdit(id,'efficiencyComment',v),{multiline:true,max:2000});
      const reasonHint=node('p','prod-hint','Obligatorio cuando la eficiencia es de 90 % o menos.');reason.append(reasonHint);
      const update=()=>{const result=calculateEfficiency(row),required=requiresEfficiencyReason(row);outcome.textContent=result.efficiency===null?(hasEfficiencyInput(row)?'Completa la captura':'No se incluirá'):fmt(result.efficiency)+' %';outcome.dataset.level=result.efficiency===null?'empty':required?'below':'met';reason.hidden=!required&&!(row.efficiencyComment??row.comment??'').trim();reason.querySelector('textarea').required=required;reasonHint.hidden=!required;updateTotals();};
      check.addEventListener('change',()=>{row.includeEfficiency=check.checked;content.hidden=!check.checked;stamp();updateTotals();});
      const grid=node('div','prod-two-fields');grid.append(inputField('Meta',row.target,v=>{rowEdit(id,'target',v);update();},{numeric:true,max:32}),inputField('Producción real',row.actual,v=>{rowEdit(id,'actual',v);update();},{numeric:true,max:32}),inputField('Unidad',row.unit,v=>{rowEdit(id,'unit',v);updateTotals();},{list:['sacos','m','kg','unidades'],max:24}));
      const resultWrap=node('div','prod-result-wrap');resultWrap.append(node('span','','Eficiencia'),outcome);grid.append(resultWrap);content.append(grid,reason);
      const waste=node('details','prod-waste');waste.append(node('summary','','Desperdicio (porcentaje)'));const wasteFields=node('div','prod-two-fields');wasteFields.append(inputField('Meta desperdicio %',row.wasteTarget,v=>{rowEdit(id,'wasteTarget',v);update();},{numeric:true,max:32}),inputField('Real desperdicio %',row.wasteActual,v=>{rowEdit(id,'wasteActual',v);update();},{numeric:true,max:32}));waste.append(wasteFields);content.append(waste);card.append(content);effPanel.append(card);update();
    }
    updateTotals();
  }
  function table(headers,rows,highlightRows=[]){const wrap=node('div','prod-table-scroll'),t=node('table','prod-table'),thead=node('thead'),tr=node('tr');for(const h of headers)tr.append(node('th','',h));thead.append(tr);const tbody=node('tbody');for(const [index,values] of rows.entries()){const r=node('tr');if(highlightRows[index]===true)r.dataset.active='true';for(const value of values)r.append(node('td','',String(value)));tbody.append(r);}t.append(thead,tbody);wrap.append(t);return wrap;}
  function renderPreview(){
    previewPanel.replaceChildren();const rows=productionPreviewRows(report);previewPanel.append(node('p','prod-eyebrow','VISTA PREVIA'),node('h2','prod-panel-title',PRODUCTION_REPORT_TITLE),node('p','prod-hint',report.teamName+' · Eficiencias '+dateLabel(report.efficiencyDate??report.date)+' · Estatus '+dateLabel(report.date)),node('h3','','Eficiencia / desperdicio · '+report.efficiencyShift));
    const efficiency=rows.filter(row=>row.includeEfficiency);
    if(efficiency.length)previewPanel.append(table(['Proceso','Meta','Real','Unidad','Eficiencia','Desperdicio meta','Desperdicio real','Comentario'],efficiency.map(row=>[row.name,row.target||'Sin datos',row.actual||'Sin datos',row.unit,fmt(row.efficiency)+(row.efficiency===null?'':' %'),fmt(row.wasteTarget)+(row.wasteTarget===null?'':' %'),fmt(row.wasteActual)+(row.wasteActual===null?'':' %'),row.efficiencyComment||'—'])));else previewPanel.append(node('p','prod-hint','No se incluyeron procesos en eficiencias.'));
    const totals=node('div','prod-totals');renderTotals(totals);previewPanel.append(totals);
    previewPanel.append(node('h3','','Estatus de planta · '+report.statusShift),table(['Proceso','Estatus','Producto / acción','Comentario'],rows.map(row=>[row.name,row.statusDisplay.status,row.statusDisplay.productAction,row.statusDisplay.observations]),rows.map(row=>row.statusDisplay.active)));
    const issues=validateProductionReport(report,catalog);if(issues.length)previewPanel.append(node('p','prod-hint',issues.length+' datos pendientes antes de compartir. Puedes guardar el borrador aunque esté incompleto.'));
  }
  function renderTiming(){
    const current=productionTimingFor();
    const same=current.date===report.date&&current.efficiencyDate===(report.efficiencyDate??report.date)&&current.efficiencyShift===report.efficiencyShift&&current.statusShift===report.statusShift;
    timingTitle.textContent=report.timingMode==='automatic'?'Turnos automáticos':'Fechas y turnos ajustados';
    timingDescription.textContent='Eficiencias '+report.efficiencyShift+' · '+dateLabel(report.efficiencyDate??report.date)+' → Estatus '+report.statusShift+' · '+dateLabel(report.date)+(same?'':' · Borrador de otro turno. Inicia un nuevo reporte para usar la hora actual.');
  }
  async function newReport(){
    if(busy||!report)return;lock(true);
    try{report=await serial(()=>beginNextProductionReport(getServices().storage,report,contextValue));dirty=false;catalogChanged=JSON.stringify(catalog.processes.filter(p=>p.enabled))!==JSON.stringify(report.catalogSnapshot.processes);newReportDialog.close();errors.hidden=true;expandedProcesses.clear();expandedCounts.clear();render();message('Nuevo reporte con turnos automáticos. El borrador anterior quedó respaldado.');}
    catch(error){message(error.message||'No se pudo iniciar el reporte. El borrador anterior se conserva.',true);}
    finally{lock(false);}
  }
  function render(){
    context.textContent=report.teamName+' · Planta '+plantName(report.plantId);date.input.value=report.date;effDate.input.value=report.efficiencyDate??report.date;renderTiming();effShift.input.value=report.efficiencyShift;statusShift.input.value=report.statusShift;
    renderStatus();renderEfficiency();renderPreview();selectTab(tab);catalogNotice.hidden=!catalogChanged;
  }
  async function persist(){const stored=await serial(()=>saveProductionDraft(getServices().storage,report));report.updatedAt=stored.updatedAt;dirty=false;return report;}
  async function guardedSave(){if(busy||!report)return false;lock(true);try{await persist();message('Borrador guardado en este teléfono.');return true;}catch(error){message(error.message||'No se pudo guardar. Tus datos siguen en esta pantalla.',true);return false;}finally{lock(false);}}
  async function exportReport(callback){
    if(busy||!report)return;const issues=validateProductionReport(report,catalog);errors.replaceChildren();errors.hidden=!issues.length;
    if(issues.length){errors.append(node('strong','','Completa estos datos:'));const list=node('ul');for(const issue of issues)list.append(node('li','',issue));errors.append(list);message('Revisa los datos pendientes antes de generar el PDF.',true);errors.scrollIntoView({block:'start'});return;}
    lock(true);message('Preparando reporte…');try{await persist();const service=getServices()[callback];if(typeof service!=='function')throw Error('Esta versión todavía no puede generar el PDF. Revisa Actualizaciones.');const result=await service(clone(report),clone(report.catalogSnapshot||catalog));message(typeof result==='string'?result:result?.message||'Reporte preparado. Confirma el siguiente paso en el selector de tu dispositivo.');}catch(error){message(error.message||'No se pudo preparar el PDF; el borrador se conserva.',true);}finally{lock(false);}
  }
  async function open(options={}){
    expandedProcesses.clear();expandedCounts.clear();
    if(busy)return false;if(!root.hidden)return true;const services=getServices();contextValue={teamId:options.teamId||services.teamId,teamName:options.teamName||services.teamName,plantId:options.plantId||services.plantId||'sacos'};
    download.hidden=typeof services.onDownload!=='function';priorAppHidden=app?.hidden??false;if(app)app.hidden=true;root.hidden=false;root.focus();lock(true);report=null;catalog=null;catalogChanged=false;errors.hidden=true;for(const panel of Object.values(panels))panel.replaceChildren();context.textContent=contextValue.teamName+' · Planta '+plantName(contextValue.plantId);message('Abriendo reporte…');
    try{if(!services.storage)throw Error('No hay almacenamiento disponible.');const catRaw=await services.storage.getText(catalogKey(contextValue.plantId));catalog=normalizeCatalog(catRaw?JSON.parse(catRaw):defaultCatalog(contextValue.plantId),contextValue.plantId);const raw=await services.storage.getText(productionDraftKey(contextValue.teamId));report=normalizeProductionReport(raw?JSON.parse(raw):null,catalog,contextValue);dirty=false;catalogChanged=JSON.stringify(catalog.processes.filter(p=>p.enabled))!==JSON.stringify(report.catalogSnapshot.processes);tab='status';render();message('');return true;}catch(error){message(error.message||'No se pudo abrir el borrador. No se sobrescribió ningún dato.',true);return false;}finally{lock(false);}
  }
  async function close(){if(busy)return false;if(root.hidden)return true;if(report&&dirty&&!(await guardedSave()))return false;catalogDialog.close();newReportDialog.close();root.hidden=true;if(app)app.hidden=priorAppHidden;getServices().onClose?.();return true;}
  function openCatalog(){if(busy||!catalog)return;catalogError.textContent='';processSelect.replaceChildren();for(const p of catalog.processes){const option=node('option','',p.name+(p.enabled?'':' (archivado)'));option.value=p.id;processSelect.append(option);}loadProcess(catalog.processes[0]?.id||null);catalogDialog.showModal();}
  function loadProcess(id){editedProcessId=id;const process=catalog.processes.find(p=>p.id===id);processSelect.value=process?.id||'';processName.input.value=process?.name||'';unit.input.value=process?.unit||'unidades';efficiencyInput.checked=process?.efficiency===true;products.value=(process?.products||[]).join('\n');actions.value=(process?.actions||['Producción','Arranque','Cambio de orden','Mantenimiento','Sin orden']).join('\n');archive.hidden=!process;archive.textContent=process?.enabled===false?'Restaurar proceso':'Quitar proceso';catalogSave.textContent=process?'Guardar cambios':'Agregar proceso';catalogError.textContent='';}
  const lines=value=>value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  async function commitCatalog(next){await serial(()=>getServices().storage.putText(catalogKey(contextValue.plantId),JSON.stringify(next)));catalog=next;catalogChanged=true;catalogNotice.hidden=false;}
  async function saveProcess(){
    if(busy)return;lock(true);try{const id=editedProcessId||'p-'+crypto.randomUUID();const process={id,name:processName.input.value,unit:unit.input.value,efficiency:efficiencyInput.checked,products:lines(products.value),actions:lines(actions.value),enabled:catalog.processes.find(p=>p.id===id)?.enabled!==false};const list=catalog.processes.map(p=>p.id===id?process:p);if(!editedProcessId)list.push(process);const next=normalizeCatalog({...catalog,processes:list},contextValue.plantId);await commitCatalog(next);catalogDialog.close();message('Catálogo guardado. Aplica los cambios al borrador cuando quieras.');}catch(error){catalogError.textContent=error.message||'No se pudo guardar el catálogo.';}finally{lock(false);}}
  async function archiveProcess(){if(busy||!editedProcessId)return;const process=catalog.processes.find(p=>p.id===editedProcessId),enabled=process.enabled===false;if(!enabled&&!confirm('¿Quitar '+process.name+' del catálogo activo? Los reportes anteriores se conservarán.'))return;lock(true);try{const next=normalizeCatalog({...catalog,processes:catalog.processes.map(p=>p.id===editedProcessId?{...p,enabled}:p)},contextValue.plantId);await commitCatalog(next);catalogDialog.close();message(enabled?'Proceso restaurado. Puedes aplicarlo al borrador.':'Proceso archivado. Puedes aplicar el catálogo al borrador.');}catch(error){catalogError.textContent=error.message||'No se pudo actualizar el catálogo.';}finally{lock(false);}}
  async function applyCatalog(){
    if(busy||!report)return;if(!confirm('¿Aplicar el catálogo a este borrador? Se guardará una copia anterior. Los datos de los procesos que continúan se conservarán.'))return;
    lock(true);try{const before=clone(report),next=reconcileProductionCatalog(report,catalog);const storage=getServices().storage;await serial(async()=>{await storage.putText('mn1.production.history.'+crypto.randomUUID().replaceAll('-',''),JSON.stringify(before));await storage.putText(productionDraftKey(next.teamId),JSON.stringify(next));});report=next;dirty=false;catalogChanged=false;render();message('Catálogo aplicado. La versión anterior del borrador quedó respaldada.');}catch(error){message(error.message||'No se aplicó el catálogo. El borrador sigue en esta pantalla.',true);}finally{lock(false);}}
  return {open,close,isOpen:()=>!root.hidden,isBusy:()=>busy};
}
