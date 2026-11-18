import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStaffDraft} from '../public/staff-admin.js';

test('trabajador conserva identidad y admite varios procesos de su planta', () => {
  const draft={id:'id-ficticio',revision:2,plantId:'sacos',name:'  Persona de prueba  ',code:'  P-001 ',active:true,processes:['telares','laminado']};
  assert.deepEqual(validateStaffDraft(draft,['telares','laminado']),{id:'id-ficticio',revision:2,plantId:'sacos',name:'Persona de prueba',code:'P-001',active:true,processes:['telares','laminado']});
});
test('no acepta asignaciones de otra planta ni repetidas', () => {
  const draft={name:'Persona ficticia',plantId:'sacos',processes:['imprenta','imprenta']};
  assert.throws(()=>validateStaffDraft(draft,['imprenta']));
  assert.throws(()=>validateStaffDraft({...draft,processes:['extrusion']},['imprenta']));
});
