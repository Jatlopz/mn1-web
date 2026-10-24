import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CUSTOM_PROFILE_ID_PATTERN,
  DEFAULT_PROFILE_ID,
  DEFAULT_TARGETS,
  MAX_CUSTOM_TEAMS,
  MAX_TOTAL_TEAMS,
  PROFILE_IDS,
  cloneWorkspace,
  createCustomTeam,
  createDefaultWorkspace,
  getProfileDefinition,
  isProfileId,
  normalizeWorkspaceState,
  profileCatalogForWorkspace,
  updateProfile,
  validateCustomTeamName,
} from '../public/profiles.js';
import {
  workspaceDocumentTitle,
  workspaceRouteFor,
} from '../public/app.js';

const IMAGE_KEY_CHAMPIONS = 'mn1.workspace.image.champions.keep01';
const IMAGE_KEY_CUSTOM = 'mn1.workspace.image.custom.keep02';

function uuidFor(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function customIdFor(index) {
  return `custom-${uuidFor(index)}`;
}

function addTeam(state, name, index) {
  return createCustomTeam(state, name, {
    idFactory: () => uuidFor(index),
    createdAt: '2026-10-22T00:00:00.000Z',
  });
}

function stateWithSavedDetails() {
  const state = createDefaultWorkspace();
  state.profiles.champions = {
    ...state.profiles.champions,
    message: 'Champions entrenan a las {hora}',
    hour: '10:15',
    targetLabels: ['Telares'],
    imageKey: IMAGE_KEY_CHAMPIONS,
    imageWidth: 1920,
    imageHeight: 1080,
  };
  return state;
}

test('crea un equipo personalizado con id seguro, plantilla propia y sin foto', () => {
  const base = stateWithSavedDetails();
  const result = addTeam(base, '  Los   Búhos  ', 1);

  assert.equal(result.ok, true);
  assert.equal(result.profileId, customIdFor(1));
  assert.match(result.profileId, CUSTOM_PROFILE_ID_PATTERN);
  assert.equal(result.definition.name, 'Los Búhos');
  assert.match(result.definition.defaultMessage, /Los Búhos/);
  assert.equal(result.state.version, 1);
  assert.equal(result.state.activeProfileId, result.profileId);
  assert.equal(result.state.customProfiles.length, 1);
  assert.deepEqual(
    Object.keys(result.state.profiles).sort(),
    [...PROFILE_IDS, result.profileId].sort(),
  );
  assert.equal(result.template.hour, '08:00');
  assert.deepEqual(result.template.quickHours, ['08:00', '09:00', '10:00']);
  assert.equal(result.template.defaultHour, '08:00');
  assert.deepEqual(result.template.targetLabels, [...DEFAULT_TARGETS]);
  assert.equal(result.template.imageKey, null);
  assert.match(result.template.message, /Los Búhos/);

  // Los cuatro equipos existentes, sus horas y su foto se conservan.
  assert.equal(result.state.profiles.champions.hour, '10:15');
  assert.equal(result.state.profiles.champions.imageKey, IMAGE_KEY_CHAMPIONS);
  assert.equal(result.state.profiles.espartanos.hour, '08:00');
});

test('recarga el estado guardado con definición y plantilla del equipo propio', () => {
  const created = addTeam(stateWithSavedDetails(), 'Los Búhos', 1);
  created.state.profiles[created.profileId] = {
    ...created.state.profiles[created.profileId],
    hour: '07:45',
    quickHours: ['06:30', '07:45', '09:15'],
    defaultHour: '09:15',
    message: 'Búhos a las {hora}',
    targetLabels: ['Telares', 'Extrusión'],
    imageKey: IMAGE_KEY_CUSTOM,
    imageWidth: 800,
    imageHeight: 600,
  };

  const reloaded = normalizeWorkspaceState(JSON.parse(JSON.stringify(created.state)));
  assert.ok(reloaded);
  assert.equal(reloaded.version, 1);
  assert.equal(reloaded.activeProfileId, created.profileId);
  assert.equal(reloaded.customProfiles.length, 1);
  assert.equal(reloaded.customProfiles[0].id, created.profileId);
  assert.equal(reloaded.customProfiles[0].name, 'Los Búhos');
  assert.equal(reloaded.profiles[created.profileId].hour, '07:45');
  assert.deepEqual(reloaded.profiles[created.profileId].quickHours, ['06:30', '07:45', '09:15']);
  assert.equal(reloaded.profiles[created.profileId].defaultHour, '09:15');
  assert.equal(reloaded.profiles[created.profileId].message, 'Búhos a las {hora}');
  assert.equal(reloaded.profiles[created.profileId].imageKey, IMAGE_KEY_CUSTOM);
  assert.equal(reloaded.profiles.champions.imageKey, IMAGE_KEY_CHAMPIONS);
  assert.equal(reloaded.profiles.champions.hour, '10:15');

  assert.equal(isProfileId(created.profileId, { customProfiles: reloaded.customProfiles }), true);
  assert.equal(
    getProfileDefinition(created.profileId, { customProfiles: reloaded.customProfiles }).name,
    'Los Búhos',
  );
});

test('editar un equipo propio no altera los demás equipos ni sus plantillas', () => {
  const first = addTeam(stateWithSavedDetails(), 'Los Búhos', 1);
  const second = addTeam(first.state, 'Las Águilas', 2);
  const beforeSecond = JSON.stringify(second.state.profiles[second.profileId]);
  const beforeChampions = JSON.stringify(second.state.profiles.champions);

  const edited = updateProfile(second.state, first.profileId, {
    ...second.state.profiles[first.profileId],
    hour: '11:30',
    message: 'Sólo búhos a las {hora}',
    targetLabels: ['Telares'],
  });
  assert.ok(edited);
  assert.equal(edited.profiles[first.profileId].hour, '11:30');
  assert.equal(edited.profiles[first.profileId].message, 'Sólo búhos a las {hora}');
  assert.equal(JSON.stringify(edited.profiles[second.profileId]), beforeSecond);
  assert.equal(JSON.stringify(edited.profiles.champions), beforeChampions);
  assert.equal(second.state.profiles[first.profileId].hour, '08:00');

  const reloaded = normalizeWorkspaceState(JSON.parse(JSON.stringify(edited)));
  assert.ok(reloaded);
  assert.equal(reloaded.profiles[first.profileId].hour, '11:30');
  assert.equal(reloaded.profiles[second.profileId].hour, '08:00');
  assert.equal(reloaded.customProfiles.length, 2);
});

test('rechaza nombres vacíos, con control, largos y duplicados sin distinguir caso ni acentos', () => {
  const state = addTeam(createDefaultWorkspace(), 'Los Búhos', 1).state;

  assert.equal(validateCustomTeamName(state, '   ').code, 'blank_name');
  assert.equal(validateCustomTeamName(state, 'Búhos\nnuevos').code, 'control_characters');
  assert.equal(validateCustomTeamName(state, `Búhos ${String.fromCharCode(0)}`).code, 'control_characters');
  assert.equal(validateCustomTeamName(state, 'x'.repeat(61)).code, 'name_too_long');

  for (const duplicate of ['los buhos', 'LOS BÚHOS', '  Los   Buhos  ', 'los champions']) {
    assert.equal(validateCustomTeamName(state, duplicate).code, 'duplicate_name', duplicate);
  }
  assert.equal(validateCustomTeamName(state, 'Los Búhos Nuevos').ok, true);
});

test('limita el total a 24 equipos y no permite crear el vigésimo quinto', () => {
  let state = createDefaultWorkspace();
  for (let index = 1; index <= MAX_CUSTOM_TEAMS; index += 1) {
    const result = addTeam(state, `Equipo ${index}`, index);
    assert.equal(result.ok, true, `equipo ${index}`);
    state = result.state;
  }
  assert.equal(Object.keys(state.profiles).length, MAX_TOTAL_TEAMS);

  const extra = addTeam(state, 'Equipo extra', MAX_CUSTOM_TEAMS + 1);
  assert.equal(extra.ok, false);
  assert.equal(extra.code, 'max_teams');
});

test('normaliza estado hostil: ids inseguros, claves de prototipo, duplicados y exceso de equipos', () => {
  const safeId = customIdFor(900);
  const validDefinitions = Array.from({ length: 40 }, (_, index) => ({
    id: customIdFor(index + 1),
    name: `Equipo válido ${index + 1}`,
  }));
  const raw = {
    version: 1,
    activeProfileId: 'custom-invalido',
    profiles: {
      champions: {
        message: 'Champions {hora}',
        hour: '09:30',
        targetLabels: ['Telares'],
        imageKey: IMAGE_KEY_CHAMPIONS,
        imageWidth: 100,
        imageHeight: 200,
      },
    },
    customProfiles: [
      { id: '__proto__', name: 'Proto' },
      { id: 'constructor', name: 'Constructor' },
      { id: 'custom-no-es-uuid', name: 'Inseguro' },
      { id: safeId, name: '  Equipo   Seguro  ', createdAt: '2026-10-22T01:00:00.000Z' },
      { id: safeId, name: 'Duplicado por id' },
      { id: customIdFor(901), name: 'los champions' },
      { id: customIdFor(902), name: 'Con\nControl' },
      ...validDefinitions,
    ],
    migratedAt: '2026-10-22T00:00:00.000Z',
  };

  const normalized = normalizeWorkspaceState(raw);
  assert.ok(normalized);
  assert.equal(normalized.activeProfileId, DEFAULT_PROFILE_ID);
  assert.equal(normalized.customProfiles.length, MAX_CUSTOM_TEAMS);
  assert.equal(Object.keys(normalized.profiles).length, MAX_TOTAL_TEAMS);
  assert.equal(normalized.profiles.champions.hour, '09:30');
  assert.equal(normalized.profiles.champions.imageKey, IMAGE_KEY_CHAMPIONS);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.profiles, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.profiles, 'constructor'), false);
  assert.equal(normalized.customProfiles[0].id, safeId);
  assert.equal(normalized.customProfiles[0].name, 'Equipo Seguro');
  assert.equal(Object.prototype.polluted, undefined);
});

