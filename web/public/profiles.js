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

export const DEFAULT_HOUR = '08:00';
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
});

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
  };
}

export function getProfileDefinition(profileId) {
  return PROFILE_CATALOG.find((profile) => profile.id === profileId) ?? null;
}

export function isProfileId(value) {
  return typeof value === 'string' && PROFILE_IDS.includes(value);
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
  const definition = getProfileDefinition(profileId) ?? getProfileDefinition(DEFAULT_PROFILE_ID);
  return normalizeTemplate({
    message: options.message ?? definition.defaultMessage,
    hour: options.hour ?? DEFAULT_HOUR,
    targetLabels: options.targetLabels ?? DEFAULT_TARGETS,
    overlay: options.overlay ?? DEFAULT_OVERLAY,
    imageKey: options.imageKey ?? null,
    imageWidth: options.imageWidth ?? null,
    imageHeight: options.imageHeight ?? null,
    updatedAt: options.updatedAt ?? '',
  }, profileId);
}

export function normalizeTemplate(raw, profileId) {
  const definition = getProfileDefinition(profileId) ?? getProfileDefinition(DEFAULT_PROFILE_ID);
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const message = typeof source.message === 'string' ? source.message.trim() : '';
  const labels = normalizeTargetLabels(source.targetLabels, {
    min: MN1_LIMITS.TARGETS_MIN_WORKSPACE,
  });
  const imageKey = isValidVaultKey(source.imageKey) ? source.imageKey : null;
  const width = Number(source.imageWidth);
  const height = Number(source.imageHeight);
  return {
    message: message.length >= 1 && textLength(message) <= MN1_LIMITS.MESSAGE_MAX_LENGTH
      ? message
      : definition.defaultMessage,
    hour: isValidHour(source.hour) ? source.hour : DEFAULT_HOUR,
    targetLabels: labels ?? [...DEFAULT_TARGETS],
    overlay: normalizeOverlay(source.overlay),
    imageKey,
    imageWidth: Number.isInteger(width) && width > 0 && width <= MN1_LIMITS.PNG_MAX_DIMENSION
      ? width
      : null,
    imageHeight: Number.isInteger(height) && height > 0 && height <= MN1_LIMITS.PNG_MAX_DIMENSION
      ? height
      : null,
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
    migratedAt: '',
  };
}

export function normalizeWorkspaceState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.version !== 1) return null;
  const profiles = {};
  for (const profile of PROFILE_CATALOG) {
    profiles[profile.id] = normalizeTemplate(raw.profiles?.[profile.id], profile.id);
  }
  return {
    version: 1,
    activeProfileId: isProfileId(raw.activeProfileId)
      ? raw.activeProfileId
      : DEFAULT_PROFILE_ID,
    profiles,
    migratedAt: typeof raw.migratedAt === 'string' ? raw.migratedAt.slice(0, 40) : '',
  };
}

export function cloneTemplate(template) {
  return {
    ...template,
    targetLabels: [...template.targetLabels],
    overlay: { ...template.overlay },
  };
}

export function cloneWorkspace(state) {
  return {
    ...state,
    profiles: Object.fromEntries(
      PROFILE_IDS.map((profileId) => [profileId, cloneTemplate(state.profiles[profileId])]),
    ),
  };
}

export function selectProfile(state, profileId) {
  if (!isProfileId(profileId)) return null;
  return {
    ...state,
    activeProfileId: profileId,
    profiles: { ...state.profiles },
  };
}

export function updateProfile(state, profileId, template) {
  if (!isProfileId(profileId)) return null;
  return {
    ...state,
    profiles: {
      ...state.profiles,
      [profileId]: normalizeTemplate(template, profileId),
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
