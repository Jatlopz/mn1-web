/*
 * MN1 · almacén genérico del workspace.
 *
 * - En APK BASE usa las acciones VAULT_GET/VAULT_PUT (almacén privado nativo).
 * - En navegador usa IndexedDB. Si no está disponible, memoria volátil y aviso honesto.
 * - Nunca usa rutas, URIs ni claves fuera del patrón del contrato.
 * - Los valores son strings; las imágenes se guardan como base64 PNG sin prefijo.
 */

import {
  MN1_LIMITS,
  isValidVaultKey,
  utf8ByteLength,
} from './bridge.js';

export const VAULT_LIMITS = Object.freeze({
  VALUE_MAX_BYTES: MN1_LIMITS.VAULT_VALUE_MAX_BYTES,
  TOTAL_MAX_BYTES: MN1_LIMITS.VAULT_TOTAL_MAX_BYTES,
  MAX_KEYS: MN1_LIMITS.VAULT_MAX_KEYS,
});

export const WORKSPACE_KEYS = Object.freeze({
  state: 'mn1.workspace.state',
  migrated: 'mn1.workspace.migrated',
  imagePrefix: 'mn1.workspace.image.',
  coverPrefix: 'mn1.workspace.cover.',
});

const CUSTOM_PROFILE_KEY_PATTERN =
  /^custom-([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;
const VAULT_KEY_MAX_LENGTH = 64;

function compactCustomProfileId(profileId) {
  const match = CUSTOM_PROFILE_KEY_PATTERN.exec(String(profileId ?? ''));
  if (!match) return null;
  return `custom-${match.slice(1).join('').toLowerCase()}`;
}

function stampSuffix(stamp, limit = 16) {
  const raw = typeof stamp === 'string'
    ? stamp.replace(/[^A-Za-z0-9]/g, '')
    : Number(stamp).toString(36).replace(/[^a-z0-9]/gi, '');
  const max = Math.max(0, Math.floor(Number(limit) || 0));
  if (max <= 0) return '';
  return raw.slice(-max) || '0';
}

function profileVaultKey(prefix, profileId, stamp) {
  const compact = compactCustomProfileId(profileId);
  if (compact === null) {
    // Las claves de los equipos integrados conservan su formato histórico.
    return `${prefix}${profileId}.${stampSuffix(stamp, 16)}`;
  }
  const fixedLength = prefix.length + compact.length + 1;
  const suffixLimit = Math.max(1, VAULT_KEY_MAX_LENGTH - fixedLength);
  return `${prefix}${compact}.${stampSuffix(stamp, suffixLimit)}`;
}

/**
 * Clave versionada por equipo. Los identificadores personalizados conservan el
 * UUID completo compactado (32 hex) y el sufijo se recorta para no superar los
 * 64 caracteres del contrato; los equipos integrados mantienen su formato.
 */
export function imageKeyForProfile(profileId, stamp = Date.now()) {
  return profileVaultKey(WORKSPACE_KEYS.imagePrefix, profileId, stamp);
}

/** Clave privada e independiente para la portada personalizada de un equipo. */
export function coverKeyForProfile(profileId, stamp = Date.now()) {
  return profileVaultKey(WORKSPACE_KEYS.coverPrefix, profileId, stamp);
}

export class VaultError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'VaultError';
    this.code = String(code || 'vault_error');
    this.details = details;
  }
}

export function validateVaultWrite(key, value, options = {}) {
  if (!isValidVaultKey(key)) {
    return {
      ok: false,
      error: new VaultError(
        'invalid_key',
        'La clave debe ser ASCII de 1 a 64 caracteres (A-Z a-z 0-9 . _ : -).',
      ),
    };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: new VaultError('invalid_value', 'El valor debe ser texto.') };
  }
  const bytes = utf8ByteLength(value);
  if (bytes > VAULT_LIMITS.VALUE_MAX_BYTES) {
    return {
      ok: false,
      bytes,
      error: new VaultError('value_too_large', 'El valor supera 8 MiB por clave.'),
    };
  }
  const existingKeys = Number(options.existingKeys ?? 0);
  const totalBytes = Number(options.totalBytes ?? 0);
  const replacedBytes = Number(options.replacedBytes ?? 0);
  const replacing = options.replacing === true;
  if (!replacing && existingKeys >= VAULT_LIMITS.MAX_KEYS) {
    return {
      ok: false,
      bytes,
      error: new VaultError('too_many_keys', `El almacén admite un máximo de ${VAULT_LIMITS.MAX_KEYS} claves.`),
    };
  }
  if (totalBytes - replacedBytes + bytes > VAULT_LIMITS.TOTAL_MAX_BYTES) {
    return {
      ok: false,
      bytes,
      error: new VaultError('vault_full', 'El almacén alcanzó el límite de 64 MiB.'),
    };
  }
  return { ok: true, bytes };
}

