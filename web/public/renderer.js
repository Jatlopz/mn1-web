/*
 * MN1 · editor Canvas de la hora sobre la foto ORIGINAL.
 *
 * La foto guardada nunca se modifica. Al previsualizar o compartir se dibuja una copia
 * con la hora/fecha y se exporta PNG. Este módulo no toca el DOM al importarse.
 */

import { MN1_LIMITS } from './bridge.js';
import {
  OVERLAY_LIMITS,
  normalizeOverlay,
} from './profiles.js';

export class RendererError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'RendererError';
    this.code = String(code || 'renderer_error');
    this.details = details;
  }
}

const HOUR_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const FONT_FAMILIES = Object.freeze({
  bold: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  sans: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Consolas, "Liberation Mono", monospace',
});

export function formatHourText(hour, twelveHour = false) {
  if (typeof hour !== 'string' || !HOUR_PATTERN.test(hour)) return '';
  if (!twelveHour) return hour;
  const hours = Number(hour.slice(0, 2));
  const suffix = hours < 12 ? 'AM' : 'PM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${hour.slice(3, 5)} ${suffix}`;
}

export function formatDateEs(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().slice(0, OVERLAY_LIMITS.DATE_MAX_LENGTH);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return trimmed;
}

export function scaleDimensions(width, height, maxSide = MN1_LIMITS.PNG_MAX_DIMENSION) {
  const sourceWidth = Math.max(1, Math.round(Number(width) || 1));
  const sourceHeight = Math.max(1, Math.round(Number(height) || 1));
  const limit = Math.max(1, Math.round(Number(maxSide) || MN1_LIMITS.PNG_MAX_DIMENSION));
  const largest = Math.max(sourceWidth, sourceHeight);
  const scale = largest <= limit ? 1 : limit / largest;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  };
}

export function nextDownscaleScale(scale, factor = 0.82) {
  const current = Number(scale);
  const safeFactor = Number(factor);
  if (!Number.isFinite(current) || current <= 0) return 1;
  if (!Number.isFinite(safeFactor) || safeFactor <= 0 || safeFactor >= 1) return current * 0.82;
  return current * safeFactor;
}

export function fontSpecFor(font, sizePx) {
  const family = FONT_FAMILIES[font] ?? FONT_FAMILIES.bold;
  const weight = font === 'bold' || font === 'mono' ? 700 : 500;
  return `${weight} ${Math.max(1, Math.round(sizePx))}px ${family}`;
}

export function layoutOverlay(overlay, width, height, hour) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const normalized = normalizeOverlay(overlay);
  const fontSize = Math.max(8, normalized.size * safeHeight);
  const dateFontSize = Math.max(7, fontSize * 0.54);
  const hourText = formatHourText(hour, normalized.twelveHour);
  const dateText = normalized.showDate ? formatDateEs(normalized.date) : '';
  const x = Math.min(safeWidth, Math.max(0, normalized.x * safeWidth));
  const y = Math.min(safeHeight, Math.max(0, normalized.y * safeHeight));
  const dateY = Math.min(safeHeight - 2, y + fontSize * 0.8);
  return {
    overlay: normalized,
    x,
    y,
    hourText,
    dateText,
    fontSize,
    dateFontSize,
    dateY,
    hourFont: fontSpecFor(normalized.font, fontSize),
    dateFont: fontSpecFor(normalized.font, dateFontSize),
  };
}

/**
 * Dibuja la hora/fecha centrada en (x,y). Añade un contorno oscuro sólo para legibilidad;
 * el color elegido se usa en el relleno. No añade marcas de la app.
 */
export function drawOverlay(ctx, width, height, hour, overlay) {
  if (!ctx || typeof ctx.fillText !== 'function') {
    throw new RendererError('invalid_context', 'El contexto Canvas no es válido.');
  }
  const layout = layoutOverlay(overlay, width, height, hour);
  if (!layout.hourText && !layout.dateText) return layout;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (layout.hourText) {
    ctx.font = layout.hourFont;
    ctx.lineWidth = Math.max(2, layout.fontSize / 11);
    if (typeof ctx.strokeText === 'function') {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.strokeText(layout.hourText, layout.x, layout.y);
    }
    ctx.fillStyle = layout.overlay.color;
    ctx.fillText(layout.hourText, layout.x, layout.y);
  }
  if (layout.dateText) {
    ctx.font = layout.dateFont;
    ctx.lineWidth = Math.max(2, layout.dateFontSize / 11);
    if (typeof ctx.strokeText === 'function') {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.strokeText(layout.dateText, layout.x, layout.dateY);
    }
    ctx.fillStyle = layout.overlay.color;
    ctx.fillText(layout.dateText, layout.x, layout.dateY);
  }
  ctx.restore();
  return layout;
}

