import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDesktopInstaller} from '../public/desktop-install.js';

function fixture(standalone=false) {
 const host=new EventTarget();host.matchMedia=()=>({matches:standalone});
 const button=new EventTarget(),status={textContent:''},help={hidden:true};
 const controller=createDesktopInstaller({host,button,status,help});
 return {host,button,status,help,controller};
}
function offer(f,prompt=async()=>{},outcome='accepted') {
 const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=prompt;event.userChoice=Promise.resolve({outcome});f.host.dispatchEvent(event);return event;
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('sin soporte o sin evento muestra ayuda sin afirmar que está instalada',()=>{
 const f=fixture();f.button.dispatchEvent(new Event('click'));
 assert.equal(f.help.hidden,false);assert.match(f.status.textContent,/Edge o Chrome/);assert.equal(f.button.disabled,false);f.controller.dispose();
});
test('instalación sólo por clic; evita doble prompt y espera confirmación del navegador',async()=>{
 const f=fixture();let calls=0,finish;const event=offer(f,()=>{calls++;return new Promise(r=>{finish=r;});});
 assert.equal(event.defaultPrevented,true);assert.equal(calls,0);
 f.button.dispatchEvent(new Event('click'));f.button.dispatchEvent(new Event('click'));assert.equal(calls,1);assert.equal(f.button.disabled,true);
 finish();await tick();assert.match(f.status.textContent,/aceptada/);assert.doesNotMatch(f.status.textContent,/está instalada/);
 f.host.dispatchEvent(new Event('appinstalled'));assert.match(f.status.textContent,/está instalada/);assert.equal(f.button.disabled,false);f.controller.dispose();
});
test('cancelación y error ofrecen alternativa sin borrar datos o bloquear la interfaz',async()=>{
 const f=fixture();offer(f,async()=>{},'dismissed');f.button.dispatchEvent(new Event('click'));await tick();assert.match(f.status.textContent,/cancelada/);assert.equal(f.help.hidden,false);
 offer(f,async()=>{throw Error('unsupported');});f.button.dispatchEvent(new Event('click'));await tick();assert.match(f.status.textContent,/no pudo/);assert.equal(f.button.disabled,false);f.controller.dispose();
});
test('ventana standalone reconoce su modo; dispose elimina listeners',()=>{
 const f=fixture(true);assert.equal(f.button.disabled,true);assert.match(f.status.textContent,/propia ventana/);f.controller.dispose();
 const g=fixture();g.controller.dispose();offer(g);assert.equal(g.status.textContent,'');
});
test('manifest e iconos permiten instalar en el mismo origen y perfil sin caché de app',async()=>{
 const root=new URL('../public/',import.meta.url),m=JSON.parse(await readFile(new URL('app.webmanifest',root),'utf8'));
 assert.equal(m.id,'./');assert.equal(m.start_url,'./');assert.equal(m.scope,'./');assert.equal(m.display,'standalone');assert.equal(m.name,'SuperTools');
 assert.deepEqual(m.icons.map(i=>i.sizes),['192x192','512x512']);
 for(const icon of m.icons){const b=await readFile(new URL(icon.src,root));const size=Number(icon.sizes.split('x')[0]);assert.equal(b.readUInt32BE(16),size);assert.equal(b.readUInt32BE(20),size);}
 for(const name of ['index.html','install.html']){const html=await readFile(new URL(name,root),'utf8');assert.match(html,/rel="manifest" href="\.\/app.webmanifest"/);assert.match(html,/manifest-src 'self'/);assert.match(html,/worker-src 'none'/);}
 const js=await readFile(new URL('desktop-install.js',root),'utf8');assert.doesNotMatch(js,/localStorage|indexedDB|serviceWorker|fetch\(/);
});
