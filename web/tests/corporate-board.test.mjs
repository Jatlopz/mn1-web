import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateBoardDraft,localBoardDate,boardIndicators} from '../public/corporate-board.js';
const base={title:' Cambio de turno ',body:' Revisar el programa. ',priority:'important',status:'pending',assignee_email:'',pinned:true,archived:false,due_at:null,remind_at:null};
test('pizarra valida notas, fechas y límites sin interpretar HTML',()=>{
 assert.equal(validateBoardDraft(base).title,'Cambio de turno');assert.equal(validateBoardDraft({...base,body:'<script>alert(1)</script>'}).body,'<script>alert(1)</script>');
 for(const patch of [{title:''},{title:'x'.repeat(121)},{body:'x'.repeat(4001)},{priority:'__proto__'},{status:'invalid'},{pinned:'false'},{archived:1},{due_at:'no-date'},{remind_at:'bad'},{assignee_email:'not-mail'}])assert.throws(()=>validateBoardDraft({...base,...patch}));
 assert.equal(validateBoardDraft({...base,due_at:'2026-11-10T13:00:00Z'}).due_at,'2026-11-10T13:00:00.000Z');assert.equal(localBoardDate('invalid'),'');assert.equal(localBoardDate(null),'');
});
test('indicadores cuentan sólo asignaciones vigentes',()=>{
 const now=Date.parse('2026-11-17T12:00:00Z'),old='2026-11-17T11:00:00Z';
 assert.deepEqual(boardIndicators([{status:'pending',archived:false,due_at:old,remind_at:old},{status:'done',archived:false,due_at:old,remind_at:old},{status:'pending',archived:true,due_at:old,remind_at:old}],now),{pending:1,overdue:1,reminders:1});
});
test('mural está conectado a InsForge sin lectura periódica ni HTML interpretado',async()=>{
 const workspace=await readFile(new URL('../public/cloud-workspace.js',import.meta.url),'utf8'),ui=await readFile(new URL('../public/corporate-board.js',import.meta.url),'utf8'),html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),adapter=await readFile(new URL('../public/insforge-admin.js',import.meta.url),'utf8');
 assert.match(workspace,/installCorporateBoard\(\{client:assignmentBoard,onSessionChange:/);assert.match(adapter,/st_board_feed/);assert.match(adapter,/st_board_save/);assert.match(ui,/ticket!==epoch/);assert.match(ui,/e\.textContent=value/);assert.doesNotMatch(ui,/innerHTML|setInterval|localStorage|putText/);assert.match(html,/id="board-remind"/);assert.match(html,/id="board-assignee"/);
});
