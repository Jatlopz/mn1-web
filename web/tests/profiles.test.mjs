import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_OVERLAY,
  DEFAULT_PROFILE_ID,
  DEFAULT_TARGETS,
  PROFILE_CATALOG,
  PROFILE_IDS,
  cloneTemplate,
  createDefaultWorkspace,
  createProfileTemplate,
  getProfileDefinition,
  isProfileId,
  migrateLegacyWorkspace,
  normalizeOverlay,
  normalizeTargetLabels,
  normalizeTemplate,
  normalizeWorkspaceState,
  updateProfile,
  validateDraft,
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
  }
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
