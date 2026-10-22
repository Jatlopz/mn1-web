import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CARD_APPEARANCE,
  cardCoverCssVars,
  cloneTemplate,
  createCardCoverDraft,
  createCustomTeam,
  createDefaultWorkspace,
  createProfileTemplate,
  migrateLegacyWorkspace,
  normalizeCardAppearance,
  normalizeWorkspaceState,
  resolveCardCoverSource,
  resolveCoverSave,
  thumbnailDimensions,
  updateProfile,
} from '../public/profiles.js';
import {
  CardThumbnailCache,
} from '../public/app.js';
import {
  coverKeyForProfile,
  imageKeyForProfile,
} from '../public/storage.js';

const ANNOUNCEMENT_KEY = 'mn1.workspace.image.champions.keep01';
const COVER_KEY = coverKeyForProfile('champions', 'cover01');

test('normaliza la apariencia estricta y degrada custom sin clave a none', () => {
  assert.deepEqual(normalizeCardAppearance(null), { ...DEFAULT_CARD_APPEARANCE });
  assert.deepEqual(normalizeCardAppearance('texto'), { ...DEFAULT_CARD_APPEARANCE });

  assert.deepEqual(normalizeCardAppearance({
    mode: 'custom',
    imageKey: COVER_KEY,
    blur: 12,
    shade: 0.8,
  }), {
    mode: 'custom',
    imageKey: COVER_KEY,
    blur: 12,
    shade: 0.8,
  });

  assert.deepEqual(normalizeCardAppearance({
    mode: 'custom',
    imageKey: ANNOUNCEMENT_KEY,
  }), {
    mode: 'none',
    imageKey: null,
    blur: 0,
    shade: 0.35,
  });

  const normalized = normalizeCardAppearance({
    mode: 'otro',
    imageKey: COVER_KEY,
    blur: 7,
    shade: 9,
  });
  assert.equal(normalized.mode, 'announcement');
  assert.equal(normalized.imageKey, null);
  assert.equal(normalized.blur, 0);
  assert.equal(normalized.shade, 0.8);

  const low = normalizeCardAppearance({ mode: 'none', blur: 0, shade: -1 });
  assert.equal(low.mode, 'none');
  assert.equal(low.blur, 0);
  assert.equal(low.shade, 0.35);
});

test('resuelve la clave de la tarjeta y publica las variables CSS', () => {
  assert.equal(
    resolveCardCoverSource({ imageKey: ANNOUNCEMENT_KEY }),
    ANNOUNCEMENT_KEY,
  );
  assert.equal(resolveCardCoverSource({ imageKey: ANNOUNCEMENT_KEY, cardAppearance: {
    mode: 'none',
  } }), null);
  assert.equal(resolveCardCoverSource({ imageKey: ANNOUNCEMENT_KEY, cardAppearance: {
    mode: 'custom',
    imageKey: COVER_KEY,
  } }), COVER_KEY);
  assert.equal(resolveCardCoverSource({ imageKey: null }), null);

  assert.deepEqual(cardCoverCssVars({
    mode: 'custom',
    imageKey: COVER_KEY,
    blur: 12,
    shade: 0.65,
  }), {
    '--cover-blur': '12px',
    '--cover-shade': '0.65',
  });
});

