export const THEME_KEY = 'mn1.appearance.theme';
export const APPEARANCE_KEY = 'mn1.appearance.surfaces.v1';
export const DEFAULT_APPEARANCE = Object.freeze({wallpaper:'original',cards:18,windows:8});
export function normalizeAppearance(value) {
 const source=value&&typeof value==='object'?value:{};
 const transparency=(key,max)=>typeof source[key]==='number'&&Number.isFinite(source[key])?Math.round(Math.max(0,Math.min(max,source[key]))):DEFAULT_APPEARANCE[key];
 return {wallpaper:source.wallpaper==='moon'?'moon':'original',cards:transparency('cards',60),windows:transparency('windows',40)};
}

export async function installAppearance(storage,root=document) {
 const controls=root.getElementById('appearance-controls');
 if(!controls)return;
 const status=root.getElementById('appearance-status');
 const buttons=[...controls.querySelectorAll('[data-wallpaper-choice]')];
 const cards=root.getElementById('appearance-cards'),windows=root.getElementById('appearance-windows');
 const reset=root.getElementById('appearance-reset');
 const inputs=[cards,windows,reset,...buttons];
 let saved=normalizeAppearance(null),draft=saved,revision=0,writes=Promise.resolve();
 const apply=value=>{
  draft=normalizeAppearance(value);
  root.documentElement.dataset.wallpaper=draft.wallpaper;
  root.documentElement.style.setProperty('--ui-card-opacity',(100-draft.cards)+'%');
  root.documentElement.style.setProperty('--ui-window-opacity',(100-draft.windows)+'%');
  for(const key of ['cards','windows']){
   root.getElementById('appearance-'+key).value=String(draft[key]);
   root.getElementById('appearance-'+key+'-value').textContent=draft[key]+' %';
  }
  for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.wallpaperChoice===draft.wallpaper));
 };
 apply(saved);
 for(const input of inputs)input.disabled=true;
 try{const raw=await storage.getText(APPEARANCE_KEY);saved=normalizeAppearance(raw?JSON.parse(raw):null);apply(saved);}
 catch{status.textContent='No se pudo leer la apariencia guardada. Tus equipos se conservan.';}
 finally{for(const input of inputs)input.disabled=false;}
 const save=value=>{
  const next=normalizeAppearance(value),current=++revision;
  status.textContent='';apply(next);
  // Serialize writes without disabling a focused slider or dropping rapid edits.
  writes=writes.then(async()=>{
   try{await storage.putText(APPEARANCE_KEY,JSON.stringify(next));saved=next;if(current===revision)status.textContent='Apariencia guardada en este teléfono.';}
   catch{if(current===revision){apply(saved);status.textContent='No se pudo guardar la apariencia. Se restauró el ajuste anterior.';}}
  });
  return writes;
 };
 for(const key of ['cards','windows']){
  const input=root.getElementById('appearance-'+key);
  input.addEventListener('input',()=>{revision++;apply({...draft,[key]:Number(input.value)});});
  input.addEventListener('change',()=>save({...draft,[key]:Number(input.value)}));
 }
 for(const button of buttons)button.addEventListener('click',()=>save({...draft,wallpaper:button.dataset.wallpaperChoice}));
 reset.addEventListener('click',()=>save(DEFAULT_APPEARANCE));
}
export const DEFAULT_THEME = 'halloween';
export const THEMES = Object.freeze([
 {id:'ice',name:'Azul hielo',accent:'#8dd8ff'},
 {id:'violet',name:'Amatista',accent:'#d5b7ff'},
 {id:'amber',name:'Ámbar',accent:'#ffd08a'},
 {id:'lime',name:'Lima clásico',accent:'#c8f751'},
 {id:'halloween',name:'Halloween',accent:'#ffbd80',seasonal:true},
 {id:'winter',name:'Fin de año',accent:'#9ce8dd',seasonal:true},
]);
export const normalizeTheme = value => THEMES.some(t=>t.id===value) ? value : DEFAULT_THEME;
export async function installThemes(storage, root=document, events=window) {
 const dialog=root.getElementById('theme-dialog');
 const error=root.getElementById('theme-error');
 let selected=DEFAULT_THEME,saving=false;
 const apply=id=>{
  selected=normalizeTheme(id);root.documentElement.dataset.theme=selected;
  const backgrounds=root.getElementById('halloween-backgrounds');if(backgrounds)backgrounds.hidden=selected!=='halloween';
  for(const button of dialog.querySelectorAll('[data-theme-choice]')) button.setAttribute('aria-pressed',String(button.dataset.themeChoice===selected));
 };
 apply(DEFAULT_THEME);
 try {apply(await storage.getText(THEME_KEY));}catch {error.textContent='No se pudo leer tu preferencia. Puedes elegir un tema.';}
 const section=value=>{
  const base=root.getElementById('base-themes'),season=root.getElementById('seasonal-themes');
  if(!base||!season)return;
  base.hidden=value==='season';season.hidden=value!=='season';
  root.getElementById('theme-tab-base').setAttribute('aria-selected',String(value!=='season'));
  root.getElementById('theme-tab-season').setAttribute('aria-selected',String(value==='season'));
  root.getElementById('theme-tab-base').tabIndex=value==='season'?-1:0;
  root.getElementById('theme-tab-season').tabIndex=value==='season'?0:-1;
 };
 root.getElementById('theme-tab-base')?.addEventListener('click',()=>section('base'));
 root.getElementById('theme-tab-season')?.addEventListener('click',()=>section('season'));
 for(const id of ['theme-tab-base','theme-tab-season']) root.getElementById(id)?.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();const next=event.key==='Home'?'base':event.key==='End'?'season':id==='theme-tab-base'?'season':'base';
  section(next);root.getElementById(next==='base'?'theme-tab-base':'theme-tab-season').focus();
 });
 const open=()=>{root.getElementById('web-settings-dialog')?.close();section(THEMES.find(t=>t.id===selected)?.seasonal?'season':'base');if(!dialog.open)dialog.showModal();};
 root.getElementById('open-themes').addEventListener('click',open);
 root.getElementById('close-themes').addEventListener('click',()=>dialog.close());
 events.addEventListener('mn1:open-themes',open);
 dialog.addEventListener('click',async event=>{
  const button=event.target.closest('[data-theme-choice]');
  if(!button||saving)return;
  const previous=selected;const next=normalizeTheme(button.dataset.themeChoice);
  saving=true;error.textContent='';apply(next);
  try {await storage.putText(THEME_KEY,next);}
  catch {apply(previous);error.textContent='No se pudo guardar el tema. Tus equipos no se modificaron.';}
  finally {saving=false;}
 });
 await installAppearance(storage,root);
}

