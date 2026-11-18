import {isoWeekInfo} from './iso-calendar.js';
import {normalizeRegistry} from './registry-model.js';
import {provisionSacosLooms,loomNumberFromName,weeklyTarget,applyLoomRoster,createLoomConfig,normalizeLoomConfig,loomConfigKey,loomWeekKey,createLoomWeek,normalizeLoomWeek,loomDays,loomText,loomNumber,loomMetric,loomDashboard,saveLoomShift,isLoomPhoto} from './looms-model.js';

/** Decode only user-selected raster files; save a small, metadata-free JPEG thumbnail. */
export async function prepareLoomPhoto(file,{root=document}={}){
 if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024||file.size===0)throw Error('Elige una foto JPG, PNG o WebP de hasta 8 MB.');
 const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n),webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';if(!jpeg&&!png&&!webp)throw Error('El archivo no contiene una imagen compatible.');
 const source=await new Promise((resolve,reject)=>{const reader=new (root.defaultView?.FileReader||FileReader)();reader.onload=()=>resolve(reader.result);reader.onerror=reader.onabort=()=>reject(Error('No se pudo leer el archivo de foto.'));reader.readAsDataURL(file);});
 const image=root.createElement('img');try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{image.removeAttribute('src');reject(Error('No se pudo preparar la foto. Inténtalo con otra imagen.'));},15000);image.onload=()=>{clearTimeout(timeout);resolve();};image.onerror=()=>{clearTimeout(timeout);reject(Error('No se pudo leer la foto.'));};image.src=source;});
  const width=image.naturalWidth,height=image.naturalHeight;if(!width||!height||width*height>40000000)throw Error('La foto supera el tamaño de imagen permitido.');const size=Math.min(width,height),canvas=root.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d');if(!ctx)throw Error('No se pudo preparar la foto.');ctx.fillStyle='#e6edf2';ctx.fillRect(0,0,256,256);ctx.drawImage(image,(width-size)/2,(height-size)/2,size,size,0,0,256,256);const result=canvas.toDataURL('image/jpeg',.85);if(!isLoomPhoto(result))throw Error('No se pudo guardar una miniatura de la foto.');return result;
 }finally{image.removeAttribute('src');}
}

