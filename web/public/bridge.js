/*
 * MN1 híbrido · puente web ↔ Android (protocolo v1).
 *
 * Este módulo NO inventa respuestas. Si `window.MN1Bridge` no existe (navegador de
 * escritorio), el modo es `preview` y toda petición se rechaza con `bridge_unavailable`.
 * La app web muestra ese estado de forma explícita y nunca simula guardado ni envío.
 *
 * Acciones heredadas (APK3): GET_STATE, UPDATE_TEMPLATE, PICK_IMAGE, OPEN_EDITOR,
 * SAVE_TEMPLATE y PREPARE_SHARE.
 * Acciones genéricas BASE: VAULT_GET, VAULT_PUT, IMPORT_IMAGE, GET_LEGACY_IMAGE,
 * SHARE_PNG y RECOGNIZE_SPEECH.
 *
 * Android inyecta `window.MN1Bridge.postMessage(json)`. Aquí se instala `onmessage` en
 * el objeto inyectado y cada respuesta válida se convierte en:
 *   window.dispatchEvent(new CustomEvent('mn1:native-result', { detail: result }))
 */

export const PROTOCOL_VERSION = 1;
export const MAX_ENVELOPE_BYTES = 32 * 1024;
export const MAX_GLOBAL_ENVELOPE_BYTES = 12 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_REQUEST_ID_LENGTH = 128;
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const VAULT_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
export const SPEECH_LANGUAGE = 'es-MX';

export const LEGACY_ACTIONS = Object.freeze([
  'GET_STATE',
  'UPDATE_TEMPLATE',
  'PICK_IMAGE',
  'OPEN_EDITOR',
  'SAVE_TEMPLATE',
  'PREPARE_SHARE',
]);

export const WORKSPACE_ACTIONS = Object.freeze([
  'VAULT_GET',
  'VAULT_PUT',
  'VAULT_REMOVE',
  'IMPORT_IMAGE',
  'CAPTURE_PHOTO',
  'GET_LEGACY_IMAGE',
  'SHARE_PNG',
  'RECOGNIZE_SPEECH',
  'CANCEL_SPEECH',
]);

export const ACTIONS = Object.freeze([...LEGACY_ACTIONS, ...WORKSPACE_ACTIONS]);

export const CAPABILITIES = Object.freeze({
  WORKSPACE: 'web-workspace-v1',
  RAW_IMAGE: 'raw-image-v1',
  CAMERA: 'camera-capture-v1',
  SHARE_PNG: 'share-png-v1',
  SPEECH: 'speech-input-v1',
});

/** Acciones que admiten el sobre ampliado de 12 MiB. Las demás siguen en 32 KiB. */
const LARGE_ENVELOPE_ACTIONS = new Set(['VAULT_PUT', 'SHARE_PNG']);

const ALLOWED_ACTIONS = new Set(ACTIONS);
const HOUR_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const COMPLETED_ID_LIMIT = 256;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_BASE64_SIGNATURE = 'iVBORw0KGgo';

/**
 * Límites compartidos por el formulario y la validación del puente. Android conserva su
 * propia validación; estos valores sólo evitan enviar cargas que el contrato no admite.
 */
export const MN1_LIMITS = Object.freeze({
  MESSAGE_MAX_LENGTH: 2_000,
  LABEL_MAX_LENGTH: 40,
  TARGETS_MIN: 2,
  TARGETS_MIN_WORKSPACE: 1,
  TARGETS_MAX: 10,
  IMAGE_PNG_BASE64_MAX_LENGTH: 8 * 1024 * 1024,
  IMAGE_DATA_URL_MAX_LENGTH: 8 * 1024 * 1024 + 64,
  VAULT_VALUE_MAX_BYTES: 8 * 1024 * 1024,
  VAULT_TOTAL_MAX_BYTES: 64 * 1024 * 1024,
  VAULT_MAX_KEYS: 128,
  SHARE_MESSAGE_MAX_LENGTH: 2_000,
  PNG_MAX_DIMENSION: 4_096,
  REQUEST_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
  PREPARE_SHARE_TIMEOUT_MS: 300_000,
  IMPORT_IMAGE_TIMEOUT_MS: 300_000,
  LEGACY_IMAGE_TIMEOUT_MS: 120_000,
  SHARE_PNG_TIMEOUT_MS: 300_000,
  SPEECH_TIMEOUT_MS: 300_000,
  VAULT_TIMEOUT_MS: 20_000,
});