test('guardar la portada de un equipo conserva anuncio, mensaje, hora y demás equipos', () => {
  const state = createDefaultWorkspace();
  state.profiles.champions.message = 'Champions a las {hora}';
  state.profiles.champions.hour = '10:30';
  state.profiles.champions.imageKey = ANNOUNCEMENT_KEY;
  const beforeEspartanos = JSON.stringify(state.profiles.espartanos);
  const beforeChampionsImage = state.profiles.champions.imageKey;

  for (const template of Object.values(state.profiles)) {
    assert.deepEqual(template.cardAppearance, { ...DEFAULT_CARD_APPEARANCE });
  }

  const appearance = {
    mode: 'custom',
    imageKey: COVER_KEY,
    blur: 12,
    shade: 0.7,
  };
  const updated = updateProfile(state, 'champions', {
    ...state.profiles.champions,
    cardAppearance: appearance,
  });
  assert.ok(updated);
  assert.deepEqual(updated.profiles.champions.cardAppearance, appearance);
  assert.equal(updated.profiles.champions.message, 'Champions a las {hora}');
  assert.equal(updated.profiles.champions.hour, '10:30');
  assert.equal(updated.profiles.champions.imageKey, beforeChampionsImage);
  assert.equal(JSON.stringify(updated.profiles.espartanos), beforeEspartanos);
  assert.equal(JSON.stringify(state.profiles.champions.cardAppearance),
    JSON.stringify(DEFAULT_CARD_APPEARANCE));

  const cloned = cloneTemplate(updated.profiles.champions);
  cloned.cardAppearance.shade = 0.35;
  assert.equal(updated.profiles.champions.cardAppearance.shade, 0.7);

  const reloaded = normalizeWorkspaceState(JSON.parse(JSON.stringify(updated)));
  assert.ok(reloaded);
  assert.deepEqual(reloaded.profiles.champions.cardAppearance, appearance);
  assert.equal(reloaded.profiles.champions.imageKey, beforeChampionsImage);
  assert.deepEqual(
    reloaded.profiles.espartanos.cardAppearance,
    { ...DEFAULT_CARD_APPEARANCE },
  );
});

test('crear equipos, migrar y crear plantillas persiste la apariencia por defecto', () => {
  const uuid = '12345678-1234-4123-8123-123456789abc';
  const created = createCustomTeam(createDefaultWorkspace(), 'Los Búhos', {
    idFactory: () => uuid,
    createdAt: '2026-10-22T00:00:00.000Z',
  });
  assert.equal(created.ok, true);
  assert.deepEqual(created.template.cardAppearance, { ...DEFAULT_CARD_APPEARANCE });

  const migrated = migrateLegacyWorkspace({ message: 'Aviso {hora}' });
  assert.deepEqual(
    migrated.profiles.indestructibles.cardAppearance,
    { ...DEFAULT_CARD_APPEARANCE },
  );

  const explicit = createProfileTemplate('champions', {
    cardAppearance: { mode: 'none', blur: 0, shade: 0.4 },
  });
  assert.deepEqual(explicit.cardAppearance, {
    mode: 'none',
    imageKey: null,
    blur: 0,
    shade: 0.4,
  });
});

test('el borrador de portada aísla Guardar y Cancelar sin tocar lo guardado', () => {
  const saved = {
    mode: 'announcement',
    imageKey: null,
    blur: 0,
    shade: 0.35,
  };
  const draft = createCardCoverDraft(saved);
  draft.mode = 'custom';
  draft.imageKey = COVER_KEY;
  draft.blur = 12;
  draft.shade = 0.75;

  assert.deepEqual(saved, {
    mode: 'announcement',
    imageKey: null,
    blur: 0,
    shade: 0.35,
  });

  const savedResult = resolveCoverSave(draft);
  assert.equal(savedResult.ok, true);
  assert.deepEqual(savedResult.appearance, {
    mode: 'custom',
    imageKey: COVER_KEY,
    blur: 12,
    shade: 0.75,
  });

  const cancelled = createCardCoverDraft(saved);
  assert.deepEqual(cancelled, {
    mode: 'announcement',
    imageKey: null,
    customImageKey: null,
    blur: 0,
    shade: 0.35,
    pendingImage: null,
    newKey: null,
  });

  const missing = createCardCoverDraft(saved);
  missing.mode = 'custom';
  const rejected = resolveCoverSave(missing);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'missing_cover_image');
});

