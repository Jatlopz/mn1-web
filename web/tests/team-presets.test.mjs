import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WIDGET_HASH,
  WIDGET_OPEN_EVENT,
  canEditOverlayByPointer,
  canMoveOverlayByPointer,
  createWidgetOpenQueue,
  isWidgetHash,
  openWidgetDefault,
} from '../public/app.js';
import { layoutOverlay } from '../public/renderer.js';

test('el bloqueo sólo impide arrastrar el overlay y respeta los demás bloqueos', () => {
  const unlocked = { locked: false };
  const locked = { locked: true };
  assert.equal(canEditOverlayByPointer({ overlay: unlocked }), true);
  assert.equal(canEditOverlayByPointer({ overlay: locked }), false);
  assert.equal(canEditOverlayByPointer({ overlay: unlocked, busy: true }), false);
  assert.equal(canEditOverlayByPointer({ overlay: unlocked, workspace: false }), false);
  assert.equal(canEditOverlayByPointer({ overlay: unlocked, hasImage: false }), false);
  assert.equal(canMoveOverlayByPointer(true, unlocked), true);
  assert.equal(canMoveOverlayByPointer(true, locked), false);
  assert.equal(canMoveOverlayByPointer(false, unlocked), false);
});

test('el renderer calcula la misma posición con el overlay bloqueado o desbloqueado', () => {
  const base = { x: 0.3, y: 0.6, size: 0.08, font: 'serif', color: '#ffffff', showDate: false, date: '', twelveHour: false };
  const unlocked = layoutOverlay(base, 400, 600, '08:00');
  const locked = layoutOverlay({ ...base, locked: true }, 400, 600, '08:00');
  assert.equal(locked.x, unlocked.x);
  assert.equal(locked.y, unlocked.y);
  assert.equal(locked.hourText, unlocked.hourText);
  assert.equal(locked.hourFont, unlocked.hourFont);
  assert.equal(locked.dateY, unlocked.dateY);
});

test('el origen del widget se encola antes de hidratar y se entrega una sola vez', () => {
  const queue = createWidgetOpenQueue();
  assert.equal(queue.enqueue('cold'), true);
  assert.equal(queue.enqueue('warm'), true);
  assert.equal(queue.pendingCount, 2);
  assert.deepEqual(queue.markHydrated(), ['cold', 'warm']);
  assert.equal(queue.hydrated, true);
  assert.equal(queue.pendingCount, 0);
  assert.equal(queue.enqueue('late'), false);
  assert.deepEqual(queue.markHydrated(), []);
  assert.equal(WIDGET_OPEN_EVENT, 'mn1:widget-open');
  assert.equal(WIDGET_HASH, '#widget');
  assert.equal(isWidgetHash('#widget'), true);
  assert.equal(isWidgetHash('#widget/extra'), false);
});

test('el widget guarda primero, aplica la hora y sólo entonces abre y consume el hash', async () => {
  const calls = [];
  const result = await openWidgetDefault({
    defaultHour: '09:15',
    flushSave: async () => { calls.push('flush'); return true; },
    applyDefaultHour: async (hour) => { calls.push(`apply:${hour}`); },
    openEditor: async () => { calls.push('open'); },
    consumeHash: () => { calls.push('consume'); },
    report: (reason) => { calls.push(`report:${reason}`); },
  });
  assert.deepEqual(result, { ok: true, hour: '09:15' });
  assert.deepEqual(calls, ['flush', 'apply:09:15', 'open', 'consume', 'report:opened']);
});

test('el widget no aplica, abre ni consume si el guardado falla o lanza', async () => {
  for (const flushSave of [async () => false, async () => { throw new Error('offline'); }]) {
    const calls = [];
    const result = await openWidgetDefault({
      defaultHour: '08:00',
      flushSave,
      applyDefaultHour: () => { calls.push('apply'); },
      openEditor: () => { calls.push('open'); },
      consumeHash: () => { calls.push('consume'); },
      report: (reason) => { calls.push(`report:${reason}`); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'save_failed');
    assert.deepEqual(calls, ['report:save_failed']);
  }
});

test('el widget rechaza ocupado, escucha activa y hora ausente sin tocar el borrador', async () => {
  for (const [options, reason] of [
    [{ defaultHour: '08:00', isBusy: true }, 'busy'],
    [{ defaultHour: '08:00', isListening: true }, 'listening'],
    [{ defaultHour: '' }, 'missing_default'],
    [{ defaultHour: '24:00' }, 'missing_default'],
  ]) {
    let touched = false;
    const reports = [];
    const result = await openWidgetDefault({
      ...options,
      flushSave: () => { touched = true; },
      applyDefaultHour: () => { touched = true; },
      openEditor: () => { touched = true; },
      consumeHash: () => { touched = true; },
      report: (value) => reports.push(value),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(touched, false);
    assert.deepEqual(reports, [reason]);
  }
});

test('el widget no consume el origen si aplicar o abrir falla', async () => {
  for (const [options, reason] of [
    [{ applyDefaultHour: () => { throw new Error('apply'); } }, 'apply_failed'],
    [{ openEditor: () => { throw new Error('open'); } }, 'open_failed'],
  ]) {
    const calls = [];
    const result = await openWidgetDefault({
      defaultHour: '10:00',
      flushSave: async () => true,
      applyDefaultHour: () => {},
      openEditor: () => {},
      consumeHash: () => { calls.push('consume'); },
      report: (value) => { calls.push(value); },
      ...options,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(calls.includes('consume'), false);
    assert.deepEqual(calls, [reason]);
  }
});
