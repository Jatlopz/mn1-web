import {PLANTS} from './profiles.js';
import {normalizeRegistry,registrySummary,filterRegistry,validateProcessDraft,validateResourceDraft,REGISTRY_FLOWS,REGISTRY_CYCLES,RESOURCE_KINDS} from './registry-model.js';

const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const button=(text,action,className='button button-secondary')=>{const node=element('button',className,text);node.type='button';node.addEventListener('click',action);return node;};

/** Server owns permissions and revisions. No catalogue is persisted to browser storage. */
export function createRegistryAdmin(host,{client,onAccessLost=()=>{}}){
 let catalog=null,plantId=PLANTS[0].id,busy=false,generation=0,editor=null;
 host.classList.add('registry');
 host.innerHTML=`<div class="registry-heading"><div><p class="welcome-eyebrow">INFRAESTRUCTURA DE PLANTA</p><h2>Procesos y recursos</h2><p class="hint">Un catálogo común, preparado para crecer.</p></div><label class="field">Planta<select class="select" data-registry="plant"></select></label></div>
 <div class="registry-metrics" data-registry="metrics"></div>
 <div class="registry-toolbar"><div class="registry-flows" role="group" aria-label="Flujo de procesos"><button type="button" data-flow="entry" aria-pressed="true">↘ Entrada</button><button type="button" data-flow="exit" aria-pressed="false">↗ Salida</button></div><button type="button" class="button button-secondary" data-registry="refresh">Actualizar</button></div>
 <div class="registry-filters"><label class="field">Buscar<input type="search" data-registry="search" placeholder="Proceso, máquina o estación" maxlength="100"></label><label class="field">Ciclo<select data-registry="cycle"><option value="">Todos</option><option value="permanent">Permanentes</option><option value="seasonal">Temporada</option></select></label></div>
 <div class="registry-actions"><label class="registry-check"><input type="checkbox" data-registry="archived"> Mostrar archivados</label><button type="button" class="button button-primary" data-registry="add">+ Agregar proceso</button></div>
 <p data-registry="status" class="hint registry-status" role="status" aria-live="polite"></p><div data-registry="list" class="registry-list"></div><p class="hint registry-footnote">Este catálogo describe los recursos de la planta. Las asignaciones a equipos se habilitarán después.</p>`;
 const $=name=>host.querySelector('[data-registry="'+name+'"]');
 for(const plant of PLANTS){const option=element('option','',plant.name);option.value=plant.id;$('plant').append(option);}
 const message=(text,error=false)=>{$('status').textContent=text;$('status').dataset.tone=error?'error':'info';};
 const flow=()=>host.querySelector('[data-flow][aria-pressed="true"]').dataset.flow;
 function lock(value){busy=value;host.setAttribute('aria-busy',String(value));for(const control of host.querySelectorAll('button,input,select'))control.disabled=value||(!catalog&&control.dataset.registry==='add');}
 function render(){
  const metrics=$('metrics');metrics.replaceChildren();
  if(catalog){const counts=registrySummary(catalog);for(const [key,label] of [['processes','Procesos'],['machines','Máquinas'],['stations','Estaciones']]){const tile=element('div');tile.append(element('strong','',String(counts[key])),element('span','',label));metrics.append(tile);}}
  const list=$('list');list.replaceChildren();if(!catalog)return;
  const processes=filterRegistry(catalog,{flow:flow(),cycle:$('cycle').value,includeArchived:$('archived').checked,query:$('search').value});
  for(const [cycle,label] of Object.entries(REGISTRY_CYCLES)){
   const matches=processes.filter(p=>p.cycle===cycle);if(!matches.length)continue;
   const group=element('section','registry-group');group.append(element('h3','registry-group-title',label));
   for(const process of matches){
    const card=element('details','registry-process');card.dataset.archived=String(!process.enabled);
    const summary=element('summary'),copy=element('span','registry-process-copy'),count=process.resources.filter(r=>r.enabled).length;
    copy.append(element('strong','',process.name),element('small','',!process.enabled?'Archivado':count?count+(count===1?' recurso':' recursos'):RESOURCE_KINDS[process.defaultKind]));summary.append(element('span','registry-process-symbol',process.defaultKind==='station'?'▦':process.defaultKind==='activity'?'◇':'⚙'),copy,element('span','registry-chevron','⌄'));card.append(summary);
    const body=element('div','registry-process-body'),actions=element('div','registry-process-actions');
    actions.append(button('Editar proceso',()=>editProcess(process)));
    if(process.enabled)actions.append(button('+ Máquina o estación',()=>editResource(process)));
    body.append(actions);
    const resources=process.resources.filter(r=>$('archived').checked||r.enabled);
    if(!resources.length)body.append(element('p','hint','Sin recursos individuales registrados. Puedes agregarlos cuando los necesites.'));
    for(const resource of resources){const row=element('div','registry-resource');row.dataset.archived=String(!resource.enabled);const text=element('span');text.append(element('strong','',resource.name),element('small','',RESOURCE_KINDS[resource.kind]+(resource.enabled?'':' · Archivado')));const edit=button('Editar',()=>editResource(process,resource));edit.setAttribute('aria-label','Editar '+resource.name);row.append(text,edit);body.append(row);}
    card.append(body);group.append(card);
   }
   list.append(group);
  }
  if(!processes.length)list.append(element('p','registry-empty','No hay procesos en esta selección.'));
  lock(false);
 }
 function clear(){generation++;catalog=null;busy=false;if(editor){editor.close();editor.remove();editor=null;}render();message('');lock(false);}
 function accessError(error){if(['401','403','42501'].includes(error.code)){clear();message('Inicia sesión con tu cuenta de administrador general.',true);onAccessLost();return true;}return false;}
 async function load(){
  if(busy||editor)return;const ticket=++generation,selected=plantId;catalog=null;render();lock(true);message('Cargando catálogo…');
  try{if(!(await client.access()).admin)throw Object.assign(Error('Acceso no autorizado.'),{code:'403'});const value=await client.registry(selected);if(ticket!==generation)return;catalog=normalizeRegistry(value,selected);render();message('Catálogo actualizado.');}
  catch(error){if(ticket!==generation)return;if(!accessError(error))message(error.message,true);}
  finally{if(ticket===generation)lock(false);}
 }
 function field(form,labelText,name,options,value){
  const label=element('label','field',labelText),input=element(options?'select':'input');input.name=name;
  if(options){for(const [key,text] of Object.entries(options)){const option=element('option','',text);option.value=key;input.append(option);}}
  else{input.type='text';input.required=true;input.maxLength=100;input.autocomplete='off';}
  input.value=value;label.append(input);form.append(label);return input;
 }
 function editProcess(process){openEditor({process,resource:null,isResource:false});}
 function editResource(process,resource){openEditor({process,resource,isResource:true});}
 function openEditor({process,resource,isResource}){
  if(busy||!catalog||editor)return;
  const create=isResource?!resource:!process,id=(isResource?resource:process)?.id||crypto.randomUUID(),revision=catalog.revision,selected=plantId,ticket=generation;
  const modal=element('dialog','dialog registry-editor');editor=modal;const title=element('h2','',isResource?(create?'Agregar recurso':'Editar recurso'):(create?'Agregar proceso':'Editar proceso'));title.id='registry-editor-title';modal.setAttribute('aria-labelledby',title.id);
  const head=element('div','dialog-head'),form=element('form','registry-form'),close=button('×',()=>cancel(),'dialog-close');close.setAttribute('aria-label','Cerrar editor de catálogo');head.append(title,close);modal.append(head);
  if(isResource)form.append(element('p','hint',process.name));
  const initial=isResource?(resource||{name:'',kind:process.defaultKind==='station'?'station':'machine',enabled:true}):(process||{name:'',flow:flow(),cycle:'permanent',defaultKind:'machine',enabled:true});
  field(form,'Nombre','name',null,initial.name);
  if(isResource)field(form,'Tipo','kind',{machine:'Máquina',station:'Estación'},initial.kind);
  else{field(form,'Flujo','flow',REGISTRY_FLOWS,initial.flow);field(form,'Ciclo','cycle',REGISTRY_CYCLES,initial.cycle);field(form,'Tipo de recurso habitual','defaultKind',RESOURCE_KINDS,initial.defaultKind);}
  const enabledLabel=element('label','registry-check'),enabled=element('input');enabled.type='checkbox';enabled.name='enabled';enabled.checked=initial.enabled;enabledLabel.append(enabled,document.createTextNode('Disponible en el catálogo'));form.append(enabledLabel,element('p','hint','Desmarcar archiva este registro. Conserva su identidad y su historial.'));
  const feedback=element('p','registry-status hint');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');const actions=element('div','registry-editor-actions'),save=element('button','button button-primary','Guardar'),cancelButton=button('Cancelar',()=>cancel());save.type='submit';actions.append(cancelButton,save);form.append(feedback,actions);modal.append(form);document.body.append(modal);
  const signature=()=>JSON.stringify([...new FormData(form)]),original=signature();let saving=false;
  function dispose(){modal.close();modal.remove();if(editor===modal)editor=null;}
  function cancel(){if(saving)return;if(signature()!==original&&!window.confirm('¿Descartar los cambios de este formulario?'))return;dispose();}
  modal.addEventListener('cancel',event=>{event.preventDefault();cancel();});
  modal.addEventListener('close',()=>{modal.remove();if(editor===modal)editor=null;});
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(saving)return;let draft;
   try{const values=Object.fromEntries(new FormData(form));values.enabled=enabled.checked;draft=isResource?validateResourceDraft(values):validateProcessDraft(values);}catch(error){feedback.textContent=error.message;return;}
   saving=true;for(const control of modal.querySelectorAll('button,input,select'))control.disabled=true;feedback.textContent='Guardando…';
   try{
    const request={...draft,plantId:selected,revision,id,create};if(isResource)request.processId=process.id;
    const value=await(isResource?client.saveRegistryResource(request):client.saveRegistryProcess(request));if(ticket!==generation)return;
    catalog=normalizeRegistry(value,selected);dispose();render();message('Guardado en el catálogo central.');
   }catch(error){if(ticket!==generation)return;if(!accessError(error)){feedback.textContent=error.code==='conflict'?'El catálogo cambió en otra sesión. Tu formulario se conserva. Anota tus cambios, cierra y actualiza el catálogo antes de reintentar.':error.message;feedback.dataset.tone='error';}}
   finally{saving=false;for(const control of modal.querySelectorAll('button,input,select'))control.disabled=false;}
  });
  modal.showModal();form.elements.name.focus();
 }
 $('plant').addEventListener('change',()=>{plantId=$('plant').value;void load();});
 $('refresh').addEventListener('click',()=>void load());$('add').addEventListener('click',()=>editProcess());
 for(const control of [$('cycle'),$('archived')])control.addEventListener('change',render);$('search').addEventListener('input',render);
 for(const control of host.querySelectorAll('[data-flow]'))control.addEventListener('click',()=>{for(const item of host.querySelectorAll('[data-flow]'))item.setAttribute('aria-pressed',String(item===control));render();});
 lock(false);return {open:load,clear};
}
