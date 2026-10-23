export const THEME_KEY = 'mn1.appearance.theme';
export const THEMES = Object.freeze([
 {id:'ice',name:'Azul hielo',accent:'#8dd8ff'},
 {id:'violet',name:'Amatista',accent:'#d5b7ff'},
 {id:'amber',name:'Ámbar',accent:'#ffd08a'},
 {id:'lime',name:'Lima clásico',accent:'#c8f751'},
]);
export const normalizeTheme = value => THEMES.some(t=>t.id===value) ? value : 'ice';
export async function installThemes(storage, root=document, events=window) {
 const dialog=root.getElementById('theme-dialog');
 const error=root.getElementById('theme-error');
 let selected='ice',saving=false;
 const apply=id=>{
  selected=normalizeTheme(id);root.documentElement.dataset.theme=selected;
  for(const button of dialog.querySelectorAll('[data-theme-choice]')) button.setAttribute('aria-pressed',String(button.dataset.themeChoice===selected));
 };
 apply('ice');
 try {apply(await storage.getText(THEME_KEY));}catch {error.textContent='No se pudo leer tu preferencia. Puedes elegir un tema.';}
 const open=()=>{if(!dialog.open)dialog.showModal();};
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
