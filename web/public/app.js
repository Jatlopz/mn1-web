/*
 * MN1 híbrido · app web
 *
 * - Vista previa del anuncio, hora 08/09 y hora personalizada.
 * - Mensaje y etiquetas editables (2–10 etiquetas orientativas).
 * - Imagen PNG tal cual la prepara Android: sin recorte, sin overlay ni marca añadida.
 * - Guardar/compartir sólo a través del puente v1. En navegador se muestra modo preview
 *   y NUNCA se simula éxito.
 *
 * La validación pura se exporta para poder revisarla con Node sin DOM.
 */

import {
  BridgeError,
  MN1_LIMITS,
  PROTOCOL_VERSION,
  createMn1Bridge,
  isValidHour,
} from './bridge.js';

export const APP_VERSION = '0.1.2';
export const HOUR_PRESETS = Object.freeze(['08:00', '09:00']);
export const DEFAULT_MESSAGE =
  'Batiseñal MN1 {hora}. Convocatoria del equipo Los Indestructibles de Sacos. ' +
  'Destinos: Telares y Extrusión.';
export const DEFAULT_TARGETS = Object.freeze(['Telares', 'Extrusión']);

const HOUR_TOKEN = '{hora}';
const MAX_IMAGE_DATA_URL = MN1_LIMITS.IMAGE_DATA_URL_MAX_LENGTH;

/* ------------------------------------------------------------------------- */
/* Lógica pura (testeable sin DOM)                                            */
/* ------------------------------------------------------------------------- */

export function textLength(value) {
  return Array.from(String(value ?? '')).length;
}

export function sanitizeHourPart(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 2);
}

export function normalizeHourDraft(hourText, minuteText) {
  const hours = sanitizeHourPart(hourText);
  const minutes = sanitizeHourPart(minuteText);
  if (hours.length === 0 || minutes.length === 0) return null;
  const hour = Number(hours);
  const minute = Number(minutes);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function hourDraftError(hourText, minuteText) {
  const hours = sanitizeHourPart(hourText);
  const minutes = sanitizeHourPart(minuteText);
  if (hours.length === 0 && minutes.length === 0) {
    return 'Escribe la hora y los minutos, de 00:00 a 23:59.';
  }
  if (hours.length === 0) return 'Falta la hora (00 a 23).';
  if (minutes.length === 0) return 'Faltan los minutos (00 a 59).';
  const hour = Number(hours);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return 'La hora debe estar entre 00 y 23.';
  const minute = Number(minutes);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return 'Los minutos deben estar entre 00 y 59.';
  return null;
}

export function splitMessage(message, hour) {
  const text = String(message ?? '');
  const parts = [];
  let cursor = 0;
  while (cursor <= text.length) {
    const index = text.indexOf(HOUR_TOKEN, cursor);
    if (index < 0) {
      if (cursor < text.length || parts.length === 0) {
        parts.push({ type: 'text', value: text.slice(cursor) });
      }
      break;
    }
    if (index > cursor) {
      parts.push({ type: 'text', value: text.slice(cursor, index) });
    }
    parts.push({ type: 'hour', value: hour });
    cursor = index + HOUR_TOKEN.length;
  }
  return parts;
}

export function normalizeTargetLabels(value) {
  if (!Array.isArray(value)
      || value.length < MN1_LIMITS.TARGETS_MIN
      || value.length > MN1_LIMITS.TARGETS_MAX) {
    return null;
  }
  const labels = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return null;
    const label = raw.trim();
    if (label.length < 1 || textLength(label) > MN1_LIMITS.LABEL_MAX_LENGTH) return null;
    labels.push(label);
  }
  return labels;
}