export function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    if (typeof Image !== 'function') {
      reject(new RendererError('image_unavailable', 'No hay decodificador de imágenes.'));
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new RendererError('image_decode_failed', 'No se pudo decodificar la imagen.'));
    image.src = dataUrl;
  });
}

function defaultCanvasFactory() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new RendererError('canvas_unavailable', 'Canvas no está disponible.');
  }
  return document.createElement('canvas');
}

function imageSize(image) {
  const width = Number(image?.naturalWidth ?? image?.width);
  const height = Number(image?.naturalHeight ?? image?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new RendererError('image_size_invalid', 'La imagen no tiene dimensiones legibles.');
  }
  return { width: Math.round(width), height: Math.round(height) };
}

async function drawPngAtScale({ image, scale, width, height, hour, overlay, createCanvas, maxDataUrlLength }) {
  const canvas = createCanvas();
  canvas.width = width;
  canvas.height = height;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) throw new RendererError('canvas_unavailable', 'No se pudo obtener el contexto Canvas.');
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  drawOverlay(ctx, width, height, hour, overlay);
  let dataUrl;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch (error) {
    throw new RendererError('png_export_failed', 'No se pudo exportar el PNG.', error);
  }
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    throw new RendererError('png_export_failed', 'El Canvas no devolvió un PNG.');
  }
  return {
    dataUrl,
    width,
    height,
    scale,
    fits: dataUrl.length <= maxDataUrlLength,
  };
}

/**
 * Compone la foto original + la hora. Si el PNG supera 8 MiB de base64, reduce la copia
 * progresivamente; la foto original almacenada no se altera.
 */
export async function renderCompositePng(options = {}) {
  const {
    imageDataUrl,
    hour,
    overlay,
    maxDataUrlLength = MN1_LIMITS.IMAGE_DATA_URL_MAX_LENGTH,
    createCanvas = defaultCanvasFactory,
    loadImage = loadImageElement,
  } = options;
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/png;base64,')) {
    throw new RendererError('invalid_image', 'La foto original no es un PNG válido.');
  }
  const image = await loadImage(imageDataUrl);
  const size = imageSize(image);
  const initial = scaleDimensions(size.width, size.height, MN1_LIMITS.PNG_MAX_DIMENSION);
  let scale = initial.scale;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    if (width < 64 || height < 64) break;
    const rendered = await drawPngAtScale({
      image,
      scale,
      width,
      height,
      hour,
      overlay,
      createCanvas,
      maxDataUrlLength,
    });
    if (rendered.fits) {
      return { dataUrl: rendered.dataUrl, width, height, scale };
    }
    scale = nextDownscaleScale(scale);
  }
  throw new RendererError(
    'png_too_large',
    'No se pudo generar un PNG de menos de 8 MiB. Prueba una foto más pequeña.',
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'function') {
      reject(new RendererError('file_unavailable', 'No se puede leer el archivo.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new RendererError('file_read_failed', 'No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
}

async function decodeFile(file, createImageBitmapFn) {
  if (typeof createImageBitmapFn === 'function') {
    try {
      return await createImageBitmapFn(file);
    } catch {
      // Se intenta con FileReader + Image.
    }
  }
  const dataUrl = await readFileAsDataUrl(file);
  return loadImageElement(dataUrl);
}

/**
 * Importación de navegador: decodifica dentro de Canvas (sin EXIF), limita el lado a
 * 2048 px y devuelve un PNG data URL. En APK se usa IMPORT_IMAGE, no este camino.
 */
export async function prepareImageFile(file, options = {}) {
  const {
    maxSide = 2048,
    minDimension = 64,
    maxDataUrlLength = MN1_LIMITS.IMAGE_DATA_URL_MAX_LENGTH,
    createCanvas = defaultCanvasFactory,
    createImageBitmapFn = typeof createImageBitmap === 'function' ? createImageBitmap : null,
  } = options;
  if (!file || typeof file !== 'object') {
    throw new RendererError('invalid_file', 'No se eligió ninguna imagen.');
  }
  const image = await decodeFile(file, createImageBitmapFn);
  const size = imageSize(image);
  const initial = scaleDimensions(size.width, size.height, maxSide);
  let scale = initial.scale;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    if (width < minDimension || height < minDimension) break;
    const canvas = createCanvas();
    canvas.width = width;
    canvas.height = height;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) throw new RendererError('canvas_unavailable', 'No se pudo obtener el contexto Canvas.');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    let dataUrl;
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (error) {
      throw new RendererError('png_export_failed', 'No se pudo convertir la imagen a PNG.', error);
    }
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
      if (dataUrl.length <= maxDataUrlLength) {
        return { dataUrl, width, height, scale };
      }
    }
    scale = nextDownscaleScale(scale);
  }
  throw new RendererError(
    'image_too_large',
    'La imagen supera 8 MiB en PNG. Prueba con una foto más pequeña.',
  );
}
