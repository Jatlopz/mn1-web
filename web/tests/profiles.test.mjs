import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_OVERLAY,
  DEFAULT_PROFILE_ID,
  DEFAULT_QUICK_HOURS,
  DEFAULT_TARGETS,
  PROFILE_CATALOG,
  PROFILE_IDS,
  cloneTemplate,
  createDefaultWorkspace,
  createProfileTemplate,
  getProfileDefinition,
  isProfileId,
  migrateLegacyWorkspace,
  normalizeDefaultHour,
  normalizeOverlay,
  normalizeQuickHours,
  normalizeTargetLabels,
  normalizeTemplate,
  normalizeWorkspaceState,
  resolveDefaultHourAfterQuickHoursEdit,
  updateProfile,
  validateDraft,
  validateQuickHours,
} from '../public/profiles.js';

test('el catálogo web contiene exactamente los cuatro equipos del contrato', () => {
  assert.deepEqual([...PROFILE_IDS], [
    'champions',
    'espartanos',
    'super-guerreros',
    'indestructibles',
  ]);
  assert.deepEqual(
    PROFILE_CATALOG.map((profile) => profile.name),
    ['Los Champions', 'Los Espartanos', 'Los Super Guerreros', 'Los Indestructibles'],
  );
  assert.equal(DEFAULT_PROFILE_ID, 'indestructibles');
  assert.equal(isProfileId('champions'), true);
  assert.equal(isProfileId('otro'), false);
  assert.equal(getProfileDefinition('super-guerreros').shortName, 'Super Guerreros');
});

test('el workspace por defecto tiene cuatro plantillas válidas y activa indestructibles', () => {
  const state = createDefaultWorkspace();
  assert.equal(state.version, 1);
  assert.equal(state.activeProfileId, 'indestructibles');
  assert.deepEqual(Object.keys(state.profiles).sort(), [...PROFILE_IDS].sort());
  for (const id of PROFILE_IDS) {
    const template = state.profiles[id];
    assert.match(template.message, /\{hora\}/);
    assert.equal(template.hour, '08:00');
    assert.deepEqual(template.targetLabels, [...DEFAULT_TARGETS]);
    assert.equal(template.imageKey, null);
    assert.deepEqual(template.quickHours, [...DEFAULT_QUICK_HOURS]);
    assert.equal(template.defaultHour, '08:00');
    assert.equal(template.overlay.locked, false);
  }
});

test('los tres accesos y la hora del widget se normalizan por separado de la hora vigente', () => {
  const template = createProfileTemplate('champions', {
    hour: '12:15',
    quickHours: ['06:30', '07:30', '13:45'],
    defaultHour: '13:45',
  });
  assert.equal(template.hour, '12:15');
  assert.deepEqual(template.quickHours, ['06:30', '07:30', '13:45']);
  assert.equal(template.defaultHour, '13:45');

  assert.deepEqual(normalizeQuickHours(['08:00', '09:00']), [...DEFAULT_QUICK_HOURS]);
  assert.deepEqual(normalizeQuickHours(['08:00', '9:00', '10:00']), [...DEFAULT_QUICK_HOURS]);
  assert.deepEqual(normalizeQuickHours(['08:00', '08:00', '10:00']), [...DEFAULT_QUICK_HOURS]);
  assert.equal(normalizeDefaultHour('99:99', template.quickHours), '06:30');
  assert.equal(normalizeDefaultHour('07:30', template.quickHours), '07:30');

  const valid = validateQuickHours(['06:30', '07:30', '13:45']);
  assert.equal(valid.ok, true);
  assert.equal(validateQuickHours(['06:30', '07:30', '06:30']).code, 'quick_hours_duplicate');
  assert.equal(validateQuickHours(['06:30', '07:30', '24:00']).code, 'quick_hours_invalid');

  const kept = resolveDefaultHourAfterQuickHoursEdit('07:30', ['06:30', '07:30', '14:00']);
  assert.equal(kept.ok, true);
  assert.equal(kept.defaultHour, '07:30');
  assert.equal(kept.defaultChanged, false);

  const replaced = resolveDefaultHourAfterQuickHoursEdit('07:30', ['06:30', '14:00', '15:00']);
  assert.equal(replaced.ok, true);
  assert.equal(replaced.defaultHour, '06:30');
  assert.equal(replaced.defaultChanged, true);
});

