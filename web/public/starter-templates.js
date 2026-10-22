/*
 * MN1 · fotos de inicio aprobadas.
 *
 * Este módulo es deliberadamente estrecho: sólo incluye los dos PNG aprobados
 * (indestructibles y super-guerreros). No descarga URLs externas, no toca el
 * puente nativo y no modifica permisos ni URIs. La siembra es pura respecto al
 * estado y recibe los seams de carga/almacén para poder probarla sin navegador.
 */

import { DEFAULT_OVERLAY } from './profiles.js';
import { WORKSPACE_KEYS } from './storage.js';

const RAW_STARTER_TEMPLATES = [
  {
    id: 'indestructibles',
    path: './templates/indestructibles.c9e3d4ac8d3d6f3f.png',
    sha256: 'c9e3d4ac8d3d6f3f3594e4883c4d1f9c3daeb7b4dbf4055a8225a1a90ab6c203',
    size: 2168242,
    width: 1254,
    height: 1254,
    overlay: { x: 0.5, y: 0.78, size: 0.075 },
  },
  {
    id: 'super-guerreros',
    path: './templates/super-guerreros.8200d4c6f9ede505.png',
    sha256: '8200d4c6f9ede50597c078bbb5ad7192fc9879dde83d7bd6fc8ef98ad8795a5a',
    size: 2378319,
    width: 1254,
    height: 1254,
    overlay: { x: 0.5, y: 0.925, size: 0.055 },
  },
];

export const STARTER_TEMPLATES = Object.freeze(
  RAW_STARTER_TEMPLATES.map((template) => Object.freeze({
    ...template,
    overlay: Object.freeze({ ...template.overlay }),
  })),
);

export const STARTER_TEMPLATE_CATALOG = STARTER_TEMPLATES;
export const STARTER_IMAGE_CATALOG = STARTER_TEMPLATES;
export const STARTER_IDS = Object.freeze(STARTER_TEMPLATES.map((template) => template.id));
export const STARTER_TEMPLATES_BY_ID = Object.freeze(
  Object.fromEntries(STARTER_TEMPLATES.map((template) => [template.id, template])),
);

export const STARTER_IMAGE_KEYS = Object.freeze(
  Object.fromEntries(STARTER_TEMPLATES.map((template) => [
    template.id,
    `${WORKSPACE_KEYS.imagePrefix}${template.id}.starterv1`,
  ])),
);

export function starterImageKeyFor(profileId) {
  return typeof profileId === 'string' && Object.prototype.hasOwnProperty.call(STARTER_IMAGE_KEYS, profileId)
    ? STARTER_IMAGE_KEYS[profileId]
    : null;
}

export const starterImageKey = starterImageKeyFor;

export class StarterImageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StarterImageError';
    this.code = String(code || 'starter_image_error');
  }
}

const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);

/** Lee la firma PNG y el IHDR; devuelve las dimensiones reales del archivo. */
export function parsePngHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 24) {
    throw new StarterImageError('invalid_png', 'El archivo no contiene un encabezado PNG completo.');
  }
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      throw new StarterImageError('invalid_png', 'El archivo no tiene la firma PNG esperada.');
    }
  }
  if (bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13
      || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) {
    throw new StarterImageError('invalid_png', 'El archivo no contiene un bloque IHDR válido.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1) {
    throw new StarterImageError('invalid_png', 'El PNG declara dimensiones no válidas.');
  }
  return { width, height };
}

export const validatePngHeader = parsePngHeader;
export const loadStarterImage = loadStarterImageAsset;

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Carga un asset aprobado desde el mismo origen. Valida HTTP, tamaño exacto,
 * SHA-256, firma PNG e IHDR contra los metadatos del catálogo. No acepta URLs
 * externas ni rutas absolutas.
 */
