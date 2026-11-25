import {installCorporateBoard} from '../public/corporate-board.js';
const $=id=>document.getElementById(id),tests=[],assert=(value,name)=>{if(!value)throw Error(name);tests.push(name);},pause=()=>new Promise(r=>setTimeout(r,80));
let chosen='',requested='',user=null,reader=false,fail=false,deferred=null;
const notes=[
{id:'fixture-1',revision:1,title:'Revisión del programa semanal',body:'Confirmar asignaciones del turno. Datos ficticios.',priority:'important',status:'pending',assignee_email:'supervisor@fixture.invalid',pinned:true,archived:false,due_at:'2026-11-10T13:00:00Z',remind_at:null,updated_at:'2026-11-08T01:00:00Z'},
{id:'fixture-2',revision:1,title:'<img src=x onerror=alert(1)>',body:'Este texto nunca se interpreta como HTML.',priority:'urgent',status:'pending',assignee_email:null,pinned:false,archived:false,due_at:null,remind_at:null,updated_at:'2026-11-08T01:00:00Z'}];
const client={
 identity:async()=>user,
 sendPasswordCode:async email=>{requested=email;},
 passwordToken:async(email,code)=>{if(email!==requested||code!=='123456')throw Error('Código inválido');return 'fixture-token';},
 setPassword:async(token,password)=>{if(token!=='fixture-token')throw Error('Token inválido');chosen=password;},
 signIn:async(email,password)=>{if(email!==requested||password!==chosen)throw Error('Credenciales');return user={id:'fixture-supervisor',email};},
 signOut:async()=>{user=null;},
 feed:async archived=>{if(deferred)return deferred;if(fail)throw Error('Fallo de conexión simulado');return {notes:notes.filter(n=>n.archived===archived),canPublish:!reader,owner:!reader&&user?.id==='fixture-owner',supervisors:['supervisor@fixture.invalid'],more:false};},
 save:async(id,revision,value)=>{if(fail)throw Error('Fallo de conexión simulado');const note={...value,id,revision:revision+1,updated_at:new Date().toISOString()};const i=notes.findIndex(n=>n.id===id);if(i<0)notes.push(note);else notes[i]=note;return note;},
 publishers:async()=>[{email:'supervisor@fixture.invalid'}],grant:async()=>true,
 requestCode:async()=>true,verifyCode:async()=>({id:'fixture-owner'})
};
try{
 const board=installCorporateBoard({client,confirmDiscard:()=>true});
 await board.open();assert(!$('board-auth').hidden&&$('board-notes').children.length===0,'Sin sesión: contenido privado');
 $('board-email').value='supervisor@example.invalid';$('board-setup').open=true;$('board-reset-send').click();await pause();
 assert(!$('board-reset-form').hidden&&requested==='supervisor@example.invalid','Primer acceso solicita código al correo indicado');
 $('board-reset-code').value='000000';$('board-new-password').value=$('board-confirm-password').value='ficticia-123';$('board-reset-form').requestSubmit();await pause();
 assert(chosen===''&&$('board-status').textContent.includes('código'),'Código incorrecto conserva la cuenta');
 $('board-reset-code').value='123456';$('board-reset-form').requestSubmit();await pause();
 assert(chosen==='ficticia-123'&&$('board-new-password').value==='','Contraseña elegida se guarda y se limpia del formulario');
 $('board-password').value='ficticia-123';$('board-password-login').requestSubmit();await pause();
 assert(!$('board-new').hidden&&$('board-publishers').hidden&&$('board-auth').hidden,'Supervisor entra al mural sin gestión de accesos');
 $('board-sign-out').click();await pause();assert(!$('board-auth').hidden&&!$('board-notes').children.length,'Cerrar sesión borra los datos del mural');
 user={id:'fixture-owner'};await board.open();assert(!$('board-new').hidden&&!$('board-publishers').hidden,'Creador: permisos de gestión');
 assert(!$('board-notes').querySelector('img')&&$('board-notes').textContent.includes('<img'),'Texto hostil no se interpreta como HTML');
 $('board-new').click();$('board-title').value='Nueva asignación';$('board-body').value='Recordatorio de ejemplo.';$('board-editor').requestSubmit();await pause();assert($('board-editor').hidden&&$('board-notes').textContent.includes('Nueva asignación'),'Guardar y refrescar');
 $('board-new').click();$('board-title').value='Borrador privado';$('board-body').value='No perder la edición.';fail=true;$('board-editor').requestSubmit();await pause();assert(!$('board-editor').hidden&&$('board-body').value==='No perder la edición.','Fallo de red conserva el borrador');fail=false;$('board-cancel').click();
 reader=true;await board.refresh();assert($('board-new').hidden&&$('board-publishers').hidden&&!$('board-notes').querySelector('button'),'Lector sin controles de edición');
 notes[0].remind_at='2026-11-01T01:00:00Z';reader=false;await board.refresh();assert($('open-board').dataset.reminders==='1','Recordatorio visible en indicador');
 let resolve;deferred=new Promise(r=>resolve=r);const late=board.refresh();user=null;await board.open();resolve({notes,canPublish:true,owner:true});await late;deferred=null;assert($('board-notes').children.length===0&&$('board-new').hidden,'Sesión cerrada invalida respuesta pendiente');
 assert($('open-board').dataset.reminders===''&&$('board-count').textContent==='','Cierre de sesión limpia indicadores privados');
 user={id:'fixture-owner'};reader=false;await board.open();const content=document.querySelector('.board-content'),before=$('board-close').getBoundingClientRect();content.scrollTop=content.scrollHeight;await pause();const after=$('board-close').getBoundingClientRect();assert(before.width>0&&Math.abs(before.top-after.top)<1,'La X queda fija con scroll');
 assert($('board-dialog').getBoundingClientRect().right<=document.documentElement.clientWidth&&content.scrollWidth<=content.clientWidth+1,'Sin desbordamiento horizontal');
 $('board-close').click();await pause();assert(!$('board-dialog').open,'Cerrar mural');
 $('results').textContent='PASS '+tests.length+'/'+tests.length+' · '+tests.join(' · ');document.title='PASS '+tests.length+' · Mural';
}catch(e){$('results').textContent='FAIL: '+e.message;document.title='FAIL · Mural';}