test('el bloqueo del overlay es opcional, persistente y no altera otras propiedades', () => {
  assert.equal(DEFAULT_OVERLAY.locked, false);
  assert.equal(normalizeOverlay({ locked: true }).locked, true);
  assert.equal(normalizeOverlay({ locked: 'true' }).locked, false);
  assert.equal(normalizeOverlay({ locked: 1 }).locked, false);

  const template = createProfileTemplate('espartanos', {
    overlay: { x: 0.2, y: 0.3, locked: true, font: 'serif' },
  });
  const clone = cloneTemplate(template);
  assert.equal(clone.overlay.locked, true);
  clone.overlay.locked = false;
  assert.equal(template.overlay.locked, true);
  assert.equal(clone.overlay.font, 'serif');
  assert.equal(clone.overlay.x, 0.2);
});

test('normaliza overlay y plantilla sin aceptar campos arbitrarios de imagen', () => {
  assert.deepEqual(normalizeOverlay(null), { ...DEFAULT_OVERLAY });
  const overlay = normalizeOverlay({
    x: -3,
    y: 9,
    size: 0.99,
    font: 'serif',
    color: '#ABC',
    showDate: true,
    date: '2026-10-22',
    twelveHour: true,
  });
  assert.equal(overlay.x, 0);
  assert.equal(overlay.y, 1);
  assert.equal(overlay.size, 0.18);
  assert.equal(overlay.font, 'serif');
  assert.equal(overlay.color, '#aabbcc');
  assert.equal(overlay.showDate, true);
  assert.equal(overlay.twelveHour, true);

  assert.equal(normalizeOverlay({ showDate: true, date: '' }).showDate, false);
  assert.equal(normalizeOverlay({ font: 'otra' }).font, 'bold');

  const template = normalizeTemplate({
    message: '  Hola {hora}  ',
    hour: '9:00',
    targetLabels: ['Telares'],
    imageKey: '../ruta/no',
    imageWidth: 5000,
    imageHeight: 900,
  }, 'champions');
  assert.equal(template.message, 'Hola {hora}');
  assert.equal(template.hour, '08:00');
  assert.deepEqual(template.targetLabels, ['Telares']);
  assert.equal(template.imageKey, null);
  assert.equal(template.imageWidth, null);
  assert.equal(template.imageHeight, 900);
});

test('el workspace admite un destino y el modo heredado exige dos', () => {
  const draft = {
    message: 'Hola {hora}',
    hour: '08:00',
    targetLabels: ['Telares'],
  };
  assert.equal(validateDraft(draft, { minTargets: 1 }).ok, true);
  assert.equal(validateDraft(draft).ok, false);
  assert.match(validateDraft(draft).errors.targets, /al menos 2/);

  assert.deepEqual(normalizeTargetLabels([' Telares ']), null);
  assert.deepEqual(normalizeTargetLabels([' Telares '], { min: 1 }), ['Telares']);
});

test('migra la plantilla anterior sólo a indestructibles sin tocar las demás', () => {
  const state = migrateLegacyWorkspace({
    message: 'Aviso antiguo {hora}',
    hour: '09:00',
    targetLabels: ['Telares', 'Extrusión'],
    overlay: { x: 0.2, y: 0.4 },
  }, { migratedAt: '2026-10-22T00:00:00.000Z' });
  assert.equal(state.activeProfileId, 'indestructibles');
  assert.equal(state.migratedAt, '2026-10-22T00:00:00.000Z');
  assert.equal(state.profiles.indestructibles.message, 'Aviso antiguo {hora}');
  assert.equal(state.profiles.indestructibles.hour, '09:00');
  assert.equal(state.profiles.champions.message, getProfileDefinition('champions').defaultMessage);
  assert.equal(state.profiles.espartanos.hour, '08:00');
});

test('normaliza estado guardado y actualiza sin mutar el original', () => {
  const state = createDefaultWorkspace();
  const normalized = normalizeWorkspaceState({
    ...state,
    activeProfileId: 'desconocido',
    profiles: {
      champions: {
        message: 'Hola',
        hour: '10:30',
        targetLabels: ['Telares'],
      },
    },
  });
  assert.ok(normalized);
  assert.equal(normalized.activeProfileId, 'indestructibles');
  assert.equal(normalized.profiles.champions.hour, '10:30');
  assert.equal(normalized.profiles.espartanos.hour, '08:00');
  assert.equal(normalizeWorkspaceState({ version: 2 }), null);
  assert.equal(normalizeWorkspaceState(null), null);

  const template = createProfileTemplate('espartanos', { hour: '11:00' });
  const clone = cloneTemplate(template);
  clone.targetLabels.push('Otro');
  assert.notEqual(template.targetLabels.length, clone.targetLabels.length);

  const updated = updateProfile(state, 'champions', { ...template, hour: '12:00' });
  assert.equal(updated.profiles.champions.hour, '12:00');
  assert.equal(state.profiles.champions.hour, '08:00');
});