let textEncoder = null;
try {
  if (typeof TextEncoder === 'function') textEncoder = new TextEncoder();
} catch {
  textEncoder = null;
}

export class BridgeError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'BridgeError';
    this.code = String(code || 'bridge_error');
    this.details = details;
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function utf8ByteLength(value) {
  const text = String(value ?? '');
  if (textEncoder) return textEncoder.encode(text).length;
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0);
    if (point <= 0x7f) bytes += 1;
    else if (point <= 0x7ff) bytes += 2;
    else if (point <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

export function isValidRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function isValidHour(value) {
  return typeof value === 'string' && HOUR_PATTERN.test(value);
}

export function isValidVaultKey(value) {
  return typeof value === 'string' && VAULT_KEY_PATTERN.test(value);
}

export function normalizeHour(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return HOUR_PATTERN.test(trimmed) ? trimmed : null;
}

export function textLength(value) {
  return Array.from(String(value ?? '')).length;
}

export function pngBase64FromDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(PNG_DATA_URL_PREFIX)) return null;
  return value.slice(PNG_DATA_URL_PREFIX.length);
}

export function pngDataUrlFromBase64(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  if (value.length % 4 !== 0) return null;
  if (!value.startsWith(PNG_BASE64_SIGNATURE)) return null;
  return `${PNG_DATA_URL_PREFIX}${value}`;
}

export function isPngDataUrl(value, maxLength = MN1_LIMITS.IMAGE_DATA_URL_MAX_LENGTH) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    return false;
  }
  const base64 = pngBase64FromDataUrl(value);
  if (base64 === null || base64.length > MN1_LIMITS.IMAGE_PNG_BASE64_MAX_LENGTH) return false;
  if (base64.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return false;
  return base64.startsWith(PNG_BASE64_SIGNATURE);
}

export function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item === 'string' && item.trim().length > 0) seen.add(item.trim());
  }
  return [...seen];
}

export function hasCapability(capabilities, name) {
  return Array.isArray(capabilities) && capabilities.includes(name);
}

export function maxEnvelopeBytesForAction(action) {
  return LARGE_ENVELOPE_ACTIONS.has(action) ? MAX_GLOBAL_ENVELOPE_BYTES : MAX_ENVELOPE_BYTES;
}

function failure(code, message, details = undefined) {
  return { ok: false, code, message, details };
}

function hasOnlyKeys(object, allowed) {
  return Object.keys(object).every((key) => allowed.includes(key));
}

function validateVaultGet(payload) {
  if (!hasOnlyKeys(payload, ['key'])) {
    return failure('invalid_payload', 'VAULT_GET sólo admite key.');
  }
  if (!isValidVaultKey(payload.key)) {
    return failure(
      'invalid_payload',
      'key debe ser ASCII de 1 a 64 caracteres y sólo A-Z a-z 0-9 . _ : -.',
    );
  }
  return { ok: true };
}

function validateVaultPut(payload) {
  if (!hasOnlyKeys(payload, ['key', 'value'])) {
    return failure('invalid_payload', 'VAULT_PUT sólo admite key y value.');
  }
  if (!isValidVaultKey(payload.key)) {
    return failure(
      'invalid_payload',
      'key debe ser ASCII de 1 a 64 caracteres y sólo A-Z a-z 0-9 . _ : -.',
    );
  }
  if (typeof payload.value !== 'string') {
    return failure('invalid_payload', 'value debe ser texto.');
  }
  const bytes = utf8ByteLength(payload.value);
  if (bytes > MN1_LIMITS.VAULT_VALUE_MAX_BYTES) {
    return failure('invalid_payload', 'value supera el máximo de 8 MiB por clave.');
  }
  return { ok: true };
}

