import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSpanishCommand} from '../public/voice.js';

test('voice never proposes preparation for cancellation or explicit negation', () => {
 for(const phrase of ['Cancela el envio de los espartanos a las ocho para Telares','No envies el anuncio de los champions a las nueve para Extrusion','No prepares el anuncio de los indestructibles a las ocho para Telares']) {
  assert.equal(parseSpanishCommand(phrase).ok,false,phrase);
 }
});

test('voice does not silently truncate spoken minutes', () => {
 const result=parseSpanishCommand('Prepara el anuncio de los espartanos a las ocho treinta para Telares');
 assert.ok(!result.ok || result.hour==='08:30',JSON.stringify(result));
});