test('un workspace antiguo sin customProfiles conserva equipos, fotos, horas y mensajes', () => {
  const legacyState = {
    version: 1,
    activeProfileId: 'espartanos',
    profiles: {
      champions: {
        message: 'Aviso antiguo {hora}',
        hour: '10:00',
        targetLabels: ['Telares'],
        imageKey: IMAGE_KEY_CHAMPIONS,
        imageWidth: 1024,
        imageHeight: 768,
      },
      espartanos: {
        message: 'Espartanos {hora}',
        hour: '06:15',
        targetLabels: ['Extrusión'],
        imageKey: 'mn1.workspace.image.espartanos.old01',
        imageWidth: 500,
        imageHeight: 400,
      },
    },
    migratedAt: '2026-10-20T12:00:00.000Z',
  };

  const normalized = normalizeWorkspaceState(legacyState);
  assert.ok(normalized);
  assert.deepEqual(normalized.customProfiles, []);
  assert.equal(normalized.activeProfileId, 'espartanos');
  assert.equal(normalized.profiles.champions.message, 'Aviso antiguo {hora}');
  assert.equal(normalized.profiles.champions.hour, '10:00');
  assert.equal(normalized.profiles.champions.imageKey, IMAGE_KEY_CHAMPIONS);
  assert.equal(normalized.profiles.champions.imageWidth, 1024);
  assert.equal(normalized.profiles.espartanos.hour, '06:15');
  assert.equal(normalized.profiles.espartanos.imageKey, 'mn1.workspace.image.espartanos.old01');
  assert.equal(normalized.profiles.indestructibles.hour, '08:00');
  assert.equal(normalized.migratedAt, '2026-10-20T12:00:00.000Z');
});