function validateVaultRemove(payload) {
  if (!hasOnlyKeys(payload, ['key'])) {
    return failure('invalid_payload', 'VAULT_REMOVE sólo admite key.');
  }
  if (!isValidVaultKey(payload.key)) {
    return failure(
      'invalid_payload',
      'key debe ser ASCII de 1 a 64 caracteres y sólo A-Z a-z 0-9 . _ : -.',
    );
  }
  return { ok: true };
}

function validateSharePng(payload) {
  if (!hasOnlyKeys(payload, ['imageDataUrl', 'message'])) {
    return failure('invalid_payload', 'SHARE_PNG sólo admite imageDataUrl y message.');
  }
  if (!isPngDataUrl(payload.imageDataUrl)) {
    return failure('invalid_payload', 'imageDataUrl debe ser un PNG base64 de hasta 8 MiB.');
  }
  if (typeof payload.message !== 'string') {
    return failure('invalid_payload', 'message debe ser texto.');
  }
  const length = textLength(payload.message.trim());
  if (length < 1 || length > MN1_LIMITS.SHARE_MESSAGE_MAX_LENGTH) {
    return failure(
      'invalid_payload',
      `message debe tener entre 1 y ${MN1_LIMITS.SHARE_MESSAGE_MAX_LENGTH} caracteres.`,
    );
  }
  return { ok: true };
}

function validateSpeech(payload) {
  if (!hasOnlyKeys(payload, ['language'])) {
    return failure('invalid_payload', 'RECOGNIZE_SPEECH sólo admite language.');
  }
  if (payload.language !== SPEECH_LANGUAGE) {
    return failure('invalid_payload', `language debe ser ${SPEECH_LANGUAGE}.`);
  }
  return { ok: true };
}

function validateActionPayload(action, payload) {
  if (!isPlainObject(payload)) {
    return failure('invalid_payload', 'El payload debe ser un objeto JSON.');
  }

  if (action === 'GET_STATE'
      || action === 'PICK_IMAGE'
      || action === 'OPEN_EDITOR'
      || action === 'SAVE_TEMPLATE'
      || action === 'IMPORT_IMAGE'
      || action === 'CAPTURE_PHOTO'
      || action === 'GET_LEGACY_IMAGE'
      || action === 'CANCEL_SPEECH') {
    if (Object.keys(payload).length !== 0) {
      return failure('invalid_payload', `${action} exige payload vacío.`);
    }
    return { ok: true };
  }

  if (action === 'UPDATE_TEMPLATE') {
    if (!hasOnlyKeys(payload, ['message', 'hour', 'targetLabels'])) {
      return failure('invalid_payload', 'UPDATE_TEMPLATE sólo admite message, hour y targetLabels.');
    }
    if (Object.keys(payload).length === 0) {
      return failure('invalid_payload', 'UPDATE_TEMPLATE necesita al menos un campo.');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'message')) {
      if (typeof payload.message !== 'string') {
        return failure('invalid_payload', 'message debe ser texto.');
      }
      const length = textLength(payload.message.trim());
      if (length < 1 || length > MN1_LIMITS.MESSAGE_MAX_LENGTH) {
        return failure('invalid_payload', `message debe tener entre 1 y ${MN1_LIMITS.MESSAGE_MAX_LENGTH} caracteres.`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'hour') && !isValidHour(payload.hour)) {
      return failure('invalid_payload', 'hour debe tener formato HH:mm entre 00:00 y 23:59.');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'targetLabels')) {
      const labels = payload.targetLabels;
      if (!Array.isArray(labels)
          || labels.length < MN1_LIMITS.TARGETS_MIN
          || labels.length > MN1_LIMITS.TARGETS_MAX) {
        return failure('invalid_payload', `targetLabels debe tener entre ${MN1_LIMITS.TARGETS_MIN} y ${MN1_LIMITS.TARGETS_MAX} etiquetas.`);
      }
      for (const label of labels) {
        if (typeof label !== 'string') {
          return failure('invalid_payload', 'Cada etiqueta debe ser texto.');
        }
        const length = textLength(label.trim());
        if (length < 1 || length > MN1_LIMITS.LABEL_MAX_LENGTH) {
          return failure('invalid_payload', `Cada etiqueta debe tener entre 1 y ${MN1_LIMITS.LABEL_MAX_LENGTH} caracteres.`);
        }
      }
    }
    return { ok: true };
  }

  if (action === 'PREPARE_SHARE') {
    if (!hasOnlyKeys(payload, ['slot'])) {
      return failure('invalid_payload', 'PREPARE_SHARE sólo admite slot.');
    }
    if (!isValidHour(payload.slot)) {
      return failure('invalid_payload', 'slot debe tener formato HH:mm entre 00:00 y 23:59.');
    }
    return { ok: true };
  }

  if (action === 'VAULT_GET') return validateVaultGet(payload);
  if (action === 'VAULT_PUT') return validateVaultPut(payload);
  if (action === 'VAULT_REMOVE') return validateVaultRemove(payload);
  if (action === 'SHARE_PNG') return validateSharePng(payload);
  if (action === 'RECOGNIZE_SPEECH') return validateSpeech(payload);

  return failure('unsupported_action', 'Acción no admitida por el contrato v1.');
}

