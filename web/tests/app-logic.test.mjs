import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MESSAGE,
  DEFAULT_TARGETS,
  HOUR_PRESETS,
  describeBridgeError,
  hourDraftError,
  isPngDataUrl,
  normalizeHourDraft,
  normalizeTargetLabels,
  splitMessage,
  textLength,
  validateDraft,
} from '../public/app.js';
import { BridgeError, MN1_LIMITS } from '../public/bridge.js';

function draft(overrides = {}) {
  return {
    message: DEFAULT_MESSAGE,
    hour: '08:00',
    targetLabels: [...DEFAULT_TARGETS],
    imageDataUrl: null,
    overlay: null,
    ...overrides,
  };
}

test('la plantilla por defecto es válida y conserva los accesos 08/09', () => {
  assert.deepEqual([...HOUR_PRESETS], ['08:00', '09:00']);
  assert.deepEqual([...DEFAULT_TARGETS], ['Telares', 'Extrusión']);
  assert.ok(DEFAULT_MESSAGE.includes('{hora}'));
  const validation = validateDraft(draft());
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, {});
  assert.equal(validation.normalized.hour, '08:00');
});

test('splitMessage interpola {hora} sin usar HTML', () => {
  assert.deepEqual(splitMessage('A {hora} B {hora}', '10:30'), [
    { type: 'text', value: 'A ' },
    { type: 'hour', value: '10:30' },
    { type: 'text', value: ' B ' },
    { type: 'hour', value: '10:30' },
  ]);
  assert.deepEqual(splitMessage('Sin token', '09:00'), [
    { type: 'text', value: 'Sin token' },
  ]);
  assert.deepEqual(splitMessage('', '09:00'), [
    { type: 'text', value: '' },
  ]);
  assert.deepEqual(splitMessage('{hora}', '09:00'), [
    { type: 'hour', value: '09:00' },
  ]);
});

test('hora personalizada normaliza y valida 00:00–23:59', () => {
  assert.equal(normalizeHourDraft('8', '5'), '08:05');
  assert.equal(normalizeHourDraft('00', '00'), '00:00');
  assert.equal(normalizeHourDraft('23', '59'), '23:59');
  assert.equal(normalizeHourDraft('24', '00'), null);
  assert.equal(normalizeHourDraft('12', '60'), null);
  assert.equal(normalizeHourDraft('', '30'), null);
  assert.equal(normalizeHourDraft('12', ''), null);
  assert.equal(normalizeHourDraft('12a', '2b'), '12:02');

  assert.match(hourDraftError('', ''), /Escribe la hora/);
  assert.match(hourDraftError('', '30'), /Falta la hora/);
  assert.match(hourDraftError('12', ''), /Faltan los minutos/);
  assert.match(hourDraftError('24', '00'), /entre 00 y 23/);
  assert.match(hourDraftError('12', '60'), /entre 00 y 59/);
  assert.equal(hourDraftError('23', '59'), null);
});

test('rechaza mensaje vacío, excesivo o fuera de formato', () => {
  assert.equal(validateDraft(draft({ message: '   ' })).errors.message, 'Escribe el mensaje antes de guardar o compartir.');
  assert.ok(validateDraft(draft({ message: 'x'.repeat(MN1_LIMITS.MESSAGE_MAX_LENGTH + 1) })).errors.message);
  assert.ok(validateDraft(draft({ hour: '8:00' })).errors.hour);
  assert.ok(validateDraft(draft({ hour: '24:00' })).errors.hour);
});

test('exige entre 2 y 10 etiquetas no vacías y con longitud limitada', () => {
  assert.ok(validateDraft(draft({ targetLabels: ['Telares'] })).errors.targets);
  assert.ok(validateDraft(draft({ targetLabels: Array.from({ length: 11 }, (_, index) => `Grupo ${index}`) })).errors.targets);
  assert.ok(validateDraft(draft({ targetLabels: ['Telares', '   '] })).errors.targets);
  assert.ok(validateDraft(draft({
    targetLabels: ['Telares', 'x'.repeat(MN1_LIMITS.LABEL_MAX_LENGTH + 1)],
  })).errors.targets);

  const valid = validateDraft(draft({ targetLabels: [' Telares ', 'Extrusión'] }));
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.normalized.targetLabels, ['Telares', 'Extrusión']);

  assert.deepEqual(normalizeTargetLabels([' A ', 'B']), ['A', 'B']);
  assert.equal(normalizeTargetLabels(['solo']), null);
  assert.equal(normalizeTargetLabels(['A', '']), null);
});

test('sólo acepta data URL PNG y respeta el tamaño máximo', () => {
  assert.equal(isPngDataUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(isPngDataUrl('data:image/jpeg;base64,AAAA'), false);
  assert.equal(isPngDataUrl('data:image/png;base64,@@@@'), false);
  assert.equal(isPngDataUrl('https://ejemplo.test/foto.png'), false);
  assert.equal(isPngDataUrl('data:image/png;base64,' + 'A'.repeat(MN1_LIMITS.IMAGE_DATA_URL_MAX_LENGTH)), false);
});

test('textLength cuenta caracteres Unicode visibles', () => {
  assert.equal(textLength('abc'), 3);
  assert.equal(textLength('ñ'), 1);
  assert.equal(textLength('🙂'), 1);
});

test('describeBridgeError conserva honestidad ante timeout y preview', () => {
  assert.match(describeBridgeError(new BridgeError('bridge_unavailable', 'x')), /No se guardó ni se compartió/);
  assert.match(describeBridgeError(new BridgeError('timeout', 'x')), /No se asumió ningún resultado/);
  assert.match(describeBridgeError(new BridgeError('payload_too_large', 'x')), /32 KB/);
});
