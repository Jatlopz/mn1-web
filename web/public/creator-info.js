export const DEFAULT_CREATOR_INFO=Object.freeze({showCeo:true,showCoffee:true,showContact:true,contacts:Object.freeze([{kind:'whatsapp',value:'+504 8830-1336'},{kind:'email',value:'Jatlopz90@gmail.com'}])});
export function normalizeCreatorInfo(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['showCeo','showCoffee','showContact','contacts'].includes(k))||!['showCeo','showCoffee','showContact'].every(k=>typeof value[k]==='boolean')||!Array.isArray(value.contacts)||value.contacts.length>6)throw Error('La información del perfil no es válida.');
 const seen=new Set(),counts={whatsapp:0,email:0},contacts=value.contacts.map(c=>{
  if(!c||Object.keys(c).some(k=>!['kind','value'].includes(k))||!['whatsapp','email'].includes(c.kind)||typeof c.value!=='string')throw Error('Contacto no válido.');
  const v=c.value.trim(),digits=v.replace(/\D/g,'');
  if(c.kind==='email'?v.length>254||!/^[^\s@<>;"\\]+@[^\s@<>;"\\]+\.[^\s@<>;"\\]+$/.test(v):v.length>32||!/^\+?[0-9 ()-]+$/.test(v)||digits.length<7||digits.length>15)throw Error(c.kind==='email'?'Revisa el correo electrónico.':'Revisa el número de WhatsApp, incluido el código de país.');
  const key=c.kind+':'+(c.kind==='email'?v.toLowerCase():digits);if(seen.has(key)||++counts[c.kind]>3)throw Error('Evita contactos repetidos. Máximo tres por tipo.');seen.add(key);return {kind:c.kind,value:v};
 });return {showCeo:value.showCeo,showCoffee:value.showCoffee,showContact:value.showContact,contacts};
}
export function publicCreatorInfo(value){const info=normalizeCreatorInfo(value);return {...info,contacts:info.showContact?info.contacts:[]};}

export function installCreatorInfo({getServices,client,root=document,clipboard=globalThis.navigator?.clipboard}){
 const $=id=>root.getElementById(id),editor=$('creator-info-editor'),form=$('creator-info-form'),about=$('about-dialog');
 if(!editor||!form)return {setAdmin(){},ready:Promise.resolve()};
 const storage=getServices().storage,publicKey='mn1.creator.info.public',draftKey='mn1.creator.info.draft';
 let admin=false,busy=false,loaded=false,revision=0,publicRevision=-1,draft=null;
 const status=$('creator-info-status'),rows=$('creator-info-contacts');
 function render(info){
  $('creator-ceo').hidden=!info.showCeo;$('about-coffee').hidden=!info.showCoffee;
  const host=$('creator-contact-list');host.replaceChildren();$('creator-business-contact').hidden=!info.showContact||!info.contacts.length;
  for(const contact of info.contacts){const row=root.createElement('div'),label=root.createElement('span'),value=root.createElement('span'),box=root.createElement('div'),copy=root.createElement('button');row.className='contact-row';label.className='contact-label';label.textContent=contact.kind==='email'?'Correo':'WhatsApp';value.className='contact-value';value.textContent=contact.value;value.tabIndex=0;copy.type='button';copy.className='contact-copy';copy.textContent='Copiar';copy.setAttribute('aria-label','Copiar '+label.textContent.toLowerCase());copy.addEventListener('click',async()=>{try{if(!clipboard?.writeText)throw Error();await clipboard.writeText(contact.value);$('creator-contact-status').textContent=label.textContent+' copiado.';}catch{$('creator-contact-status').textContent='Mantén pulsado el dato para copiarlo.';value.focus();}});box.append(label,value);row.append(box,copy);host.append(row);}
 }
 function lock(value){busy=value;for(const c of form.querySelectorAll('input,button'))c.disabled=value||(!loaded&&c.id!=='creator-info-reload');}
 function collect(){return normalizeCreatorInfo({showCeo:$('creator-show-ceo').checked,showCoffee:$('creator-show-coffee').checked,showContact:$('creator-show-contact').checked,contacts:[...rows.children].map(row=>({kind:row.dataset.kind,value:row.querySelector('input').value}))});}
 function remember(){if(!loaded||busy)return;try{const info=collect();void storage.putText(draftKey,JSON.stringify({revision,info})).catch(()=>{status.textContent='El borrador sigue en pantalla, pero no pudo guardarse en este dispositivo.';});}catch{/* Incomplete input remains editable; validate on save. */}}
 function contactRow(contact){
  const row=root.createElement('div'),label=root.createElement('label'),input=root.createElement('input'),remove=root.createElement('button');row.className='creator-contact-edit';row.dataset.kind=contact.kind;label.textContent=contact.kind==='email'?'Correo electrónico':'WhatsApp';input.type=contact.kind==='email'?'email':'tel';input.value=contact.value;input.maxLength=contact.kind==='email'?254:32;input.required=true;input.autocomplete='off';input.addEventListener('input',remember);remove.type='button';remove.className='button button-secondary';remove.textContent='Quitar';remove.setAttribute('aria-label','Quitar '+label.textContent);remove.addEventListener('click',()=>{row.remove();remember();});label.append(input);row.append(label,remove);rows.append(row);return input;
 }
 function fields(info){$('creator-show-ceo').checked=info.showCeo;$('creator-show-coffee').checked=info.showCoffee;$('creator-show-contact').checked=info.showContact;rows.replaceChildren();info.contacts.forEach(contactRow);}
 async function refresh(){try{const row=await client.creatorInfo();if(!row||!Number.isSafeInteger(row.revision)||row.revision<publicRevision)return;const info=publicCreatorInfo(row.info);publicRevision=row.revision;render(info);try{await storage.putText(publicKey,JSON.stringify({revision:publicRevision,info}));}catch{}}catch{/* Last confirmed public profile remains visible. */}}
 async function load(useDraft=true){
  if(!admin||busy)return;lock(true);status.textContent='Cargando tu perfil…';
  try{const row=await client.creatorSettings();if(!admin)return;if(!row||!Number.isSafeInteger(row.revision)||row.revision<0)throw Error('No se pudo leer el perfil.');draft=normalizeCreatorInfo(row.info);revision=row.revision;
   if(useDraft){try{const pending=JSON.parse(await storage.getText(draftKey)||'null');if(pending&&Number.isSafeInteger(pending.revision)&&pending.revision>=0){draft=normalizeCreatorInfo(pending.info);revision=pending.revision;}}catch{}}
   fields(draft);if(!useDraft){try{await storage.putText(draftKey,JSON.stringify({revision,info:draft}));}catch{}}loaded=true;status.textContent=revision!==row.revision?'Hay cambios publicados más recientes. Tu borrador se conserva; pulsa Recargar publicado antes de reemplazarlos.':'Sólo tú puedes modificar esta información. Se publicará al guardar.';
  }catch(e){status.textContent=e.message||'No se pudo cargar el perfil.';if(['401','403'].includes(e.code))setAdmin(false);}finally{lock(false);}
 }
 function setAdmin(value){admin=value===true;editor.hidden=!admin;if(!admin){editor.open=false;loaded=false;draft=null;rows.replaceChildren();}}
 editor.addEventListener('toggle',()=>{if(editor.open&&!loaded)void load();});
 for(const id of ['creator-show-ceo','creator-show-coffee','creator-show-contact'])$(id).addEventListener('change',remember);
 for(const kind of ['whatsapp','email'])$('creator-add-'+kind).addEventListener('click',()=>{if(!loaded||busy)return;if(rows.children.length>=6||[...rows.children].filter(r=>r.dataset.kind===kind).length>=3){status.textContent='Puedes agregar hasta tres contactos de cada tipo.';return;}contactRow({kind,value:''}).focus();});
 $('creator-info-reload').addEventListener('click',()=>void load(false));
 form.addEventListener('submit',async event=>{event.preventDefault();if(!admin||!loaded||busy)return;let info;try{info=collect();}catch(e){status.textContent=e.message;return;}lock(true);status.textContent='Guardando perfil…';
  try{await storage.putText(draftKey,JSON.stringify({revision,info}));const next=await client.setCreatorInfo(revision,info);if(!Number.isSafeInteger(next)||next<=revision)throw Error('No se confirmó la publicación. El borrador se conserva.');revision=next;draft=info;publicRevision=next;render(publicCreatorInfo(info));try{await storage.putText(publicKey,JSON.stringify({revision:next,info:publicCreatorInfo(info)}));await storage.putText(draftKey,'');}catch{}status.textContent='Perfil actualizado para todos los usuarios.';}
  catch(e){status.textContent=e.code==='conflict'?'El perfil cambió en otro lugar. Tu borrador se conserva. Recarga la versión publicada antes de guardar.':(e.message||'No se guardó el perfil. Tu borrador se conserva.');}finally{lock(false);}
 });
 render(publicCreatorInfo(DEFAULT_CREATOR_INFO));setAdmin(false);
 const ready=(async()=>{try{const row=JSON.parse(await storage.getText(publicKey)||'null');if(row&&Number.isSafeInteger(row.revision)&&row.revision>=0){render(publicCreatorInfo(row.info));publicRevision=row.revision;}}catch{}await refresh();})();
 if(typeof MutationObserver!=='undefined')new MutationObserver(()=>{if(about.open)void refresh();}).observe(about,{attributes:true,attributeFilter:['open']});
 return {setAdmin,ready,refresh};
}
