import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  DEFAULT_OVERLAY,
  DEFAULT_PROFILE_ID,
  createCustomTeam,
  createDefaultWorkspace,
  normalizeTemplate,
  normalizeWorkspaceState,
} from '../public/profiles.js';
import { WORKSPACE_KEYS } from '../public/storage.js';
import {
  STARTER_IDS,
  STARTER_IMAGE_KEYS,
  STARTER_TEMPLATES,
  loadStarterImageAsset,
  seedStarterImages,
  starterImageKeyFor,
} from '../public/starter-templates.js';

function makeStorage(options = {}) {
  const values = new Map();
  const puts = [];
  return {
    values,
    puts,
    async putText(key, value) {
      if (typeof options.fail === 'function' && options.fail(key, value)) {
        throw new Error(`fallo simulado en ${key}`);
      }
      puts.push({ key, value });
      values.set(key, value);
      return value.length;
    },
    async getText(key) {
      return values.has(key) ? values.get(key) : null;
    },
  };
}

function imageFor(template) {
  return {
    base64: `base64-${template.id}`,
    width: template.width,
    height: template.height,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('el catálogo aprobado es congelado, exacto y sólo contiene dos equipos', () => {
  assert.deepEqual([...STARTER_IDS], ['indestructibles', 'super-guerreros']);
  assert.equal(Object.isFrozen(STARTER_TEMPLATES), true);
  for (const template of STARTER_TEMPLATES) {
    assert.equal(Object.isFrozen(template), true);
    assert.equal(Object.isFrozen(template.overlay), true);
    assert.match(template.path, /^\.\/templates\/.+\.png$/);
    assert.equal(template.width, 1254);
    assert.equal(template.height, 1254);
    assert.equal(template.sha256.length, 64);
    assert.equal(starterImageKeyFor(template.id), STARTER_IMAGE_KEYS[template.id]);
  }
  assert.equal(starterImageKeyFor('champions'), null);
  assert.equal(starterImageKeyFor('espartanos'), null);
  assert.equal(
    STARTER_IMAGE_KEYS.indestructibles,
    'mn1.workspace.image.indestructibles.starterv1',
  );
});

test('siembra las dos fotos aprobadas y persiste el workspace real', async () => {
  const storage = makeStorage();
  const workspace = createDefaultWorkspace();
  const loaded = [];
  const result = await seedStarterImages({
    workspace,
    storage,
    loadImage: async (template) => {
      loaded.push(template.id);
      return imageFor(template);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(loaded, ['indestructibles', 'super-guerreros']);
  assert.deepEqual(result.seeded.map((item) => item.profileId), ['indestructibles', 'super-guerreros']);
  assert.equal(
    result.workspace.profiles.indestructibles.imageKey,
    'mn1.workspace.image.indestructibles.starterv1',
  );
  assert.equal(
    result.workspace.profiles['super-guerreros'].imageKey,
    'mn1.workspace.image.super-guerreros.starterv1',
  );
  assert.equal(result.workspace.profiles.indestructibles.starterImageInitialized, true);
  assert.equal(storage.values.get('mn1.workspace.image.indestructibles.starterv1'), 'base64-indestructibles');
  assert.equal(storage.values.get('mn1.workspace.image.super-guerreros.starterv1'), 'base64-super-guerreros');
  const persisted = JSON.parse(storage.values.get(WORKSPACE_KEYS.state));
  assert.deepEqual(persisted, clone(result.workspace));
  assert.equal(persisted.profiles.champions.imageKey, null);
  assert.equal(persisted.profiles.espartanos.imageKey, null);
});

test('una foto existente se conserva y no se descarga ni se sobrescribe', async () => {
  const storage = makeStorage();
  const workspace = createDefaultWorkspace();
  workspace.profiles.indestructibles.imageKey = 'mn1.workspace.image.indestructibles.keep01';
  workspace.profiles.indestructibles.imageWidth = 800;
  workspace.profiles.indestructibles.imageHeight = 600;
  workspace.profiles.indestructibles.starterImageInitialized = false;
  const loaded = [];

  const result = await seedStarterImages({
    workspace,
    storage,
    loadImage: async (template) => {
      loaded.push(template.id);
      return imageFor(template);
    },
  });

  assert.deepEqual(loaded, ['super-guerreros']);
  assert.equal(result.workspace.profiles.indestructibles.imageKey, 'mn1.workspace.image.indestructibles.keep01');
  assert.equal(result.workspace.profiles.indestructibles.imageWidth, 800);
  assert.equal(result.workspace.profiles.indestructibles.imageHeight, 600);
  assert.equal(result.workspace.profiles.indestructibles.starterImageInitialized, true);
  assert.equal(storage.values.has('mn1.workspace.image.indestructibles.starterv1'), false);
});

test('una plantilla ya inicializada nunca se restaura aunque no tenga foto', async () => {
  const storage = makeStorage();
  const workspace = createDefaultWorkspace();
  workspace.profiles.indestructibles.starterImageInitialized = true;
  workspace.profiles['super-guerreros'].starterImageInitialized = true;
  let calls = 0;

  const result = await seedStarterImages({
    workspace,
    storage,
    loadImage: async () => {
      calls += 1;
      throw new Error('no debe cargar');
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.changed, false);
  assert.equal(storage.puts.length, 0);
  assert.equal(result.workspace.profiles.indestructibles.imageKey, null);
  assert.equal(result.workspace.profiles['super-guerreros'].imageKey, null);
});

test('una descarga parcial sólo referencia la foto que se guardó de verdad', async () => {
  const storage = makeStorage();
  const workspace = createDefaultWorkspace();
  const result = await seedStarterImages({
    workspace,
    storage,
    loadImage: async (template) => {
      if (template.id === 'super-guerreros') throw new Error('sin red');
      return imageFor(template);
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, true);
  assert.equal(result.workspace.profiles.indestructibles.imageKey, 'mn1.workspace.image.indestructibles.starterv1');
  assert.equal(result.workspace.profiles['super-guerreros'].imageKey, null);
  assert.equal(result.workspace.profiles['super-guerreros'].starterImageInitialized, false);
  assert.equal(result.warnings[0].code, 'image_fetch_failed');
  assert.equal(result.warnings[0].retryable, true);
  const persisted = JSON.parse(storage.values.get(WORKSPACE_KEYS.state));
  assert.equal(persisted.profiles['super-guerreros'].imageKey, null);
});

test('si guardar la imagen falla no se devuelve ninguna referencia falsa', async () => {
  const storage = makeStorage({
    fail: (key) => key.startsWith(WORKSPACE_KEYS.imagePrefix),
  });
  const workspace = createDefaultWorkspace();
  const result = await seedStarterImages({
    workspace,
    storage,
    loadImage: async (template) => imageFor(template),
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(result.workspace.profiles.indestructibles.imageKey, null);
  assert.equal(result.workspace.profiles['super-guerreros'].imageKey, null);
  assert.equal(result.seeded.length, 0);
  assert.equal(storage.values.has(WORKSPACE_KEYS.state), false);
  assert.equal(result.warnings.every((item) => item.code === 'image_save_failed'), true);
});

test('si el snapshot final falla se conserva el estado anterior y la clave es reintentable', async () => {
  const storage = makeStorage();
  const workspace = createDefaultWorkspace();
  const before = clone(workspace);
  const result = await seedStarterImages({
    workspace,
    storage,
    loadImage: async (template) => imageFor(template),
    saveWorkspace: async () => {
      throw new Error('sin espacio');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.deepEqual(result.workspace, before);
  assert.equal(result.workspace.profiles.indestructibles.imageKey, null);
  assert.equal(result.workspace.profiles['super-guerreros'].imageKey, null);
  assert.equal(result.warnings.at(-1).code, 'workspace_save_failed');
  assert.equal(storage.values.has('mn1.workspace.image.indestructibles.starterv1'), true);
  assert.equal(storage.values.has(WORKSPACE_KEYS.state), false);
});

test('no siembra con estado sucio, ocupado, bloqueado o almacén no duradero', async () => {
  const cases = [
    { dirty: true },
    { busy: true },
    { listening: true },
    { storageBlocked: true },
    { corrupt: true },
    { persistent: false },
  ];
  for (const extra of cases) {
    const storage = makeStorage();
    let calls = 0;
    const result = await seedStarterImages({
      workspace: createDefaultWorkspace(),
      storage,
      loadImage: async () => {
        calls += 1;
        return { base64: 'x', width: 1254, height: 1254 };
      },
      ...extra,
    });
    assert.equal(calls, 0, JSON.stringify(extra));
    assert.equal(result.changed, false, JSON.stringify(extra));
    assert.equal(storage.puts.length, 0, JSON.stringify(extra));
  }
});

test('la migración marca las fotos antiguas como inicializadas sin alterar sus datos', () => {
  const legacy = {
    version: 1,
    activeProfileId: 'espartanos',
    profiles: {
      champions: {
        message: 'Champions antiguos {hora}',
        hour: '10:30',
        targetLabels: ['Telares'],
        imageKey: 'mn1.workspace.image.champions.old01',
        imageWidth: 1024,
        imageHeight: 768,
      },
      espartanos: {
        message: 'Espartanos antiguos {hora}',
        hour: '06:15',
        targetLabels: ['Extrusión'],
        quickHours: ['06:15', '07:15', '08:15'],
        defaultHour: '07:15',
        overlay: { x: 0.2, y: 0.3, locked: true },
      },
    },
  };
  const normalized = normalizeWorkspaceState(legacy);
  assert.ok(normalized);
  assert.equal(normalized.activeProfileId, 'espartanos');
  assert.equal(normalized.profiles.champions.imageKey, 'mn1.workspace.image.champions.old01');
  assert.equal(normalized.profiles.champions.starterImageInitialized, true);
  assert.equal(normalized.profiles.espartanos.message, 'Espartanos antiguos {hora}');
  assert.equal(normalized.profiles.espartanos.hour, '06:15');
  assert.deepEqual(normalized.profiles.espartanos.quickHours, ['06:15', '07:15', '08:15']);
  assert.equal(normalized.profiles.espartanos.defaultHour, '07:15');
  assert.equal(normalized.profiles.espartanos.overlay.x, 0.2);
  assert.equal(normalized.profiles.espartanos.overlay.locked, true);
  assert.equal(normalized.profiles.espartanos.starterImageInitialized, false);

  assert.equal(normalizeTemplate({}, 'champions').starterImageInitialized, false);
  assert.equal(
    normalizeTemplate({ imageKey: 'mn1.workspace.image.champions.old01' }, 'champions').starterImageInitialized,
    true,
  );
});

test('los equipos personalizados y sus datos independientes se conservan', async () => {
  const created = createCustomTeam(createDefaultWorkspace(), 'Los Búhos', {
    idFactory: () => '00000000-0000-4000-8000-000000000001',
  });
  assert.equal(created.ok, true);
  const workspace = created.state;
  workspace.profiles[created.profileId] = {
    ...workspace.profiles[created.profileId],
    message: 'Búhos a las {hora}',
    hour: '07:45',
    quickHours: ['06:30', '07:45', '09:15'],
    defaultHour: '09:15',
    targetLabels: ['Telares'],
    imageKey: 'mn1.workspace.image.custom.keep01',
    imageWidth: 800,
    imageHeight: 600,
  };
  const beforeCustom = clone(workspace.profiles[created.profileId]);
  const beforeCustomProfiles = clone(workspace.customProfiles);

  const result = await seedStarterImages({
    workspace,
    storage: makeStorage(),
    loadImage: async (template) => imageFor(template),
  });

  assert.deepEqual(result.workspace.profiles[created.profileId], beforeCustom);
  assert.deepEqual(result.workspace.customProfiles, beforeCustomProfiles);
  assert.equal(result.workspace.profiles.champions.imageKey, null);
  assert.equal(result.workspace.profiles.espartanos.imageKey, null);
  assert.equal(
    result.workspace.profiles['super-guerreros'].imageKey,
    'mn1.workspace.image.super-guerreros.starterv1',
  );
});

test('aplica el overlay aprobado sólo sobre una colocación prístina', async () => {
  const workspace = createDefaultWorkspace();
  workspace.profiles.indestructibles.overlay = {
    ...DEFAULT_OVERLAY,
    x: 0.2,
    locked: true,
  };
  const result = await seedStarterImages({
    workspace,
    storage: makeStorage(),
    loadImage: async (template) => imageFor(template),
  });

  assert.equal(result.workspace.profiles.indestructibles.overlay.x, 0.2);
  assert.equal(result.workspace.profiles.indestructibles.overlay.locked, true);
  assert.equal(result.workspace.profiles['super-guerreros'].overlay.x, 0.5);
  assert.equal(result.workspace.profiles['super-guerreros'].overlay.y, 0.925);
  assert.equal(result.workspace.profiles['super-guerreros'].overlay.size, 0.055);
  assert.equal(result.workspace.profiles['super-guerreros'].overlay.locked, false);

  const pristine = await seedStarterImages({
    workspace: createDefaultWorkspace(),
    storage: makeStorage(),
    loadImage: async (template) => imageFor(template),
  });
  assert.equal(pristine.workspace.profiles.indestructibles.overlay.x, 0.5);
  assert.equal(pristine.workspace.profiles.indestructibles.overlay.y, 0.78);
  assert.equal(pristine.workspace.profiles.indestructibles.overlay.size, 0.075);
});

test('el cargador valida tamaño, firma, IHDR y SHA-256 del mismo origen', {
  skip: typeof globalThis.crypto?.subtle?.digest !== 'function',
}, async () => {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 4);
  view.setUint32(20, 3);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const template = {
    id: 'indestructibles',
    path: './templates/fake.png',
    sha256,
    size: bytes.byteLength,
    width: 4,
    height: 3,
  };
  const loaded = await loadStarterImageAsset(template, {
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => bytes.buffer }),
  });
  assert.equal(loaded.width, 4);
  assert.equal(loaded.height, 3);
  assert.equal(loaded.base64, Buffer.from(bytes).toString('base64'));

  await assert.rejects(
    loadStarterImageAsset({ ...template, size: template.size + 1 }, {
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => bytes.buffer }),
    }),
    (error) => error.code === 'size_mismatch',
  );
  await assert.rejects(
    loadStarterImageAsset({ ...template, sha256: '0'.repeat(64) }, {
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => bytes.buffer }),
    }),
    (error) => error.code === 'hash_mismatch',
  );
  await assert.rejects(
    loadStarterImageAsset(template, {
      fetchImpl: async () => ({ ok: false, status: 404 }),
    }),
    (error) => error.code === 'http_error',
  );
});
