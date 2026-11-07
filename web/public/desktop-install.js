/** Browser-owned installation. No executable downloads, storage changes or app cache. */
export function createDesktopInstaller({host,button,status,help}) {
 let promptEvent=null,busy=false,installed=false;
 const standalone=()=>host.matchMedia?.('(display-mode: standalone)').matches===true;
 const showHelp=()=>{help.hidden=false;};
 const render=()=>{button.disabled=busy||standalone();button.textContent=standalone()?'Abierta como aplicación':busy?'Abriendo instalador…':installed?'Ver cómo abrir SuperTools':'Instalar SuperTools';};
 const available=event=>{event.preventDefault();promptEvent=event;if(!busy){status.textContent='Lista para instalar. Windows te pedirá confirmar.';render();}};
 const completed=()=>{installed=true;promptEvent=null;busy=false;status.textContent='SuperTools está instalada. Ábrela desde el menú Inicio; el navegador puede ofrecer crear el acceso en el escritorio.';render();};
 const install=async()=>{
  if(busy||standalone())return;
  const event=promptEvent;
  if(!event){showHelp();status.textContent=installed?'Busca SuperTools en el menú Inicio de Windows.':'Si no aparece el instalador, usa la opción de instalación de Edge o Chrome que se indica abajo.';return;}
  promptEvent=null;busy=true;render();
  try {await event.prompt();const choice=await event.userChoice;if(!installed){status.textContent=choice?.outcome==='accepted'?'Instalación aceptada. Sigue las indicaciones del navegador para crear el acceso directo.':'Instalación cancelada. Puedes intentarlo de nuevo desde el menú del navegador.';showHelp();}}
  catch {status.textContent='El navegador no pudo abrir el instalador. Puedes usar su menú para instalar SuperTools.';showHelp();}
  finally {busy=false;render();}
 };
 host.addEventListener('beforeinstallprompt',available);host.addEventListener('appinstalled',completed);button.addEventListener('click',install);
 if(standalone())status.textContent='Ya estás usando SuperTools en su propia ventana. Pulsa Abrir SuperTools para entrar.';
 render();
 return {dispose(){host.removeEventListener('beforeinstallprompt',available);host.removeEventListener('appinstalled',completed);button.removeEventListener('click',install);}};
}

if(typeof document!=='undefined') {
 const button=document.getElementById('desktop-install');
 if(button)createDesktopInstaller({host:window,button,status:document.getElementById('install-status'),help:document.getElementById('install-help')});
}