export function validateDraft(draft) {
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

  if (labels.length < MN1_LIMITS.TARGETS_MIN) {
    errors.targets = `Añade al menos ${MN1_LIMITS.TARGETS_MIN} etiquetas.`;
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

export function isPngDataUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IMAGE_DATA_URL) {
    return false;
  }
  return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function describeBridgeError(error) {
  if (!(error instanceof BridgeError)) {
    return 'Error inesperado al comunicarse con la app. No se asumió ningún resultado.';
  }
  switch (error.code) {
    case 'bridge_unavailable':
      return 'Vista previa: la app Android no está conectada. No se guardó ni se compartió nada.';
    case 'timeout':
      return 'La app Android no respondió a tiempo. No se asumió ningún resultado; inténtalo de nuevo desde la app.';
    case 'payload_too_large':
      return 'La petición supera el límite de 32 KB del puente. Acorta el mensaje o las etiquetas.';
    case 'unsupported_action':
      return 'Esta versión de la app no admite la acción solicitada.';
    case 'duplicate_request_id':
      return 'Se detectó una petición duplicada y no se repitió.';
    case 'invalid_result':
      return 'La app devolvió una respuesta que no cumple el contrato v1.';
    case 'native_post_failed':
      return 'No se pudo entregar la petición a Android. No se asumió ningún resultado.';
    case 'bridge_closed':
      return 'El puente se cerró antes de recibir respuesta.';
    default:
      return error.message || 'No se pudo completar la acción nativa.';
  }
}

/* ------------------------------------------------------------------------- */
/* Arranque y DOM                                                            */
/* ------------------------------------------------------------------------- */

function byId(id) {
  return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

function createDefaultDraft() {
  return {
    message: DEFAULT_MESSAGE,
    hour: HOUR_PRESETS[0],
    targetLabels: [...DEFAULT_TARGETS],
    imageDataUrl: null,
    overlay: null,
  };
}

function showStatus(dom, text, tone = 'info') {
  if (!dom.status) return;
  dom.status.hidden = false;
  dom.status.dataset.tone = tone;
  dom.status.textContent = text;
}

function showError(dom, text) {
  if (!dom.error) return;
  dom.error.hidden = false;
  dom.error.textContent = text;
}

function clearError(dom) {
  if (!dom.error) return;
  dom.error.hidden = true;
  dom.error.textContent = '';
}

function setFieldError(element, text) {
  if (!element) return;
  element.hidden = !text;
  element.textContent = text || '';
}

function renderMode(dom, app) {
  let label = 'Vista previa · sin envío';
  let mode = 'preview';
  if (app.mode === 'native') {
    if (app.connection === 'checking') {
      label = 'Conectando con la app…';
      mode = 'checking';
    } else if (app.connection === 'offline') {
      label = 'App Android sin respuesta';
      mode = 'offline';
    } else {
      label = 'App Android conectada';
      mode = 'native';
    }
  }
  dom.modeBadge.textContent = label;
  dom.modeBadge.dataset.mode = mode;
  dom.previewNote.hidden = app.mode !== 'preview';
  dom.modeBadge.title = app.mode === 'native'
    ? 'Las acciones se preparan en el teléfono. La web no confirma la entrega.'
    : 'Modo navegador: no hay puente nativo. No se guarda ni se comparte nada.';
}

function renderCounts(dom, app) {
  const messageCount = textLength(app.draft.message);
  dom.messageCount.textContent = `${messageCount} / ${MN1_LIMITS.MESSAGE_MAX_LENGTH}`;
  const labelCount = app.draft.targetLabels.length;
  dom.targetsCount.textContent = `${labelCount} / ${MN1_LIMITS.TARGETS_MAX}`;
  dom.addTarget.disabled = app.busy || labelCount >= MN1_LIMITS.TARGETS_MAX;
}

function renderHour(dom, app) {
  const hour = app.draft.hour;
  const custom = !HOUR_PRESETS.includes(hour) && isValidHour(hour);
  for (const radio of dom.hourRadios) {
    radio.checked = radio.value === hour;
    radio.disabled = app.busy;
  }
  dom.heroHour.textContent = hour;
  dom.customHour.disabled = app.busy;
  if (custom) {
    dom.customHourLabel.textContent = `Personalizada · ${hour} · Cambiar`;
    dom.customHour.setAttribute('aria-label', `Hora personalizada ${hour}. Cambiar hora`);
  } else {
    dom.customHourLabel.textContent = 'Elegir otra hora';
    dom.customHour.setAttribute('aria-label', 'Elegir una hora personalizada');
  }
}

function renderPreview(dom, app) {
  dom.previewMessage.replaceChildren();
  const message = app.draft.message;
  if (message.trim().length === 0) {
    dom.previewMessage.classList.add('is-empty');
    dom.previewMessage.textContent = 'Escribe tu mensaje para ver aquí la convocatoria.';
  } else {
    dom.previewMessage.classList.remove('is-empty');
    const fragment = document.createDocumentFragment();
    for (const part of splitMessage(message, app.draft.hour)) {
      if (part.type === 'hour') {
        const mark = document.createElement('mark');
        mark.textContent = part.value;
        fragment.append(mark);
      } else {
        fragment.append(document.createTextNode(part.value));
      }
    }
    dom.previewMessage.append(fragment);
  }

  dom.targetsSummary.replaceChildren();
  const labels = app.draft.targetLabels
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  if (labels.length === 0) {
    const chip = document.createElement('span');
    chip.className = 'target-chip';
    chip.textContent = 'Sin etiquetas';
    dom.targetsSummary.append(chip);
  } else {
    for (const label of labels) {
      const chip = document.createElement('span');
      chip.className = 'target-chip';
      chip.textContent = label;
      dom.targetsSummary.append(chip);
    }
  }
}

function renderImage(dom, app) {
  const dataUrl = app.draft.imageDataUrl;
  if (isPngDataUrl(dataUrl)) {
    if (dom.previewImage.getAttribute('src') !== dataUrl) {
      dom.previewImage.src = dataUrl;
    }
    dom.previewImage.hidden = false;
    dom.imagePlaceholder.hidden = true;
    dom.previewImage.alt = `PNG de la convocatoria con la hora ${app.draft.hour}. Sin recorte ni rótulos añadidos.`;
    dom.imageMeta.textContent = 'PNG preparado por Android · se muestra completo, sin recorte ni rótulos añadidos.';
  } else {
    dom.previewImage.removeAttribute('src');
    dom.previewImage.hidden = true;
    dom.imagePlaceholder.hidden = false;
    dom.imageMeta.textContent = app.mode === 'native'
      ? 'Aún no hay un PNG vigente. Elige o diseña la imagen en la app Android.'
      : 'La imagen se prepara en la app Android; esta vista previa no la simula.';
  }
}

function renderTargetsEditor(dom, app) {
  dom.targetsList.replaceChildren();
  app.draft.targetLabels.forEach((label, index) => {
    const row = document.createElement('div');
    row.className = 'target-row';
    row.setAttribute('role', 'listitem');

    const input = document.createElement('input');
    input.className = 'input';
    input.type = 'text';
    input.value = label;
    input.maxLength = MN1_LIMITS.LABEL_MAX_LENGTH;
    input.autocomplete = 'off';
    input.dataset.targetInput = String(index);
    input.setAttribute('aria-label', `Etiqueta ${index + 1} de ${app.draft.targetLabels.length}`);
    input.disabled = app.busy;
    if (app.validationShown
        && (label.trim().length === 0 || textLength(label.trim()) > MN1_LIMITS.LABEL_MAX_LENGTH)) {
      input.setAttribute('aria-invalid', 'true');
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'target-remove';
    remove.dataset.removeTarget = String(index);
    remove.textContent = 'Quitar';
    remove.setAttribute('aria-label', `Quitar la etiqueta ${index + 1}`);
    remove.disabled = app.busy || app.draft.targetLabels.length <= MN1_LIMITS.TARGETS_MIN;

    row.append(input, remove);
    dom.targetsList.append(row);
  });
}

function renderValidation(dom, app) {
  const validation = validateDraft(app.draft);
  const show = app.validationShown;
  setFieldError(dom.messageError, show ? validation.errors.message : '');
  setFieldError(dom.targetsError, show ? validation.errors.targets : '');
  if (dom.messageInput) {
    if (show && validation.errors.message) {
      dom.messageInput.setAttribute('aria-invalid', 'true');
    } else {
      dom.messageInput.removeAttribute('aria-invalid');
    }
  }
  if (dom.targetsList) {
    for (const input of dom.targetsList.querySelectorAll('[data-target-input]')) {
      const index = Number(input.dataset.targetInput);
      const label = String(app.draft.targetLabels[index] ?? '').trim();
      const invalid = show && (label.length === 0 || textLength(label) > MN1_LIMITS.LABEL_MAX_LENGTH);
      if (invalid) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }
}

function renderAll(dom, app, { syncFields = true } = {}) {
  if (syncFields) {
    dom.messageInput.value = app.draft.message;
    renderTargetsEditor(dom, app);
  }
  renderMode(dom, app);
  renderCounts(dom, app);
  renderHour(dom, app);
  renderPreview(dom, app);
  renderImage(dom, app);
  renderValidation(dom, app);
}

function setBusy(dom, app, busy, label = '') {
  app.busy = busy;
  dom.main.setAttribute('aria-busy', busy ? 'true' : 'false');
  dom.messageInput.disabled = busy;
  for (const radio of dom.hourRadios) radio.disabled = busy;
  dom.customHour.disabled = busy;
  dom.pickImage.disabled = busy;
  dom.openEditor.disabled = busy;
  dom.refreshState.disabled = busy;
  dom.saveTemplate.disabled = busy;
  dom.prepareShare.disabled = busy;
  dom.addTarget.disabled = busy || app.draft.targetLabels.length >= MN1_LIMITS.TARGETS_MAX;
  for (const control of dom.targetsList.querySelectorAll('[data-target-input], [data-remove-target]')) {
    control.disabled = busy;
  }
  if (busy && label) showStatus(dom, label, 'busy');
  if (!busy) {
    renderTargetsEditor(dom, app);
    renderHour(dom, app);
    renderCounts(dom, app);
    updateHourDialog(dom, app);
  }
}

function updateHourDialog(dom, app) {
  dom.hourField.value = sanitizeHourPart(dom.hourField.value);
  dom.minuteField.value = sanitizeHourPart(dom.minuteField.value);
  const normalized = normalizeHourDraft(dom.hourField.value, dom.minuteField.value);
  const error = hourDraftError(dom.hourField.value, dom.minuteField.value);
  setFieldError(dom.hourError, error);
  if (error) {
    dom.hourField.setAttribute('aria-invalid', 'true');
    dom.minuteField.setAttribute('aria-invalid', 'true');
  } else {
    dom.hourField.removeAttribute('aria-invalid');
    dom.minuteField.removeAttribute('aria-invalid');
  }
  dom.hourConfirm.disabled = app.busy || normalized === null;
  dom.hourPreview.textContent = normalized
    ? `Se usará ${normalized}. Aún no se guarda hasta que guardes o prepares el compartir.`
    : 'Escribe una hora válida, de 00:00 a 23:59.';
}

function openHourDialog(dom, app) {
  if (app.busy) return;
  const [hours = '', minutes = ''] = app.draft.hour.split(':');
  dom.hourField.value = sanitizeHourPart(hours);
  dom.minuteField.value = sanitizeHourPart(minutes);
  updateHourDialog(dom, app);
  if (typeof dom.hourDialog.showModal === 'function') {
    if (!dom.hourDialog.open) dom.hourDialog.showModal();
  } else {
    dom.hourDialog.setAttribute('open', '');
  }
  dom.hourField.focus();
  dom.hourField.select();
}

function closeHourDialog(dom) {
  if (typeof dom.hourDialog.close === 'function' && dom.hourDialog.open) {
    dom.hourDialog.close();
  } else {
    dom.hourDialog.removeAttribute('open');
  }
}

function applyNativeState(dom, app, data, { source = 'get', preserveDirty = false } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const keepLocalDraft = preserveDirty && app.dirty;
  const next = { ...app.draft };

  if (!keepLocalDraft) {
    if (typeof data.message === 'string'
        && textLength(data.message) <= MN1_LIMITS.MESSAGE_MAX_LENGTH) {
      next.message = data.message;
    }
    if (isValidHour(data.hour)) next.hour = data.hour;
    const labels = normalizeTargetLabels(data.targetLabels);
    if (labels) next.targetLabels = labels;
  }

  const hasImage = Object.prototype.hasOwnProperty.call(data, 'imageDataUrl');
  if (hasImage) {
    if (typeof data.imageDataUrl === 'string' && isPngDataUrl(data.imageDataUrl)) {
      next.imageDataUrl = data.imageDataUrl;
    } else if (data.imageDataUrl === null || data.imageDataUrl === '') {
      next.imageDataUrl = null;
    } else if (data.imageDataUrl !== undefined) {
      showStatus(dom, 'La app envió una imagen que no es un PNG válido; no se muestra.', 'warning');
    }
  } else if (source === 'get') {
    next.imageDataUrl = null;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'overlay')) {
    next.overlay = data.overlay ?? null;
  }

  app.draft = next;
  if (!keepLocalDraft) app.dirty = false;

  if (typeof data.nativeVersion === 'string' || typeof data.nativeVersion === 'number') {
    app.nativeVersion = String(data.nativeVersion);
    dom.nativeVersion.textContent = `Android ${app.nativeVersion}`;
  }

  renderAll(dom, app, { syncFields: !keepLocalDraft });
}

async function requestNative(dom, app, action, payload, { timeoutMs, silent = false } = {}) {
  try {
    const result = await app.bridge.request(action, payload, { timeoutMs });
    if (app.mode === 'native') {
      app.connection = 'connected';
      renderMode(dom, app);
    }
    return result;
  } catch (error) {
    if (error instanceof BridgeError
        && ['bridge_unavailable', 'timeout', 'native_post_failed'].includes(error.code)) {
      app.connection = 'offline';
      renderMode(dom, app);
    }
    if (!silent) showError(dom, describeBridgeError(error));
    return null;
  }
}

async function loadState(dom, app, { silent = false, preserveDirty = true, successMessage = '' } = {}) {
  if (app.refreshInFlight) return null;
  app.refreshInFlight = true;
  try {
    const result = await requestNative(dom, app, 'GET_STATE', {}, {
      timeoutMs: 12_000,
      silent,
    });
    if (!result) return null;
    if (!result.ok) {
      if (!silent) showStatus(dom, result.message || 'No se pudo leer la plantilla desde la app.', 'warning');
      return result;
    }
    applyNativeState(dom, app, result.data ?? {}, {
      source: 'get',
      preserveDirty: preserveDirty || app.dirty,
    });
    if (!silent && successMessage) showStatus(dom, successMessage, 'info');
    return result;
  } finally {
    app.refreshInFlight = false;
  }
}

async function syncTemplate(dom, app) {
  const validation = validateDraft(app.draft);
  if (!validation.ok) {
    app.validationShown = true;
    renderValidation(dom, app);
    showError(dom, 'Revisa el mensaje, la hora y las etiquetas antes de continuar.');
    return null;
  }
  app.draft.message = validation.normalized.message;
  app.draft.hour = validation.normalized.hour;
  app.draft.targetLabels = [...validation.normalized.targetLabels];

  const result = await requestNative(dom, app, 'UPDATE_TEMPLATE', {
    message: validation.normalized.message,
    hour: validation.normalized.hour,
    targetLabels: validation.normalized.targetLabels,
  }, { timeoutMs: 15_000 });
  if (!result) return null;
  if (!result.ok) {
    showStatus(dom, result.message || 'La app rechazó los cambios de la plantilla.', 'warning');
    return null;
  }
  if (result.data) {
    applyNativeState(dom, app, result.data, { source: 'update', preserveDirty: false });
  }
  app.dirty = false;
  return validation.normalized;
}

function ensureNative(dom, app) {
  app.mode = app.bridge.refreshMode() ? 'native' : 'preview';
  if (app.mode !== 'native') {
    renderMode(dom, app);
    showStatus(dom, 'Vista previa en navegador: esta acción necesita la app Android. No se guardó ni se compartió nada.', 'warning');
    return false;
  }
  if (app.protocolMismatch) {
    renderMode(dom, app);
    showStatus(dom, 'La versión web no coincide con el contrato v1. Revisa el despliegue antes de continuar.', 'warning');
    return false;
  }
  return true;
}

async function hydrate(dom, app) {
  app.connection = 'checking';
  renderMode(dom, app);
  setBusy(dom, app, true, 'Conectando con la app MN1…');
  try {
    await loadState(dom, app, {
      silent: false,
      preserveDirty: false,
      successMessage: 'Conectado a la app MN1. Revisa la plantilla; la confirmación final es en tu teléfono.',
    });
  } finally {
    setBusy(dom, app, false);
  }
}

async function handleSave(dom, app) {
  if (!ensureNative(dom, app) || app.busy) return;
  clearError(dom);
  setBusy(dom, app, true, 'Guardando la plantilla…');
  try {
    const synced = await syncTemplate(dom, app);
    if (!synced) return;
    const result = await requestNative(dom, app, 'SAVE_TEMPLATE', {}, { timeoutMs: 30_000 });
    if (!result) return;
    if (!result.ok) {
      showStatus(dom, result.message || 'No se pudo guardar la plantilla. No se asumió ningún cambio.', 'warning');
      return;
    }
    if (result.data) {
      applyNativeState(dom, app, result.data, { source: 'update', preserveDirty: false });
    }
    app.dirty = false;
    const message = (result.message || 'Plantilla guardada.').trim();
    showStatus(dom, `${message} No se ha enviado nada.`, 'success');
  } finally {
    setBusy(dom, app, false);
  }
}

async function handlePrepareShare(dom, app) {
  if (!ensureNative(dom, app) || app.busy) return;
  clearError(dom);
  setBusy(dom, app, true, 'Preparando la imagen con la hora y el compartir…');
  try {
    const synced = await syncTemplate(dom, app);
    if (!synced) return;
    const result = await requestNative(dom, app, 'PREPARE_SHARE', { slot: synced.hour }, {
      timeoutMs: MN1_LIMITS.PREPARE_SHARE_TIMEOUT_MS,
    });
    if (!result) return;
    if (!result.ok) {
      showStatus(dom, result.message || 'La app no pudo preparar el compartir. No se asumió ningún envío.', 'warning');
      return;
    }
    if (result.data) {
      applyNativeState(dom, app, result.data, { source: 'update', preserveDirty: false });
    }
    const message = (result.message || 'Listo para compartir. Confirma en tu teléfono.').trim();
    showStatus(dom, `${message} La web no confirma la entrega.`, 'success');
  } finally {
    setBusy(dom, app, false);
  }
}

async function handlePickImage(dom, app) {
  if (!ensureNative(dom, app) || app.busy) return;
  clearError(dom);
  setBusy(dom, app, true, 'Abriendo el selector de imagen…');
  try {
    const result = await requestNative(dom, app, 'PICK_IMAGE', {}, { timeoutMs: 300_000 });
    if (!result) return;
    if (!result.ok) {
      showStatus(dom, result.message || 'No se abrió el selector de imagen.', 'warning');
      return;
    }
    if (result.data) {
      applyNativeState(dom, app, result.data, { source: 'update', preserveDirty: true });
    }
    app.pendingResume = 'pick';
    showStatus(dom, result.message || 'Selector de imagen abierto. Si eliges una foto, la vista previa se actualizará.', 'info');
    window.setTimeout(() => {
      if (!app.busy && app.mode === 'native') {
        void loadState(dom, app, { silent: true, preserveDirty: true });
      }
    }, 900);
  } finally {
    setBusy(dom, app, false);
  }
}

async function handleOpenEditor(dom, app) {
  if (!ensureNative(dom, app) || app.busy) return;
  clearError(dom);
  setBusy(dom, app, true, 'Abriendo el editor nativo…');
  try {
    const synced = await syncTemplate(dom, app);
    if (!synced) return;
    const result = await requestNative(dom, app, 'OPEN_EDITOR', {}, { timeoutMs: 30_000 });
    if (!result) return;
    if (!result.ok) {
      showStatus(dom, result.message || 'No se pudo abrir el editor nativo.', 'warning');
      return;
    }
    if (result.data) {
      applyNativeState(dom, app, result.data, { source: 'update', preserveDirty: false });
    }
    app.pendingResume = 'editor';
    showStatus(dom, result.message || 'Editor nativo abierto. Al volver, la vista se actualizará.', 'info');
  } finally {
    setBusy(dom, app, false);
  }
}

async function handleRefresh(dom, app) {
  if (!ensureNative(dom, app) || app.busy) return;
  clearError(dom);
  setBusy(dom, app, true, 'Actualizando la vista desde la app…');
  try {
    await loadState(dom, app, {
      silent: false,
      preserveDirty: app.dirty,
      successMessage: 'Vista actualizada desde la app. La web no confirma la entrega.',
    });
  } finally {
    setBusy(dom, app, false);
  }
}

function handleResume(dom, app) {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  if (app.mode !== 'native' || app.busy || app.refreshInFlight) return;
  const now = Date.now();
  if (now - app.lastResumeAt < 1200) return;
  app.lastResumeAt = now;
  const resumeKind = app.pendingResume;
  const preserveDirty = resumeKind !== 'editor';
  app.pendingResume = '';
  void loadState(dom, app, { silent: true, preserveDirty }).then((result) => {
    // El PhotoPicker puede cerrarse antes de que Android termine de asentar el PNG.
    // Un segundo GET_STATE (sin inventar nada) recoge el estado vigente si ya existe.
    if (result && resumeKind === 'pick') {
      window.setTimeout(() => {
        if (!app.busy && app.mode === 'native') {
          void loadState(dom, app, { silent: true, preserveDirty: true });
        }
      }, 1600);
    }
  });
}

function readVersion(dom, app) {
  dom.versionBadge.textContent = `v${APP_VERSION}`;
  if (typeof fetch !== 'function') return;
  fetch('./version.json', { cache: 'no-store', headers: { Accept: 'application/json' } })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      if (!data || typeof data.version !== 'string' || data.version.trim().length === 0) return;
      dom.versionBadge.textContent = `v${data.version.trim()}`;
      dom.versionBadge.title = `Web ${data.version.trim()} · contrato ${data.protocol ?? '?'} · ${data.updated ?? 'sin fecha'}`;
      if (Number.isFinite(Number(data.protocol)) && Number(data.protocol) !== PROTOCOL_VERSION) {
        showStatus(dom, 'La versión web no coincide con el contrato v1. No se realizarán acciones nativas hasta revisarlo.', 'warning');
        app.protocolMismatch = true;
      }
    })
    .catch(() => {
      dom.versionBadge.textContent = `v${APP_VERSION}`;
      dom.versionBadge.title = 'No se pudo leer version.json; se muestra la versión local.';
    });
}

function boot() {
  const dom = {
    app: byId('app'),
    main: byId('contenido'),
    modeBadge: byId('mode-badge'),
    versionBadge: byId('version-badge'),
    previewNote: byId('preview-note'),
    heroHour: byId('hero-hour'),
    previewMessage: byId('preview-message'),
    previewImage: byId('preview-image'),
    imagePlaceholder: byId('image-placeholder'),
    imageMeta: byId('image-meta'),
    hourRadios: Array.from(document.querySelectorAll('[data-hour-option]')),
    customHour: byId('custom-hour'),
    customHourLabel: byId('custom-hour-label'),
    messageInput: byId('message-input'),
    messageCount: byId('message-count'),
    messageError: byId('message-error'),
    targetsList: byId('targets-list'),
    targetsCount: byId('targets-count'),
    targetsError: byId('targets-error'),
    addTarget: byId('add-target'),
    targetsSummary: byId('targets-summary'),
    pickImage: byId('pick-image'),
    openEditor: byId('open-editor'),
    refreshState: byId('refresh-state'),
    saveTemplate: byId('save-template'),
    prepareShare: byId('prepare-share'),
    status: byId('status'),
    error: byId('error'),
    hourDialog: byId('hour-dialog'),
    hourField: byId('hour-field'),
    minuteField: byId('minute-field'),
    hourError: byId('hour-error'),
    hourPreview: byId('hour-preview'),
    hourConfirm: byId('hour-confirm'),
    hourCancel: byId('hour-cancel'),
    hourClose: byId('hour-close'),
    nativeVersion: byId('native-version'),
  };

  if (!dom.main || !dom.messageInput || !dom.previewMessage) return;

  const bridge = createMn1Bridge({ root: window });
  const app = {
    bridge,
    mode: bridge.mode,
    connection: bridge.mode === 'native' ? 'checking' : 'preview',
    draft: createDefaultDraft(),
    busy: false,
    dirty: false,
    validationShown: false,
    refreshInFlight: false,
    nativeVersion: '',
    pendingResume: '',
    lastResumeAt: 0,
    protocolMismatch: false,
  };

  renderAll(dom, app);
  readVersion(dom, app);

  wireUiEvents(dom, app);

  if (app.mode === 'native') {
    void hydrate(dom, app);
  } else {
    showStatus(dom, 'Vista previa en navegador. No hay puente nativo: no se guarda ni se comparte nada desde aquí.', 'warning');
  }
}

function wireUiEvents(dom, app) {
  dom.messageInput.addEventListener('input', (event) => {
    app.draft.message = event.target.value;
    app.dirty = true;
    renderCounts(dom, app);
    renderPreview(dom, app);
    if (app.validationShown) renderValidation(dom, app);
  });

  for (const radio of dom.hourRadios) {
    radio.addEventListener('change', (event) => {
      if (!event.target.checked) return;
      app.draft.hour = event.target.value;
      app.dirty = true;
      renderHour(dom, app);
      renderPreview(dom, app);
      if (app.validationShown) renderValidation(dom, app);
    });
  }

  dom.customHour.addEventListener('click', () => openHourDialog(dom, app));

  dom.hourField.addEventListener('input', () => {
    dom.hourField.value = sanitizeHourPart(dom.hourField.value);
    updateHourDialog(dom, app);
  });
  dom.minuteField.addEventListener('input', () => {
    dom.minuteField.value = sanitizeHourPart(dom.minuteField.value);
    updateHourDialog(dom, app);
  });
  dom.hourField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      dom.minuteField.focus();
      dom.minuteField.select();
    }
  });
  dom.minuteField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !dom.hourConfirm.disabled) {
      event.preventDefault();
      dom.hourConfirm.click();
    }
  });

  dom.hourConfirm.addEventListener('click', () => {
    const normalized = normalizeHourDraft(dom.hourField.value, dom.minuteField.value);
    if (!normalized) return;
    app.draft.hour = normalized;
    app.dirty = true;
    closeHourDialog(dom);
    renderHour(dom, app);
    renderPreview(dom, app);
    if (app.validationShown) renderValidation(dom, app);
    showStatus(dom, `Hora personalizada ${normalized}. Aún no se ha guardado.`, 'info');
    dom.customHour.focus();
  });
  dom.hourCancel.addEventListener('click', () => closeHourDialog(dom));
  dom.hourClose.addEventListener('click', () => closeHourDialog(dom));
  dom.hourDialog.addEventListener('close', () => {
    dom.customHour.focus();
  });

  dom.targetsList.addEventListener('input', (event) => {
    const input = event.target.closest('[data-target-input]');
    if (!input) return;
    const index = Number(input.dataset.targetInput);
    if (!Number.isInteger(index) || index < 0 || index >= app.draft.targetLabels.length) return;
    app.draft.targetLabels[index] = input.value;
    app.dirty = true;
    renderCounts(dom, app);
    renderPreview(dom, app);
    if (app.validationShown) renderValidation(dom, app);
  });

  dom.targetsList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-target]');
    if (!button || app.busy) return;
    if (app.draft.targetLabels.length <= MN1_LIMITS.TARGETS_MIN) return;
    const index = Number(button.dataset.removeTarget);
    if (!Number.isInteger(index) || index < 0 || index >= app.draft.targetLabels.length) return;
    app.draft.targetLabels.splice(index, 1);
    app.dirty = true;
    renderTargetsEditor(dom, app);
    renderCounts(dom, app);
    renderPreview(dom, app);
    if (app.validationShown) renderValidation(dom, app);
    const nextInput = dom.targetsList.querySelector(`[data-target-input="${Math.min(index, app.draft.targetLabels.length - 1)}"]`);
    if (nextInput) nextInput.focus();
  });

  dom.addTarget.addEventListener('click', () => {
    if (app.busy || app.draft.targetLabels.length >= MN1_LIMITS.TARGETS_MAX) return;
    app.draft.targetLabels.push('');
    app.dirty = true;
    renderTargetsEditor(dom, app);
    renderCounts(dom, app);
    renderPreview(dom, app);
    if (app.validationShown) renderValidation(dom, app);
    const inputs = dom.targetsList.querySelectorAll('[data-target-input]');
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
  });

  dom.pickImage.addEventListener('click', () => void handlePickImage(dom, app));
  dom.openEditor.addEventListener('click', () => void handleOpenEditor(dom, app));
  dom.refreshState.addEventListener('click', () => void handleRefresh(dom, app));
  dom.saveTemplate.addEventListener('click', () => void handleSave(dom, app));
  dom.prepareShare.addEventListener('click', () => void handlePrepareShare(dom, app));

  dom.previewImage.addEventListener('error', () => {
    if (!dom.previewImage.getAttribute('src')) return;
    app.draft.imageDataUrl = null;
    renderImage(dom, app);
    showStatus(dom, 'No se pudo mostrar el PNG recibido. La app puede regenerarlo; no se inventa una vista previa.', 'warning');
  });

  document.addEventListener('visibilitychange', () => handleResume(dom, app));
  window.addEventListener('focus', () => handleResume(dom, app));
  window.addEventListener('mn1:native-state-changed', () => handleResume(dom, app));

  window.addEventListener('mn1:native-result', (event) => {
    const result = event?.detail;
    if (!result || typeof result !== 'object') return;
    if (result.data && (typeof result.data.nativeVersion === 'string' || typeof result.data.nativeVersion === 'number')) {
      app.nativeVersion = String(result.data.nativeVersion);
      dom.nativeVersion.textContent = `Android ${app.nativeVersion}`;
    }
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
