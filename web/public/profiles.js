/*
 * MN1 · catálogo, plantillas y estado del workspace web.
 *
 * Este módulo es puro: no toca DOM, IndexedDB ni el puente. El catálogo de cuatro
 * equipos vive aquí (no en Kotlin) y cada plantilla conserva mensaje, hora, destinos,
 * imagen original, overlay y referencia a su copia privada.
 */

import {
  MN1_LIMITS,
  isValidHour,
  isValidVaultKey,
  textLength,
} from './bridge.js';
import { WORKSPACE_KEYS } from './storage.js';

export const DEFAULT_HOUR = '08:00';
export const DEFAULT_QUICK_HOURS = Object.freeze(['08:00', '09:00', '10:00']);
// Se conserva el export histórico de los accesos 08/09; los accesos editables de
// cada equipo viven en `quickHours` con tres horas iniciales.
export const HOUR_PRESETS = Object.freeze(['08:00', '09:00']);
export const DEFAULT_TARGETS = Object.freeze(['Telares', 'Extrusión']);
export const DEFAULT_PROFILE_ID = 'indestructibles';

export const PROFILE_CATALOG = Object.freeze([
  Object.freeze({
    id: 'champions',
    name: 'Los Champions',
    shortName: 'Champions',
    color: '#f5c542',
    defaultMessage:
      'Batiseñal MN1 {hora}. Convocatoria del equipo Los Champions de Sacos. ' +
      'Destinos: Telares y Extrusión.',
  }),
  Object.freeze({
    id: 'espartanos',
    name: 'Los Espartanos',
    shortName: 'Espartanos',
    color: '#e35d4f',
    defaultMessage:
      'Batiseñal MN1 {hora}. Convocatoria del equipo Los Espartanos de Sacos. ' +
      'Destinos: Telares y Extrusión.',
  }),
  Object.freeze({
    id: 'super-guerreros',
    name: 'Los Super Guerreros',
    shortName: 'Super Guerreros',
    color: '#35e3c8',
    defaultMessage:
      'Batiseñal MN1 {hora}. Convocatoria del equipo Los Super Guerreros de Sacos. ' +
      'Destinos: Telares y Extrusión.',
  }),
  Object.freeze({
    id: 'indestructibles',
    name: 'Los Indestructibles',
    shortName: 'Indestructibles',
    color: '#c8f751',
    defaultMessage:
      'Batiseñal MN1 {hora}. Convocatoria del equipo Los Indestructibles de Sacos. ' +
      'Destinos: Telares y Extrusión.',
  }),
]);

export const PROFILE_IDS = Object.freeze(PROFILE_CATALOG.map((profile) => profile.id));

