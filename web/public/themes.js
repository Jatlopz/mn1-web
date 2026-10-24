export const THEME_KEY = 'mn1.appearance.theme';
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
}

export function installSettings(nativeMenu, root=document) {
 const button=root.getElementById('open-web-settings');
 const dialog=root.getElementById('web-settings-dialog');
 button.hidden=Boolean(nativeMenu);
 button.addEventListener('click',()=>{if(!dialog.open)dialog.showModal();});
 root.getElementById('close-web-settings').addEventListener('click',()=>dialog.close());
}