test('clonar y resolver catálogo/ruta/título incluye los equipos personalizados', () => {
  const created = addTeam(createDefaultWorkspace(), 'Los Búhos', 1);
  const clone = cloneWorkspace(created.state);
  assert.equal(clone.customProfiles.length, 1);
  assert.notEqual(clone.customProfiles[0], created.state.customProfiles[0]);
  assert.equal(clone.profiles[created.profileId].hour, '08:00');
  assert.notEqual(
    clone.profiles[created.profileId].targetLabels,
    created.state.profiles[created.profileId].targetLabels,
  );

  const catalog = profileCatalogForWorkspace(created.state);
  assert.equal(catalog.length, PROFILE_IDS.length + 1);
  assert.equal(isProfileId(created.profileId, { catalog }), true);
  assert.equal(workspaceRouteFor(created.profileId, { catalog }), `#equipo/${created.profileId}`);
  assert.equal(workspaceDocumentTitle(created.profileId, { catalog }), 'SuperTools · Los Búhos');
  assert.equal(workspaceRouteFor('custom-desconocido', { catalog }), '#equipos');
});

test('la pantalla de equipos tiene botón verde y diálogo accesible con máximo de 60', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button[^>]*class="[^"]*button-primary[^"]*"[^>]*id="add-team"[^>]*>\s*\+ Agregar equipo/);
  assert.match(html, /<dialog[^>]*id="add-team-dialog"[^>]*aria-labelledby="add-team-title"[^>]*aria-describedby="add-team-help add-team-error"/);
  assert.match(html, /id="add-team-input"[^>]*maxlength="60"/);
  assert.match(html, /id="add-team-error"[^>]*role="alert"/);
  assert.match(html, /id="add-team-cancel"[^>]*>Cancelar</);
  assert.match(html, /id="add-team-create"[^>]*>Crear equipo</);
});