export const MAX_TOTAL_TEAMS = 24;
export const MAX_CUSTOM_TEAMS = MAX_TOTAL_TEAMS - PROFILE_CATALOG.length;
export const TEAM_NAME_MAX_LENGTH = 60;
export const CUSTOM_PROFILE_ID_PATTERN =
  /^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CUSTOM_PROFILE_COLORS = Object.freeze([
  '#c8f751',
  '#35e3c8',
  '#f5c542',
  '#ff6b6b',
  '#9ad4ff',
  '#d6a8ff',
]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

export const OVERLAY_LIMITS = Object.freeze({
  MIN_SIZE: 0.025,
  MAX_SIZE: 0.18,
  DEFAULT_SIZE: 0.075,
  DATE_MAX_LENGTH: 30,
});

export const OVERLAY_FONTS = Object.freeze(['bold', 'sans', 'serif', 'mono']);

export const DEFAULT_OVERLAY = Object.freeze({
  x: 0.5,
  y: 0.78,
  size: OVERLAY_LIMITS.DEFAULT_SIZE,
  font: 'bold',
  color: '#ffffff',
  showDate: false,
  date: '',
  twelveHour: false,
  locked: false,
});

export const CARD_COVER_MODES = Object.freeze(['announcement', 'custom', 'none']);
export const CARD_COVER_BLURS = Object.freeze([0, 6, 12]);
export const CARD_COVER_SHADE_MIN = 0.35;
export const CARD_COVER_SHADE_MAX = 0.8;
export const CARD_COVER_SHADE_DEFAULT = 0.55;
export const CARD_COVER_BLUR_DEFAULT = 6;
export const CARD_COVER_THUMBNAIL_MAX_SIDE = 384;
export const CARD_COVER_CACHE_LIMIT = 24;

export const DEFAULT_CARD_APPEARANCE = Object.freeze({
  mode: 'announcement',
  imageKey: null,
  blur: CARD_COVER_BLUR_DEFAULT,
  shade: CARD_COVER_SHADE_DEFAULT,
});

export function isCardCoverKey(value) {
  return typeof value === 'string'
    && value.startsWith(WORKSPACE_KEYS.coverPrefix)
    && isValidVaultKey(value);
}

function normalizeCoverBlur(value) {
  if (typeof value === 'number' && CARD_COVER_BLURS.includes(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (CARD_COVER_BLURS.includes(parsed)) return parsed;
  }
  return CARD_COVER_BLUR_DEFAULT;
}

function normalizeCoverShade(value) {
  if (value === null || value === '' || typeof value === 'boolean') {
    return CARD_COVER_SHADE_DEFAULT;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return CARD_COVER_SHADE_DEFAULT;
  const clamped = Math.min(CARD_COVER_SHADE_MAX, Math.max(CARD_COVER_SHADE_MIN, number));
  return Math.round(clamped * 100) / 100;
}

/**
 * Apariencia estricta de la tarjeta. Un modo desconocido vuelve a "announcement",
 * el desenfoque sólo admite 0/6/12 y la sombra se limita a 0.35–0.8. "custom"
 * sin una clave de portada válida se degrada a "none" para no inventar ni
 * reutilizar la foto del anuncio.
 */
export function normalizeCardAppearance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_CARD_APPEARANCE };
  }
  const mode = CARD_COVER_MODES.includes(value.mode)
    ? value.mode
    : DEFAULT_CARD_APPEARANCE.mode;
  const blur = normalizeCoverBlur(value.blur);
  const shade = normalizeCoverShade(value.shade);
  if (mode === 'custom') {
    return isCardCoverKey(value.imageKey)
      ? { mode, imageKey: value.imageKey, blur, shade }
      : { mode: 'none', imageKey: null, blur, shade };
  }
  return { mode, imageKey: null, blur, shade };
}

export function cardCoverCssVars(appearance) {
  const normalized = normalizeCardAppearance(appearance);
  return {
    '--cover-blur': `${normalized.blur}px`,
    '--cover-shade': String(normalized.shade),
  };
}

export function resolveCardCoverSource(template) {
  if (!template || typeof template !== 'object') return null;
  const appearance = normalizeCardAppearance(template.cardAppearance);
  if (appearance.mode === 'custom') return appearance.imageKey;
  if (appearance.mode === 'none') return null;
  return isValidVaultKey(template.imageKey) ? template.imageKey : null;
}

/** Borrador aislado del diálogo; conserva la última portada propia elegida. */
export function createCardCoverDraft(appearance) {
  const normalized = normalizeCardAppearance(appearance);
  return {
    mode: normalized.mode,
    imageKey: normalized.imageKey,
    customImageKey: normalized.imageKey,
    blur: normalized.blur,
    shade: normalized.shade,
    pendingImage: null,
    newKey: null,
  };
}

/**
 * Seam puro de Guardar. No escribe ni muta el borrador; devuelve la apariencia
 * normalizada o un error que la UI muestra conservando el diálogo abierto.
 */
export function resolveCoverSave(draft, options = {}) {
  if (!draft || typeof draft !== 'object') {
    return {
      ok: false,
      code: 'missing_draft',
      error: 'No hay una portada abierta para guardar.',
    };
  }
  const mode = CARD_COVER_MODES.includes(draft.mode)
    ? draft.mode
    : DEFAULT_CARD_APPEARANCE.mode;
  if (mode === 'custom') {
    const key = options.newImageKey ?? draft.imageKey;
    if (!isCardCoverKey(key)) {
      return {
        ok: false,
        code: 'missing_cover_image',
        error: 'Elige una imagen para la portada antes de guardar.',
      };
    }
    return {
      ok: true,
      appearance: normalizeCardAppearance({
        mode,
        imageKey: key,
        blur: draft.blur,
        shade: draft.shade,
      }),
    };
  }
  return {
    ok: true,
    appearance: normalizeCardAppearance({
      mode,
      imageKey: null,
      blur: draft.blur,
      shade: draft.shade,
    }),
  };
}