export function installSettings(nativeMenu, root=document) {
 const button=root.getElementById('open-web-settings');
 const dialog=root.getElementById('web-settings-dialog');
 button.hidden=Boolean(nativeMenu);
 button.addEventListener('click',()=>{if(!dialog.open)dialog.showModal();});
 root.getElementById('close-web-settings').addEventListener('click',()=>dialog.close());
}

export const SUPPORT_PAYPAL_URL='https://paypal.me/Jatlopz90';
export function installCoffeeLink({native=false,canOpenExternal=false}={},root=document){
 const link=root.getElementById('about-paypal'),hint=root.getElementById('coffee-compat');
 link.href=SUPPORT_PAYPAL_URL;link.target=native?'_self':'_blank';hint.hidden=true;
 link.addEventListener('click',event=>{if(native&&!canOpenExternal){event.preventDefault();hint.hidden=false;hint.textContent='Abre paypal.me/Jatlopz90 en tu navegador. Para abrirlo directamente desde aquí, actualiza SuperTools desde Settings → Actualizaciones.';}});
}

export function installContactCopy(root=document,clipboard=globalThis.navigator?.clipboard){
 for(const [kind,label] of [['whatsapp','Número de WhatsApp'],['email','Correo']]){
  const button=root.getElementById('copy-creator-'+kind),value=root.getElementById('creator-'+kind),status=root.getElementById('creator-contact-status');
  button.addEventListener('click',async()=>{try{if(!clipboard?.writeText)throw Error('Copiado no disponible');await clipboard.writeText(value.textContent.trim());status.textContent=label+' copiado.';}catch{status.textContent='Mantén pulsado el dato para copiarlo.';value.focus?.();}});
 }
}