export async function loadStarterImageAsset(template, options = {}) {
  if (!template || typeof template !== 'object') {
    throw new StarterImageError('invalid_template', 'No hay metadatos de la imagen aprobada.');
  }
  const fetchImpl = options.fetchImpl ?? options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new StarterImageError('fetch_unavailable', 'Este entorno no permite descargar la imagen aprobada.');
  }
  const path = typeof template.path === 'string' ? template.path : '';
  if (!path.startsWith('./') || path.startsWith('../') || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new StarterImageError('invalid_path', 'La imagen aprobada debe usar una ruta relativa del mismo origen.');
  }
  const assetUrl = new URL(path, import.meta.url);
  const origin = globalThis.location?.origin;
  if (origin && assetUrl.origin !== origin) {
    throw new StarterImageError('cross_origin', 'La imagen aprobada debe servirse desde el mismo origen.');
  }
  const controller = new AbortController();
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, 20000) : 20000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let bytes;
  try {
    const response = await fetchImpl(assetUrl.href, {
      cache: 'no-store', credentials: 'same-origin',
      headers: { Accept: 'image/png' }, signal: controller.signal,
    });
    if (!response || response.ok !== true) {
      throw new StarterImageError('http_error', 'No se pudo descargar la imagen aprobada.');
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof StarterImageError) throw error;
    throw new StarterImageError(controller.signal.aborted ? 'fetch_timeout' : 'fetch_failed',
      controller.signal.aborted ? 'La descarga tardó demasiado; se reintentará al abrir.' : 'No se pudo descargar la imagen aprobada.');
  } finally {
    clearTimeout(timer);
  }
  if (!Number.isInteger(template.size) || bytes.byteLength !== template.size) {
    throw new StarterImageError('size_mismatch', 'El tamaño de la imagen aprobada no coincide con el catálogo.');
  }
  const header = parsePngHeader(bytes);
  if (header.width !== template.width || header.height !== template.height) {
    throw new StarterImageError('dimensions_mismatch', 'Las dimensiones del PNG no coinciden con el catálogo.');
  }
  const subtle = options.subtle ?? globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw new StarterImageError('crypto_unavailable', 'No se pudo validar SHA-256 en este entorno.');
  }
  let digest;
  try {
    digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  } catch {
    throw new StarterImageError('crypto_failed', 'No se pudo calcular SHA-256 de la imagen aprobada.');
  }
  const sha256 = bytesToHex(digest);
  if (sha256 !== String(template.sha256 || '').toLowerCase()) {
    throw new StarterImageError('hash_mismatch', 'La imagen aprobada no coincide con su SHA-256.');
  }
  return {
    base64: bytesToBase64(bytes),
    width: header.width,
    height: header.height,
    size: bytes.byteLength,
    sha256,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Compara el overlay completo con los valores prístinos congelados. */
export function isPristineOverlay(overlay) {
  if (!isPlainObject(overlay)) return false;
  return Object.keys(DEFAULT_OVERLAY).every((key) => overlay[key] === DEFAULT_OVERLAY[key]);
}

/**
 * La posición y el bloqueo son lo único que el catálogo sustituye. Si el usuario
 * movió, redimensionó o bloqueó el rótulo, se conserva tal cual.
 */
export function hasPristineOverlayPlacement(overlay) {
  if (!isPlainObject(overlay)) return false;
  return overlay.x === DEFAULT_OVERLAY.x
    && overlay.y === DEFAULT_OVERLAY.y
    && overlay.size === DEFAULT_OVERLAY.size
    && overlay.locked !== true;
}

function applyStarterProfile(profile, template, imageKey) {
  const baseOverlay = isPlainObject(profile.overlay)
    ? profile.overlay
    : { ...DEFAULT_OVERLAY };
  const overlay = hasPristineOverlayPlacement(baseOverlay)
    ? { ...baseOverlay, ...template.overlay }
    : { ...baseOverlay };
  return {
    ...profile,
    overlay,
    imageKey,
    imageWidth: template.width,
    imageHeight: template.height,
    starterImageInitialized: true,
  };
}

function warning(code, profileId, message) {
  return { code, profileId, message, retryable: true };
}

/**
 * Siembra una sola vez las fotos aprobadas de los equipos integrados que aún no
 * tienen foto. Es pura: no toca DOM ni el puente; recibe `loadImage` y el
 * almacén. Sólo escribe imágenes y el snapshot del workspace cuando ambos pasos
 * pueden completarse. Si algo falla, devuelve el estado previo intacto.
 */
export async function seedStarterImages(options = {}) {
  const workspace = options.workspace ?? options.state;
  const storage = options.storage ?? options.vault ?? null;
  const putText = typeof storage?.putText === 'function'
    ? (key, value) => storage.putText(key, value)
    : typeof storage?.put === 'function'
      ? (key, value) => storage.put(key, value)
      : null;
  const loadImage = options.loadImage ?? options.imageLoader ?? loadStarterImageAsset;
  const persistent = options.persistent ?? options.isPersistent ?? true;
  const storageBlocked = options.storageBlocked ?? options.blocked ?? false;
  const corrupt = options.corrupt === true;
  const dirty = options.dirty === true;
  const listening = options.listening === true;
  const busy = options.busy === true;
  const saveWorkspace = options.saveWorkspace ?? options.commitWorkspace ?? null;
  const providedCatalog = Array.isArray(options.catalog) ? options.catalog : null;

  const empty = (extra = {}) => ({
    ok: true,
    changed: false,
    workspace,
    state: workspace,
    seeded: [],
    initialized: [],
    warnings: [],
    skippedReason: '',
    ...extra,
  });

  if (!isPlainObject(workspace) || !isPlainObject(workspace.profiles)) {
    return empty({ ok: false, skippedReason: 'invalid_workspace' });
  }
  if (!persistent || storageBlocked || corrupt) {
    return empty({ skippedReason: 'storage_unavailable' });
  }
  if (dirty || listening || busy) {
    return empty({ skippedReason: 'state_busy' });
  }
  if (!putText) {
    return empty({ ok: false, skippedReason: 'storage_unavailable' });
  }

  const approved = new Set(STARTER_IDS);
  const catalog = providedCatalog
    ? providedCatalog.filter((template) => approved.has(template?.id))
    : STARTER_TEMPLATES;
  const profiles = { ...workspace.profiles };
  const seeded = [];
  const initialized = [];
  const warnings = [];
  const changedIds = new Set();

  for (const template of catalog) {
    const profile = profiles[template.id];
    if (!isPlainObject(profile)) continue;
    if (profile.imageKey) {
      // Una foto ya existe: nunca se descarga ni se reemplaza. Sólo se marca.
      if (profile.starterImageInitialized !== true) {
        profiles[template.id] = { ...profile, starterImageInitialized: true };
        initialized.push(template.id);
        changedIds.add(template.id);
      }
      continue;
    }
    if (profile.starterImageInitialized === true) {
      // La siembra ya ocurrió; si el usuario borró o cambió la foto, no se restaura.
      continue;
    }

    let image;
    try {
      image = await loadImage(template);
    } catch (error) {
      warnings.push(warning(
        'image_fetch_failed',
        template.id,
        error?.message || 'No se pudo preparar la foto de inicio.',
      ));
      continue;
    }
    if (typeof image === 'string') {
      image = { base64: image, width: template.width, height: template.height };
    } else if (isPlainObject(image) && typeof image.base64 !== 'string') {
      const candidate = image.pngBase64 ?? image.dataUrl ?? image.data;
      if (typeof candidate === 'string') {
        image = { ...image, base64: candidate };
      }
    }
    if (!isPlainObject(image)) {
      image = null;
    } else {
      const raw = image.base64;
      const base64 = typeof raw === 'string' && raw.startsWith('data:image/png;base64,')
        ? raw.slice('data:image/png;base64,'.length)
        : raw;
      image = {
        ...image,
        base64,
        width: image.width ?? template.width,
        height: image.height ?? template.height,
      };
    }
    if (!isPlainObject(image)
        || typeof image.base64 !== 'string'
        || image.base64.length === 0
        || image.width !== template.width
        || image.height !== template.height) {
      warnings.push(warning(
        'image_invalid',
        template.id,
        'La foto de inicio no cumple las dimensiones esperadas.',
      ));
      continue;
    }

    const imageKey = starterImageKeyFor(template.id);
    if (!imageKey) {
      warnings.push(warning(
        'image_key_unavailable',
        template.id,
        'No hay una clave segura para la foto de inicio.',
      ));
      continue;
    }
    try {
      const saved = await putText(imageKey, image.base64);
      if (saved === false) throw new Error('La imagen no se confirmó en el almacén.');
    } catch (error) {
      warnings.push(warning(
        'image_save_failed',
        template.id,
        error?.message || 'No se pudo guardar la foto de inicio.',
      ));
      continue;
    }
    profiles[template.id] = applyStarterProfile(profile, template, imageKey);
    seeded.push({ profileId: template.id, imageKey });
    changedIds.add(template.id);
  }

  if (changedIds.size === 0) {
    return empty({ ok: warnings.length === 0, warnings });
  }

  const nextWorkspace = {
    ...workspace,
    profiles,
  };
  try {
    const committed = typeof saveWorkspace === 'function'
      ? await saveWorkspace(nextWorkspace)
      : await putText(WORKSPACE_KEYS.state, JSON.stringify(nextWorkspace));
    if (committed === false) {
      throw new Error('El estado no se confirmó en el almacén.');
    }
  } catch (error) {
    // La imagen puede quedar como huérfana bajo la clave determinista: el
    // siguiente intento la reescribe sin afectar ninguna referencia previa.
    return empty({
      ok: false,
      warnings: [
        ...warnings,
        warning(
          'workspace_save_failed',
          '',
          error?.message || 'No se pudo confirmar el estado con las fotos de inicio.',
        ),
      ],
    });
  }

  return {
    ok: warnings.length === 0,
    changed: true,
    workspace: nextWorkspace,
    state: nextWorkspace,
    seeded,
    initialized,
    warnings,
    skippedReason: '',
  };
}

export const seedStarterTemplates = seedStarterImages;