export function thumbnailDimensions(
  width,
  height,
  maxSide = CARD_COVER_THUMBNAIL_MAX_SIDE,
) {
  const sourceWidth = Math.max(1, Math.round(Number(width) || 1));
  const sourceHeight = Math.max(1, Math.round(Number(height) || 1));
  const limit = Math.max(1, Math.round(Number(maxSide) || CARD_COVER_THUMBNAIL_MAX_SIDE));
  const largest = Math.max(sourceWidth, sourceHeight);
  const scale = largest <= limit ? 1 : limit / largest;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  };
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeColor(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const safe = Math.trunc(value) >>> 0;
    const hex = (safe & 0xffffff).toString(16).padStart(6, '0');
    return `#${hex}`;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
    if (/^#[0-9a-f]{3}$/.test(trimmed)) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    }
    if (/^[0-9a-f]{6}$/.test(trimmed)) return `#${trimmed}`;
  }
  return DEFAULT_OVERLAY.color;
}

export function normalizeOverlay(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_OVERLAY };
  }
  const font = OVERLAY_FONTS.includes(value.font) ? value.font : DEFAULT_OVERLAY.font;
  const date = typeof value.date === 'string'
    ? value.date.trim().slice(0, OVERLAY_LIMITS.DATE_MAX_LENGTH)
    : '';
  return {
    x: clamp(value.x, 0, 1, DEFAULT_OVERLAY.x),
    y: clamp(value.y, 0, 1, DEFAULT_OVERLAY.y),
    size: clamp(value.size, OVERLAY_LIMITS.MIN_SIZE, OVERLAY_LIMITS.MAX_SIZE, DEFAULT_OVERLAY.size),
    font,
    color: normalizeColor(value.color),
    showDate: value.showDate === true && date.length > 0,
    date,
    twelveHour: value.twelveHour === true,
    locked: value.locked === true,
  };
}

/**
 * Los accesos rápidos son exactamente tres horas HH:mm distintas. Si el dato
 * guardado está incompleto o corrupto se vuelve a los valores iniciales, sin
 * tocar la hora vigente del equipo.
 */
export function normalizeQuickHours(value) {
  if (!Array.isArray(value) || value.length !== DEFAULT_QUICK_HOURS.length) {
    return [...DEFAULT_QUICK_HOURS];
  }
  const hours = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return [...DEFAULT_QUICK_HOURS];
    const hour = raw.trim();
    if (!isValidHour(hour) || hours.includes(hour)) return [...DEFAULT_QUICK_HOURS];
    hours.push(hour);
  }
  return hours;
}

export function validateQuickHours(value) {
  if (!Array.isArray(value) || value.length !== DEFAULT_QUICK_HOURS.length) {
    return {
      ok: false,
      code: 'quick_hours_count',
      error: 'Escribe las tres horas de acceso.',
    };
  }
  const hours = [];
  for (const raw of value) {
    const hour = typeof raw === 'string' ? raw.trim() : '';
    if (!isValidHour(hour)) {
      return {
        ok: false,
        code: 'quick_hours_invalid',
        error: 'Cada acceso debe ser una hora válida HH:mm, de 00:00 a 23:59.',
      };
    }
    if (hours.includes(hour)) {
      return {
        ok: false,
        code: 'quick_hours_duplicate',
        error: 'Los tres accesos deben ser horas distintas.',
      };
    }
    hours.push(hour);
  }
  return { ok: true, hours };
}

/** Mantiene la hora del widget si sigue entre los accesos; si no, usa la primera. */
export function resolveDefaultHourAfterQuickHoursEdit(currentDefaultHour, nextHours) {
  const check = validateQuickHours(nextHours);
  if (!check.ok) return check;
  const defaultHour = check.hours.includes(currentDefaultHour)
    ? currentDefaultHour
    : check.hours[0];
  return {
    ok: true,
    quickHours: check.hours,
    defaultHour,
    defaultChanged: defaultHour !== currentDefaultHour,
  };
}

export function normalizeDefaultHour(value, quickHours) {
  const hours = normalizeQuickHours(quickHours);
  return isValidHour(value) && hours.includes(value) ? value : hours[0];
}