test('la miniatura se limita a 384 px, se cachea y no comparte cargas entre equipos', async () => {
  const thumbA = 'iVBORw0KGgoA';
  const thumbB = 'iVBORw0KGgoB';
  const calls = [];
  const drawCalls = [];
  const storage = {
    async getText(key) {
      calls.push(key);
      if (key === 'A') return thumbA;
      if (key === 'B') return thumbB;
      return null;
    },
  };
  const loadImage = async (dataUrl) => (dataUrl.endsWith('A')
    ? { naturalWidth: 1000, naturalHeight: 500 }
    : { naturalWidth: 500, naturalHeight: 1000 });
  const createCanvas = () => ({
    width: 0,
    height: 0,
    getContext() {
      return {
        clearRect() {},
        drawImage() {
          drawCalls.push('drawImage');
        },
      };
    },
    toDataURL() {
      return `data:image/png;base64,thumb-${this.width}x${this.height}`;
    },
  });

  assert.deepEqual(thumbnailDimensions(1000, 500), {
    width: 384,
    height: 192,
    scale: 0.384,
  });
  assert.deepEqual(thumbnailDimensions(100, 80), {
    width: 100,
    height: 80,
    scale: 1,
  });

  const cache = new CardThumbnailCache({
    storage,
    loadImage,
    createCanvas,
    maxEntries: 2,
  });
  const first = cache.load('A');
  const second = cache.load('A');
  assert.equal(calls.length, 1);
  assert.equal(await first, 'data:image/png;base64,thumb-384x192');
  assert.equal(await second, 'data:image/png;base64,thumb-384x192');
  assert.equal(calls.length, 1);
  assert.deepEqual(drawCalls, ['drawImage']);

  const [teamA, teamB] = await Promise.all([
    cache.loadProfile('equipo-a', 'B'),
    cache.loadProfile('equipo-b', 'A'),
  ]);
  assert.equal(teamA, 'data:image/png;base64,thumb-192x384');
  assert.equal(teamB, 'data:image/png;base64,thumb-384x192');
  assert.notEqual(teamA, teamB);

  cache.trackProfile('equipo-a', 'B');
  cache.trackProfile('equipo-a', 'A');
  assert.equal(cache.get('B'), null);
  assert.notEqual(cache.get('A'), null);
});

test('la caché está acotada y una clave cambiada invalida la miniatura anterior', async () => {
  const storage = {
    async getText(key) {
      return key === 'A' ? 'iVBORw0KGgoA' : 'iVBORw0KGgoB';
    },
  };
  const loadImage = async () => ({ naturalWidth: 320, naturalHeight: 200 });
  const createCanvas = () => ({
    width: 0,
    height: 0,
    getContext() {
      return { clearRect() {}, drawImage() {} };
    },
    toDataURL() {
      return 'data:image/png;base64,thumb';
    },
  });
  const cache = new CardThumbnailCache({
    storage,
    loadImage,
    createCanvas,
    maxEntries: 2,
  });
  await cache.load('A');
  await cache.load('B');
  assert.notEqual(cache.get('A'), null);
  await cache.load('C');
  assert.equal(cache.get('B'), null);
  assert.notEqual(cache.get('A'), null);
  assert.notEqual(cache.get('C'), null);

  cache.trackProfile('equipo', 'A');
  cache.trackProfile('equipo', 'C');
  assert.equal(cache.get('A'), null);
  assert.notEqual(cache.get('C'), null);
});

test('las claves de portada de un UUID real son válidas y distintas', () => {
  const first = `custom-${'12345678-1234-4123-8123-123456789abc'}`;
  const second = `custom-${'12345678-1234-4123-8123-123456789abd'}`;
  const firstCover = coverKeyForProfile(first, 'abc123');
  const secondCover = coverKeyForProfile(second, 'abc123');
  assert.notEqual(firstCover, secondCover);
  assert.ok(firstCover.length <= 64);
  assert.ok(secondCover.length <= 64);
  assert.notEqual(imageKeyForProfile(first, 'abc123'), imageKeyForProfile(second, 'abc123'));
});