/** Almacén en memoria con los mismos límites. Sirve de respaldo honesto y para tests. */
export class MemoryVault {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    if (!isValidVaultKey(key)) throw new VaultError('invalid_key', 'Clave no válida.');
    return this.values.has(key) ? this.values.get(key) : null;
  }

  async put(key, value) {
    const replacing = this.values.has(key);
    const totalBytes = this.totalBytes();
    const replacedBytes = replacing ? utf8ByteLength(this.values.get(key)) : 0;
    const check = validateVaultWrite(key, value, {
      existingKeys: this.values.size,
      totalBytes,
      replacedBytes,
      replacing,
    });
    if (!check.ok) throw check.error;
    this.values.set(key, value);
  }

  async remove(key) {
    if (!isValidVaultKey(key)) throw new VaultError('invalid_key', 'Clave no válida.');
    return this.values.delete(key);
  }

  totalBytes() {
    let total = 0;
    for (const value of this.values.values()) total += utf8ByteLength(value);
    return total;
  }

  keyCount() {
    return this.values.size;
  }
}

/** Adaptador del puente nativo. El almacén real y sus cuotas viven en Android. */
export class BridgeVaultAdapter {
  constructor(bridge, options = {}) {
    this.bridge = bridge;
    this.timeoutMs = options.timeoutMs ?? MN1_LIMITS.VAULT_TIMEOUT_MS;
  }

  async get(key) {
    if (!isValidVaultKey(key)) throw new VaultError('invalid_key', 'Clave no válida.');
    const result = await this.bridge.request('VAULT_GET', { key }, { timeoutMs: this.timeoutMs });
    if (!result.ok) {
      throw new VaultError('native_rejected', result.message || 'El almacén privado rechazó la lectura.');
    }
    const data = result.data;
    if (!data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data, 'value')) {
      throw new VaultError('invalid_response', 'La app no devolvió value en VAULT_GET.');
    }
    if (data.value === null) return null;
    if (typeof data.value !== 'string') {
      throw new VaultError('invalid_response', 'VAULT_GET devolvió un valor no textual.');
    }
    return data.value;
  }

  async put(key, value) {
    const check = validateVaultWrite(key, value);
    if (!check.ok) throw check.error;
    const result = await this.bridge.request(
      'VAULT_PUT',
      { key, value },
      { timeoutMs: this.timeoutMs },
    );
    if (!result.ok) {
      throw new VaultError('native_rejected', result.message || 'El almacén privado rechazó la escritura.');
    }
    if (!result.data || result.data.saved !== true) {
      throw new VaultError('invalid_response', 'VAULT_PUT no confirmó saved:true.');
    }
    return check.bytes;
  }

  async remove(key) {
    if (!isValidVaultKey(key)) throw new VaultError('invalid_key', 'Clave no válida.');
    const result = await this.bridge.request('VAULT_REMOVE', { key }, { timeoutMs: this.timeoutMs });
    if (!result.ok) {
      throw new VaultError('native_rejected', result.message || 'El almacén privado rechazó el borrado.');
    }
    if (!result.data || typeof result.data.removed !== 'boolean') {
      throw new VaultError('invalid_response', 'VAULT_REMOVE no confirmó removed booleano.');
    }
    return result.data.removed;
  }
}

/** Adaptador IndexedDB para navegador. No se abre hasta llamar a ready(). */
export class IndexedDbVaultAdapter {
  constructor(options = {}) {
    this.indexedDb = options.indexedDB ?? globalThis.indexedDB;
    this.databaseName = options.databaseName ?? 'mn1-workspace';
    this.storeName = options.storeName ?? 'vault';
    this.dbPromise = null;
  }

  ready() {
    return this._open();
  }