function hasOwn(object, key) {
  return Boolean(object)
    && typeof object === 'object'
    && Object.prototype.hasOwnProperty.call(object, key);
}

function customProfilesFrom(options = {}) {
  if (!options || typeof options !== 'object') return [];
  if (Array.isArray(options.customProfiles)) return options.customProfiles;
  if (options.workspace && Array.isArray(options.workspace.customProfiles)) {
    return options.workspace.customProfiles;
  }
  return [];
}

/**
 * Definiciones disponibles sin mutar el catálogo global. `options.catalog` permite pasar
 * el catálogo ya resuelto de la app; `options.customProfiles` añade los equipos del estado.
 */
export function getProfileDefinitions(options = {}) {
  if (Array.isArray(options)) return options;
  if (options && Array.isArray(options.catalog)) return options.catalog;
  if (options && Array.isArray(options.definitions)) return options.definitions;
  const customProfiles = customProfilesFrom(options);
  return customProfiles.length > 0 ? [...PROFILE_CATALOG, ...customProfiles] : PROFILE_CATALOG;
}

export function getProfileDefinition(profileId, options = {}) {
  if (typeof profileId !== 'string') return null;
  return getProfileDefinitions(options).find((profile) => profile?.id === profileId) ?? null;
}

export function isProfileId(value, options = {}) {
  return typeof value === 'string'
    && getProfileDefinitions(options).some((profile) => profile?.id === value);
}

export function isCustomProfileId(value) {
  return typeof value === 'string' && CUSTOM_PROFILE_ID_PATTERN.test(value);
}

export function profileCatalogForWorkspace(workspace) {
  const customProfiles = normalizeCustomProfiles(workspace?.customProfiles);
  return Object.freeze([
    ...PROFILE_CATALOG,
    ...customProfiles.map((profile) => Object.freeze({ ...profile })),
  ]);
}

export function defaultMessageForTeam(name) {
  return `Batiseñal MN1 {hora}. Convocatoria del equipo ${name} de Sacos. ` +
    'Destinos: Telares y Extrusión.';
}

export function normalizeTeamNameKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateTeamName(value) {
  if (typeof value !== 'string') {
    return { ok: false, code: 'invalid_name', error: 'Escribe un nombre para el equipo.' };
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    return {
      ok: false,
      code: 'control_characters',
      error: 'El nombre no puede incluir caracteres de control.',
    };
  }
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0) {
    return { ok: false, code: 'blank_name', error: 'Escribe un nombre para el equipo.' };
  }
  if (textLength(name) > TEAM_NAME_MAX_LENGTH) {
    return {
      ok: false,
      code: 'name_too_long',
      error: `El nombre puede tener hasta ${TEAM_NAME_MAX_LENGTH} caracteres.`,
    };
  }
  return { ok: true, name };
}

export function validateCustomTeamName(state, value) {
  const check = validateTeamName(value);
  if (!check.ok) return check;
  const customProfiles = normalizeCustomProfiles(state?.customProfiles);
  if (PROFILE_CATALOG.length + customProfiles.length >= MAX_TOTAL_TEAMS) {
    return {
      ok: false,
      code: 'max_teams',
      error: `Puedes tener hasta ${MAX_TOTAL_TEAMS} equipos en total.`,
    };
  }
  const key = normalizeTeamNameKey(check.name);
  const duplicate = [...PROFILE_CATALOG, ...customProfiles]
    .some((profile) => normalizeTeamNameKey(profile?.name) === key);
  if (duplicate) {
    return {
      ok: false,
      code: 'duplicate_name',
      error: 'Ya existe un equipo con ese nombre.',
    };
  }
  return { ok: true, name: check.name };
}

function buildCustomProfileDefinition(id, name, index, createdAt = '') {
  return {
    id,
    name,
    shortName: name,
    color: CUSTOM_PROFILE_COLORS[index % CUSTOM_PROFILE_COLORS.length],
    defaultMessage: defaultMessageForTeam(name),
    createdAt: typeof createdAt === 'string' ? createdAt.slice(0, 40) : '',
  };
}