export function validateRequestEnvelope(envelope) {
  if (!isPlainObject(envelope)) {
    return failure('invalid_request', 'La petición debe ser un objeto JSON.');
  }
  if (envelope.version !== PROTOCOL_VERSION) {
    return failure('invalid_request', `version debe ser ${PROTOCOL_VERSION}.`);
  }
  if (!isValidRequestId(envelope.requestId)) {
    return failure('invalid_request', 'requestId no es un ID ASCII seguro de 1 a 128 caracteres.');
  }
  if (typeof envelope.action !== 'string' || !ALLOWED_ACTIONS.has(envelope.action)) {
    return failure('unsupported_action', 'Acción no admitida por el contrato v1.');
  }
  const payloadCheck = validateActionPayload(envelope.action, envelope.payload);
  if (!payloadCheck.ok) return payloadCheck;
  return { ok: true, value: envelope };
}

export function validateResultEnvelope(result) {
  if (!isPlainObject(result)) {
    return failure('invalid_result', 'La respuesta nativa no es un objeto JSON.');
  }
  if (result.version !== PROTOCOL_VERSION) {
    return failure('invalid_result', `La respuesta no usa version ${PROTOCOL_VERSION}.`);
  }
  if (!isValidRequestId(result.requestId)) {
    return failure('invalid_result', 'La respuesta no trae un requestId válido.');
  }
  if (typeof result.ok !== 'boolean') {
    return failure('invalid_result', 'La respuesta no trae ok booleano.');
  }
  if (typeof result.message !== 'string') {
    return failure('invalid_result', 'La respuesta no trae message de texto.');
  }
  if (Object.prototype.hasOwnProperty.call(result, 'data')
      && result.data !== null
      && !isPlainObject(result.data)) {
    return failure('invalid_result', 'data debe ser un objeto JSON o null.');
  }
  return { ok: true, value: result };
}

let fallbackRequestCounter = 0;