  _open() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      if (!this.indexedDb || typeof this.indexedDb.open !== 'function') {
        reject(new VaultError('indexeddb_unavailable', 'IndexedDB no está disponible en este navegador.'));
        return;
      }
      let request;
      try {
        request = this.indexedDb.open(this.databaseName, 1);
      } catch (error) {
        reject(new VaultError('indexeddb_unavailable', 'No se pudo abrir IndexedDB.', error));
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(
        new VaultError('indexeddb_error', 'No se pudo abrir IndexedDB.', request.error),
      );
      request.onblocked = () => reject(
        new VaultError('indexeddb_blocked', 'IndexedDB está bloqueado por otra pestaña.'),
      );
    });
    return this.dbPromise;
  }

  async get(key) {
    if (!isValidVaultKey(key)) throw new VaultError('invalid_key', 'Clave no válida.');
    const db = await this._open();
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(this.storeName, 'readonly');
      } catch (error) {
        reject(new VaultError('indexeddb_error', 'No se pudo leer IndexedDB.', error));
        return;
      }
      const request = tx.objectStore(this.storeName).get(key);
      request.onsuccess = () => {
        resolve(request.result === undefined ? null : request.result);
      };
      request.onerror = () => reject(
        new VaultError('indexeddb_error', 'No se pudo leer IndexedDB.', request.error),
      );
    });
  }

  async remove(key) {
    if (!isValidVaultKey(key)) throw new VaultError('invalid_key', 'Clave no válida.');
    const db = await this._open();
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(this.storeName, 'readwrite');
      } catch (error) {
        reject(new VaultError('indexeddb_error', 'No se pudo borrar de IndexedDB.', error));
        return;
      }
      let existed = false;
      const store = tx.objectStore(this.storeName);
      const getRequest = store.get(key);
      getRequest.onsuccess = () => {
        existed = getRequest.result !== undefined;
        if (existed) store.delete(key);
      };
      getRequest.onerror = () => reject(
        new VaultError('indexeddb_error', 'No se pudo leer IndexedDB.', getRequest.error),
      );
      tx.oncomplete = () => resolve(existed);
      tx.onerror = () => reject(
        new VaultError('indexeddb_error', 'No se pudo borrar de IndexedDB.', tx.error),
      );
      tx.onabort = () => reject(
        new VaultError('indexeddb_aborted', 'El borrado se canceló.', tx.error),
      );
    });
  }

  async put(key, value) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof VaultError
          ? error
          : new VaultError('indexeddb_error', 'No se pudo guardar en IndexedDB.', error));
      };
      let tx;
      try {
        tx = db.transaction(this.storeName, 'readwrite');
      } catch (error) {
        fail(error);
        return;
      }
      const store = tx.objectStore(this.storeName);
      let totalBytes = 0;
      let keyCount = 0;
      let replacedBytes = 0;
      let replacing = false;
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          keyCount += 1;
          const existing = typeof cursor.value === 'string' ? cursor.value : '';
          totalBytes += utf8ByteLength(existing);
          if (cursor.key === key) {
            replacing = true;
            replacedBytes = utf8ByteLength(existing);
          }
          cursor.continue();
          return;
        }
        const check = validateVaultWrite(key, value, {
          existingKeys: keyCount,
          totalBytes,
          replacedBytes,
          replacing,
        });
        if (!check.ok) {
          try {
            tx.abort();
          } catch {
            // La transacción ya puede estar cerrada.
          }
          fail(check.error);
          return;
        }
        try {
          store.put(value, key);
        } catch (error) {
          fail(error);
        }
      };
      cursorRequest.onerror = () => fail(cursorRequest.error);
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      tx.onerror = () => fail(tx.error);
      tx.onabort = () => fail(tx.error ?? new VaultError('indexeddb_aborted', 'La escritura se canceló.'));
    });
  }
}

/**
 * Crea el almacén de navegador. Si IndexedDB falla, devuelve memoria volátil y
 * `persistent:false` para que la UI no afirme que guardó de forma duradera.
 */
export async function createBrowserVault(options = {}) {
  const adapter = new IndexedDbVaultAdapter(options);
  try {
    await adapter.ready();
    return { adapter, persistent: true, label: 'IndexedDB de este navegador', reason: '' };
  } catch (error) {
    return {
      adapter: new MemoryVault(),
      persistent: false,
      label: 'memoria temporal',
      reason: error instanceof Error ? error.message : 'IndexedDB no disponible',
    };
  }
}

/** Fachada común: valida antes de escribir y oculta la diferencia nativo/navegador. */
export class VaultClient {
  constructor(adapter, options = {}) {
    if (!adapter || typeof adapter.get !== 'function' || typeof adapter.put !== 'function') {
      throw new VaultError('invalid_adapter', 'El adaptador del almacén no es válido.');
    }
    this.adapter = adapter;
    this.persistent = options.persistent !== false;
    this.label = options.label ?? '';
    this.reason = options.reason ?? '';
  }

  async getText(key) {
    return this.adapter.get(key);
  }

  async putText(key, value) {
    const check = validateVaultWrite(key, value);
    if (!check.ok) throw check.error;
    await this.adapter.put(key, value);
    return check.bytes;
  }

  async removeText(key) {
    if (!isValidVaultKey(key)) throw new VaultError('invalid_key', 'Clave no válida.');
    if (typeof this.adapter.remove !== 'function') {
      throw new VaultError('remove_unavailable', 'El almacén no permite borrar claves.');
    }
    return this.adapter.remove(key);
  }

  async getJson(key) {
    const raw = await this.getText(key);
    if (raw === null) return { ok: true, value: null };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (error) {
      return { ok: false, value: null, error };
    }
  }

  async putJson(key, value) {
    const json = JSON.stringify(value);
    await this.putText(key, json);
    return json;
  }
}