function randomUuidV4() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID();
    } catch {
      // Se usa la alternativa con getRandomValues o Math.random.
    }
  }
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    try {
      cryptoApi.getRandomValues(bytes);
    } catch {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function generateCustomProfileId(idFactory) {
  const raw = typeof idFactory === 'function' ? idFactory() : randomUuidV4();
  const uuid = String(raw ?? '').trim().toLowerCase().replace(/^custom-/, '');
  const id = `custom-${uuid}`;
  return isCustomProfileId(id) ? id : null;
}

export function normalizeCustomProfiles(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seenIds = new Set(PROFILE_IDS);
  const seenNames = new Set(PROFILE_CATALOG.map((profile) => normalizeTeamNameKey(profile.name)));
  for (const raw of value) {
    if (result.length >= MAX_CUSTOM_TEAMS) break;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const rawId = hasOwn(raw, 'id') ? raw.id : undefined;
    if (!isCustomProfileId(rawId)) continue;
    const id = rawId.toLowerCase();
    if (seenIds.has(id)) continue;
    const nameCheck = validateTeamName(hasOwn(raw, 'name') ? raw.name : undefined);
    if (!nameCheck.ok) continue;
    const nameKey = normalizeTeamNameKey(nameCheck.name);
    if (seenNames.has(nameKey)) continue;
    seenIds.add(id);
    seenNames.add(nameKey);
    const createdAt = hasOwn(raw, 'createdAt') && typeof raw.createdAt === 'string'
      ? raw.createdAt
      : '';
    result.push(buildCustomProfileDefinition(id, nameCheck.name, result.length, createdAt));
  }
  return result;
}

export function createCustomTeam(state, rawName, options = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, code: 'invalid_state', error: 'No hay un workspace disponible.' };
  }
  const check = validateCustomTeamName(state, rawName);
  if (!check.ok) return check;
  const customProfiles = normalizeCustomProfiles(state.customProfiles);
  const definitions = [...PROFILE_CATALOG, ...customProfiles];
  let profileId = null;
  for (let attempt = 0; attempt < 8 && profileId === null; attempt += 1) {
    const candidate = generateCustomProfileId(options.idFactory);
    if (candidate && !definitions.some((profile) => profile.id === candidate)) {
      profileId = candidate;
    }
  }
  if (!profileId) {
    return {
      ok: false,
      code: 'id_unavailable',
      error: 'No se pudo generar un identificador seguro para el equipo.',
    };
  }
  const createdAt = typeof options.createdAt === 'string'
    ? options.createdAt
    : new Date().toISOString();
  const definition = buildCustomProfileDefinition(
    profileId,
    check.name,
    customProfiles.length,
    createdAt,
  );
  const nextCustomProfiles = [...customProfiles, definition];
  const nextDefinitions = [...PROFILE_CATALOG, ...nextCustomProfiles];
  const profiles = {};
  const rawProfiles = state.profiles && typeof state.profiles === 'object' ? state.profiles : {};
  for (const profileDefinition of nextDefinitions) {
    const source = hasOwn(rawProfiles, profileDefinition.id)
      ? rawProfiles[profileDefinition.id]
      : undefined;
    profiles[profileDefinition.id] = normalizeTemplate(source, profileDefinition.id, {
      definitions: nextDefinitions,
    });
  }
  profiles[profileId] = createProfileTemplate(profileId, {
    definitions: nextDefinitions,
    message: definition.defaultMessage,
    hour: DEFAULT_HOUR,
    targetLabels: DEFAULT_TARGETS,
    overlay: DEFAULT_OVERLAY,
    imageKey: null,
    imageWidth: null,
    imageHeight: null,
    updatedAt: '',
  });
  return {
    ok: true,
    profileId,
    definition,
    template: profiles[profileId],
    state: {
      ...state,
      version: 1,
      activeProfileId: profileId,
      profiles,
      customProfiles: nextCustomProfiles,
      migratedAt: typeof state.migratedAt === 'string' ? state.migratedAt : '',
    },
  };
}

export function normalizeTargetLabels(value, options = {}) {
  const min = options.min ?? MN1_LIMITS.TARGETS_MIN;
  const max = options.max ?? MN1_LIMITS.TARGETS_MAX;
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const labels = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return null;
    const label = raw.trim();
    if (label.length < 1 || textLength(label) > MN1_LIMITS.LABEL_MAX_LENGTH) return null;
    labels.push(label);
  }
  return labels;
}

