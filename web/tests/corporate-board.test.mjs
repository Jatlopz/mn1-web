import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateBoardDraft,localBoardDate} from '../public/corporate-board.js';
import {CloudClient} from '../public/cloud-client.js';
const base={title:' Cambio de turno ',body:' Revisar el programa. ',priority:'important',pinned:true,archived:false,due_at:null};
test('pizarra valida notas, fechas y límites sin interpretar HTML',()=>{
 assert.equal(validateBoardDraft(base).title,'Cambio de turno');assert.equal(validateBoardDraft({...base,body:'<script>alert(1)</script>'}).body,'<script>alert(1)</script>');
 for(const patch of [{title:''},{title:'x'.repeat(121)},{body:'x'.repeat(4001)},{priority:'__proto__'},{pinned:'false'},{archived:1},{due_at:'no-date'}])assert.throws(()=>validateBoardDraft({...base,...patch}));
 assert.equal(validateBoardDraft({...base,due_at:'2026-11-10T13:00:00Z'}).due_at,'2026-11-10T13:00:00.000Z');assert.equal(localBoardDate('invalid'),'');assert.equal(localBoardDate(null),'');
});
test('pizarra nunca pide contenido sin bearer y conserva contrato de revisión',async()=>{
 const calls=[],store={getText:async()=>null},client=new CloudClient(store,{fetcher:async(url,options)=>{calls.push({url,options});return new Response('{}',{status:200});}});
 await assert.rejects(()=>client.boardFeed(),e=>e.code==='login');assert.equal(calls.length,0);
 client.session={access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:Date.now()/1000+3600,user:{id:'fixture'}};
 await client.boardFeed(true,50);await client.saveBoardNote('fixture-note',7,validateBoardDraft(base));await client.grantBoardPublisher('person@fixture.invalid',false);
 assert.equal(calls[0].options.headers.Authorization,'Bearer fixture-token');assert.deepEqual(JSON.parse(calls[0].options.body),{p_archived:true,p_offset:50});assert.equal(JSON.parse(calls[1].options.body).p_expected,7);assert.equal(JSON.parse(calls[2].options.body).p_allowed,false);
});
test('pizarra está conectada al frontend y protege el contenido al cambiar identidad',async()=>{
 const workspace=await readFile(new URL('../public/cloud-workspace.js',import.meta.url),'utf8'),ui=await readFile(new URL('../public/corporate-board.js',import.meta.url),'utf8'),html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(workspace,/corporateBoard=installCorporateBoard/);assert.match(workspace,/corporateBoard\?\.setIdentity/);assert.match(ui,/ticket!==epoch/);assert.match(ui,/e\.textContent=value/);assert.doesNotMatch(ui,/innerHTML|localStorage|putText/);assert.match(html,/id="open-board"/);assert.match(html,/id="board-dialog"/);
});
