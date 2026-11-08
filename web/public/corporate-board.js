const PRIORITIES=Object.freeze({normal:'Normal',important:'Importante',urgent:'Urgente'});
export function validateBoardDraft(value){
 const title=String(value?.title||'').trim(),body=String(value?.body||'').trim();
 if(!title||title.length>120||!body||body.length>4000||!Object.hasOwn(PRIORITIES,value?.priority)||typeof value.pinned!=='boolean'||typeof value.archived!=='boolean')throw Error('Escribe un título de hasta 120 caracteres y una nota de hasta 4000.');
 const due_at=value.due_at||null;
 if(due_at!==null&&(!Number.isFinite(Date.parse(due_at))))throw Error('Revisa la fecha del recordatorio.');
 return {title,body,priority:value.priority,pinned:value.pinned,archived:value.archived,due_at:due_at?new Date(due_at).toISOString():null};
}
export function localBoardDate(iso){if(!iso)return '';const d=new Date(iso);if(!Number.isFinite(d.valueOf()))return '';return new Date(d.valueOf()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function installCorporateBoard({client,root=document,openAccount,confirmDiscard=message=>globalThis.confirm(message)}){
 const dialog=root.getElementById('board-dialog');if(!dialog)return {setIdentity(){}};
 const $=id=>root.getElementById(id),list=$('board-notes'),form=$('board-editor'),feedback=$('board-status');
 let identity=null,epoch=0,loading=false,canPublish=false,owner=false,notes=[],offset=0,editing=null,dirty=false,saving=false;
 const text=(tag,value,className='')=>{const e=root.createElement(tag);e.textContent=value;e.className=className;return e;};
 const tell=message=>{feedback.textContent=message;};
 function clearEditor(){editing=null;dirty=false;form.reset();form.hidden=true;}
 function clear(){epoch++;notes=[];list.replaceChildren();canPublish=false;owner=false;clearEditor();$('board-new').hidden=true;$('board-publishers').hidden=true;$('board-publisher-list').replaceChildren();$('board-more').hidden=true;$('board-login').hidden=Boolean(identity);tell(identity?'':'Inicia sesión para leer los recordatorios de la empresa.');}
 function setIdentity(id){if(id===identity)return;identity=id;clear();if(dialog.open&&id)void load();}
 function button(label,handler){const b=text('button',label,'button button-secondary');b.type='button';b.addEventListener('click',handler);return b;}
 function render(){
  list.replaceChildren();
  if(!notes.length){list.append(text('p','No hay recordatorios en esta vista.','board-empty'));return;}
  for(const note of notes){
   const card=root.createElement('article');card.className='board-note';card.dataset.priority=note.priority;
   const top=root.createElement('div');top.className='board-note-meta';top.append(text('span',PRIORITIES[note.priority]||'Normal'));if(note.pinned)top.append(text('span','Fijado'));card.append(top,text('h3',note.title),text('p',note.body,'board-note-body'));
   if(note.due_at){const time=text('time','Para el '+new Date(note.due_at).toLocaleString('es-HN',{dateStyle:'medium',timeStyle:'short'}),'board-due');time.dateTime=note.due_at;card.append(time);}
   card.append(text('small','Actualizado '+new Date(note.updated_at).toLocaleString('es-HN',{dateStyle:'short',timeStyle:'short'})));
   if(canPublish){const actions=root.createElement('div');actions.className='board-note-actions';actions.append(button('Editar',()=>edit(note)),button(note.archived?'Restaurar':'Archivar',()=>void archive(note)));card.append(actions);}
   list.append(card);
  }
 }
 async function load(append=false){
  if(loading||saving||!identity)return;const ticket=epoch,account=identity;loading=true;$('board-refresh').disabled=true;tell('Cargando pizarra…');
  try{
   const start=append?offset:0,data=await client.boardFeed($('board-filter').value==='archived',start);
   if(ticket!==epoch||account!==identity)return;
   if(!data||!Array.isArray(data.notes))throw Error('No se pudo leer la pizarra.');
   canPublish=data.canPublish===true;owner=data.owner===true;
   const combined=append?[...notes,...data.notes]:data.notes;notes=[...new Map(combined.map(n=>[n.id,n])).values()];offset=start+data.notes.length;
   $('board-new').hidden=!canPublish;$('board-publishers').hidden=!owner;$('board-more').hidden=data.more!==true;render();tell('');
  }catch(e){if(ticket!==epoch)return;if(['401','403','login'].includes(e.code)){clear();tell('Inicia sesión de nuevo para abrir la pizarra.');$('board-login').hidden=false;}else tell(e.message||'No se pudo cargar la pizarra.');}
  finally{loading=false;$('board-refresh').disabled=false;}
 }
 function edit(note=null){
  if(!canPublish||saving)return;if(dirty&&!confirmDiscard('¿Descartar la edición sin guardar?'))return;
  editing=note||{id:crypto.randomUUID(),revision:0,archived:false};form.hidden=false;dirty=false;
  $('board-editor-title').textContent=note?'Editar recordatorio':'Nuevo recordatorio';$('board-title').value=note?.title||'';$('board-body').value=note?.body||'';$('board-priority').value=note?.priority||'normal';$('board-pinned').checked=note?.pinned===true;$('board-due').value=localBoardDate(note?.due_at);$('board-title').focus();
 }
 async function save(note,value){
  if(saving||!canPublish)return;const ticket=epoch;saving=true;for(const b of dialog.querySelectorAll('button,input,select,textarea'))b.disabled=true;
  try{const result=await client.saveBoardNote(note.id,note.revision,validateBoardDraft(value));if(ticket!==epoch)return;if(!result?.id||result.revision<=note.revision)throw Error('No se confirmó la publicación.');clearEditor();tell('Recordatorio guardado.');}
  catch(e){if(ticket===epoch)tell((e.code==='conflict'?'Otra persona modificó esta nota. Tu texto sigue en el editor; recarga la pizarra y revisa la versión publicada.':e.message)||'No se guardó. Tu edición se conserva.');return;}
  finally{saving=false;for(const b of dialog.querySelectorAll('button,input,select,textarea'))b.disabled=false;}
  if(ticket===epoch)await load();
 }
 async function archive(note){if(dirty){tell('Guarda o cancela tu edición antes de archivar otra nota.');return;}if(!confirmDiscard(note.archived?'¿Restaurar este recordatorio?':'¿Archivar este recordatorio? Podrás restaurarlo después.'))return;await save(note,{...note,archived:!note.archived});}
 async function publishers(){if(!owner)return;const ticket=epoch;try{const rows=await client.boardPublishers();if(ticket!==epoch)return;const host=$('board-publisher-list');host.replaceChildren();for(const row of rows){const item=root.createElement('li');item.append(text('span',row.email),button('Revocar',()=>void grant(row.email,false)));host.append(item);}if(!rows.length)host.append(text('li','Sólo el creador puede publicar por ahora.'));}catch(e){if(ticket===epoch)tell(e.message);}}
 async function grant(email,allowed){if(!owner||saving)return;const ticket=epoch;saving=true;$('board-grant-submit').disabled=true;try{await client.grantBoardPublisher(email,allowed);if(ticket!==epoch)return;$('board-grant-form').reset();tell(allowed?'Cuenta autorizada para publicar.':'Permiso revocado.');await publishers();}catch(e){if(ticket===epoch)tell(e.message);}finally{saving=false;$('board-grant-submit').disabled=false;}}
 function open(){root.getElementById('web-settings-dialog')?.close();if(!dialog.open)dialog.showModal();if(identity)void load();else tell('Inicia sesión para leer los recordatorios de la empresa.');}
 function close(){if(saving)return;if(dirty&&!confirmDiscard('¿Cerrar sin guardar este recordatorio?'))return;clearEditor();dialog.close();}
 for(const id of ['open-board','settings-board'])$(id)?.addEventListener('click',open);
 $('board-close').addEventListener('click',close);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('close',()=>{clearEditor();});
 $('board-login').addEventListener('click',()=>{dialog.close();openAccount();});$('board-refresh').addEventListener('click',()=>void load());$('board-more').addEventListener('click',()=>void load(true));
 $('board-filter').addEventListener('change',()=>void load());$('board-new').addEventListener('click',()=>edit());$('board-cancel').addEventListener('click',()=>{if(!dirty||confirmDiscard('¿Descartar la edición?'))clearEditor();});
 form.addEventListener('input',()=>{dirty=true;});form.addEventListener('submit',e=>{e.preventDefault();if(editing)void save(editing,{title:$('board-title').value,body:$('board-body').value,priority:$('board-priority').value,pinned:$('board-pinned').checked,due_at:$('board-due').value||null,archived:editing.archived});});
 $('board-publishers').addEventListener('toggle',()=>{if($('board-publishers').open)void publishers();});$('board-grant-form').addEventListener('submit',e=>{e.preventDefault();void grant($('board-publisher-email').value,true);});
 root.defaultView?.addEventListener('focus',()=>{if(dialog.open&&!dirty&&!editing)void load();});
 clear();return {setIdentity,open,refresh:load};
}