export function createProfileTemplate(profileId, options = {}) {
  const definitions = getProfileDefinitions(options);
  const definition = getProfileDefinition(profileId, { definitions })
    ?? getProfileDefinition(DEFAULT_PROFILE_ID, { definitions });
  return normalizeTemplate({
    message: options.message ?? definition.defaultMessage,
    hour: options.hour ?? DEFAULT_HOUR,
    quickHours: options.quickHours ?? DEFAULT_QUICK_HOURS,
    defaultHour: options.defaultHour,
    targetLabels: options.targetLabels ?? DEFAULT_TARGETS,
    overlay: options.overlay ?? DEFAULT_OVERLAY,
    imageKey: options.imageKey ?? null,
    imageWidth: options.imageWidth ?? null,
    imageHeight: options.imageHeight ?? null,
    cardAppearance: options.cardAppearance ?? DEFAULT_CARD_APPEARANCE,
    starterImageInitialized: options.starterImageInitialized ?? false,
    updatedAt: options.updatedAt ?? '',
  }, profileId, { definitions });
}

export function normalizeTemplate(raw, profileId, options = {}) {
  const definitions = getProfileDefinitions(options);
  const definition = getProfileDefinition(profileId, { definitions })
    ?? getProfileDefinition(DEFAULT_PROFILE_ID, { definitions });
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const message = typeof source.message === 'string' ? source.message.trim() : '';
  const labels = normalizeTargetLabels(source.targetLabels, {
    min: MN1_LIMITS.TARGETS_MIN_WORKSPACE,
  });
  const imageKey = isValidVaultKey(source.imageKey) ? source.imageKey : null;
  const width = Number(source.imageWidth);
  const height = Number(source.imageHeight);
  const quickHours = normalizeQuickHours(source.quickHours);
  return {
    message: message.length >= 1 && textLength(message) <= MN1_LIMITS.MESSAGE_MAX_LENGTH
      ? message
      : definition.defaultMessage,
    hour: isValidHour(source.hour) ? source.hour : DEFAULT_HOUR,
    quickHours,
    defaultHour: normalizeDefaultHour(source.defaultHour, quickHours),
    targetLabels: labels ?? [...DEFAULT_TARGETS],
    overlay: normalizeOverlay(source.overlay),
    imageKey,
    imageWidth: Number.isInteger(width) && width > 0 && width <= MN1_LIMITS.PNG_MAX_DIMENSION
      ? width
      : null,
    imageHeight: Number.isInteger(height) && height > 0 && height <= MN1_LIMITS.PNG_MAX_DIMENSION
      ? height
      : null,
    cardAppearance: normalizeCardAppearance(source.cardAppearance),
    // Una foto ya guardada cuenta como inicializada aunque venga de una versión
    // anterior. Después de true, borrar o reemplazar la foto nunca la restaura.
    starterImageInitialized: source.starterImageInitialized === true || Boolean(imageKey),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt.slice(0, 40) : '',
  };
}

export function createDefaultWorkspace() {
  return {
    version: 1,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: Object.fromEntries(
      PROFILE_CATALOG.map((profile) => [profile.id, createProfileTemplate(profile.id)]),
    ),
    customProfiles: [],
    migratedAt: '',
  };
}

export function normalizeWorkspaceState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.version !== 1) return null;
  const customProfiles = normalizeCustomProfiles(raw.customProfiles);
  const definitions = [...PROFILE_CATALOG, ...customProfiles];
  const rawProfiles = raw.profiles && typeof raw.profiles === 'object'
    && !Array.isArray(raw.profiles)
    ? raw.profiles
    : {};
  const profiles = {};
  for (const definition of definitions) {
    const source = hasOwn(rawProfiles, definition.id) ? rawProfiles[definition.id] : undefined;
    profiles[definition.id] = normalizeTemplate(source, definition.id, { definitions });
  }
  const activeProfileId = isProfileId(raw.activeProfileId, { definitions })
    ? raw.activeProfileId
    : DEFAULT_PROFILE_ID;
  return {
    version: 1,
    activeProfileId,
    profiles,
    customProfiles,
    migratedAt: typeof raw.migratedAt === 'string' ? raw.migratedAt.slice(0, 40) : '',
  };
}

