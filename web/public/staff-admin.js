export function validateStaffDraft(draft, available) {
  const name = String(draft.name || '').trim();
  const code = String(draft.code || '').trim();
  const processes = [...new Set(draft.processes || [])];
  if (!name || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) throw Error('Ingresa un nombre válido (máximo 120 caracteres).');
  if (code.length > 40 || /[\x00-\x1f\x7f]/.test(code)) throw Error('El código de empleado no es válido.');
  if (processes.length !== (draft.processes || []).length || processes.some(p => !available.includes(p))) throw Error('Selecciona procesos válidos de esta planta.');
  return {id:draft.id, revision:draft.revision || 0, plantId:draft.plantId, name, code:code || null, active:draft.active !== false, processes};
}

export function createStaffAdmin(host, service) {
  let plantId='sacos', snapshot={processes:[],workers:[]}, editing=null, busy=false;
  const make=(tag, className='', label='')=>{const el=document.createElement(tag);if(className)el.className=className;if(label)el.textContent=label;return el;};
  const section=make('section','staff-admin');
  const heading=make('div','tools-heading'), headingCopy=make('div');
  headingCopy.append(make('p','welcome-eyebrow','PERSONAL DE PLANTA'),make('h2','','Trabajadores y procesos'));
  const actions=make('div','staff-actions');
  const plant=make('select','select');plant.setAttribute('aria-label','Planta');
  for(const [value,label] of [['sacos','Sacos'],['polietileno','Polietileno']]){const option=make('option','',label);option.value=value;plant.append(option);}
  const refresh=make('button','button button-secondary','Actualizar');refresh.type='button';
  const add=make('button','button button-primary','+ Agregar trabajador');add.type='button';
  actions.append(plant,refresh,add);heading.append(headingCopy,actions);
  const note=make('p','hint','Este registro es de trabajadores, no de usuarios de la app. Los líderes de equipo se configurarán después.');
  const status=make('p','hint');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const search=make('input','input');search.type='search';search.placeholder='Buscar por nombre, código o proceso';search.setAttribute('aria-label','Buscar trabajadores');
  const list=make('div','staff-list');
  const form=make('form','staff-form');form.hidden=true;
  const formTitle=make('h3','','Agregar trabajador');
  const field=(label,input)=>{const wrapper=make('label','field',label);wrapper.append(input);return wrapper;};
  const name=make('input','input');name.required=true;name.maxLength=120;
  const code=make('input','input');code.maxLength=40;
  const active=make('input');active.type='checkbox';active.checked=true;
  const processBox=make('fieldset','staff-processes');processBox.append(make('legend','','Procesos asignados'));
  const formActions=make('div','staff-actions');
  const save=make('button','button button-primary','Guardar trabajador');save.type='submit';
  const cancel=make('button','button button-secondary','Cancelar');cancel.type='button';
  formActions.append(save,cancel);
  form.append(formTitle,field('Nombre completo',name),field('Código de empleado (opcional)',code),field('Activo',active),processBox,formActions);
  section.append(heading,note,status,search,list,form);host.append(section);
  function render(){
    const query=search.value.trim().toLocaleLowerCase('es');list.replaceChildren();
    const rows=snapshot.workers.filter(w=>!query||[w.name,w.code,...w.processes].some(v=>String(v||'').toLocaleLowerCase('es').includes(query)));
    if(!rows.length){list.append(make('p','hint',snapshot.workers.length?'No hay coincidencias.':'Todavía no hay trabajadores registrados en esta planta.'));return;}
    for(const worker of rows){const row=make('article','staff-row'),copy=make('div');
      copy.append(make('strong','',worker.name),make('p','hint',(worker.code||'Sin código')+' · '+(worker.active?'Activo':'Inactivo')),
        make('p','staff-tags',worker.processes.map(code=>snapshot.processes.find(p=>p.code===code)?.name||code).join(' · ')||'Sin procesos asignados'));
      const edit=make('button','button button-secondary','Editar');edit.type='button';edit.addEventListener('click',()=>openForm(worker));row.append(copy,edit);list.append(row);
    }
  }
  function openForm(worker=null){editing=worker;form.hidden=false;formTitle.textContent=worker?'Editar trabajador':'Agregar trabajador';name.value=worker?.name||'';code.value=worker?.code||'';active.checked=worker?.active!==false;processBox.replaceChildren(make('legend','','Procesos asignados'));
    if(!snapshot.processes.length)processBox.append(make('p','hint','No hay procesos configurados para esta planta.'));
    for(const process of snapshot.processes){const input=make('input');input.type='checkbox';input.value=process.code;input.checked=!!worker?.processes.includes(process.code);processBox.append(field(process.name,input));}
    name.focus();form.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  async function load(){if(busy)return;busy=true;refresh.disabled=true;status.textContent='Cargando personal…';try{const result=await service.read(plantId);snapshot={processes:Array.isArray(result?.processes)?result.processes:[],workers:Array.isArray(result?.workers)?result.workers:[]};status.textContent=`${snapshot.workers.length} trabajador(es) en ${plant.options[plant.selectedIndex].text}.`;render();}catch(error){status.textContent=error.message||'No se pudo cargar el personal.';}finally{busy=false;refresh.disabled=false;}}
  plant.addEventListener('change',()=>{plantId=plant.value;form.hidden=true;void load();});refresh.addEventListener('click',()=>void load());add.addEventListener('click',()=>openForm());cancel.addEventListener('click',()=>{form.hidden=true;editing=null;});search.addEventListener('input',render);
  form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;let draft;try{draft=validateStaffDraft({id:editing?.id||crypto.randomUUID(),revision:editing?.revision||0,plantId,name:name.value,code:code.value,active:active.checked,processes:[...processBox.querySelectorAll('input:checked')].map(input=>input.value)},snapshot.processes.map(p=>p.code));}catch(error){status.textContent=error.message;return;}
    busy=true;save.disabled=true;status.textContent='Guardando trabajador…';try{await service.save(draft);form.hidden=true;editing=null;busy=false;await load();status.textContent='Trabajador y asignaciones guardados.';}catch(error){status.textContent=error.message||'No se pudo guardar. Los datos anteriores se conservan.';}finally{busy=false;save.disabled=false;}
  });
  return {open:load};
}