export function createRequestId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID();
    } catch {
      // Se continúa con la alternativa.
    }
  }
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    try {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      // Se continúa con la alternativa.
    }
  }
  fallbackRequestCounter += 1;
  return `mn1-${Date.now().toString(36)}-${fallbackRequestCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class Mn1Bridge {
  constructor(options = {}) {
    const root = options.root || globalThis;
    this.root = root;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.requestIdFactory = typeof options.requestIdFactory === 'function'
      ? options.requestIdFactory
      : createRequestId;
    this.setTimeoutFn = typeof options.setTimeoutFn === 'function'
      ? options.setTimeoutFn
      : globalThis.setTimeout.bind(globalThis);
    this.clearTimeoutFn = typeof options.clearTimeoutFn === 'function'
      ? options.clearTimeoutFn
      : globalThis.clearTimeout.bind(globalThis);
    this.onResult = typeof options.onResult === 'function' ? options.onResult : null;

    this.pending = new Map();
    this.completed = new Set();
    this.native = null;
    this.mode = 'preview';
    this.closed = false;
    this.lastProtocolError = null;
    this._receiverHandler = null;
    this._previousOnMessage = undefined;
    this._detectNative();
  }

  _detectNative() {
    const candidate = this.root && this.root.MN1Bridge;
    if (candidate && typeof candidate.postMessage === 'function') {
      if (this.native !== candidate) {
        this.native = candidate;
        this._installReceiver(candidate);
      }
      this.mode = 'native';
      return true;
    }
    this.native = null;
    this.mode = 'preview';
    return false;
  }

  _installReceiver(native) {
    const handler = (eventOrData) => {
      const data = eventOrData && typeof eventOrData === 'object' && 'data' in eventOrData
        ? eventOrData.data
        : eventOrData;
      this.handleNativeMessage(data);
    };
    this._receiverHandler = handler;
    try {
      this._previousOnMessage = native.onmessage;
      native.onmessage = handler;
    } catch {
      // AndroidX WebKit permite asignar onmessage. Si un host no lo permite, todavía se
      // puede llamar handleNativeMessage() desde un receptor externo.
      this.lastProtocolError = 'No se pudo instalar onmessage en MN1Bridge.';
    }
  }

  refreshMode() {
    return this._detectNative();
  }

  _rememberCompleted(requestId) {
    this.completed.add(requestId);
    while (this.completed.size > COMPLETED_ID_LIMIT) {
      const oldest = this.completed.values().next().value;
      this.completed.delete(oldest);
    }
  }

  _emit(result) {
    const CustomEventCtor = this.root && this.root.CustomEvent
      ? this.root.CustomEvent
      : globalThis.CustomEvent;
    if (this.root && typeof this.root.dispatchEvent === 'function') {
      try {
        const event = typeof CustomEventCtor === 'function'
          ? new CustomEventCtor('mn1:native-result', { detail: result })
          : { type: 'mn1:native-result', detail: result };
        this.root.dispatchEvent(event);
      } catch {
        // Una respuesta válida no debe perderse por un fallo al emitir el evento.
      }
    }
    if (this.onResult) {
      try {
        this.onResult(result);
      } catch {
        // El callback del host no debe romper el protocolo.
      }
    }
  }

  handleNativeMessage(rawMessage) {
    let parsed = rawMessage;
    if (typeof rawMessage === 'string') {
      try {
        parsed = JSON.parse(rawMessage);
      } catch {
        this.lastProtocolError = 'La respuesta nativa no es JSON válido.';
        return false;
      }
    }
    const validation = validateResultEnvelope(parsed);
    if (!validation.ok) {
      this.lastProtocolError = validation.message;
      return false;
    }
    const result = validation.value;
    const entry = this.pending.get(result.requestId);
    if (!entry) {
      // Un duplicado de una respuesta ya resuelta no se vuelve a emitir.
      return false;
    }
    this.pending.delete(result.requestId);
    if (entry.timer !== undefined && entry.timer !== null) {
      this.clearTimeoutFn(entry.timer);
    }
    this._rememberCompleted(result.requestId);
    this._emit(result);
    entry.resolve(result);
    return true;
  }

  request(action, payload = {}, options = {}) {
    if (this.closed) {
      return Promise.reject(new BridgeError('bridge_closed', 'El puente se cerró.'));
    }

    let requestId;
    try {
      requestId = options.requestId ?? this.requestIdFactory();
    } catch (error) {
      return Promise.reject(new BridgeError('invalid_request_id', 'No se pudo generar un requestId.', error));
    }

    const envelope = {
      version: PROTOCOL_VERSION,
      requestId,
      action,
      payload,
    };
    const validation = validateRequestEnvelope(envelope);
    if (!validation.ok) {
      return Promise.reject(new BridgeError(validation.code, validation.message, validation.details));
    }

    let json;
    try {
      json = JSON.stringify(envelope);
    } catch (error) {
      return Promise.reject(new BridgeError('invalid_payload', 'La petición no se puede serializar.', error));
    }
    const bytes = utf8ByteLength(json);
    if (bytes > MAX_GLOBAL_ENVELOPE_BYTES) {
      return Promise.reject(new BridgeError(
        'payload_too_large',
        `La petición ocupa ${bytes} bytes; el máximo global es ${MAX_GLOBAL_ENVELOPE_BYTES}.`,
      ));
    }
    const actionLimit = maxEnvelopeBytesForAction(action);
    if (bytes > actionLimit) {
      const human = actionLimit === MAX_ENVELOPE_BYTES ? '32 KB' : '12 MiB';
      return Promise.reject(new BridgeError(
        'payload_too_large',
        `La petición ocupa ${bytes} bytes; ${action} admite hasta ${human}.`,
      ));
    }

    const pending = this.pending.get(requestId);
    if (pending) {
      if (pending.action === action && pending.payloadJson === JSON.stringify(payload)) {
        // Deduplicación: la misma petición en vuelo comparte una sola promesa.
        return pending.promise;
      }
      return Promise.reject(new BridgeError('duplicate_request_id', 'requestId ya está en uso con otra petición.'));
    }
    if (this.completed.has(requestId)) {
      return Promise.reject(new BridgeError('duplicate_request_id', 'requestId ya fue utilizado; genera uno nuevo.'));
    }

    if (!this._detectNative()) {
      return Promise.reject(new BridgeError(
        'bridge_unavailable',
        'La app Android no está conectada. Esta vista previa no guarda ni comparte.',
      ));
    }

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new BridgeError('invalid_timeout', 'timeoutMs debe ser un número positivo.'));
    }

    let resolveRequest;
    let rejectRequest;
    const promise = new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });

    const timer = this.setTimeoutFn(() => {
      const current = this.pending.get(requestId);
      if (!current) return;
      this.pending.delete(requestId);
      this._rememberCompleted(requestId);
      rejectRequest(new BridgeError(
        'timeout',
        `La app Android no respondió en ${timeoutMs} ms. No se asumió ningún resultado.`,
      ));
    }, timeoutMs);

    this.pending.set(requestId, {
      action,
      payloadJson: JSON.stringify(payload),
      json,
      bytes,
      timer,
      promise,
      resolve: resolveRequest,
      reject: rejectRequest,
    });

    try {
      this.native.postMessage(json);
    } catch (error) {
      this.pending.delete(requestId);
      this.clearTimeoutFn(timer);
      rejectRequest(new BridgeError('native_post_failed', 'No se pudo entregar la petición a Android.', error));
    }

    return promise;
  }

  pendingCount() {
    return this.pending.size;
  }

  close() {
    this.closed = true;
    for (const [requestId, entry] of this.pending.entries()) {
      if (entry.timer !== undefined && entry.timer !== null) {
        this.clearTimeoutFn(entry.timer);
      }
      entry.reject(new BridgeError('bridge_closed', 'El puente se cerró antes de recibir respuesta.'));
      this.pending.delete(requestId);
    }
    if (this.native && this._receiverHandler && this.native.onmessage === this._receiverHandler) {
      try {
        this.native.onmessage = this._previousOnMessage;
      } catch {
        // Sin consecuencia: el host puede reinstalar su receptor.
      }
    }
  }
}

export function createMn1Bridge(options = {}) {
  return new Mn1Bridge(options);
}