export function cloneTemplate(template) {
  return {
    ...template,
    quickHours: normalizeQuickHours(template?.quickHours),
    defaultHour: normalizeDefaultHour(template?.defaultHour, template?.quickHours),
    targetLabels: [...(template?.targetLabels ?? DEFAULT_TARGETS)],
    overlay: { ...(template?.overlay ?? DEFAULT_OVERLAY) },
    cardAppearance: { ...normalizeCardAppearance(template?.cardAppearance) },
  };
}

export function cloneWorkspace(state) {
  const customProfiles = Array.isArray(state?.customProfiles)
    ? state.customProfiles.map((profile) => ({ ...profile }))
    : [];
  const definitions = getProfileDefinitions({ customProfiles });
  const profiles = {};
  for (const definition of definitions) {
    const source = state?.profiles?.[definition.id];
    profiles[definition.id] = source
      ? cloneTemplate(source)
      : createProfileTemplate(definition.id, { definitions });
  }
  return {
    ...state,
    profiles,
    customProfiles,
  };
}

export function selectProfile(state, profileId) {
  if (!isProfileId(profileId, { customProfiles: state?.customProfiles })) return null;
  return {
    ...state,
    activeProfileId: profileId,
    profiles: { ...state.profiles },
  };
}

export function updateProfile(state, profileId, template) {
  if (!isProfileId(profileId, { customProfiles: state?.customProfiles })) return null;
  const definitions = getProfileDefinitions({ customProfiles: state?.customProfiles });
  return {
    ...state,
    profiles: {
      ...state.profiles,
      [profileId]: normalizeTemplate(template, profileId, { definitions }),
    },
  };
}

/**
 * Migración no destructiva: la plantilla única anterior se convierte en el perfil
 * Los Indestructibles. No borra claves nativas ni sobrescribe un workspace existente.
 */
export function migrateLegacyWorkspace(legacy, options = {}) {
  const state = createDefaultWorkspace();
  const template = normalizeTemplate({
    message: legacy?.message,
    hour: legacy?.hour,
    targetLabels: legacy?.targetLabels,
    overlay: legacy?.overlay,
  }, DEFAULT_PROFILE_ID);
  state.profiles[DEFAULT_PROFILE_ID] = template;
  state.activeProfileId = DEFAULT_PROFILE_ID;
  state.migratedAt = options.migratedAt ?? new Date().toISOString();
  return state;
}

export function validateDraft(draft, options = {}) {
  const minTargets = options.minTargets ?? MN1_LIMITS.TARGETS_MIN;
  const message = typeof draft?.message === 'string' ? draft.message : '';
  const hour = typeof draft?.hour === 'string' ? draft.hour : '';
  const rawLabels = Array.isArray(draft?.targetLabels) ? draft.targetLabels : [];
  const labels = rawLabels.map((label) => (typeof label === 'string' ? label.trim() : ''));
  const errors = {};

  const trimmedMessage = message.trim();
  if (trimmedMessage.length === 0) {
    errors.message = 'Escribe el mensaje antes de guardar o compartir.';
  } else if (textLength(trimmedMessage) > MN1_LIMITS.MESSAGE_MAX_LENGTH) {
    errors.message = `El mensaje no puede superar ${MN1_LIMITS.MESSAGE_MAX_LENGTH} caracteres.`;
  }

  if (!isValidHour(hour)) {
    errors.hour = 'La hora debe tener formato HH:mm entre 00:00 y 23:59.';
  }

  if (labels.length < minTargets) {
    errors.targets = `Añade al menos ${minTargets} ${minTargets === 1 ? 'destino' : 'etiquetas'}.`;
  } else if (labels.length > MN1_LIMITS.TARGETS_MAX) {
    errors.targets = `El máximo es ${MN1_LIMITS.TARGETS_MAX} etiquetas.`;
  } else if (labels.some((label) => label.length === 0)) {
    errors.targets = 'Completa o elimina las etiquetas vacías.';
  } else if (labels.some((label) => textLength(label) > MN1_LIMITS.LABEL_MAX_LENGTH)) {
    errors.targets = `Cada etiqueta puede tener hasta ${MN1_LIMITS.LABEL_MAX_LENGTH} caracteres.`;
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    normalized: {
      message: trimmedMessage,
      hour,
      targetLabels: labels,
    },
  };
}