/** Local operational captures. Never writes personnel data to the public team feed. */
export function createLoomStudio(getServices,{root=document,now=()=>new Date()}={}){
 const el=(tag,cls,text)=>{const n=root.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const btn=(text,fn,cls='button button-secondary')=>{const n=el('button',cls,text);n.type='button';n.addEventListener('click',()=>void fn());return n;};
 const fmt=value=>value===null?'—':new Intl.NumberFormat('es-HN',{maximumFractionDigits:2}).format(value);
 const dialog=el('dialog','dialog looms-studio');dialog.id='looms-studio';dialog.setAttribute('aria-labelledby','looms-title');
 const header=el('header','looms-header'),title=el('h2','','Eficiencias de Telares');title.id='looms-title';
 const subtitle=el('p','hint'),status=el('p','looms-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const closeButton=btn('×',close,'dialog-close');closeButton.setAttribute('aria-label','Guardar y cerrar Telares');header.append(el('p','welcome-eyebrow','PROCESOS DE ENTRADA'),title,closeButton,subtitle);
 const toolbar=el('div','looms-toolbar');const weekField=el('label','','Semana ISO'),weekDate=el('input');weekDate.type='date';weekField.append(weekDate);const weekLabel=el('strong');toolbar.append(weekField,weekLabel);
 const tabs=el('nav','looms-tabs');tabs.setAttribute('aria-label','Secciones de Telares');const content=el('section','looms-content');
 const discardDialog=el('dialog','dialog looms-discard');discardDialog.setAttribute('aria-label','Descartar edición de Telares');discardDialog.append(el('h3','','¿Cerrar sin guardar esta edición?'),el('p','hint','La última versión guardada se conservará. Los cambios pendientes de esta pantalla se descartarán.'),btn('Seguir editando',()=>discardDialog.close()),btn('Descartar edición y cerrar',()=>{discardDialog.close();dirty=false;dialog.close();}));root.body.append(discardDialog);
 const discardButton=btn('Cerrar sin guardar',()=>discardDialog.showModal());discardButton.hidden=true;
 const saveButton=btn('Guardar cambios',save,'button button-primary'),footer=el('footer','looms-footer');footer.append(el('small','','Metros · Meta base de 12 horas · Datos locales de este equipo'),discardButton,saveButton);
 dialog.append(header,toolbar,tabs,status,content,footer);root.body.append(dialog);
 let team=null,config=null,week=null,date='',active='dashboard',dirty=false,busy=false,formRows=[],personFilter='',dashboardShift='',loadError=false,loadedConfigRaw=null,loadedWeekRaw=null;
 const tabButtons=new Map();for(const [id,label] of [['dashboard','Dashboard'],['capture','Captura'],['assign','Asignaciones'],['config','Configuración']]){const b=btn(label,async()=>{if(await save()){active=id;render();}},'looms-tab');tabButtons.set(id,b);tabs.append(b);}
 let controlLocks=new WeakMap();
 const photoCache=new Map(),photoInputs=new Map();
 const canConfigure=()=>getServices().canConfigure?.()===true;
 const message=(text,error=false)=>{status.textContent=text;status.dataset.error=String(error);};
 function lock(value){busy=value;dialog.setAttribute('aria-busy',String(value));for(const c of dialog.querySelectorAll('button,input,select,textarea')){if(value)controlLocks.set(c,c.disabled);c.disabled=value||(loadError&&c!==closeButton)||(controlLocks.get(c)===true);if(!value)controlLocks.delete(c);}}
 function changed(){dirty=true;message('Cambios sin guardar');}
 function avatar(person,name){const fallback=()=>{const n=el('span','looms-avatar looms-avatar-initials',name.trim().split(/\s+/).slice(0,2).map(w=>[...w][0]).join('').toLocaleUpperCase('es'));n.setAttribute('aria-hidden','true');return n;};const src=person?.photoKey&&photoCache.get(person.photoKey);if(!src)return fallback();const image=el('img','looms-avatar');image.src=src;image.alt='Foto de '+name;image.width=48;image.height=48;image.addEventListener('error',()=>image.replaceWith(fallback()),{once:true});return image;}
 async function readPhotos(){photoCache.clear();let missing=0;for(const person of config.people.filter(p=>p.photoKey)){try{const value=await getServices().storage.getText(person.photoKey);if(isLoomPhoto(value))photoCache.set(person.photoKey,value);else missing++;}catch{missing++;}}return missing;}
 function personPhotoEditor(person,line){
  const box=el('div','looms-photo-editor'),input=el('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.hidden=true;input.setAttribute('aria-label','Elegir foto de '+person.name);photoInputs.set(person.id,input);
  const choose=btn(person.photoKey?'Cambiar foto':'Agregar foto',()=>input.click());choose.setAttribute('aria-label','Foto de '+person.name);
  input.addEventListener('change',async()=>{const file=input.files?.[0];if(!file||busy)return;lock(true);try{if(!canConfigure())throw Error('La sesión de administrador ya no está disponible.');const photo=await prepareLoomPhoto(file,{root});if(!canConfigure())throw Error('La sesión de administrador ya no está disponible.');const key='mn1.loom.pic.'+crypto.randomUUID().replaceAll('-','');await getServices().storage.putText(key,photo);if(!canConfigure())throw Error('La sesión de administrador ya no está disponible.');person.photoKey=key;photoCache.set(key,photo);dirty=true;render();message('Foto preparada. Guarda los cambios para conservarla.');}catch(e){message(e.message||'No se pudo guardar la foto. La anterior se conserva.',true);}finally{input.value='';lock(false);}});
  box.append(avatar(person,person.name),choose,input);if(person.photoKey)box.append(btn('Quitar foto',()=>{if(!canConfigure())return;person.photoKey='';changed();render();}));line.prepend(box);
 }
 function field(parent,label,value,change,{type='text',numeric=false}={}){const w=el('label','looms-field',label),i=el(type==='textarea'?'textarea':'input');if(type!=='textarea')i.type=type;i.value=value;i.maxLength=type==='textarea'?500:100;if(numeric)i.inputMode='decimal';i.addEventListener('input',()=>{change(i.value);changed();});w.append(i);parent.append(w);return i;}
 function select(parent,label,value,options,change,{tracked=true}={}){const w=el('label','looms-field',label),s=el('select');for(const [id,name] of options){const o=el('option','',name);o.value=id;s.append(o);}s.value=value;s.addEventListener('change',()=>{if(tracked)changed();change(s.value);});w.append(s);parent.append(w);return s;}
 const availablePeople=current=>options(config.people.filter(p=>p.enabled||p.id===current));
 const options=values=>[['','Sin asignar'],...values.map(v=>[v.id,v.name+(v.enabled?'':' (archivado)')])];
 function titleFor(text){content.append(el('h3','',text));}
 function rowsTable(headers){const scroll=el('div','looms-table-scroll'),table=el('table','looms-table'),head=el('tr'),body=el('tbody');for(const label of headers){const th=el('th','',label);th.scope='col';head.append(th);}const thead=el('thead');thead.append(head);table.append(thead,body);scroll.append(table);content.append(scroll);return body;}
 function cell(row){const c=el('td');row.append(c);return c;}
 function numericCell(row,label,value,set){return field(cell(row),label,value,set,{numeric:true});}
 function captureSetup(){
  const enabled=config.machines.some(m=>m.enabled);
  if(!canConfigure()){
   if(!enabled)content.append(el('p','looms-empty','El administrador debe habilitar un telar y asignarle una bancada en este dispositivo.'));
   return;
  }
  const panel=el('details','looms-config-group');
  panel.open=!enabled;
  panel.append(el('summary','',enabled?'Agregar otro telar':'Preparar el primer telar'));
  const form=el('form','looms-filters');
  function textInput(label,value){
   const wrapper=el('label','looms-field',label),input=el('input');
   input.required=true;input.maxLength=100;input.value=value;wrapper.append(input);form.append(wrapper);return input;
  }
  let number=1;
  while(config.machines.some(m=>m.name==='Telar '+number))number++;
  const machine=textInput('Nombre del telar','Telar '+number);
  const bench=textInput('Bancada',config.benches.find(b=>b.enabled)?.name||'');
  const choices=el('datalist');choices.id='looms-bench-choices';
  for(const b of config.benches.filter(b=>b.enabled)){const o=el('option');o.value=b.name;choices.append(o);}
  bench.setAttribute('list',choices.id);
  const target=textInput('Meta en metros para 12 horas','');target.inputMode='decimal';
  const submit=el('button','button button-primary','Habilitar captura');submit.type='submit';
  form.append(choices,submit);panel.append(form);content.append(panel);
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(!canConfigure()||busy||!await save())return;
   lock(true);
   try{
    const name=loomText(machine.value),benchName=loomText(bench.value);
    if(config.machines.some(m=>m.name.toLocaleLowerCase('es')===name.toLocaleLowerCase('es')))throw Error('Ese telar ya existe. Revisa su configuración.');
    const next=structuredClone(config);
    let group=next.benches.find(b=>b.name.toLocaleLowerCase('es')===benchName.toLocaleLowerCase('es'));
    if(group&&!group.enabled)throw Error('Esa bancada está archivada. Habilítala en Configuración.');
    if(!group){group={id:crypto.randomUUID(),name:benchName,enabled:true};next.benches.push(group);}
    next.machines.push({id:crypto.randomUUID(),name,enabled:true,benchId:group.id,baseTarget:target.value.trim()});
    const valid=normalizeLoomConfig(next);
    if(!canConfigure())throw Error('Vuelve a iniciar sesión como administrador.');
    loadedConfigRaw=await persist(loomConfigKey(team.id),JSON.stringify(valid),loadedConfigRaw);
    config=valid;render();message('Telar listo. Selecciona al responsable y escribe los metros en Real (m).');
   }catch(e){message(e.message,true);}finally{lock(false);}
  });
 }
 function renderCapture(){
  titleFor('Producción diaria por bancada');
  const selectors=el('div','looms-filters');
  content.append(selectors);
  select(selectors,'Día',date,loomDays(week.startDate).map(d=>[d,d.split('-').reverse().join('/')]),async value=>{
   if(await save()){date=value;render();}
   else selectors.querySelector('select').value=date;
  },{tracked:false});
  selectors.append(btn('Editar metas y operadores',()=>tabButtons.get('assign').click()));
  if(!config.machines.some(m=>m.enabled)){captureSetup();return;}
  content.append(el('p','hint','Ingresa los metros producidos en TA y TC. Cada meta corresponde a 12 horas y se establece en Asignaciones para la semana seleccionada.'));
  for(const bench of benchGroups()){
   const heading=el('div','loom-bench-heading');
   heading.append(el('h4','',bench.name));
   for(const turn of ['TA','TC']){
    const assigned=week.schedule.find(a=>a.benchId===bench.id&&a.shift===turn);
    const person=config.people.find(p=>p.id===assigned?.personId);
    heading.append(el('span','',turn+' · '+(person?.name||'Sin asignar')));
   }
   content.append(heading);
   const body=rowsTable(['Telar','Meta 12 h','Producción TA','Eficiencia TA','Producción TC','Eficiencia TC']);
   body.closest('table').classList.add('looms-sheet');
   for(const machine of bench.members){
    const row=el('tr');body.append(row);
    cell(row).textContent=machine.name;
    const goal=weeklyTarget(week,machine);
    cell(row).textContent=goal ? fmt(loomNumber(goal))+' m' : 'Por definir';
    for(const turn of ['TA','TC']){
     const previous=week.captures.find(r=>r.machineId===machine.id && r.date===date && r.shift===turn);
     const assigned=week.schedule.find(a=>a.benchId===machine.benchId && a.shift===turn);
     const data=previous?{...previous}:{machineId:machine.id,benchId:machine.benchId,state:'pending',hours:'12',note:'',actual:'',personId:''};
     if(data.state!=='recorded'){
      data.benchId=machine.benchId;
      data.baseTarget=goal;
      if(!previous?.personId) data.personId=assigned?.personId||'';
     }
     data.shift=turn;
     formRows.push(data);
     const inputCell=cell(row),result=cell(row);
     const actual=field(inputCell,'Metros '+turn+' · '+machine.name,data.actual,value=>{
      data.actual=value;
      data.state=value.trim()?'recorded':'pending';
      state.value=data.state;
      update();
     },{numeric:true});
     actual.placeholder='Metros';
     const out=el('output','looms-eff');
     result.append(out);
     const details=el('details','loom-shift-options');
     const summary=el('summary','','Ajustes');
     summary.setAttribute('aria-label','Ajustes '+turn+' · '+machine.name);
     details.append(summary);
     const person=select(details,'Responsable '+turn+' · '+machine.name,data.personId,availablePeople(data.personId),value=>{data.personId=value;update();});
     const state=select(details,'Estado '+turn+' · '+machine.name,data.state,[['pending','Pendiente'],['recorded','Capturado'],['inactive','Inactivo']],value=>{
      data.state=value;
      if(value!=='recorded'){data.actual='';actual.value='';}
      update();
     });
     field(details,'Horas '+turn+' · '+machine.name,data.hours,value=>{data.hours=value;update();},{numeric:true});
     field(details,'Comentario '+turn+' · '+machine.name,data.note,value=>{data.note=value;data.touched=true;},{type:'textarea'});
     inputCell.append(details);
     function refresh(){
      actual.disabled=data.state==='inactive'||!(loomNumber(data.baseTarget)>0)||!data.personId;
      actual.title=!(loomNumber(data.baseTarget)>0)?'Define la meta en Asignaciones':!data.personId?'Selecciona al operador en Asignaciones o en Ajustes':'';
      person.disabled=data.state==='inactive';
      try{
       const metric=loomMetric(data);
       out.textContent=metric?fmt(metric.efficiency)+' %':data.state==='inactive'?'Inactivo':'—';
       out.dataset.level=metric?(metric.efficiency>=90?'good':metric.efficiency>=80?'warning':'low'):'';
      }catch{out.textContent=!(loomNumber(data.baseTarget)>0)?'Falta meta':'Revisa datos';}
     }
     function update(){data.touched=true;refresh();}
     refresh();
    }
   }
  }
 }
 function benchGroups(){
  const groups=[...config.benches,{id:'',name:'Sin bancada'}];
  return groups.map(b=>({...b,members:config.machines.filter(m=>m.enabled&&m.benchId===b.id)
   .sort((a,b)=>(loomNumberFromName(a.name)??Infinity)-(loomNumberFromName(b.name)??Infinity))})).filter(b=>b.members.length);
 }
 function renderAssignments(){titleFor('Responsables de las bancadas');content.append(el('p','hint','Programa semanal por turno. Puedes cambiar el responsable en una captura diaria para registrar un relevo. Los cambios no reescriben capturas anteriores.'));
  const body=rowsTable(['Bancada','Telares','Turno TA','Turno TC']);for(const bench of config.benches.filter(b=>b.enabled)){
   const row=el('tr');body.append(row);cell(row).textContent=bench.name;cell(row).textContent=config.machines.filter(m=>m.enabled&&m.benchId===bench.id).map(m=>m.name).join(', ')||'Sin máquinas';
   for(const turn of ['TA','TC']){const current=week.schedule.find(a=>a.benchId===bench.id&&a.shift===turn)?.personId||'';select(cell(row),turn+' · '+bench.name,current,availablePeople(current),v=>{week.schedule=week.schedule.filter(a=>!(a.benchId===bench.id&&a.shift===turn));if(v)week.schedule.push({benchId:bench.id,shift:turn,personId:v});});}
  }
  titleFor('Metas de la semana');
  content.append(el('p','hint','Define los metros por telar para 12 horas. La meta se usa en ambos turnos durante esta semana. Las capturas ya guardadas conservan la meta con la que se calcularon.'));
  const list=el('div','looms-week-goals');content.append(list);
  for(const bench of benchGroups()){
   const group=el('section');group.append(el('h4','',bench.name));list.append(group);
   for(const machine of bench.members){
    field(group,machine.name,weeklyTarget(week,machine),value=>week.targets[machine.id]=value.trim(),{numeric:true});
   }
  }
  if(!config.benches.length)content.append(el('p','looms-empty','Primero crea las bancadas en Configuración.'));
 }
 function renderConfig(){titleFor('Catálogo local de Telares');if(!canConfigure()){content.append(el('p','hint','La configuración del catálogo corresponde al administrador.'));return;}
  content.append(el('p','hint','Las máquinas se importan del catálogo central de planta. Personas, bancadas y metas se guardan sólo en este equipo y dispositivo. Archivar conserva los registros anteriores.'));
  content.append(btn('Importar máquinas de Telares',async()=>{if(!await save())return;lock(true);try{const raw=await getServices().getRegistry(team.plantId),registry=normalizeRegistry(raw,team.plantId);const process=registry.processes.find(p=>p.enabled&&p.flow==='entry'&&(p.code==='telares'||p.name.toLocaleLowerCase('es')==='telares'));if(!process)throw Error('No hay un proceso Telares de entrada habilitado en el catálogo.');const candidate=JSON.parse(JSON.stringify(config));let added=0;for(const m of process.resources.filter(m=>m.enabled&&m.kind==='machine'))if(!candidate.machines.some(v=>v.id===m.id||(loomNumberFromName(m.name)!==null&&loomNumberFromName(m.name)===loomNumberFromName(v.name)))){candidate.machines.push({id:m.id,name:m.name,enabled:true,benchId:'',baseTarget:''});added++;}const next=normalizeLoomConfig(candidate);if(!canConfigure())throw Error('La sesión de administrador ya no está disponible.');loadedConfigRaw=await persist(loomConfigKey(team.id),JSON.stringify(next),loadedConfigRaw);config=next;dirty=false;render();message(added+' máquinas incorporadas sin reemplazar metas existentes.');}catch(e){message(e.message,true);}finally{lock(false);}}));
  content.append(btn('Agregar telar local',()=>{
   if(config.machines.length>=100){message('Se alcanzó el límite de telares.',true);return;}
   let number=1;
   while(config.machines.some(m=>m.name==='Telar '+number))number++;
   config.machines.push({id:crypto.randomUUID(),name:'Telar '+number,enabled:true,benchId:'',baseTarget:''});
   changed();render();
  }));
  function namedEditor(kind,label){const box=el('section','looms-config-group');box.append(el('h4','',label));content.append(box);for(const v of config[kind]){const line=el('div','looms-config-line');field(line,label==='Personas'?'Nombre de la persona':'Nombre de bancada',v.name,value=>v.name=value);const check=el('label','looms-check'),i=el('input');i.type='checkbox';i.checked=v.enabled;i.addEventListener('change',()=>{v.enabled=i.checked;changed();});check.append(i,el('span','','Habilitado'));line.append(check);if(kind==='people')personPhotoEditor(v,line);box.append(line);}box.append(btn('+ Agregar '+(kind==='people'?'persona':'bancada'),()=>{if(config[kind].length>=(kind==='people'?100:50)){message('Se alcanzó el límite del catálogo.',true);return;}config[kind].push({id:crypto.randomUUID(),name:kind==='people'?'Nueva persona':'Nueva bancada',enabled:true});changed();render();}));}
  namedEditor('people','Personas');namedEditor('benches','Bancadas');
  const body=rowsTable(['Máquina del catálogo','Bancada','Meta base (m / 12 h)','Habilitada']);for(const m of config.machines){const row=el('tr');body.append(row);field(cell(row),'Nombre del telar',m.name,v=>m.name=v);select(cell(row),'Bancada de '+m.name,m.benchId,options(config.benches),v=>m.benchId=v);numericCell(row,'Meta base de '+m.name,m.baseTarget,v=>m.baseTarget=v);const check=el('input');check.type='checkbox';check.checked=m.enabled;check.setAttribute('aria-label','Habilitar '+m.name);check.addEventListener('change',()=>{m.enabled=check.checked;changed();});cell(row).append(check);}
 }
 function operatorBoard(data){
  const section=el('section','loom-operators');
  section.append(el('h4','','Rendimiento por operador'));
  const cards=el('div','loom-person-grid');section.append(cards);
  const ids=new Set([...data.people.map(p=>p.id),...week.schedule.filter(a=>(!dashboardShift||a.shift===dashboardShift)&&(!personFilter||a.personId===personFilter)).map(a=>a.personId)]);
  for(const id of ids){
   const person=config.people.find(p=>p.id===id),summary=data.people.find(p=>p.id===id);
   const name=person?.name||summary?.name||'Operador asignado';
   const card=el('article','loom-person-card'),top=el('div','looms-chart-person');
   const picture=avatar(person,name);
   if(canConfigure()&&person){
    const edit=btn('',()=>{active='config';render();photoInputs.get(id)?.click();},'looms-avatar-button');
    edit.setAttribute('aria-label',(person.photoKey?'Cambiar':'Agregar')+' foto de '+name);edit.append(picture);top.append(edit);
   }else top.append(picture);
   const caption=el('div');caption.append(el('strong','',name));
   const assigned=week.schedule.filter(a=>a.personId===id&&(!dashboardShift||a.shift===dashboardShift));
   caption.append(el('small','',assigned.map(a=>(config.benches.find(b=>b.id===a.benchId)?.name||'Bancada')+' · '+a.shift).join(' / ')));
   top.append(caption);card.append(top);cards.append(card);
   if(!summary){card.append(el('p','hint','Pendiente de captura'));continue;}
   const score=el('strong','looms-eff loom-person-score',fmt(summary.efficiency)+' %');
   score.dataset.level=summary.efficiency>=90?'good':summary.efficiency>=80?'warning':'low';
   card.append(score,el('small','',fmt(summary.actual)+' m de '+fmt(summary.target)+' m'));
   const trend=el('div','loom-week-trend');
   const days=loomDays(week.startDate).map(day=>loomDashboard(week,{shift:dashboardShift,personId:id,date:day}));
   const max=Math.max(100,...days.map(d=>d.efficiency||0));
   days.forEach((day,i)=>{
    const col=el('div'),track=el('div','loom-day-track'),bar=el('span');
    if(day.efficiency!==null){bar.style.height=Math.max(2,day.efficiency/max*100)+'%';bar.dataset.level=day.efficiency>=90?'good':day.efficiency>=80?'warning':'low';}
    const title=loomDays(week.startDate)[i]+' · '+(day.recorded?fmt(day.efficiency)+' %':'Sin captura');
    col.title=title;col.setAttribute('aria-label',title);
    track.append(bar);col.append(track,el('small','',['L','M','X','J','V','S','D'][i]));trend.append(col);
   });
   card.append(trend);
  }
  if(ids.size)content.append(section);
 }
 function renderDashboard(){titleFor('Rendimiento semanal');const filters=el('div','looms-filters');content.append(filters);select(filters,'Turno del dashboard',dashboardShift,[['','Todos'],['TA','TA'],['TC','TC']],v=>{dashboardShift=v;render();},{tracked:false});select(filters,'Persona del dashboard',personFilter,options(config.people).map(([id,name])=>[id,id?name:'Todas']),v=>{personFilter=v;render();},{tracked:false});
  const data=loomDashboard(week,{shift:dashboardShift,personId:personFilter});const tiles=el('div','looms-kpis');for(const [label,value] of [['Eficiencia ponderada',data.efficiency===null?'—':fmt(data.efficiency)+' %'],['Producción',fmt(data.actual)+' m'],['Meta ajustada',fmt(data.target)+' m'],['Brecha',fmt(data.gap)+' m'],['Capturas',String(data.recorded)],['Pendientes guardados',String(data.pending)],['Inactivos',String(data.inactive)]]){const card=el('article','looms-kpi');card.append(el('span','',label),el('strong','',value));tiles.append(card);}content.append(tiles,el('p','hint','Resultados de las capturas guardadas. Pendientes e inactivos no se suman como producción cero. La eficiencia total divide producción acumulada entre metas ajustadas acumuladas.'));
  operatorBoard(data);
  if(!data.recorded){content.append(el('p','looms-empty','Aún no hay producción capturada en esta semana. Selecciona la bancada y el turno en Asignaciones y registra los metros en Captura.'));content.append(btn('Abrir captura',()=>tabButtons.get('capture').click()));return;}
  for(const [heading,items] of [['Evolución diaria por turno',data.daily]]){const chart=el('section','looms-chart');chart.append(el('h4','',heading));const maximum=Math.max(100,...items.map(i=>i.efficiency));for(const r of items){const line=el('div','looms-chart-row'),top=el('div','looms-chart-label');const identity=el('div','looms-chart-person');identity.append(el('strong','',r.name));top.append(identity,el('span','',fmt(r.efficiency)+' %'));const track=el('div','looms-track'),fill=el('span');fill.style.width=(r.efficiency/maximum*100)+'%';fill.dataset.level=r.efficiency>=90?'good':r.efficiency>=80?'warning':'low';track.setAttribute('role','meter');track.setAttribute('aria-label',r.name);track.setAttribute('aria-valuenow',String(r.efficiency));track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax',String(maximum));track.append(fill);line.append(top,track,el('small','',fmt(r.actual)+' m / '+fmt(r.target)+' m de meta ajustada'));chart.append(line);}content.append(chart);}
 }
 function render(){if(!config||!week)return;formRows=[];photoInputs.clear();content.replaceChildren();weekDate.value=week.startDate;weekLabel.textContent=week.week+' · '+week.startDate.split('-').reverse().join('/');for(const [id,b] of tabButtons){b.setAttribute('aria-pressed',String(id===active));b.hidden=id==='config'&&!canConfigure();}saveButton.hidden=active==='dashboard';if(active==='capture')renderCapture();else if(active==='assign')renderAssignments();else if(active==='config')renderConfig();else renderDashboard();}
 async function persist(key,value,expected){const storage=getServices().storage,current=await storage.getText(key);if(current!==expected)throw Error('Los datos cambiaron en otra ventana. Cierra y vuelve a abrir antes de guardar; tu edición sigue en pantalla.');if(current!==null)await storage.putText('mn1.loom.history.'+crypto.randomUUID().replaceAll('-',''),current);await storage.putText(key,value);return value;}
 async function save(){if(busy||loadError)return false;if(!dirty)return true;lock(true);try{
  if(active==='config'){if(!canConfigure())throw Error('La sesión de administrador ya no está disponible.');const next=normalizeLoomConfig(config);loadedConfigRaw=await persist(loomConfigKey(team.id),JSON.stringify(next),loadedConfigRaw);config=next;}
  else{let next=normalizeLoomWeek(week,week.startDate);
   if(active==='capture'){
    for(const turn of ['TA','TC']){
     const entries=formRows.filter(r=>r.shift===turn&&r.touched);
     for(const r of entries){
      if(r.state==='recorded' && (!r.personId||!(loomNumber(r.baseTarget)>0)))throw Error(config.machines.find(m=>m.id===r.machineId).name+' · '+turn+': indica el responsable y la meta semanal en Asignaciones antes de capturar.');
     }
     if(entries.length)next=saveLoomShift(next,config,date,turn,entries);
    }
   }loadedWeekRaw=await persist(loomWeekKey(team.id,week.startDate),JSON.stringify(next),loadedWeekRaw);week=next;}
  dirty=false;discardButton.hidden=true;if(active==='config')render();message('Guardado en este dispositivo.');return true;
 }catch(e){discardButton.hidden=false;message(e.message||'No se pudo guardar. Tu captura se conserva en pantalla.',true);return false;}finally{lock(false);}}
 async function close(){if(busy)return false;if(!loadError&&!await save())return false;dialog.close();return true;}
 dialog.addEventListener('cancel',e=>{e.preventDefault();void close();});
 weekDate.addEventListener('change',async()=>{const selected=weekDate.value;if(!selected){weekDate.value=week.startDate;return;}if(!await save()){weekDate.value=week.startDate;return;}await loadWeek(selected);});
 async function loadWeek(selected){lock(true);try{const info=isoWeekInfo(selected),raw=await getServices().storage.getText(loomWeekKey(team.id,selected));const next=raw?normalizeLoomWeek(JSON.parse(raw),selected):createLoomWeek(selected);for(const m of config.machines){if(!Object.hasOwn(next.targets,m.id)&&weeklyTarget(next,m))next.targets[m.id]=weeklyTarget(next,m);}week=next;loadedWeekRaw=raw;date=info.date;dirty=false;loadError=false;render();message('Semana '+info.week+' · datos locales del equipo.');}catch{loadError=true;message('No se pudo leer la semana. El original no se reemplazará. Cierra y vuelve a intentar.',true);}finally{lock(false);}}
 async function open(value){if(dialog.open||busy)return false;team={...value};config=null;week=null;loadError=false;dirty=false;controlLocks=new WeakMap();for(const c of dialog.querySelectorAll('button,input,select,textarea'))c.disabled=false;discardButton.hidden=true;active='dashboard';personFilter='';dashboardShift='';subtitle.textContent=team.name+' · Metros · TA / TC';content.replaceChildren();dialog.showModal();lock(true);message('Cargando Telares…');try{const raw=await getServices().storage.getText(loomConfigKey(team.id));config=raw?normalizeLoomConfig(JSON.parse(raw)):createLoomConfig();if(team.plantId==='sacos')config=provisionSacosLooms(config);loadedConfigRaw=raw;}catch{loadError=true;message('No se pudo leer la configuración. No se modificó ningún dato.',true);lock(false);return false;}let rosterMessage='';
  try{
   const workers=await getServices().getRoster?.(team.plantId);
   if(workers)config=applyLoomRoster(config,workers);
   else if(!config.people.length)rosterMessage='Abre Administración con tu cuenta para consultar el personal asignado a Telares.';
  }catch{rosterMessage='No se pudo consultar el personal de Telares. Puedes continuar con la configuración local.';}
  const missingPhotos=await readPhotos();lock(false);await loadWeek(isoWeekInfo(now()).date);if(missingPhotos&&!loadError)message('No se pudieron cargar '+missingPhotos+' fotos; los datos del equipo se conservan.');if(rosterMessage&&!loadError)message(rosterMessage);return !loadError;}
 return {open,close,isOpen:()=>dialog.open};
}
