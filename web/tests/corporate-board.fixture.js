import {installCorporateBoard} from '../public/corporate-board.js';
const $=id=>document.getElementById(id),tests=[],assert=(value,name)=>{if(!value)throw Error(name);tests.push(name);},pause=()=>new Promise(r=>setTimeout(r,60));
let reader=false,fail=false,deferred=null;
const notes=[{id:'fixture-1',revision:1,title:'Revisión del programa semanal',body:'Confirmar las asignaciones de cada equipo antes del cambio de turno.\nDatos ficticios de demostración.',priority:'important',pinned:true,archived:false,due_at:'2026-11-10T13:00:00Z',updated_at:'2026-11-08T01:00:00Z'},
{id:'fixture-2',revision:1,title:'Material de capacitación',body:'Consultar las nuevas guías de trabajo.\n'+('Recordatorio de ejemplo. '.repeat(55)),priority:'normal',pinned:false,archived:false,due_at:null,updated_at:'2026-11-08T01:00:00Z'},
{id:'fixture-3',revision:1,title:'<img src=x onerror=alert(1)>',body:'El contenido del recordatorio siempre se muestra como texto.',priority:'urgent',pinned:false,archived:false,due_at:null,updated_at:'2026-11-08T01:00:00Z'}];
const client={boardFeed:async archived=>{if(deferred)return deferred;if(fail)throw Error('Fallo de conexión simulado');return {notes:notes.filter(n=>n.archived===archived),canPublish:!reader,owner:!reader,more:false};},saveBoardNote:async(id,revision,value)=>{if(fail)throw Error('Fallo de conexión simulado');const note={...value,id,revision:revision+1,updated_at:new Date().toISOString()};const i=notes.findIndex(n=>n.id===id);if(i<0)notes.push(note);else notes[i]=note;return note;},boardPublishers:async()=>[{email:'publisher@fixture.invalid'}],grantBoardPublisher:async()=>{}};
try{
 const board=installCorporateBoard({client,openAccount(){},confirmDiscard:()=>true});
 board.open();assert(!$('board-login').hidden&&$('board-notes').children.length===0,'Sin sesión: contenido privado vacío');
 board.setIdentity('fixture-owner');await pause();assert(!$('board-new').hidden&&!$('board-publishers').hidden,'Creador: publicar y autorizar cuentas');
 assert(!$('board-notes').querySelector('img')&&$('board-notes').textContent.includes('<img'),'Título hostil se muestra como texto');
 $('board-new').click();$('board-title').value='Nueva nota';$('board-body').value='Un recordatorio de ejemplo.';$('board-editor').dispatchEvent(new Event('input',{bubbles:true}));$('board-editor').requestSubmit();await pause();assert($('board-editor').hidden&&$('board-notes').textContent.includes('Nueva nota'),'Crear y refrescar la pizarra');
 $('board-new').click();$('board-title').value='Borrador privado';$('board-body').value='No perder esta edición.';$('board-editor').dispatchEvent(new Event('input',{bubbles:true}));fail=true;$('board-editor').requestSubmit();await pause();assert(!$('board-editor').hidden&&$('board-body').value==='No perder esta edición.','Fallo de red conserva el borrador');fail=false;$('board-cancel').click();
 reader=true;await board.refresh();assert($('board-new').hidden&&$('board-publishers').hidden&&!$('board-notes').querySelector('button'),'Lector: sin controles de publicación');
 let resolve;deferred=new Promise(r=>resolve=r);const late=board.refresh();board.setIdentity(null);resolve({notes,canPublish:true,owner:true});await late;deferred=null;assert($('board-notes').children.length===0&&$('board-new').hidden,'Cerrar sesión invalida respuestas pendientes');
 reader=false;board.setIdentity('fixture-owner');await pause();
 const content=document.querySelector('.board-content'),before=$('board-close').getBoundingClientRect();content.scrollTop=content.scrollHeight;await pause();const after=$('board-close').getBoundingClientRect();assert(before.width>0&&Math.abs(before.top-after.top)<1,'La X permanece fija al hacer scroll');content.scrollTop=0;
 const viewport=document.documentElement.clientWidth;assert($('board-dialog').getBoundingClientRect().right<=viewport&&content.scrollWidth<=content.clientWidth+1,'Sin desbordamiento horizontal');
 const closed=new Promise(r=>$('board-dialog').addEventListener('close',r,{once:true}));$('board-close').click();await closed;assert(!$('board-dialog').open,'La X cierra la pizarra');board.open();await pause();
 notes[1].body='Consultar las nuevas guías de trabajo antes del inicio de la jornada.\nDemostración con datos ficticios.';notes[2].title='Revisar equipos de protección';await board.refresh();
 $('results').textContent='PASS '+tests.length+'/'+tests.length+' · '+tests.join(' · ');document.title='PASS '+tests.length+'/10 · Pizarra';
}catch(e){$('results').textContent='FAIL: '+e.message;document.title='FAIL · Pizarra';}
