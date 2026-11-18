const PRIORITIES=Object.freeze({normal:'Normal',important:'Importante',urgent:'Urgente'});
const STATES=Object.freeze({pending:'Pendiente',in_progress:'En proceso',done:'Completada'});
export function validateBoardDraft(value){
 const title=String(value?.title||'').trim(),body=String(value?.body||'').trim();
 if(!title||title.length>120||!body||body.length>4000)throw Error('Escribe un título de hasta 120 caracteres y una nota de hasta 4000.');
 if(!Object.hasOwn(PRIORITIES,value?.priority)||!Object.hasOwn(STATES,value?.status)||typeof value.pinned!=='boolean'||typeof value.archived!=='boolean')throw Error('Revisa la prioridad y el estado.');
 const due_at=value.due_at||null,remind_at=value.remind_at||null,assignee_email=String(value.assignee_email||'').trim().toLowerCase();
 if((due_at&&!Number.isFinite(Date.parse(due_at)))||(remind_at&&!Number.isFinite(Date.parse(remind_at))))throw Error('Revisa las fechas del recordatorio.');
 if(assignee_email&&(assignee_email.length>254||!/^\S+@\S+\.\S+$/.test(assignee_email)))throw Error('Revisa el responsable.');
 return {title,body,priority:value.priority,status:value.status,assignee_email:assignee_email||null,pinned:value.pinned,archived:value.archived,due_at:due_at?new Date(due_at).toISOString():null,remind_at:remind_at?new Date(remind_at).toISOString():null};
}
export function localBoardDate(iso){if(!iso)return '';const d=new Date(iso);if(!Number.isFinite(d.valueOf()))return '';return new Date(d.valueOf()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function boardIndicators(notes,now=Date.now()){return notes.reduce((c,n)=>{if(n.archived||n.status==='done')return c;c.pending++;if(n.due_at&&Date.parse(n.due_at)<now)c.overdue++;if(n.remind_at&&Date.parse(n.remind_at)<=now)c.reminders++;return c;},{pending:0,overdue:0,reminders:0});}
export function installCorporateBoard({client,root=document,confirmDiscard=message=>globalThis.confirm(message)}){
 const dialog=root.getElementById('board-dialog');if(!dialog)return {open(){}};
 const $=id=>root.getElementById(id),list=$('board-notes'),form=$('board-editor'),feedback=$('board-status');
 let identity=null,epoch=0,loading=false,canPublish=false,owner=false,notes=[],offset=0,editing=null,dirty=false,saving=false,supervisors=[],reminderTimer=null;
 const alerted=new Set();
 const text=(tag,value,className='')=>{const e=root.createElement(tag);e.textContent=value;e.className=className;return e;};
 const tell=message=>{feedback.textContent=message;};
 function clearEditor(){editing=null;dirty=false;form.reset();form.hidden=true;}
 function clear(){epoch++;if(reminderTimer)clearTimeout(reminderTimer);reminderTimer=null;notes=[];list.replaceChildren();canPublish=false;owner=false;clearEditor();$('board-new').hidden=true;$('board-publishers').hidden=true;$('board-publisher-list').replaceChildren();$('board-more').hidden=true;$('board-auth').hidden=Boolean(identity);$('board-controls').hidden=!identity;$('board-count').textContent='';for(const id of ['open-board','settings-board']){const entry=$(id);if(entry){entry.dataset.reminders='';entry.setAttribute('aria-label','Mural de asignaciones');}}tell(identity?'':'Inicia sesión para leer el mural de supervisores.');}
 function scheduleReminders(){
  if(reminderTimer)clearTimeout(reminderTimer);reminderTimer=null;
  const now=Date.now(),due=notes.filter(n=>!n.archived&&n.status!=='done'&&n.remind_at&&Date.parse(n.remind_at)<=now&&!alerted.has(n.id+':'+n.remind_at));
  for(const note of due)alerted.add(note.id+':'+note.remind_at);
  if(due.length){tell(`${due.length} recordatorio${due.length===1?'':'s'} pendiente${due.length===1?'':'s'}: ${due.slice(0,2).map(n=>n.title).join(', ')}${due.length>2?'…':''}`);render();}
  const future=notes.filter(n=>!n.archived&&n.status!=='done'&&n.remind_at&&Date.parse(n.remind_at)>now).map(n=>Date.parse(n.remind_at));
  if(future.length)reminderTimer=setTimeout(scheduleReminders,Math.min(Math.min(...future)-now,2147483647));
 }
 function button(label,handler){const b=text('button',label,'button button-secondary');b.type='button';b.addEventListener('click',handler);return b;}
 function render(){
  list.replaceChildren();const count=boardIndicators(notes);$('board-count').textContent=count.pending?`${count.pending} pendientes${count.overdue?` · ${count.overdue} vencidas`:''}${count.reminders?` · ${count.reminders} recordatorios`:''}`:'Sin pendientes en esta vista';
  for(const id of ['open-board','settings-board']){const entry=$(id);if(entry){entry.dataset.reminders=String(count.reminders||'');entry.setAttribute('aria-label',count.reminders?`Mural de asignaciones: ${count.reminders} recordatorios pendientes`:'Mural de asignaciones');}}
  if(!notes.length){list.append(text('p','No hay asignaciones en esta vista.','board-empty'));return;}
  for(const note of notes){
   const card=root.createElement('article');card.className='board-note';card.dataset.priority=note.priority;card.dataset.status=note.status;
   const top=root.createElement('div');top.className='board-note-meta';top.append(text('span',PRIORITIES[note.priority]||'Normal'),text('span',STATES[note.status]||'Pendiente'));if(note.pinned)top.append(text('span','Fijado'));card.append(top,text('h3',note.title),text('p',note.body,'board-note-body'));
   if(note.assignee_email)card.append(text('p','Responsable: '+note.assignee_email,'board-assignee'));
   if(note.due_at){const time=text('time','Vence: '+new Date(note.due_at).toLocaleString('es-HN',{dateStyle:'medium',timeStyle:'short'}),'board-due');time.dateTime=note.due_at;if(note.status!=='done'&&Date.parse(note.due_at)<Date.now())time.classList.add('board-overdue');card.append(time);}
   if(note.remind_at&&note.status!=='done'){const time=text('time','Recordar: '+new Date(note.remind_at).toLocaleString('es-HN',{dateStyle:'medium',timeStyle:'short'}),'board-reminder');time.dateTime=note.remind_at;card.append(time);}
   card.append(text('small','Actualizado '+new Date(note.updated_at).toLocaleString('es-HN',{dateStyle:'short',timeStyle:'short'})));
   if(canPublish){const actions=root.createElement('div');actions.className='board-note-actions';actions.append(button('Editar',()=>edit(note)));if(note.status!=='done'&&!note.archived)actions.append(button('Completar',()=>void update(note,{status:'done'})));if(note.remind_at&&note.status!=='done'&&!note.archived)actions.append(button('Posponer 1 h',()=>void update(note,{remind_at:new Date(Date.now()+3600000).toISOString()})));actions.append(button(note.archived?'Restaurar':'Archivar',()=>void archive(note)));card.append(actions);}
   list.append(card);
  }
 }
 async function load(append=false){
  if(loading||saving||!identity)return;const ticket=epoch,account=identity;loading=true;$('board-refresh').disabled=true;tell('Cargando pizarra…');
  try{
   const start=append?offset:0,data=await client.feed($('board-filter').value==='archived',start);
   if(ticket!==epoch||account!==identity)return;
   if(!data||!Array.isArray(data.notes))throw Error('No se pudo leer la pizarra.');
   canPublish=data.canPublish===true;owner=data.owner===true;supervisors=Array.isArray(data.supervisors)?data.supervisors:[];
   const combined=append?[...notes,...data.notes]:data.notes;notes=[...new Map(combined.map(n=>[n.id,n])).values()];offset=start+data.notes.length;
   $('board-new').hidden=!canPublish;$('board-publishers').hidden=!owner;$('board-more').hidden=data.more!==true;render();tell('');scheduleReminders();
  }catch(e){if(ticket!==epoch)return;tell(e.message||'No se pudo cargar el mural.');}
  finally{loading=false;$('board-refresh').disabled=false;}
 }
 function fillAssignees(current=''){const select=$('board-assignee');select.replaceChildren();const empty=root.createElement('option');empty.value='';empty.textContent='Sin asignar';select.append(empty);for(const email of [...new Set([...supervisors,current].filter(Boolean))]){const option=root.createElement('option');option.value=email;option.textContent=email;select.append(option);}select.value=current;}
 function edit(note=null){
  if(!canPublish||saving)return;if(dirty&&!confirmDiscard('¿Descartar la edición sin guardar?'))return;
  editing=note||{id:crypto.randomUUID(),revision:0,archived:false};form.hidden=false;dirty=false;
  $('board-editor-title').textContent=note?'Editar asignación':'Nueva asignación';$('board-title').value=note?.title||'';$('board-body').value=note?.body||'';$('board-priority').value=note?.priority||'normal';$('board-state').value=note?.status||'pending';fillAssignees(note?.assignee_email||'');$('board-pinned').checked=note?.pinned===true;$('board-due').value=localBoardDate(note?.due_at);$('board-remind').value=localBoardDate(note?.remind_at);$('board-title').focus();
 }
 async function save(note,value){
  if(saving||!canPublish)return;const ticket=epoch;saving=true;for(const b of dialog.querySelectorAll('button,input,select,textarea'))b.disabled=true;
  try{const result=await client.save(note.id,note.revision,validateBoardDraft(value));if(ticket!==epoch)return;if(!result?.id||result.revision<=note.revision)throw Error('No se confirmó la publicación.');clearEditor();tell('Asignación guardada.');}
  catch(e){if(ticket===epoch)tell((/changed|conflict/i.test(e.message)?'Otra persona modificó esta asignación. Tu texto sigue en el editor; recarga el mural y revisa la versión publicada.':e.message)||'No se guardó. Tu edición se conserva.');return;}
  finally{saving=false;for(const b of dialog.querySelectorAll('button,input,select,textarea'))b.disabled=false;}
  if(ticket===epoch)await load();
 }
 async function update(note,patch){if(dirty){tell('Guarda o cancela tu edición antes de cambiar otra asignación.');return;}await save(note,{...note,...patch});}
 async function archive(note){if(!confirmDiscard(note.archived?'¿Restaurar esta asignación?':'¿Archivar esta asignación? Podrás restaurarla después.'))return;await update(note,{archived:!note.archived});}
 async function publishers(){if(!owner)return;const ticket=epoch;try{const rows=await client.publishers();if(ticket!==epoch)return;const host=$('board-publisher-list');host.replaceChildren();for(const row of rows){const item=root.createElement('li');item.append(text('span',row.email),button('Revocar',()=>void grant(row.email,false)));host.append(item);}if(!rows.length)host.append(text('li','Sólo el creador puede gestionar por ahora.'));}catch(e){if(ticket===epoch)tell(e.message);}}
 async function grant(email,allowed){if(!owner||saving)return;const ticket=epoch;saving=true;$('board-grant-submit').disabled=true;let changed=false;try{await client.grant(email,allowed);if(ticket!==epoch)return;$('board-grant-form').reset();tell(allowed?'Supervisor autorizado.':'Permiso revocado.');await publishers();changed=true;}catch(e){if(ticket===epoch)tell(e.message);}finally{saving=false;$('board-grant-submit').disabled=false;}if(changed&&ticket===epoch)await load();}
 async function open(){root.getElementById('web-settings-dialog')?.close();if(!dialog.open)dialog.showModal();const ticket=++epoch;tell('Comprobando tu sesión…');try{const user=await client.identity();if(ticket!==epoch)return;identity=user?.id||null;clear();if(identity)await load();}catch(e){if(ticket===epoch){identity=null;clear();tell(e.message||'No se pudo comprobar la sesión.');}}}
 function close(){if(saving)return;if(dirty&&!confirmDiscard('¿Cerrar sin guardar este recordatorio?'))return;clearEditor();dialog.close();}
 for(const id of ['open-board','settings-board'])$(id)?.addEventListener('click',()=>void open());
 $('board-close').addEventListener('click',close);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('close',()=>{clearEditor();});
 $('board-request-code').addEventListener('click',async()=>{const email=$('board-email').value.trim();if(!email)return;tell('Solicitando código…');try{await client.requestCode(email);tell('Código solicitado. Revisa tu correo.');}catch(e){tell(e.message);}});
 $('board-sign-in').addEventListener('click',async()=>{tell('Verificando código…');try{const user=await client.verifyCode($('board-email').value,$('board-code').value);if(!user?.id)throw Error('No se pudo iniciar sesión.');$('board-code').value='';identity=user.id;clear();await load();}catch(e){tell(e.message);}});
 $('board-refresh').addEventListener('click',()=>void load());$('board-more').addEventListener('click',()=>void load(true));
 $('board-filter').addEventListener('change',()=>void load());$('board-new').addEventListener('click',()=>edit());$('board-cancel').addEventListener('click',()=>{if(!dirty||confirmDiscard('¿Descartar la edición?'))clearEditor();});
 form.addEventListener('input',()=>{dirty=true;});form.addEventListener('submit',e=>{e.preventDefault();if(editing)void save(editing,{title:$('board-title').value,body:$('board-body').value,priority:$('board-priority').value,status:$('board-state').value,assignee_email:$('board-assignee').value,pinned:$('board-pinned').checked,due_at:$('board-due').value||null,remind_at:$('board-remind').value||null,archived:editing.archived});});
 $('board-publishers').addEventListener('toggle',()=>{if($('board-publishers').open)void publishers();});$('board-grant-form').addEventListener('submit',e=>{e.preventDefault();void grant($('board-publisher-email').value,true);});
 clear();return {open,refresh:load};
}
