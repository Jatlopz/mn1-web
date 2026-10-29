import {installIsoCalendar} from './iso-calendar.js';
import {createLaminationStudio} from './lamination-studio.js';
import {createTeamToolLibrary,syncToolAvailability} from './team-tool-library.js';
import { TEAM_TOOLS, normalizeToolShortcuts, teamShortcutsKey, isToolEnabledForTeam, toolShortcutsForTeam } from './profiles.js';
import { readSelectedPlant, rememberSelectedPlant, readSelectedTeam, rememberSelectedTeam } from './profiles.js';
/*
 * MN1 híbrido · app web del workspace.
 *
 * - Catálogo de cuatro equipos y activeProfileId en WEB.
 * - Cada equipo conserva mensaje, hora, destinos, foto ORIGINAL y overlay.
 * - Persistencia: almacén privado nativo (VAULT_GET/PUT) en APK BASE; IndexedDB en navegador.
 * - Editor Canvas: posición, tamaño, fuente, color y fecha opcional.
 * - Voz: RECOGNIZE_SPEECH + parser español; sólo propone, nunca envía.
 * - APK3: se conserva el flujo anterior (plantilla única y compartir) con aviso honesto.
 * - La web nunca simula guardado nativo, selector, micrófono ni entrega.
 */

import { installThemes, installSettings, installCoffeeLink, installContactCopy } from './themes.js';
import {
  BridgeError,
  CAPABILITIES,
  MN1_LIMITS,
  PROTOCOL_VERSION,
  SPEECH_LANGUAGE,
  createMn1Bridge,
  isPngDataUrl,
  isValidHour,
  isValidVaultKey,
  normalizeCapabilities,
  pngBase64FromDataUrl,
  pngDataUrlFromBase64,
  textLength,
} from './bridge.js';
import {
  CARD_COVER_CACHE_LIMIT,
  CARD_COVER_SHADE_MAX,
  CARD_COVER_SHADE_MIN,
  CARD_COVER_THUMBNAIL_MAX_SIDE,
  DEFAULT_PROFILE_ID,
  DEFAULT_TARGETS,
  HOUR_PRESETS,
  OVERLAY_FONTS,
  OVERLAY_LIMITS,
  PROFILE_CATALOG,
  cardCoverCssVars,
  cloneTemplate,
  createCardCoverDraft,
  createCustomTeam,
  createDefaultWorkspace,
  createProfileTemplate,
  getProfileDefinition,
  isProfileId,
  migrateLegacyWorkspace,
  normalizeCardAppearance,
  normalizeDefaultHour,
  normalizeOverlay,
  normalizeQuickHours,
  normalizeTargetLabels,
  normalizeTemplate,
  normalizeWorkspaceState,
  profileCatalogForWorkspace,
  PLANTS, plantForTeam, teamsForPlant,
  setTeamArchived,
  resolveCardCoverSource,
  resolveCoverSave,
  resolveDefaultHourAfterQuickHoursEdit,
  thumbnailDimensions,
  updateProfile,
  validateCustomTeamName,
  validateDraft as validateProfileDraft,
  validateQuickHours,
} from './profiles.js';
import {
  BridgeVaultAdapter,
  MemoryVault,
  VaultClient,
  WORKSPACE_KEYS,
  coverKeyForProfile,
  createBrowserVault,
  imageKeyForProfile,
} from './storage.js';
import {
  RendererError,
  drawOverlay,
  formatDateEs,
  loadImageElement,
  prepareImageFile,
  renderCompositePng,
} from './renderer.js';
import { createMeetingReport, REPORT_PREFS_KEY, reportLogoKey } from './meeting-report.js';
import { createCloudWorkspace } from './cloud-workspace.js';
import { createProductionStudio } from './production-studio.js';
import { createProductionPdf, pdfBytesDataUrl, productionReportFileName, productionShareMessage } from './production-pdf.js';
import { recoverPendingReceive } from './cloud-model.js';
import { seedStarterImages } from './starter-templates.js';
import {
  SPEECH_EXAMPLE,
  parseSpanishCommand,
} from './voice.js';

export const APP_VERSION = '0.5.17';
export const DEFAULT_MESSAGE = getProfileDefinition(DEFAULT_PROFILE_ID).defaultMessage;

/*
 * Un único editor visual: el HERO permanece siempre visible y las herramientas
 * se abren en un drawer inferior. `null` significa drawer cerrado; nunca hay
 * dos formularios abiertos a la vez.
 */
export const EDITOR_TOOLS = Object.freeze(['hour', 'message', 'voice']);
export const WORKSPACE_VIEW_TEAMS = 'teams';
export const WORKSPACE_VIEW_OPEN = 'workspace';

const EDITOR_TOOL_TITLES = Object.freeze({
  hour: 'Hora y texto',
  message: 'Mensaje y destinos',
  voice: 'Dictado',
});

const EDITOR_TOOL_PANEL_IDS = Object.freeze({
  hour: 'editor-panel',
  message: 'template-panel',
  voice: 'voice-panel',
});

export function isEditorTool(value) {
  return typeof value === 'string' && EDITOR_TOOLS.includes(value);
}

export function resolveEditorTool(value) {
  return isEditorTool(value) ? value : null;
}

/** Alternancia de un botón de herramienta: la misma herramienta cierra el drawer. */
export function toggleEditorTool(current, requested) {
  const tool = resolveEditorTool(requested);
  if (!tool) return null;
  return resolveEditorTool(current) === tool ? null : tool;
}

export function workspaceRouteFor(profileId, options = {}) {
  if ((options.view ?? WORKSPACE_VIEW_OPEN) !== WORKSPACE_VIEW_OPEN) return '#equipos';
  return isProfileId(profileId, options) ? `#equipo/${profileId}` : '#equipos';
}

export function workspaceDocumentTitle(profileId, options = {}) {
  if ((options.view ?? WORKSPACE_VIEW_OPEN) !== WORKSPACE_VIEW_OPEN) return 'SuperTools · Equipos';
  if (options.legacy === true) return 'SuperTools · Plantilla única (APK3)';
  const definition = getProfileDefinition(profileId, options);
  return definition ? `SuperTools · ${definition.name}` : 'SuperTools · Equipo';
}

/**
 * Decide la apertura de una tarjeta de equipo. La tarjeta activa abre sin guardar;
 * un equipo distinto sólo abre si `switchProfile` confirma que guardó/cargó.
 * Es pura respecto al DOM para poder probar el orden y los bloqueos.
 */
export async function navigateToProfile(options = {}) {
  const {
    profileId,
    activeProfileId = '',
    isBusy = false,
    isListening = false,
    switchProfile,
    openProfile,
    catalog,
    reportBlocked = () => {},
  } = options;
  if (!isProfileId(profileId, { catalog })) {
    reportBlocked('invalid_profile');
    return false;
  }
  if (isBusy) {
    reportBlocked('busy');
    return false;
  }
  if (isListening) {
    reportBlocked('listening');
    return false;
  }
  if (profileId === activeProfileId) {
    openProfile?.(profileId, { switched: false });
    return true;
  }
  let switched = false;
  try {
    switched = await switchProfile?.(profileId);
  } catch {
    reportBlocked('switch_failed');
    return false;
  }
  if (switched !== true) {
    reportBlocked('switch_failed');
    return false;
  }
  openProfile?.(profileId, { switched: true });
  return true;
}

/**
 * Salida ordenada del espacio de trabajo: primero detiene la escucha vigente y
 * después espera/guarda el borrador pendiente. Nunca borra ni reemplaza el draft.
 * Sólo al final muestra la pantalla de equipos, haya terminado bien o mal el guardado.
 */
export async function leaveWorkspaceToTeams(options = {}) {
  const {
    isListening = false,
    cancelListening,
    flushSave,
    showTeams,
    onError = () => {},
  } = options;
  let ok = true;
  if (isListening && typeof cancelListening === 'function') {
    try {
      await cancelListening();
    } catch (error) {
      ok = false;
      onError(error);
    }
  }
  if (typeof flushSave === 'function') {
    try {
      const saved = await flushSave();
      if (saved === false) ok = false;
    } catch (error) {
      ok = false;
      onError(error);
    }
  }
  showTeams?.();
  return ok;
}

export {
  DEFAULT_TARGETS,
  HOUR_PRESETS,
  isPngDataUrl,
  normalizeTargetLabels,
  textLength,
};

const HOUR_TOKEN = '{hora}';
const MAX_IMAGE_DATA_URL = MN1_LIMITS.IMAGE_DATA_URL_MAX_LENGTH;

/* ------------------------------------------------------------------------- */
/* Lógica pura (testeable sin DOM)                                            */
/* ------------------------------------------------------------------------- */

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

export const OVERLAY_SIZE_STEP = 0.005;

/**
 * Paso accesible del tamaño del rótulo. Mantiene los límites de normalizeOverlay
 * y redondea a 4 decimales para que los botones no acumulen error flotante.
 */
export function stepOverlaySize(current, direction) {
  const value = Number(current);
  const base = Number.isFinite(value) ? value : OVERLAY_LIMITS.DEFAULT_SIZE;
  const delta = direction === 'bigger'
    ? OVERLAY_SIZE_STEP
    : direction === 'smaller'
      ? -OVERLAY_SIZE_STEP
      : 0;
  const next = Math.min(
    OVERLAY_LIMITS.MAX_SIZE,
    Math.max(OVERLAY_LIMITS.MIN_SIZE, base + delta),
  );
  return Number(next.toFixed(4));
}

export function canEditOverlayByPointer(options = {}) {
  const { overlay, busy = false, workspace = true, hasImage = true } = options;
  return workspace === true
    && busy !== true
    && hasImage === true
    && overlay?.locked !== true;
}

export function canMoveOverlayByPointer(dragging, overlay) {
  return dragging === true && overlay?.locked !== true;
}

export const WIDGET_OPEN_EVENT = 'mn1:widget-open';
export const WIDGET_HASH = '#widget';

export function isWidgetHash(hash) {
  return typeof hash === 'string' && hash === WIDGET_HASH;
}

/**
 * La escucha se registra antes de hidratar. Mientras el arranque no terminó, los
 * avisos fríos/calientes se guardan aquí para no perder ninguno; después se
 * entregan una sola vez en orden.
 */
export function createWidgetOpenQueue() {
  let hydrated = false;
  let pending = [];
  return {
    get hydrated() {
      return hydrated;
    },
    get pendingCount() {
      return pending.length;
    },
    enqueue(source) {
      if (hydrated) return false;
      pending.push(source);
      return true;
    },
    markHydrated() {
      hydrated = true;
      const items = pending;
      pending = [];
      return items;
    },
  };
}

/**
 * Apertura desde el widget. Nunca envía ni simula: primero confirma la hora del
 * widget, luego vacía/guarda el borrador pendiente y sólo después aplica la hora
 * y abre el editor. Si el guardado falla, no navega ni consume el origen.
 */
export async function openWidgetDefault(options = {}) {
  const {
    defaultHour,
    isBusy = false,
    isListening = false,
    flushSave,
    applyDefaultHour,
    openEditor,
    consumeHash,
    report = () => {},
  } = options;
  if (isBusy) {
    report('busy');
    return { ok: false, reason: 'busy' };
  }
  if (isListening) {
    report('listening');
    return { ok: false, reason: 'listening' };
  }
  if (!isValidHour(defaultHour)) {
    report('missing_default');
    return { ok: false, reason: 'missing_default' };
  }
  if (typeof flushSave === 'function') {
    let saved;
    try {
      saved = await flushSave();
    } catch {
      report('save_failed');
      return { ok: false, reason: 'save_failed' };
    }
    if (saved === false) {
      report('save_failed');
      return { ok: false, reason: 'save_failed' };
    }
  }
  try {
    await applyDefaultHour?.(defaultHour);
  } catch {
    report('apply_failed');
    return { ok: false, reason: 'apply_failed' };
  }
  try {
    await openEditor?.();
  } catch {
    report('open_failed');
    return { ok: false, reason: 'open_failed' };
  }
  try {
    consumeHash?.();
  } catch {
    // Consumir el hash no debe deshacer una navegación ya completada.
  }
  report('opened');
  return { ok: true, hour: defaultHour };
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

export function renderHourMessage(message, hour) {
  return String(message ?? '').split(HOUR_TOKEN).join(hour);
}

export function validateDraft(draft, options = {}) {
  return validateProfileDraft(draft, options);
}

export function validateWorkspaceDraft(draft) {
  return validateProfileDraft(draft, { minTargets: MN1_LIMITS.TARGETS_MIN_WORKSPACE });
}

export function describeBridgeError(error) {
  if (!(error instanceof BridgeError)) {
    return 'Error inesperado al comunicarse con la app. No se asumió ningún resultado.';
  }
  switch (error.code) {
    case 'bridge_unavailable':
      return 'Vista previa: la app Android no está conectada. No se guardó ni se compartió nada.';
    case 'timeout':
      return 'La app Android no respondió a tiempo. No se asumió ningún resultado; inténtalo de nuevo.';
    case 'payload_too_large':
      return 'La petición supera el límite del puente (32 KB habitual o 12 MiB para almacén/PNG). Acorta el contenido.';
    case 'unsupported_action':
      return 'Esta versión de la app no admite la acción solicitada. Actualiza a la APK BASE.';
    case 'duplicate_request_id':
      return 'Se detectó una petición duplicada y no se repitió.';
    case 'invalid_result':
      return 'La app devolvió una respuesta que no cumple el contrato v1.';
    case 'invalid_payload':
      return 'La petición no cumple el formato del contrato v1.';
    case 'native_post_failed':
      return 'No se pudo entregar la petición a Android. No se asumió ningún resultado.';
    case 'bridge_closed':
      return 'El puente se cerró antes de recibir respuesta.';
    default:
      return error.message || 'No se pudo completar la acción.';
  }
}

/* ------------------------------------------------------------------------- */
/* Miniaturas de tarjetas                                                    */
/* ------------------------------------------------------------------------- */

function defaultThumbnailCanvas() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  return document.createElement('canvas');
}

async function buildCardThumbnail(options = {}) {
  const { sourceKey, storage, loadImage, createCanvas, maxSide } = options;
  if (!storage || typeof storage.getText !== 'function') return null;
  const base64 = await storage.getText(sourceKey);
  if (typeof base64 !== 'string' || base64.length === 0) return null;
  const dataUrl = pngDataUrlFromBase64(base64);
  if (!dataUrl) return null;
  const image = await loadImage(dataUrl);
  const width = Number(image?.naturalWidth ?? image?.width);
  const height = Number(image?.naturalHeight ?? image?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null;
  }
  const size = thumbnailDimensions(width, height, maxSide);
  const canvas = createCanvas();
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, size.width, size.height);
  // La miniatura contiene sólo la foto: nunca se dibuja la hora ni un rótulo.
  ctx.drawImage(image, 0, 0, size.width, size.height);
  let thumbnail;
  try {
    thumbnail = canvas.toDataURL('image/png');
  } catch {
    return null;
  }
  return typeof thumbnail === 'string' && thumbnail.startsWith('data:image/png;base64,')
    ? thumbnail
    : null;
}

/**
 * Caché LRU de miniaturas indexada por clave privada. Comparte cargas pendientes
 * y las invalida por versión para que una promesa vieja no pinte la tarjeta de
 * otra clave u otro equipo. Nunca usa app.imageDataUrl ni la foto activa.
 */
export class CardThumbnailCache {
  constructor(options = {}) {
    this.storage = options.storage ?? null;
    this.loadImage = options.loadImage ?? loadImageElement;
    this.createCanvas = options.createCanvas ?? defaultThumbnailCanvas;
    this.maxSide = options.maxSide ?? CARD_COVER_THUMBNAIL_MAX_SIDE;
    this.maxEntries = options.maxEntries ?? CARD_COVER_CACHE_LIMIT;
    this.entries = new Map();
    this.pending = new Map();
    this.versions = new Map();
    this.profileSources = new Map();
  }

  get(sourceKey) {
    if (!sourceKey || !this.entries.has(sourceKey)) return null;
    const value = this.entries.get(sourceKey);
    this.entries.delete(sourceKey);
    this.entries.set(sourceKey, value);
    return value;
  }

  versionOf(sourceKey) {
    return this.versions.get(sourceKey) ?? 0;
  }

  invalidate(sourceKey) {
    if (!sourceKey) return;
    this.versions.set(sourceKey, this.versionOf(sourceKey) + 1);
    this.entries.delete(sourceKey);
    this.pending.delete(sourceKey);
  }

  trackProfile(profileId, sourceKey) {
    if (typeof profileId !== 'string') return;
    const previous = this.profileSources.get(profileId) ?? null;
    if (sourceKey) this.profileSources.set(profileId, sourceKey);
    else this.profileSources.delete(profileId);
    if (!previous || previous === sourceKey) return;
    const stillReferenced = [...this.profileSources.entries()]
      .some(([id, key]) => id !== profileId && key === previous);
    if (!stillReferenced) this.invalidate(previous);
  }

  async loadProfile(profileId, sourceKey) {
    this.trackProfile(profileId, sourceKey);
    return this.load(sourceKey);
  }

  async load(sourceKey) {
    if (!sourceKey) return null;
    const cached = this.get(sourceKey);
    if (cached !== null) return cached;
    if (this.pending.has(sourceKey)) return this.pending.get(sourceKey);
    const version = this.versionOf(sourceKey);
    const promise = (async () => {
      try {
        return await buildCardThumbnail({
          sourceKey,
          storage: this.storage,
          loadImage: this.loadImage,
          createCanvas: this.createCanvas,
          maxSide: this.maxSide,
        });
      } catch {
        return null;
      }
    })();
    this.pending.set(sourceKey, promise);
    try {
      const thumbnail = await promise;
      if (thumbnail && this.versionOf(sourceKey) === version) {
        this.remember(sourceKey, thumbnail);
      }
      return thumbnail;
    } finally {
      if (this.pending.get(sourceKey) === promise) this.pending.delete(sourceKey);
    }
  }

  remember(sourceKey, dataUrl) {
    if (!sourceKey || typeof dataUrl !== 'string') return;
    this.entries.delete(sourceKey);
    this.entries.set(sourceKey, dataUrl);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
  }
}

/* ------------------------------------------------------------------------- */
/* DOM y estado                                                              */
/* ------------------------------------------------------------------------- */

function byId(id) {
  return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

function toolForPanel(panel) {
  const explicit = resolveEditorTool(panel?.tool ?? panel?.element?.dataset?.editorTool);
  if (explicit) return explicit;
  const element = panel?.element ?? panel;
  const id = element?.id ?? '';
  return EDITOR_TOOLS.find((tool) => EDITOR_TOOL_PANEL_IDS[tool] === id) ?? null;
}

function editorToolPanels(dom) {
  if (Array.isArray(dom.toolPanels) && dom.toolPanels.length > 0) {
    return dom.toolPanels
      .map((panel) => ({
        tool: toolForPanel(panel),
        element: panel?.element ?? panel,
      }))
      .filter((panel) => panel.tool && panel.element);
  }
  return [
    { tool: 'hour', element: dom.editorPanel },
    { tool: 'message', element: dom.templatePanel },
    { tool: 'voice', element: dom.voicePanel },
  ].filter((panel) => Boolean(panel.element));
}

function focusEditorTool(dom, tool) {
  const button = (dom.editorTools ?? []).find(
    (item) => item?.dataset?.editorTool === tool,
  );
  if (button && typeof button.focus === 'function') button.focus();
}

function syncWorkspaceRoute(app, open, profileId, legacy) {
  if (typeof window === 'undefined') return;
  const view = open ? WORKSPACE_VIEW_OPEN : WORKSPACE_VIEW_TEAMS;
  const hash = app.teamToolsOpen && !open ? '#herramientas/'+profileId : app.plantNavigation && !open ? (app.selectedPlantId ? '#planta/'+app.selectedPlantId : '#plantas') : workspaceRouteFor(profileId, { view, catalog: app.catalog });
  try {
    if (typeof window.history?.replaceState === 'function'
        && window.location
        && window.location.hash !== hash) {
      window.history.replaceState(null, '', hash);
    }
  } catch {
    // La navegación interna sigue funcionando aunque el WebView restrinja history.
  }
  if (typeof document !== 'undefined') {
    document.title = app.teamToolsOpen && !open ? 'SuperTools · Herramientas de '+(getProfileDefinition(profileId,{catalog:app.catalog})?.name||'equipo') : app.plantNavigation && !open ? (app.selectedPlantId ? 'SuperTools · '+PLANTS.find(p=>p.id===app.selectedPlantId)?.name : 'SuperTools · Bienvenido') : workspaceDocumentTitle(profileId, { view, legacy, catalog: app.catalog });
  }
}

/**
 * Única autoridad de visibilidad del editor: teams-screen, main, HERO y drawer.
 * El HERO nunca depende de la herramienta; sólo esta función cambia `hidden` en
 * los paneles, de modo que renderAll/renderOverlayControls/renderVoice no pueden
 * volver a mostrar un formulario ajeno.
 */
function syncEditorViewport() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const height = Number(window.visualViewport?.height || window.innerHeight);
  if (Number.isFinite(height) && height > 0) document.documentElement.style.setProperty('--mn1-editor-height', height + 'px');
}

export function selectPlant(app, plantId) {
  if (!PLANTS.some(plant => plant.id === plantId)) return false;
  app.selectedPlantId = plantId;
  app.workspaceView = WORKSPACE_VIEW_TEAMS;
  return true;
}

export function handleAppBack(dom, app, root = document) {
  const dialog = [...root.querySelectorAll('dialog[open]')].at(-1);
  if (dialog) {
    const event = new Event('cancel', {cancelable:true});
    if (dialog.dispatchEvent(event)) dialog.close();
    return true;
  }
  const teamSettings = root.getElementById('team-settings');
  if (teamSettings?.open) { teamSettings.open = false; teamSettings.querySelector('summary')?.focus(); return true; }
  if (app.productionStudio?.isOpen()) { void app.productionStudio.close(); return true; }
  const admin=root.getElementById('admin-dashboard');if(admin&&!admin.hidden){root.getElementById('admin-close')?.click();return true;}
  const report = root.getElementById('report-studio');
  if (report && !report.hidden) {
    void app.reportStudio?.close();
    return true;
  }
  if (app.workspaceView === WORKSPACE_VIEW_OPEN) {
    if (app.editorTool) dom.closeTool?.click();
    else void handleBackToTeams(dom,app);
    return true;
  }
  if (app.teamToolsOpen) { app.teamToolsOpen=false;renderAll(dom,app,{syncFields:true});return true; }
  if (app.selectedPlantId) {
    app.selectedPlantId=null;
    renderAll(dom,app,{syncFields:true});
    dom.welcomeScreen?.focus();
    return true;
  }
  return false;
}

export function applyWorkspaceNavigation(dom, app) {
  syncEditorViewport();
  const open = app.workspaceView === WORKSPACE_VIEW_OPEN;
  if (open && app.plantNavigation) app.selectedPlantId = plantForTeam(getProfileDefinition(app.workspace?.activeProfileId, {catalog:app.catalog}));
  const activeTool = resolveEditorTool(app.editorTool);
  app.editorTool = activeTool;
  if(dom.main?.dataset)dom.main.dataset.activeEditorTool=activeTool??'';
  const drawerOpen = open && activeTool !== null;

  const selectingPlant = Boolean(dom.welcomeScreen) && !app.selectedPlantId && !open;
  if (dom.welcomeScreen) dom.welcomeScreen.hidden = !selectingPlant;
  if (dom.skipLink) dom.skipLink.setAttribute('href', selectingPlant ? '#welcome-screen' : open ? '#contenido' : app.teamToolsOpen ? '#team-tools-home' : '#teams-screen');
  const hub = Boolean(dom.teamToolsHome) && app.teamToolsOpen && !open;
  if (dom.teamToolsHome) dom.teamToolsHome.hidden=!hub;
  if (dom.teamsScreen) dom.teamsScreen.hidden = open || selectingPlant || hub;
  if (dom.main) dom.main.hidden = !open;

  // El chrome global no se duplica dentro del editor.
  if (dom.appHeader) dom.appHeader.hidden = open;
  if (dom.appFooter) dom.appFooter.hidden = open;
  if (dom.previewNote) dom.previewNote.hidden = open;

  // El HERO es el único contenido permanente del editor.
  if (dom.heroPanel) dom.heroPanel.hidden = !open;

  if (dom.toolDrawer) dom.toolDrawer.hidden = !drawerOpen;
  if (dom.closeTool) dom.closeTool.hidden = !drawerOpen;
  if (dom.toolTitle) {
    dom.toolTitle.textContent = activeTool ? EDITOR_TOOL_TITLES[activeTool] : 'Herramientas';
  }

  const tools = Array.isArray(dom.editorTools) ? dom.editorTools : [];
  for (const button of tools) {
    const tool = resolveEditorTool(button?.dataset?.editorTool);
    if (!tool) continue;
    const selected = open && tool === activeTool;
    button.setAttribute?.('aria-expanded', selected ? 'true' : 'false');
    const controls = button.getAttribute?.('aria-controls');
    if (!controls) {
      const panelId = EDITOR_TOOL_PANEL_IDS[tool];
      if (panelId) button.setAttribute?.('aria-controls', panelId);
    }
    if (button.classList && typeof button.classList.toggle === 'function') {
      button.classList.toggle('is-active', selected);
    }
  }

  for (const panel of editorToolPanels(dom)) {
    panel.element.hidden = !(open && panel.tool === activeTool);
  }

  const profileId = app.workspace?.activeProfileId ?? '';
  const legacy = app.uiMode === 'legacy';
  if (dom.workspaceTitle) {
    dom.workspaceTitle.textContent = legacy
      ? 'Plantilla única (APK3)'
      : (getProfileDefinition(profileId, { catalog: app.catalog })?.name ?? 'Equipo');
  }
  syncWorkspaceRoute(app, open, profileId, legacy);
}

function createDefaultDraft() {
  return cloneDraftFromProfile(createProfileTemplate(DEFAULT_PROFILE_ID));
}

function cloneDraftFromProfile(profile) {
  const quickHours = normalizeQuickHours(profile.quickHours);
  return {
    message: profile.message,
    hour: profile.hour,
    quickHours,
    defaultHour: normalizeDefaultHour(profile.defaultHour, quickHours),
    targetLabels: [...profile.targetLabels],
    overlay: { ...profile.overlay },
    imageKey: profile.imageKey,
    imageWidth: profile.imageWidth,
    imageHeight: profile.imageHeight,
    cardAppearance: { ...normalizeCardAppearance(profile.cardAppearance) },
    starterImageInitialized: profile.starterImageInitialized === true,
  };
}

function activeProfileOf(app) {
  if (!app.workspace) return null;
  return app.workspace.profiles[app.workspace.activeProfileId] ?? null;
}

function isWorkspace(app) {
  return app.uiMode === 'browser' || app.uiMode === 'workspace';
}

function canUseNative(app) {
  return app.mode === 'native' && app.bridge.refreshMode();
}

function capability(app, name) {
  return app.capabilitySet instanceof Set && app.capabilitySet.has(name);
}

function targetMinimum(app) {
  return isWorkspace(app) ? MN1_LIMITS.TARGETS_MIN_WORKSPACE : MN1_LIMITS.TARGETS_MIN;
}

function activeValidation(app) {
  return validateProfileDraft(app.draft, { minTargets: targetMinimum(app) });
}

function showStatus(dom, text, tone = 'info') {
  if (!dom.status) return;
  dom.status.hidden = false;
  dom.status.dataset.tone = tone;
  dom.status.textContent = text;
}

function showError(dom, text, app = null) {
  if (app) app.navigationError = text;
  if (dom.error) {
    dom.error.hidden = false;
    dom.error.textContent = text;
  }
  // Con main oculto, el error también debe verse en la selección de equipos.
  if (app && app.workspaceView !== WORKSPACE_VIEW_OPEN && dom.profilesNotice) {
    const notice = profilesNoticeText(app);
    dom.profilesNotice.hidden = notice.length === 0;
    dom.profilesNotice.textContent = notice;
    dom.profilesNotice.dataset.tone = 'error';
  }
}

function clearError(dom, app = null) {
  if (app) app.navigationError = '';
  if (dom.error) {
    dom.error.hidden = true;
    dom.error.textContent = '';
  }
  if (app && app.workspaceView !== WORKSPACE_VIEW_OPEN) renderProfiles(dom, app);
}

function setFieldError(element, text) {
  if (!element) return;
  element.hidden = !text;
  element.textContent = text || '';
}

function storageLabel(app) {
  return app.storage?.label || (isWorkspace(app) ? 'almacén local' : 'la app');
}

function profilesNoticeText(app) {
  const notices = [];
  if (app.uiMode === 'legacy') {
    notices.push('APK3: sólo plantilla única. Los equipos necesitan la app BASE.');
  }
  if (app.uiMode === 'offline') {
    notices.push('La app no respondió. No se modificó ni se envió nada.');
  }
  if (isWorkspace(app) && !app.persistent) {
    notices.push(
      'Sin almacén duradero: este borrador se perderá al recargar' +
      `${app.storage?.reason ? ` (${app.storage.reason})` : ''}.`,
    );
  }
  if (app.storageBlocked) {
    notices.push('Estado guardado ilegible. Pulsa «Guardar» para reemplazarlo.');
  }
  if (app.migrationNotice) notices.push(app.migrationNotice);
  if (app.navigationError) notices.push(app.navigationError);
  return notices.join(' ');
}

function renderMode(dom, app) {
  let label = 'Cargando…';
  let mode = 'checking';
  let note = '';
  if (app.uiMode === 'browser') {
    label = 'Navegador · local';
    mode = 'preview';
  } else if (app.uiMode === 'workspace') {
    label = app.connection === 'offline' ? 'App BASE sin respuesta' : 'App BASE conectada';
    mode = app.connection === 'offline' ? 'offline' : 'native';
  } else if (app.uiMode === 'legacy') {
    label = 'APK3 · compatibilidad';
    mode = 'native';
  } else if (app.uiMode === 'offline') {
    label = 'App sin respuesta';
    mode = 'offline';
    note = 'No se pudo leer el estado nativo. No se asumió ningún cambio.';
  }
  dom.modeBadge.textContent = label;
  dom.modeBadge.dataset.mode = mode;
  dom.modeBadge.title = mode === 'native'
    ? 'La app prepara la confirmación nativa. La web no confirma la entrega.'
    : 'La web no simula acciones nativas.';
  // La nota ordinaria no se duplica dentro del editor; el HERO y las acciones
  // siguen visibles y los errores importantes usan #error/#status.
  dom.previewNote.hidden = !note || app.workspaceView === WORKSPACE_VIEW_OPEN;
  if (note) dom.previewNote.textContent = note;
}

function cardThumbnailCacheFor(app) {
  if (!app.cardThumbnailCache) {
    app.cardThumbnailCache = new CardThumbnailCache({ storage: app.storage });
  } else {
    app.cardThumbnailCache.storage = app.storage ?? null;
  }
  return app.cardThumbnailCache;
}

function applyCoverMedia(image, dataUrl, sourceKey) {
  if (!image || image.dataset.coverSource !== sourceKey) return;
  image.src = dataUrl;
  image.hidden = false;
}

function renderProfiles(dom, app) {
  if (dom.addTeam) {
    dom.addTeam.hidden = !isWorkspace(app);
    dom.addTeam.disabled = app.busy === true;
  }
  if (!dom.profileList) return;
  dom.profileList.replaceChildren();
  const activeId = app.workspace?.activeProfileId
    ?? (app.uiMode === 'legacy' ? DEFAULT_PROFILE_ID : '');
  const activeDefinition = getProfileDefinition(activeId, { catalog: app.catalog });
  const selectable = isWorkspace(app) || app.uiMode === 'legacy';
  const thumbnailCache = isWorkspace(app) && app.storage
    ? cardThumbnailCacheFor(app)
    : null;
  const visibleTeams = teamsForPlant(app.catalog, app.selectedPlantId);
  const empty = document.getElementById('plant-empty'); if (empty) empty.hidden = visibleTeams.length > 0;
  const report = document.getElementById('open-report'); if (report) report.hidden = visibleTeams.length === 0;
  const plantName = PLANTS.find(p=>p.id===app.selectedPlantId)?.name || 'Sacos';
  const label = document.getElementById('selected-plant-label'); if (label) label.textContent=plantName;
  if (dom.profilesTitle) dom.profilesTitle.textContent='Equipos de '+plantName;
  for (const plant of PLANTS) {const counter=document.getElementById('plant-count-'+plant.id);if(counter){const count=teamsForPlant(app.catalog,plant.id).length;counter.textContent=count ? count+' equipo'+(count===1?'':'s') : 'Sin equipos todavía';}}
  for (const definition of visibleTeams) {
    const template = app.workspace?.profiles?.[definition.id];
    const appearance = normalizeCardAppearance(template?.cardAppearance);
    const coverSourceKey = isWorkspace(app) ? resolveCardCoverSource(template) : null;

    const wrap = document.createElement('div');
    wrap.className = 'profile-card-wrap';
    wrap.dataset.coverMode = appearance.mode;
    wrap.dataset.hasCover = coverSourceKey ? 'true' : 'false';
    for (const [property, value] of Object.entries(cardCoverCssVars(appearance))) {
      if (typeof wrap.style?.setProperty === 'function') {
        wrap.style.setProperty(property, value);
      }
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `profile-card profile-card--${definition.id}`;
    button.dataset.profileId = definition.id;
    if (definition.color && typeof button.style?.setProperty === 'function') {
      button.style.setProperty('--profile-color', definition.color);
    }
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(definition.id === activeId));
    button.disabled = app.busy || !selectable;
    if (definition.id === activeId) button.classList.add('is-active');
    button.title = app.uiMode === 'legacy'
      ? 'APK3 · abrir la plantilla única conservada'
      : `Abrir la plantilla de ${definition.name}`;

    const media = document.createElement('img');
    media.className = 'profile-card-media';
    media.alt = '';
    media.setAttribute('aria-hidden', 'true');
    media.decoding = 'async';
    media.hidden = true;
    if (coverSourceKey) media.dataset.coverSource = coverSourceKey;

    const shade = document.createElement('span');
    shade.className = 'profile-card-shade';
    shade.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'profile-name';
    name.textContent = definition.name;

    const meta = document.createElement('span');
    meta.className = 'profile-meta';
    if (app.uiMode === 'legacy') {
      meta.textContent = 'Plantilla única (APK3)';
    } else {
      const hour = isWorkspace(app) ? template?.hour : app.draft.hour;
      meta.textContent = hour ?? '--:--';
    }

    button.append(media, shade, name, meta);

    const coverButton = document.createElement('button');
    coverButton.type = 'button';
    coverButton.className = 'profile-cover-edit';
    coverButton.dataset.editCover = definition.id;
    const pencil = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pencil.setAttribute('viewBox', '0 0 24 24');
    pencil.setAttribute('aria-hidden', 'true');
    const pencilPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pencilPath.setAttribute('d', 'm15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z');
    pencilPath.setAttribute('fill', 'none');
    pencilPath.setAttribute('stroke', 'currentColor');
    pencilPath.setAttribute('stroke-width', '1.8');
    pencilPath.setAttribute('stroke-linejoin', 'round');
    pencil.append(pencilPath);
    coverButton.append(pencil);
    coverButton.setAttribute('aria-label', `Editar portada de ${definition.name}`);
    coverButton.disabled = app.busy || !isWorkspace(app);

    wrap.append(button, coverButton);
    dom.profileList.append(wrap);

    if (thumbnailCache) thumbnailCache.trackProfile(definition.id, coverSourceKey);
    if (coverSourceKey && thumbnailCache) {
      const cached = thumbnailCache.get(coverSourceKey);
      if (cached) {
        applyCoverMedia(media, cached, coverSourceKey);
      } else {
        void thumbnailCache.loadProfile(definition.id, coverSourceKey).then((thumbnail) => {
          if (thumbnail) applyCoverMedia(media, thumbnail, coverSourceKey);
        }).catch(() => {});
      }
    }
  }

  if (dom.profilesStatus) {
    if (app.uiMode === 'legacy') dom.profilesStatus.textContent = 'APK3 · plantilla única';
    else if (activeDefinition) dom.profilesStatus.textContent = activeDefinition.name;
    else dom.profilesStatus.textContent = 'Conectando…';
  }
  if (dom.profilesNotice) {
    const text = profilesNoticeText(app);
    dom.profilesNotice.hidden = text.length === 0;
    dom.profilesNotice.textContent = text;
    dom.profilesNotice.dataset.tone = app.navigationError ? 'error' : 'info';
  }
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
  const quickHours = normalizeQuickHours(app.draft.quickHours);
  const defaultHour = normalizeDefaultHour(app.draft.defaultHour, quickHours);
  const custom = !quickHours.includes(hour) && isValidHour(hour);
  dom.hourRadios.forEach((radio, index) => {
    radio.value = quickHours[index] ?? '';
    radio.checked = radio.value === hour;
    radio.disabled = app.busy;
  });
  (dom.hourLabels ?? []).forEach((label, index) => {
    label.textContent = quickHours[index] ?? '';
  });
  (dom.hourDefaultStars ?? []).forEach((star, index) => {
    star.hidden = quickHours[index] !== defaultHour;
  });
  dom.heroHour.textContent = hour || '--:--';
  dom.customHour.disabled = app.busy;
  if (dom.quickHoursEdit) dom.quickHoursEdit.disabled = app.busy;
  if (dom.widgetDefaultLabel) dom.widgetDefaultLabel.textContent = `Widget: ${defaultHour}`;
  if (dom.useDefaultHour) {
    const isPreset = quickHours.includes(hour);
    dom.useDefaultHour.hidden = !isPreset;
    dom.useDefaultHour.disabled = app.busy || defaultHour === hour;
    dom.useDefaultHour.setAttribute(
      'aria-label',
      isPreset
        ? `Usar ${hour} como hora para el widget`
        : 'La hora actual no es uno de los tres accesos',
    );
  }
  if (custom) {
    dom.customHourLabel.textContent = `${hour}`;
    dom.customHour.setAttribute('aria-label', `Hora personalizada ${hour}. Cambiar hora`);
  } else {
    dom.customHourLabel.textContent = 'Otra hora';
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
    chip.textContent = 'Sin destinos';
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
  if (isWorkspace(app)) {
    dom.previewImage.hidden = true;
    dom.previewImage.removeAttribute('src');
    if (isPngDataUrl(app.imageDataUrl)) {
      dom.canvasPreview.hidden = false;
      dom.imagePlaceholder.hidden = true;
      dom.imageMeta.textContent = 'Foto original sin hora · la hora se dibuja encima sólo en la vista y en el PNG para compartir.';
      dom.canvasPreview.setAttribute(
        'aria-label',
        `Foto original con la hora ${app.draft.hour}${app.draft.overlay.showDate ? ` y fecha ${formatDateEs(app.draft.overlay.date)}` : ''}.`,
      );
      void drawCanvasPreview(dom, app);
    } else {
      dom.canvasPreview.hidden = true;
      dom.imagePlaceholder.hidden = false;
      dom.placeholderTitle.textContent = 'Sin foto original';
      if (!canUseNative(app)) {
        dom.placeholderCopy.textContent = 'Elige una foto desde este navegador. Se guarda completa, sin hora; la hora se dibuja sólo para la vista y el PNG para compartir.';
      } else if (!capability(app, CAPABILITIES.RAW_IMAGE)) {
        dom.placeholderCopy.textContent = 'Esta app no anunció raw-image-v1. Actualiza a la BASE para importar la foto original.';
      } else {
        dom.placeholderCopy.textContent = 'Elige una foto original en la app. La copia privada se conserva sin hora.';
      }
      dom.imageMeta.textContent = 'Sin foto original en este equipo.';
    }
    return;
  }

  dom.canvasPreview.hidden = true;
  const dataUrl = app.legacyImageDataUrl;
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
    dom.placeholderTitle.textContent = 'Vista previa de la imagen';
    dom.placeholderCopy.textContent = app.uiMode === 'legacy'
      ? 'La APK3 prepara el PNG con la hora. Aquí se muestra tal cual, sin recorte ni rótulos añadidos.'
      : 'La imagen se prepara en la app Android; esta vista previa no la simula.';
    dom.imageMeta.textContent = app.uiMode === 'legacy'
      ? 'Aún no hay un PNG vigente. Elige o diseña la imagen en la app Android.'
      : 'La imagen se prepara en la app Android; esta vista previa no la simula.';
  }
}

function renderTargetsEditor(dom, app) {
  const minimum = targetMinimum(app);
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
    input.setAttribute('aria-label', `Destino ${index + 1} de ${app.draft.targetLabels.length}`);
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
    remove.setAttribute('aria-label', `Quitar el destino ${index + 1}`);
    remove.disabled = app.busy || app.draft.targetLabels.length <= minimum;

    row.append(input, remove);
    dom.targetsList.append(row);
  });
}

function choiceValue(element, property, attribute) {
  return String(element?.dataset?.[property] ?? element?.getAttribute?.(attribute) ?? '');
}

function renderOverlayControls(dom, app) {
  const overlay = app.draft.overlay;
  const disabled = app.busy || !isWorkspace(app);
  const font = OVERLAY_FONTS.includes(overlay.font) ? overlay.font : 'bold';
  const color = typeof overlay.color === 'string' ? overlay.color.toLowerCase() : '#ffffff';
  dom.overlayX.value = String(Math.round(overlay.x * 100));
  dom.overlayY.value = String(Math.round(overlay.y * 100));
  dom.overlaySize.value = String(Number((overlay.size * 100).toFixed(1)));
  dom.overlayFont.value = font;
  dom.overlayColor.value = overlay.color;
  dom.overlayShowDate.checked = overlay.showDate;
  dom.overlayDate.value = overlay.date;
  dom.overlayDateField.hidden = !overlay.showDate;
  for (const control of [
    dom.overlayX,
    dom.overlayY,
    dom.overlaySize,
    dom.overlayFont,
    dom.overlayColor,
    dom.overlayShowDate,
    dom.overlayDate,
    dom.resetOverlay,
    dom.overlaySmaller,
    dom.overlayBigger,
  ]) {
    if (control) control.disabled = disabled;
  }
  for (const button of dom.fontChoices ?? []) {
    const selected = choiceValue(button, 'fontChoice', 'data-font-choice') === font;
    button.setAttribute?.('aria-pressed', selected ? 'true' : 'false');
    if (button.classList && typeof button.classList.toggle === 'function') {
      button.classList.toggle('is-active', selected);
    }
    button.disabled = disabled;
  }
  for (const button of dom.colorChoices ?? []) {
    const selected = choiceValue(button, 'colorChoice', 'data-color-choice').toLowerCase() === color;
    button.setAttribute?.('aria-pressed', selected ? 'true' : 'false');
    if (button.classList && typeof button.classList.toggle === 'function') {
      button.classList.toggle('is-active', selected);
    }
    button.disabled = disabled;
  }
  if (dom.lockOverlay) {
    const locked = overlay.locked === true;
    dom.lockOverlay.hidden = !isWorkspace(app);
    dom.lockOverlay.disabled = disabled;
    dom.lockOverlay.setAttribute('aria-pressed', locked ? 'true' : 'false');
    dom.lockOverlay.setAttribute(
      'aria-label',
      locked ? 'Desbloquear la posición de la hora' : 'Bloquear la posición de la hora',
    );
    dom.lockOverlay.title = locked
      ? 'Posición bloqueada: la hora no se mueve al arrastrar la foto'
      : 'Bloquear la posición de la hora';
    if (dom.lockOverlay.classList && typeof dom.lockOverlay.classList.toggle === 'function') {
      dom.lockOverlay.classList.toggle('is-active', locked);
    }
    if (dom.canvasPreview?.dataset) {
      dom.canvasPreview.dataset.overlayLocked = locked ? 'true' : 'false';
    }
  }
  // La visibilidad de los paneles la decide únicamente applyWorkspaceNavigation.
}

function renderValidation(dom, app) {
  const validation = activeValidation(app);
  const show = app.validationShown;
  setFieldError(dom.messageError, show ? validation.errors.message : '');
  setFieldError(dom.targetsError, show ? validation.errors.targets : '');
  if (dom.messageInput) {
    if (show && validation.errors.message) dom.messageInput.setAttribute('aria-invalid', 'true');
    else dom.messageInput.removeAttribute('aria-invalid');
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

function renderVoice(dom, app) {
  const workspace = isWorkspace(app);
  const supported = workspace && canUseNative(app) && capability(app, CAPABILITIES.SPEECH);
  if (dom.speakToggle) {
    dom.speakToggle.disabled = app.busy || !supported;
    dom.speakToggle.textContent = app.listening ? 'Parar' : 'Hablar';
  }
  if (dom.speechStatus) {
    if (app.uiMode === 'legacy') {
      dom.speechStatus.textContent = 'APK3 no anuncia dictado web. La plantilla única sigue disponible; no se pide una APK nueva.';
    } else if (app.uiMode === 'browser') {
      dom.speechStatus.textContent = 'El dictado usa RECOGNIZE_SPEECH de la app BASE. En el navegador no se simula el micrófono.';
    } else if (!workspace) {
      dom.speechStatus.textContent = 'Abre un equipo para usar el dictado. No se simula el micrófono.';
    } else if (!capability(app, CAPABILITIES.SPEECH)) {
      dom.speechStatus.textContent = 'Esta app no anunció speech-input-v1. Actualiza a la BASE para dictar.';
    } else if (app.listening) {
      dom.speechStatus.textContent = 'Escuchando una sola frase… Pulsa «Parar» para descartar la transcripción.';
    } else {
      dom.speechStatus.textContent = `Una sesión por toque. Ejemplo: «${SPEECH_EXAMPLE}».`;
    }
  }
  renderProposal(dom, app);
  // La visibilidad de los paneles la decide únicamente applyWorkspaceNavigation.
}

function gapLabel(kind, type) {
  const labels = {
    equipo: 'el equipo',
    hora: 'la hora',
    destino: 'el destino',
    texto: 'una frase reconocible',
  };
  const name = labels[type] ?? type;
  return kind === 'ambiguity' ? `Hay más de un ${name} posible.` : `Falta ${name}.`;
}

function renderProposal(dom, app) {
  const proposal = app.proposal;
  if (!proposal) {
    dom.speechResult.hidden = true;
    dom.proposalList.replaceChildren();
    dom.applyProposal.disabled = true;
    return;
  }
  dom.speechResult.hidden = false;
  dom.speechTranscript.textContent = proposal.transcript
    ? `«${proposal.transcript}»`
    : 'Sin transcripción.';
  dom.proposalList.replaceChildren();
  if (proposal.ok) {
    const lines = [
      `Equipo: ${proposal.profileName}`,
      `Hora: ${proposal.hour}`,
      `Destinos: ${proposal.targetLabels.join(', ')}`,
      'Mensaje: se conserva el del equipo; revísalo antes de compartir.',
    ];
    for (const line of lines) {
      const item = document.createElement('li');
      item.textContent = line;
      dom.proposalList.append(item);
    }
  } else if (proposal.cancelled) {
    const item = document.createElement('li');
    item.textContent = 'La frase pide cancelar o no preparar: no se prepara ninguna propuesta.';
    dom.proposalList.append(item);
  } else {
    for (const missing of proposal.missing) {
      const item = document.createElement('li');
      item.textContent = gapLabel('missing', missing);
      dom.proposalList.append(item);
    }
    for (const ambiguous of proposal.ambiguities) {
      const item = document.createElement('li');
      item.textContent = gapLabel('ambiguity', ambiguous);
      dom.proposalList.append(item);
    }
    if (proposal.missing.length === 0 && proposal.ambiguities.length === 0) {
      const item = document.createElement('li');
      item.textContent = 'La propuesta está incompleta.';
      dom.proposalList.append(item);
    }
  }
  dom.applyProposal.disabled = app.busy || !proposal.ok || !isWorkspace(app);
}

function renderActions(dom, app) {
  const legacy = app.uiMode === 'legacy';
  dom.importImage.hidden = legacy || app.uiMode === 'offline' || app.uiMode === 'loading';
  dom.pickImage.hidden = !legacy;
  dom.openEditor.hidden = !legacy;
  dom.downloadPng.hidden = app.uiMode !== 'browser';
  dom.prepareShare.hidden = app.uiMode === 'browser';
  dom.saveTemplate.textContent = legacy ? 'Guardar plantilla' : 'Guardar';
  dom.prepareShare.textContent = 'Compartir';
  dom.prepareShare.disabled = app.busy
    || app.uiMode === 'browser'
    || app.uiMode === 'offline'
    || app.uiMode === 'loading';
  dom.prepareShare.title = app.uiMode === 'browser'
    ? 'El compartir nativo necesita la app BASE; en navegador usa «Descargar PNG».'
    : '';
  const importDisabled = app.busy
    || (canUseNative(app) && !capability(app, CAPABILITIES.RAW_IMAGE));
  dom.importImage.disabled = importDisabled;
  dom.pickImage.disabled = app.busy;
  dom.openEditor.disabled = app.busy;
  dom.downloadPng.disabled = app.busy;
  dom.saveTemplate.disabled = app.busy || app.uiMode === 'offline' || app.uiMode === 'loading';
}

function renderCapabilities(dom, app) {
  if (!dom.capabilityText) return;
  const caps = [...app.capabilitySet];
  dom.capabilityText.textContent = caps.length > 0
    ? caps.join(' · ')
    : (app.uiMode === 'browser' ? 'navegador local' : 'sin capacidades nuevas');
}

function renderAll(dom, app, { syncFields = true } = {}) {
  if (syncFields) {
    dom.messageInput.value = app.draft.message;
    renderTargetsEditor(dom, app);
  }
  renderMode(dom, app);
  renderTeamTools(dom, app);
  renderProfiles(dom, app);
  renderCounts(dom, app);
  renderHour(dom, app);
  renderPreview(dom, app);
  renderImage(dom, app);
  renderOverlayControls(dom, app);
  renderVoice(dom, app);
  renderValidation(dom, app);
  renderActions(dom, app);
  renderCapabilities(dom, app);
  applyWorkspaceNavigation(dom, app);
}

function renderBusy(dom, app, label = '') {
  const busy = app.busy === true;
  if (dom.busyOverlay) {
    dom.busyOverlay.hidden = !busy;
    dom.busyOverlay.setAttribute?.('aria-hidden', busy ? 'false' : 'true');
  }
  if (dom.busyLabel) dom.busyLabel.textContent = busy ? (label || 'Trabajando…') : '';
  for (const element of [dom.app, dom.main]) {
    if (element?.dataset) element.dataset.busy = busy ? 'true' : 'false';
  }
}

function setBusy(dom, app, busy, label = '') {
  app.busy = busy;
  dom.main.setAttribute('aria-busy', busy ? 'true' : 'false');
  renderBusy(dom, app, busy ? label : '');
  dom.messageInput.disabled = busy;
  for (const radio of dom.hourRadios) radio.disabled = busy;
  dom.customHour.disabled = busy;
  if (dom.quickHoursEdit) dom.quickHoursEdit.disabled = busy;
  if (dom.useDefaultHour) dom.useDefaultHour.disabled = busy;
  if (dom.lockOverlay) dom.lockOverlay.disabled = busy;
  if (dom.quickHoursSave) dom.quickHoursSave.disabled = busy;
  if (dom.quickHoursCancel) dom.quickHoursCancel.disabled = busy;
  for (const input of dom.quickHourInputs ?? []) input.disabled = busy;
  dom.importImage.disabled = busy;
  dom.pickImage.disabled = busy;
  dom.openEditor.disabled = busy;
  dom.refreshState.disabled = busy;
  dom.saveTemplate.disabled = busy;
  dom.prepareShare.disabled = busy;
  dom.downloadPng.disabled = busy;
  dom.speakToggle.disabled = busy;
  dom.applyProposal.disabled = busy;
  if (dom.addTeam) dom.addTeam.disabled = busy;
  if (dom.addTeamInput) dom.addTeamInput.disabled = busy;
  if (dom.addTeamCreate) dom.addTeamCreate.disabled = busy;
  if (dom.addTeamCancel) dom.addTeamCancel.disabled = busy;
  dom.addTarget.disabled = busy || app.draft.targetLabels.length >= MN1_LIMITS.TARGETS_MAX;
  for (const control of dom.targetsList.querySelectorAll('[data-target-input], [data-remove-target]')) {
    control.disabled = busy;
  }
  for (const control of dom.profileList.querySelectorAll('[data-profile-id]')) {
    control.disabled = busy || app.uiMode === 'legacy';
  }
  if (busy && label) showStatus(dom, label, 'busy');
  if (!busy) {
    renderProfiles(dom, app);
    renderTargetsEditor(dom, app);
    renderHour(dom, app);
    renderCounts(dom, app);
    renderOverlayControls(dom, app);
    renderVoice(dom, app);
    renderActions(dom, app);
    updateHourDialog(dom, app);
    applyWorkspaceNavigation(dom, app);
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

function quickHoursDraft(dom) {
  return (dom.quickHourInputs ?? []).map((input) => String(input?.value ?? ''));
}

function updateQuickHoursDialog(dom, app) {
  const check = validateQuickHours(quickHoursDraft(dom));
  setFieldError(dom.quickHoursError, check.ok ? '' : check.error);
  for (const input of dom.quickHourInputs ?? []) {
    if (check.ok) input.removeAttribute('aria-invalid');
    else input.setAttribute('aria-invalid', 'true');
  }
  const currentDefault = normalizeDefaultHour(app.draft.defaultHour, app.draft.quickHours);
  if (check.ok) {
    const resolved = resolveDefaultHourAfterQuickHoursEdit(currentDefault, check.hours);
    dom.quickHoursDefaultNote.textContent = resolved.defaultChanged
      ? `La hora del widget (${currentDefault}) no está entre los accesos. Al guardar se usará ${resolved.defaultHour}.`
      : `Hora del widget: ${resolved.defaultHour}.`;
  } else {
    dom.quickHoursDefaultNote.textContent = 'Si quitas la hora del widget, se usará la primera hora nueva.';
  }
  dom.quickHoursSave.disabled = app.busy || !check.ok;
}

function openQuickHoursDialog(dom, app) {
  if (app.busy || !isWorkspace(app)) return;
  const hours = normalizeQuickHours(app.draft.quickHours);
  (dom.quickHourInputs ?? []).forEach((input, index) => {
    input.value = hours[index] ?? '';
    input.removeAttribute('aria-invalid');
  });
  updateQuickHoursDialog(dom, app);
  if (typeof dom.quickHoursDialog.showModal === 'function') {
    if (!dom.quickHoursDialog.open) dom.quickHoursDialog.showModal();
  } else {
    dom.quickHoursDialog.setAttribute('open', '');
  }
  dom.quickHourInputs?.[0]?.focus();
}

function closeQuickHoursDialog(dom) {
  if (!dom.quickHoursDialog) return;
  if (typeof dom.quickHoursDialog.close === 'function' && dom.quickHoursDialog.open) {
    dom.quickHoursDialog.close();
  } else {
    dom.quickHoursDialog.removeAttribute('open');
  }
}

function saveQuickHoursDialog(dom, app) {
  if (app.busy || !isWorkspace(app)) return;
  const check = validateQuickHours(quickHoursDraft(dom));
  if (!check.ok) {
    updateQuickHoursDialog(dom, app);
    return;
  }
  const currentDefault = normalizeDefaultHour(app.draft.defaultHour, app.draft.quickHours);
  const resolved = resolveDefaultHourAfterQuickHoursEdit(currentDefault, check.hours);
  if (!resolved.ok) {
    updateQuickHoursDialog(dom, app);
    return;
  }
  app.draft.quickHours = [...resolved.quickHours];
  app.draft.defaultHour = resolved.defaultHour;
  markDirty(app);
  closeQuickHoursDialog(dom);
  renderHour(dom, app);
  scheduleSave(dom, app);
  showStatus(
    dom,
    resolved.defaultChanged
      ? `Accesos guardados. La hora del widget ahora es ${resolved.defaultHour}.`
      : 'Accesos de hora guardados.',
    'info',
  );
  if (dom.quickHoursEdit && typeof dom.quickHoursEdit.focus === 'function') {
    dom.quickHoursEdit.focus();
  }
}

function useCurrentHourForWidget(dom, app) {
  if (app.busy || !isWorkspace(app)) return;
  const quickHours = normalizeQuickHours(app.draft.quickHours);
  if (!quickHours.includes(app.draft.hour)) return;
  app.draft.defaultHour = app.draft.hour;
  markDirty(app);
  renderHour(dom, app);
  scheduleSave(dom, app);
  showStatus(dom, `Hora del widget: ${app.draft.hour}.`, 'info');
}

function toggleOverlayLock(dom, app) {
  if (app.busy || !isWorkspace(app)) return;
  const locked = app.draft.overlay?.locked === true;
  app.draft.overlay = normalizeOverlay({ ...app.draft.overlay, locked: !locked });
  markDirty(app);
  renderOverlayControls(dom, app);
  scheduleSave(dom, app);
  showStatus(
    dom,
    app.draft.overlay.locked
      ? 'Posición de la hora bloqueada. Puedes seguir cambiando hora, tipo y tamaño.'
      : 'Posición de la hora desbloqueada.',
    'info',
  );
}

/* ------------------------------------------------------------------------- */
/* Canvas                                                                    */
/* ------------------------------------------------------------------------- */

async function drawCanvasPreview(dom, app) {
  const dataUrl = app.imageDataUrl;
  if (!isWorkspace(app) || !isPngDataUrl(dataUrl)) return;
  const token = ++app.drawToken;
  try {
    let image = app.loadedImage;
    if (!image || app.loadedImageUrl !== dataUrl) {
      image = await loadImageElement(dataUrl);
      if (token !== app.drawToken) return;
      app.loadedImage = image;
      app.loadedImageUrl = dataUrl;
    }
    if (token !== app.drawToken || app.imageDataUrl !== dataUrl) return;
    const width = Math.max(1, Math.round(image.naturalWidth || image.width));
    const height = Math.max(1, Math.round(image.naturalHeight || image.height));
    if (dom.canvasPreview.width !== width || dom.canvasPreview.height !== height) {
      dom.canvasPreview.width = width;
      dom.canvasPreview.height = height;
    }
    const ctx = dom.canvasPreview.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    drawOverlay(ctx, width, height, app.draft.hour, app.draft.overlay);
    dom.canvasPreview.dataset.ready = 'true';
  } catch (error) {
    if (token !== app.drawToken) return;
    showStatus(dom, `No se pudo mostrar la foto original: ${error.message}`, 'warning');
  }
}

export function fittedImageRect(rect, imageWidth, imageHeight) {
  const aspect = Math.max(1, Number(imageWidth) || 1) / Math.max(1, Number(imageHeight) || 1);
  const width = Math.min(Math.max(0, rect.width), Math.max(0, rect.height) * aspect);
  const height = width / aspect;
  return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
}

function updateOverlayFromPointer(dom, app, event) {
  if (!canEditOverlayByPointer({
    overlay: app.draft.overlay,
    busy: app.busy,
    workspace: isWorkspace(app),
    hasImage: isPngDataUrl(app.imageDataUrl),
  })) return;
  const rect = fittedImageRect(dom.canvasPreview.getBoundingClientRect(), dom.canvasPreview.width, dom.canvasPreview.height);
  if (rect.width <= 0 || rect.height <= 0) return;
  const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  app.draft.overlay = normalizeOverlay({ ...app.draft.overlay, x, y });
  renderOverlayControls(dom, app);
  renderImage(dom, app);
  scheduleSave(dom, app);
}

/* ------------------------------------------------------------------------- */
/* Persistencia                                                              */
/* ------------------------------------------------------------------------- */

function markDirty(app) {
  app.dirty = true;
  app.draftRevision += 1;
}

function markUnsaved(app) {
  app.dirty = true;
}

function enqueueStorageTask(app, task) {
  // Serializa las instantáneas de estado para que una escritura lenta no pise a otra.
  const run = app.saveChain.then(task, task);
  app.saveChain = run.then(
    () => {
      app.saveFailed = false;
    },
    () => {
      app.saveFailed = true;
    },
  );
  return run;
}

function cancelScheduledSave(app) {
  if (app.saveTimer === null) return;
  clearTimeout(app.saveTimer);
  app.saveTimer = null;
}

function scheduleSave(dom, app) {
  if (!isWorkspace(app) || !app.storage) return;
  cancelScheduledSave(app);
  app.saveTimer = window.setTimeout(() => {
    app.saveTimer = null;
    void persistDraft(dom, app, { quiet: true });
  }, 700);
}

function commitDraft(app) {
  const profile = activeProfileOf(app);
  if (!profile) return null;
  const updated = updateProfile(app.workspace, app.workspace.activeProfileId, {
    ...profile,
    message: app.draft.message,
    hour: app.draft.hour,
    quickHours: normalizeQuickHours(app.draft.quickHours),
    defaultHour: normalizeDefaultHour(app.draft.defaultHour, app.draft.quickHours),
    targetLabels: [...app.draft.targetLabels],
    overlay: normalizeOverlay(app.draft.overlay),
    imageKey: app.draft.imageKey,
    imageWidth: app.draft.imageWidth,
    imageHeight: app.draft.imageHeight,
    cardAppearance: normalizeCardAppearance(app.draft.cardAppearance ?? profile.cardAppearance),
    updatedAt: new Date().toISOString(),
  });
  if (!updated) return null;
  app.workspace = updated;
  const normalized = updated.profiles[app.workspace.activeProfileId];
  app.draft.message = normalized.message;
  app.draft.hour = normalized.hour;
  app.draft.quickHours = [...normalized.quickHours];
  app.draft.defaultHour = normalized.defaultHour;
  app.draft.targetLabels = [...normalized.targetLabels];
  app.draft.overlay = { ...normalized.overlay };
  app.draft.imageKey = normalized.imageKey;
  app.draft.imageWidth = normalized.imageWidth;
  app.draft.imageHeight = normalized.imageHeight;
  app.draft.cardAppearance = { ...normalizeCardAppearance(normalized.cardAppearance) };
  return normalized;
}

function imageKeyIsReferenced(app, key) {
  if (app.draft?.imageKey === key) return true;
  if (app.draft?.cardAppearance?.imageKey === key) return true;
  return Object.values(app.workspace?.profiles ?? {})
    .some((profile) => profile.imageKey === key
      || profile.cardAppearance?.imageKey === key);
}

async function removeReplacedImages(dom, app) {
  if (!app.storage || app.pendingImageRemovals.length === 0) return;
  const pending = app.pendingImageRemovals;
  app.pendingImageRemovals = [];
  const remaining = [];
  for (const key of pending) {
    if (!key || imageKeyIsReferenced(app, key)) {
      if (key) remaining.push(key);
      continue;
    }
    try {
      await app.storage.removeText(key);
    } catch (error) {
      remaining.push(key);
      showStatus(
        dom,
        `El estado se guardó, pero no se pudo retirar la foto anterior (${error.message || 'error'}). ` +
        'No se borró ninguna clave nativa fuera del vault.',
        'warning',
      );
    }
  }
  app.pendingImageRemovals = [...new Set([...app.pendingImageRemovals, ...remaining])];
}

async function persistDraft(dom, app, options = {}) {
  const { quiet = false, force = false } = options;
  cancelScheduledSave(app);
  if (!isWorkspace(app) || !app.storage) {
    if (!quiet) showError(dom, 'Este modo no tiene un almacén disponible. No se guardó nada.');
    return false;
  }
  if (app.storageBlocked && !force) {
    if (!quiet) showStatus(dom, 'Hay un estado guardado ilegible. Pulsa «Guardar» para reemplazarlo de forma explícita.', 'warning');
    return false;
  }
  const validation = activeValidation(app);
  if (!validation.ok) {
    app.validationShown = true;
    renderValidation(dom, app);
    if (!quiet) showError(dom, 'Revisa el mensaje, la hora y los destinos antes de guardar.');
    markUnsaved(app);
    return false;
  }
  app.draft.message = validation.normalized.message;
  app.draft.hour = validation.normalized.hour;
  app.draft.targetLabels = [...validation.normalized.targetLabels];
  app.draft.overlay = normalizeOverlay(app.draft.overlay);
  const committed = commitDraft(app);
  if (!committed) {
    if (!quiet) showError(dom, 'No se pudo preparar el borrador para guardar.');
    return false;
  }
  const revision = app.draftRevision;
  const serializedState = JSON.stringify(app.workspace);
  try {
    await enqueueStorageTask(app, () => (
      app.storage.putText(WORKSPACE_KEYS.state, serializedState)
    ));
    if (app.migrationPending) {
      await markMigrated(dom, app);
      app.migrationPending = false;
    }
    app.persistedRevision = Math.max(app.persistedRevision, revision);
    app.dirty = app.draftRevision !== app.persistedRevision;
    app.persistent = app.storage.persistent !== false;
    app.storageBlocked = false;
    app.lastSavedAt = new Date().toISOString();
    if (!quiet) {
      showStatus(
        dom,
        app.persistent
          ? 'Borrador guardado.'
          : 'Borrador guardado sólo en esta sesión.',
        app.persistent ? 'success' : 'warning',
      );
    }
    await removeReplacedImages(dom, app);
    return true;
  } catch (error) {
    markUnsaved(app);
    const message = `No se pudo guardar en ${storageLabel(app)}: ${error.message || 'error'}. No se asumió ningún guardado.`;
    if (quiet) showStatus(dom, message, 'warning');
    else showError(dom, message);
    return false;
  }
}

async function readWorkspaceFromStorage(app) {
  try { await recoverPendingReceive(app.storage); } catch { app.storageBlocked=true;return {status:'corrupt',state:null}; }
  const result = await app.storage.getJson(WORKSPACE_KEYS.state);
  if (!result.ok) return { status: 'corrupt', state: null };
  if (result.value === null) return { status: 'missing', state: null };
  const state = normalizeWorkspaceState(result.value);
  return state ? { status: 'ok', state } : { status: 'corrupt', state: null };
}

async function loadActiveImage(app) {
  app.imageDataUrl = null;
  app.loadedImage = null;
  app.loadedImageUrl = '';
  if (!isWorkspace(app) || !app.workspace || !app.storage) return;
  const profile = activeProfileOf(app);
  if (!profile || !profile.imageKey) return;
  const token = ++app.imageLoadToken;
  try {
    const base64 = await app.storage.getText(profile.imageKey);
    if (token !== app.imageLoadToken) return;
    if (typeof base64 !== 'string') return;
    const dataUrl = pngDataUrlFromBase64(base64);
    if (!isPngDataUrl(dataUrl)) {
      showStatus(app.dom, 'La copia privada de la foto no es un PNG válido; no se muestra.', 'warning');
      return;
    }
    app.imageDataUrl = dataUrl;
  } catch (error) {
    if (token !== app.imageLoadToken) return;
    showStatus(app.dom, `No se pudo leer la foto original: ${error.message || 'error'}.`, 'warning');
  }
}

async function storeImportedImage(app, dataUrl, width, height) {
  if (!isPngDataUrl(dataUrl) || dataUrl.length > MAX_IMAGE_DATA_URL) {
    throw new RendererError('invalid_png', 'La imagen importada no es un PNG válido de hasta 8 MiB.');
  }
  const base64 = pngBase64FromDataUrl(dataUrl);
  if (!base64) throw new RendererError('invalid_png', 'La imagen importada no es un PNG válido.');
  const profileId = app.workspace.activeProfileId;
  const previousKey = app.draft.imageKey;
  const key = imageKeyForProfile(
    profileId,
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
  );
  await app.storage.putText(key, base64);
  app.draft.imageKey = key;
  app.draft.imageWidth = width;
  app.draft.imageHeight = height;
  if (previousKey && previousKey !== key && !app.pendingImageRemovals.includes(previousKey)) {
    app.pendingImageRemovals.push(previousKey);
  }
  markDirty(app);
  return key;
}

function readLegacyBrowserDraft() {
  if (typeof localStorage === 'undefined') return null;
  const keys = ['mn1.workspace.legacy', 'mn1.template.v1', 'mn1.template', 'mn1.draft'];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string') return parsed;
    } catch {
      // Se continúa; nunca se borra la clave anterior.
    }
  }
  return null;
}

async function hasMigrated(app) {
  try {
    return (await app.storage.getText(WORKSPACE_KEYS.migrated)) === '1';
  } catch {
    return false;
  }
}

async function markMigrated(dom, app) {
  try {
    await app.storage.putText(WORKSPACE_KEYS.migrated, '1');
  } catch (error) {
    showStatus(dom, `El workspace se guardó, pero no se pudo anotar la migración: ${error.message || 'error'}.`, 'warning');
  }
}

async function initBrowserWorkspace(dom, app) {
  const vault = await createBrowserVault();
  app.storage = new VaultClient(vault.adapter, {
    persistent: vault.persistent,
    label: vault.label,
    reason: vault.reason,
  });
  app.persistent = vault.persistent;
  const loaded = await readWorkspaceFromStorage(app);
  let state = loaded.state;
  let shouldPersist = false;
  if (loaded.status === 'corrupt') {
    app.storageBlocked = true;
    state = createDefaultWorkspace();
  } else if (!state) {
    const migrated = await hasMigrated(app);
    const legacy = migrated ? null : readLegacyBrowserDraft();
    state = legacy ? migrateLegacyWorkspace(legacy) : createDefaultWorkspace();
    if (legacy) {
      app.migrationNotice = 'Se importó la plantilla anterior a Los Indestructibles. Las claves anteriores no se borraron.';
      app.migrationPending = true;
    }
    shouldPersist = !app.storageBlocked;
  }
  if (shouldPersist) {
    try {
      await app.storage.putJson(WORKSPACE_KEYS.state, state);
      if (app.migrationPending) {
        await markMigrated(dom, app);
        app.migrationPending = false;
      }
    } catch (error) {
      app.persistent = false;
      showStatus(dom, `No se pudo crear el almacén local: ${error.message || 'error'}.`, 'warning');
    }
  }
  app.workspace = state;
  app.catalog = profileCatalogForWorkspace(state);
  app.draft = cloneDraftFromProfile(activeProfileOf(app));
  await loadActiveImage(app);
}

async function initNativeWorkspace(dom, app, legacyState) {
  try {
    app.storage = new VaultClient(new BridgeVaultAdapter(app.bridge), {
      persistent: true,
      label: 'almacén privado de la app',
    });
    app.persistent = true;
    const loaded = await readWorkspaceFromStorage(app);
    let state = loaded.state;
    if (loaded.status === 'corrupt') {
      app.storageBlocked = true;
      state = createDefaultWorkspace();
    } else if (!state) {
      const migrated = await hasMigrated(app);
      if (migrated) {
        state = createDefaultWorkspace();
      } else {
        state = migrateLegacyWorkspace(legacyState);
        if (capability(app, CAPABILITIES.RAW_IMAGE)) {
          const imageResult = await requestNative(dom, app, 'GET_LEGACY_IMAGE', {}, {
            timeoutMs: MN1_LIMITS.LEGACY_IMAGE_TIMEOUT_MS,
            silent: true,
          });
          const legacyImage = imageResult?.ok ? imageResult.data?.imageDataUrl : null;
          if (isPngDataUrl(legacyImage)) {
            try {
              const base64 = pngBase64FromDataUrl(legacyImage);
              const key = imageKeyForProfile(DEFAULT_PROFILE_ID);
              await app.storage.putText(key, base64);
              const profile = state.profiles[DEFAULT_PROFILE_ID];
              const width = Number(imageResult.data?.width);
              const height = Number(imageResult.data?.height);
              state.profiles[DEFAULT_PROFILE_ID] = normalizeTemplate({
                ...profile,
                imageKey: key,
                imageWidth: Number.isInteger(width) && width > 0 ? width : null,
                imageHeight: Number.isInteger(height) && height > 0 ? height : null,
              }, DEFAULT_PROFILE_ID);
            } catch (error) {
              showStatus(dom, `La plantilla anterior se migró, pero la foto no: ${error.message || 'error'}.`, 'warning');
            }
          }
        }
        app.migrationNotice = 'Se importó la plantilla anterior a Los Indestructibles sin borrar las claves ni la foto nativa anterior.';
        app.migrationPending = true;
      }
    }
    if (!app.storageBlocked && app.migrationPending) {
      await app.storage.putJson(WORKSPACE_KEYS.state, state);
      await markMigrated(dom, app);
      app.migrationPending = false;
    }
    app.workspace = state;
    app.catalog = profileCatalogForWorkspace(state);
    app.draft = cloneDraftFromProfile(activeProfileOf(app));
    await loadActiveImage(app);
  } catch (error) {
    app.storage = new VaultClient(new MemoryVault(), {
      persistent: false,
      label: 'memoria temporal',
      reason: error.message || 'almacén no disponible',
    });
    app.persistent = false;
    const state = migrateLegacyWorkspace(legacyState);
    app.workspace = state;
    app.catalog = profileCatalogForWorkspace(state);
    app.draft = cloneDraftFromProfile(activeProfileOf(app));
    app.migrationNotice = 'El almacén nativo no está disponible; el estado vive en memoria temporal y no se finge persistencia.';
    app.migrationPending = false;
    await loadActiveImage(app);
    showStatus(dom, `No se pudo usar el almacén nativo: ${error.message || 'error'}.`, 'warning');
  }
}

/**
 * Siembra las fotos aprobadas una sola vez por arranque, después de hidratar el
 * workspace y antes de procesar el widget. No toca estados sucios, bloqueados,
 * corruptos, ocupados o sin almacén duradero. El estado sólo se reemplaza cuando
 * el snapshot con las nuevas referencias se guardó de verdad.
 */
async function seedStarterImagesOnBoot(dom, app) {
  if (app.starterSeedState && app.starterSeedState !== 'idle') {
    return app.starterSeedResult ?? null;
  }
  if (!isWorkspace(app) || !app.workspace || !app.storage) {
    app.starterSeedState = 'done';
    return null;
  }
  if (!app.persistent || app.storage.persistent === false || app.storageBlocked
      || app.dirty || app.listening || app.busy) {
    app.starterSeedState = 'done';
    return null;
  }

  // setBusy modifica app.busy: se captura el estado previo para que la siembra
  // no se confunda con una acción en curso.
  const seedState = {
    dirty: app.dirty === true,
    listening: app.listening === true,
    busy: app.busy === true,
    storageBlocked: app.storageBlocked === true,
  };
  app.starterSeedState = 'running';
  setBusy(dom, app, true, 'Preparando las fotos de inicio…');
  let result = null;
  try {
    result = await enqueueStorageTask(app, () => seedStarterImages({
      workspace: app.workspace,
      storage: app.storage,
      persistent: app.persistent && app.storage.persistent !== false,
      storageBlocked: seedState.storageBlocked,
      dirty: seedState.dirty,
      listening: seedState.listening,
      busy: seedState.busy,
      saveWorkspace: (state) => app.storage.putText(WORKSPACE_KEYS.state, JSON.stringify(state)),
    }));
    if (result?.changed && result.workspace) {
      app.workspace = result.workspace;
      app.catalog = profileCatalogForWorkspace(app.workspace);
      app.draft = cloneDraftFromProfile(activeProfileOf(app));
      app.dirty = false;
      app.persistedRevision = app.draftRevision;
      app.storageBlocked = false;
      app.persistent = app.storage.persistent !== false;
      await loadActiveImage(app);
    }
    const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
    if (warnings.length > 0) {
      showStatus(
        dom,
        `No se pudieron preparar todas las fotos de inicio: ${warnings[0].message || 'error'}. ` +
        'Las fotos no preparadas conservan su estado anterior; se reintentará al volver a abrir.',
        'warning',
      );
    } else if (result?.seeded?.length > 0) {
      showStatus(dom, 'Fotos de inicio guardadas.', 'success');
    }
    app.starterSeedResult = result;
    return result;
  } catch (error) {
    showStatus(
      dom,
      `No se pudieron preparar las fotos de inicio: ${error?.message || 'error'}. ` +
      'No se cambió ningún equipo.',
      'warning',
    );
    return null;
  } finally {
    app.starterSeedState = 'done';
    setBusy(dom, app, false);
    renderAll(dom, app, { syncFields: false });
  }
}

export async function restoreTeamToolsSession({storage,catalog,activeProfileId,selectProfile,openTools,fromWidget=false,navigationChanged=()=>false}) {
  if(fromWidget||navigationChanged()||!storage)return false;
  const id=await readSelectedTeam(storage,{catalog});
  if(!id||navigationChanged())return false;
  if(id!==activeProfileId) {
    if(!await selectProfile(id))return false;
    if(navigationChanged()) {
      if(!await selectProfile(activeProfileId))throw Error('No se pudo recuperar la selección previa.');
      return false;
    }
  }
  if(navigationChanged())return false;
  return openTools(id)!==false;
}

function rememberTeamToolsSelection(dom,app,profileId) {
  const storage=app.storage,catalog=app.catalog;
  app.teamSelectionSave=(app.teamSelectionSave??Promise.resolve()).catch(()=>{}).then(()=>rememberSelectedTeam(storage,profileId,{catalog}));
  void app.teamSelectionSave.catch(()=>showStatus(dom,'No se pudo recordar el equipo para el próximo inicio. Tus datos se conservan.','warning'));
}

function openTeamTools(dom, app, profileId) {
  const settings = document.getElementById('team-settings');
  if (settings) settings.open = false;
  app.selectedPlantId=plantForTeam(getProfileDefinition(profileId,{catalog:app.catalog}));
  app.teamToolsOpen=true;app.workspaceView=WORKSPACE_VIEW_TEAMS;app.editorTool=null;
  rememberTeamToolsSelection(dom,app,profileId);
  renderAll(dom,app,{syncFields:true});dom.teamToolsHome?.focus();
  return true;
}

export function launchTeamTool(dom,app,id) {
  if(app.busy||app.switching)return false;
  const team=getProfileDefinition(app.workspace?.activeProfileId,{catalog:app.catalog});
  if(!isToolEnabledForTeam(id,team))return false;
  if(id==='announcement')openWorkspaceFor(dom,app,app.workspace.activeProfileId);
  if(id==='report')void app.reportStudio?.open({teamId:app.workspace.activeProfileId});
  if(id==='production'){const definition=getProfileDefinition(app.workspace.activeProfileId,{catalog:app.catalog});void app.productionStudio?.open({teamId:definition.id,teamName:definition.name,plantId:plantForTeam(definition)});}
  if(id==='lamination')void app.laminationStudio?.open({id:team.id,name:team.name});
  return true;
}
export async function readTeamLogo(storage, teamId, cache = null) {
  const raw = await storage.getText(REPORT_PREFS_KEY);
  const prefs = raw ? JSON.parse(raw) : {};
  const key = prefs.logoKeys?.[teamId];
  if (!key || !key.startsWith('mn1.report.logo.') || !isValidVaultKey(key)) return '';
  if (cache?.has(key)) return cache.get(key);
  const image = pngDataUrlFromBase64(await storage.getText(key));
  if (!isPngDataUrl(image)) throw Error('No se pudo leer el logo del equipo.');
  if (cache) { cache.set(key, image); while (cache.size > 8) cache.delete(cache.keys().next().value); }
  return image;
}

export async function saveTeamLogo(storage, teamId, dataUrl) {
  if (!isPngDataUrl(dataUrl)) throw Error('Selecciona una imagen PNG válida.');
  const raw = await storage.getText(REPORT_PREFS_KEY);
  const prefs = raw ? JSON.parse(raw) : {};
  const key = reportLogoKey(teamId);
  await storage.putText(key, pngBase64FromDataUrl(dataUrl));
  await storage.putText(REPORT_PREFS_KEY, JSON.stringify({
    ...prefs, logoKeys: { ...prefs.logoKeys, [teamId]: key },
  }));
}

async function renderTeamLogo(app, id) {
  const image = document.getElementById('team-heading-logo');
  const button = document.getElementById('team-logo-pick');
  if (!image || !button) return;
  const token = app.teamLogoToken = (app.teamLogoToken || 0) + 1;
  if (image.dataset.teamId !== id) { image.hidden = true; image.removeAttribute('src'); document.getElementById('team-logo-feedback').textContent = ''; }
  image.dataset.teamId = id || '';
  button.disabled = app.busy || app.switching || !app.storage;
  try {
    app.teamLogoCache ||= new Map();
    const url = id && app.storage ? await readTeamLogo(app.storage, id, app.teamLogoCache) : '';
    if (token !== app.teamLogoToken) return;
    image.hidden = !url;
    if (url) image.src = url; else image.removeAttribute('src');
    button.textContent = url ? 'Cambiar logo' : '+ Agregar logo';
    button.setAttribute('aria-label', (url ? 'Cambiar' : 'Agregar') + ' logo del equipo');
  } catch {
    if (token !== app.teamLogoToken) return;
    image.hidden = true;
    button.textContent = 'Elegir logo';
  }
}

function wireTeamLogo(dom, app) {
  const button = document.getElementById('team-logo-pick');
  const input = document.getElementById('team-logo-input');
  const feedback = document.getElementById('team-logo-feedback');
  const settings = document.getElementById('team-settings');
  document.addEventListener('click', event => {
    if (settings.open && !settings.contains(event.target)) settings.open = false;
  });
  settings.addEventListener('keydown', event => {
    if (event.key === 'Escape') { settings.open = false; settings.querySelector('summary').focus(); event.preventDefault(); }
  });
  let selectedTeamId = null;
  const accept = async (dataUrl, id) => {
    if (!id) throw Error('Vuelve a seleccionar el equipo.');
    await enqueueStorageTask(app, () => saveTeamLogo(app.storage, id, dataUrl));
    feedback.textContent = 'Logo guardado para este equipo.';
  };
  button.addEventListener('click', async () => {
    if (app.busy || app.switching) return;
    selectedTeamId = app.workspace.activeProfileId;
    const id = selectedTeamId;
    if (app.mode !== 'native') { input.value = ''; input.click(); return; }
    setBusy(dom, app, true);
    button.disabled = true;
    feedback.textContent = '';
    try {
      const result = await app.bridge.request('IMPORT_IMAGE', {}, {timeoutMs:300000});
      if (!result.ok) throw Error(result.message || 'No se eligió un logo.');
      await accept(result.data?.imageDataUrl, id);
    } catch (error) { feedback.textContent = error.message || 'No se pudo guardar el logo.'; }
    finally { setBusy(dom, app, false); void renderTeamLogo(app, app.workspace.activeProfileId); }
  });
  input.addEventListener('change', async () => {
    const id = selectedTeamId;
    const file = input.files?.[0];
    if (!file || app.busy || app.switching) return;
    setBusy(dom, app, true);
    button.disabled = true;
    feedback.textContent = '';
    try {
      if (file.type !== 'image/png') throw Error('Selecciona un logo en formato PNG.');
      const prepared = await prepareImageFile(file, {minDimension:1});
      await accept(prepared.dataUrl, id);
    } catch (error) { feedback.textContent = error.message || 'No se pudo guardar el logo.'; }
    finally { setBusy(dom, app, false); void renderTeamLogo(app, app.workspace.activeProfileId); }
  });
}

function renderTeamTools(dom,app) {
  if (app.teamToolsOpen) void renderTeamLogo(app, app.workspace?.activeProfileId);
  else app.teamLogoToken = (app.teamLogoToken || 0) + 1;
  if(!dom.teamToolsHome)return;
  const id=app.workspace?.activeProfileId;
  if(id && app.storage && !Object.hasOwn(app.toolShortcuts,id)) {
    app.toolShortcuts[id]=null;
    void app.storage.getText(teamShortcutsKey(id)).then(raw=>{
      app.toolShortcuts[id]=normalizeToolShortcuts(raw?JSON.parse(raw):null);renderTeamTools(dom,app);
    }).catch(()=>{document.getElementById('tools-feedback').textContent='No se pudieron leer los accesos guardados.';});
  }
  const definition=getProfileDefinition(id,{catalog:app.catalog});
  syncToolAvailability(document,definition);
  document.getElementById('team-tools-title').textContent=definition?.name||'Tu equipo';
  const grid=document.getElementById('team-shortcuts');grid.replaceChildren();
  const chosen=toolShortcutsForTeam(app.toolShortcuts?.[id],definition);
  document.getElementById('shortcuts-empty').hidden=chosen.length>0;
  for(const toolId of chosen){const tool=TEAM_TOOLS.find(t=>t.id===toolId);const button=document.createElement('button');button.type='button';button.className='team-shortcut';button.disabled=app.busy||app.switching;const icon=document.createElement('span');icon.className='shortcut-icon';icon.setAttribute('aria-hidden','true');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',toolId==='lamination'?'M5 2h14v20H5ZM8 6h8M8 10h2m4 0h2M8 14h2m4 0h2M8 18h2m4 0h2':toolId==='production'?'M3 21h18M6 17V9m6 8V3m6 14v-6':toolId==='announcement'?'M4 9h5l10-5v16L9 15H4Zm5 6 2 6H7l-2-6M19 9l3 1v4l-3 1':'M4 6h4l2-3h4l2 3h4v15H4ZM8 13a4 4 0 1 0 8 0 4 4 0 1 0-8 0');svg.append(path);icon.append(svg);button.setAttribute('aria-label',tool.name);button.title=tool.name;button.append(icon);button.addEventListener('click',()=>launchTeamTool(dom,app,toolId));grid.append(button);}
}

function openWorkspaceFor(dom, app, profileId, options = {}) {
  if (isWorkspace(app) && app.workspace
      && isProfileId(profileId, { customProfiles: app.workspace.customProfiles })
      && app.workspace.activeProfileId !== profileId) {
    return false;
  }
  app.selectedPlantId = plantForTeam(getProfileDefinition(profileId, {catalog:app.catalog}));
  app.editorTool = isEditorTool(options.tool) ? options.tool : null;
  clearError(dom, app);
  app.workspaceView = WORKSPACE_VIEW_OPEN;
  renderAll(dom, app, { syncFields: true });
  return true;
}

function showTeamsView(dom, app) {
  cancelScheduledSave(app);
  if(dom.teamToolsHome) { app.teamToolsOpen=true;renderTeamTools(dom,app); }
  app.workspaceView = WORKSPACE_VIEW_TEAMS;
  app.editorTool = null;
  applyWorkspaceNavigation(dom, app);
  renderProfiles(dom, app);
  const activeId = app.workspace?.activeProfileId;
  const activeCard = activeId && dom.profileList?.querySelector
    ? dom.profileList.querySelector(`[data-profile-id="${activeId}"]`)
    : null;
  if (activeCard && typeof activeCard.focus === 'function') activeCard.focus();
}

async function flushDraftBeforeLeaving(dom, app) {
  cancelScheduledSave(app);
  try {
    await app.saveChain;
  } catch {
    // El resultado real se evalúa con saveFailed y con el guardado explícito.
  }
  let saved = true;
  if (isWorkspace(app) && app.storage) {
    if (app.dirty) {
      const validation = activeValidation(app);
      if (validation.ok) {
        saved = await persistDraft(dom, app, { quiet: true });
      } else {
        app.validationShown = true;
        renderValidation(dom, app);
        showError(
          dom,
          'El borrador se conserva sin guardar porque el mensaje, la hora o los destinos tienen errores. Corrígelo al volver a abrir el equipo.',
          app,
        );
        saved = false;
      }
    }
  }
  if (app.saveFailed) saved = false;
  return saved;
}

async function handleBackToTeams(dom, app) {
  if (app.switching) return;
  const result = await leaveWorkspaceToTeams({
    isListening: app.listening,
    cancelListening: () => cancelSpeech(dom, app, { quiet: true }),
    flushSave: () => flushDraftBeforeLeaving(dom, app),
    showTeams: () => showTeamsView(dom, app),
    onError: (error) => showError(
      dom,
      `No se pudo completar la salida: ${error?.message || 'error'}. El borrador se conserva.`,
      app,
    ),
  });
  if (result === false && !app.navigationError) {
    showError(
      dom,
      'No se pudo confirmar el guardado, pero el borrador se conserva en esta sesión. No se envió nada.',
      app,
    );
  }
}

/**
 * Abre/cierra una herramienta del drawer. `null` cierra sin tocar el HERO ni el
 * borrador. Sólo se sincroniza el formulario que se va a mostrar.
 */
export function selectEditorTool(dom, app, tool, options = {}) {
  const next = resolveEditorTool(tool);
  app.editorTool = next;
  app.workspaceView = WORKSPACE_VIEW_OPEN;
  applyWorkspaceNavigation(dom, app);
  switch (next) {
    case 'hour':
      renderImage(dom, app);
      renderOverlayControls(dom, app);
      break;
    case 'message':
      if (dom.messageInput) dom.messageInput.value = app.draft.message;
      renderTargetsEditor(dom, app);
      renderCounts(dom, app);
      renderValidation(dom, app);
      break;
    case 'voice':
      renderVoice(dom, app);
      break;
    default:
      // Drawer cerrado: el HERO sigue visible y el borrador no cambia.
      break;
  }
  if (options.focus && next) focusEditorTool(dom, next);
  return next;
}

async function switchWorkspaceProfile(dom, app, profileId, options = {}) {
  if (!isWorkspace(app)) return false;
  if (!isProfileId(profileId, { customProfiles: app.workspace?.customProfiles })) {
    showStatus(dom, 'El equipo solicitado no está en el catálogo.', 'warning');
    return false;
  }
  if (app.switching || app.busy) return false;
  if (profileId === app.workspace.activeProfileId && typeof options.mutate !== 'function') return true;
  cancelScheduledSave(app);

  const validation = activeValidation(app);
  if (!validation.ok) {
    app.validationShown = true;
    renderValidation(dom, app);
    showError(dom, 'Corrige el mensaje, la hora y los destinos antes de cambiar de equipo. No se perdió nada.', app);
    return false;
  }

  app.draft.message = validation.normalized.message;
  app.draft.hour = validation.normalized.hour;
  app.draft.targetLabels = [...validation.normalized.targetLabels];
  const committed = commitDraft(app);
  if (!committed) {
    showError(dom, 'No se pudo preparar el equipo actual para guardarlo.', app);
    return false;
  }
  const committedRevision = app.draftRevision;

  const next = {
    ...app.workspace,
    activeProfileId: profileId,
    profiles: { ...app.workspace.profiles },
  };
  if (typeof options.mutate === 'function') {
    const patched = options.mutate(cloneTemplate(next.profiles[profileId]));
    next.profiles[profileId] = normalizeTemplate(patched, profileId, {
      customProfiles: app.workspace.customProfiles,
    });
  }
  const serializedNext = JSON.stringify(next);

  app.switching = true;
  setBusy(dom, app, true, 'Guardando el equipo actual y cambiando de equipo…');
  try {
    await enqueueStorageTask(app, async () => {
      if (app.saveFailed) {
        throw new Error('previous_save_failed');
      }
      await app.storage.putText(WORKSPACE_KEYS.state, serializedNext);
    });
    app.workspace = next;
    app.draft = cloneDraftFromProfile(next.profiles[profileId]);
    app.persistedRevision = Math.max(app.persistedRevision, committedRevision);
    app.dirty = app.draftRevision !== app.persistedRevision;
    app.storageBlocked = false;
    app.proposal = null;
    renderAll(dom, app, { syncFields: true });
    await loadActiveImage(app);
    renderImage(dom, app);
    renderProfiles(dom, app);
    await removeReplacedImages(dom, app);
    const definition = getProfileDefinition(profileId, {
      customProfiles: app.workspace.customProfiles,
    });
    showStatus(dom, `Equipo activo: ${definition?.name ?? profileId}.`, 'success');
    return true;
  } catch (error) {
    markUnsaved(app);
    if (error?.message === 'previous_save_failed') {
      showError(dom, 'No se cambió de equipo: el guardado anterior no se completó. Guarda el borrador actual y vuelve a intentarlo.', app);
    } else {
      showError(dom, `No se pudo cambiar de equipo: ${error.message || 'error'}. Se conserva el equipo actual.`, app);
    }
    return false;
  } finally {
    app.switching = false;
    setBusy(dom, app, false);
  }
}

/* ------------------------------------------------------------------------- */
/* Puente nativo                                                             */
/* ------------------------------------------------------------------------- */

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

function applyNativeMeta(dom, app, data) {
  if (typeof data.nativeVersion === 'string' || typeof data.nativeVersion === 'number') {
    app.nativeVersion = String(data.nativeVersion);
    dom.nativeVersion.textContent = `Android ${app.nativeVersion}`;
  }
  app.capabilitySet = new Set(normalizeCapabilities(data.capabilities));
  renderCapabilities(dom, app);
}

function applyLegacyState(dom, app, data, { preserveDirty = false } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const keepLocalDraft = preserveDirty && app.dirty;
  const next = { ...app.draft };
  if (!keepLocalDraft) {
    if (typeof data.message === 'string' && textLength(data.message) <= MN1_LIMITS.MESSAGE_MAX_LENGTH) {
      next.message = data.message;
    }
    if (isValidHour(data.hour)) next.hour = data.hour;
    const labels = normalizeTargetLabels(data.targetLabels);
    if (labels) next.targetLabels = labels;
  }
  const hasImage = Object.prototype.hasOwnProperty.call(data, 'imageDataUrl');
  if (hasImage) {
    if (typeof data.imageDataUrl === 'string' && isPngDataUrl(data.imageDataUrl)) {
      app.legacyImageDataUrl = data.imageDataUrl;
    } else if (data.imageDataUrl === null || data.imageDataUrl === '') {
      app.legacyImageDataUrl = null;
    } else if (data.imageDataUrl !== undefined) {
      showStatus(dom, 'La app envió una imagen que no es un PNG válido; no se muestra.', 'warning');
    }
  } else if (!preserveDirty) {
    app.legacyImageDataUrl = null;
  }
  app.draft = next;
  app.dirty = keepLocalDraft ? app.dirty : false;
  renderAll(dom, app, { syncFields: !keepLocalDraft });
}

async function loadLegacyState(dom, app, options = {}) {
  const { silent = false, preserveDirty = true, successMessage = '' } = options;
  if (app.refreshInFlight) return null;
  app.refreshInFlight = true;
  try {
    const result = await requestNative(dom, app, 'GET_STATE', {}, { timeoutMs: 12_000, silent });
    if (!result) return null;
    if (!result.ok) {
      if (!silent) showStatus(dom, result.message || 'No se pudo leer la plantilla desde la app.', 'warning');
      return result;
    }
    applyNativeMeta(dom, app, result.data ?? {});
    applyLegacyState(dom, app, result.data ?? {}, {
      preserveDirty: preserveDirty || app.dirty,
    });
    if (!silent && successMessage) showStatus(dom, successMessage, 'info');
    return result;
  } finally {
    app.refreshInFlight = false;
  }
}

function ensureNative(dom, app) {
  const native = app.bridge.refreshMode();
  app.mode = native ? 'native' : 'preview';
  if (!native) {
    renderMode(dom, app);
    showStatus(dom, 'Esta acción necesita la app Android. En el navegador no se simula ningún guardado ni envío.', 'warning');
    return false;
  }
  if (app.protocolMismatch) {
    renderMode(dom, app);
    showStatus(dom, 'La versión web no coincide con el contrato v1. Revisa el despliegue antes de continuar.', 'warning');
    return false;
  }
  return true;
}

async function syncLegacyTemplate(dom, app) {
  const validation = validateProfileDraft(app.draft);
  if (!validation.ok) {
    app.validationShown = true;
    renderValidation(dom, app);
    showError(dom, 'Revisa el mensaje, la hora y los destinos antes de continuar.');
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
  if (result.data) applyLegacyState(dom, app, result.data, { preserveDirty: false });
  app.dirty = false;
  return validation.normalized;
}

async function handleLegacySave(dom, app) {
  if (!ensureNative(dom, app) || app.busy) return;
  clearError(dom);
  setBusy(dom, app, true, 'Guardando la plantilla…');
  try {
    const synced = await syncLegacyTemplate(dom, app);
    if (!synced) return;
    const result = await requestNative(dom, app, 'SAVE_TEMPLATE', {}, { timeoutMs: 30_000 });
    if (!result) return;
    if (!result.ok) {
      showStatus(dom, result.message || 'No se pudo guardar la plantilla. No se asumió ningún cambio.', 'warning');
      return;
    }
    if (result.data) applyLegacyState(dom, app, result.data, { preserveDirty: false });
    app.dirty = false;
    showStatus(dom, 'Plantilla guardada.', 'success');
  } finally {
    setBusy(dom, app, false);
  }
}

async function handleLegacyShare(dom, app) {
  if (!ensureNative(dom, app) || app.busy) return;
  clearError(dom);
  setBusy(dom, app, true, 'Preparando la imagen con la hora y el compartir…');
  try {
    const synced = await syncLegacyTemplate(dom, app);
    if (!synced) return;
    const result = await requestNative(dom, app, 'PREPARE_SHARE', { slot: synced.hour }, {
      timeoutMs: MN1_LIMITS.PREPARE_SHARE_TIMEOUT_MS,
    });
    if (!result) return;
    if (!result.ok) {
      showStatus(dom, result.message || 'La app no pudo preparar el compartir. No se asumió ningún envío.', 'warning');
      return;
    }
    if (result.data) applyLegacyState(dom, app, result.data, { preserveDirty: false });
    showStatus(dom, 'Listo para compartir.', 'success');
  } finally {
    setBusy(dom, app, false);
  }
}

async function handleLegacyPickImage(dom, app) {
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
    if (result.data) applyLegacyState(dom, app, result.data, { preserveDirty: true });
    app.pendingResume = 'pick';
    showStatus(dom, result.message || 'Selector de imagen abierto. Si eliges una foto, la vista previa se actualizará.', 'info');
    window.setTimeout(() => {
      if (!app.busy && app.mode === 'native') {
        void loadLegacyState(dom, app, { silent: true, preserveDirty: true });
      }
    }, 900);
  } finally {
    setBusy(dom, app, false);
  }
}

async function handleLegacyOpenEditor(dom, app) {
  if (!ensureNative(dom, app) || app.busy) return;
  clearError(dom);
  setBusy(dom, app, true, 'Abriendo el editor nativo…');
  try {
    const synced = await syncLegacyTemplate(dom, app);
    if (!synced) return;
    const result = await requestNative(dom, app, 'OPEN_EDITOR', {}, { timeoutMs: 30_000 });
    if (!result) return;
    if (!result.ok) {
      showStatus(dom, result.message || 'No se pudo abrir el editor nativo.', 'warning');
      return;
    }
    if (result.data) applyLegacyState(dom, app, result.data, { preserveDirty: false });
    app.pendingResume = 'editor';
    showStatus(dom, result.message || 'Editor nativo abierto. Al volver, la vista se actualizará.', 'info');
  } finally {
    setBusy(dom, app, false);
  }
}

/* ------------------------------------------------------------------------- */
/* Equipos personalizados                                                    */
/* ------------------------------------------------------------------------- */

function setAddTeamError(dom, text) {
  setFieldError(dom.addTeamError, text);
  if (!dom.addTeamInput) return;
  if (text) dom.addTeamInput.setAttribute('aria-invalid', 'true');
  else dom.addTeamInput.removeAttribute('aria-invalid');
}

function openAddTeamDialog(dom, app) {
  if (app.busy || app.switching) {
    showStatus(dom, 'Espera a que termine la acción actual antes de crear un equipo.', 'warning');
    return;
  }
  if (!isWorkspace(app) || !app.workspace) {
    showStatus(dom, 'Los equipos personalizados necesitan el workspace web y su almacén.', 'warning');
    return;
  }
  const restore = document.getElementById('restore-team-select');
  restore.replaceChildren();
  for (const id of app.workspace.archivedProfileIds || []) {
    const option = document.createElement('option'); option.value = id;
    option.textContent = getProfileDefinition(id, {customProfiles:app.workspace.customProfiles})?.name || id;
    restore.append(option);
  }
  document.getElementById('restore-team-section').hidden = !restore.options.length;
  document.getElementById('add-team-help').textContent='El equipo se creará en '+(PLANTS.find(p=>p.id===app.selectedPlantId)?.name || 'Sacos')+' con su propia plantilla.';
  app.addTeamSubmitted = false;
  if (dom.addTeamInput) {
    dom.addTeamInput.value = '';
    dom.addTeamInput.disabled = false;
  }
  if (dom.addTeamCreate) dom.addTeamCreate.disabled = false;
  if (dom.addTeamCancel) dom.addTeamCancel.disabled = false;
  setAddTeamError(dom, '');
  if (dom.addTeamDialog) {
    if (typeof dom.addTeamDialog.showModal === 'function') {
      if (!dom.addTeamDialog.open) dom.addTeamDialog.showModal();
    } else {
      dom.addTeamDialog.setAttribute('open', '');
    }
  }
  if (dom.addTeamInput) {
    dom.addTeamInput.focus();
    if (typeof dom.addTeamInput.select === 'function') dom.addTeamInput.select();
  }
}

function closeAddTeamDialog(dom) {
  if (!dom.addTeamDialog) return;
  if (typeof dom.addTeamDialog.close === 'function' && dom.addTeamDialog.open) {
    dom.addTeamDialog.close();
  } else {
    dom.addTeamDialog.removeAttribute('open');
  }
}

function validateAddTeamDraft(dom, app) {
  const result = validateCustomTeamName(app.workspace, dom.addTeamInput?.value ?? '');
  setAddTeamError(dom, result.ok ? '' : result.error);
  return result;
}

async function handleCreateTeam(dom, app) {
  if (!isWorkspace(app) || !app.workspace || !app.storage) {
    setAddTeamError(dom, 'No hay un workspace con almacén disponible para crear el equipo.');
    return;
  }
  if (app.busy || app.switching) {
    setAddTeamError(dom, 'Espera a que termine la acción actual antes de crear un equipo.');
    return;
  }
  clearError(dom, app);
  app.addTeamSubmitted = true;
  const check = validateAddTeamDraft(dom, app);
  if (!check.ok) {
    dom.addTeamInput?.focus();
    return;
  }
  if (app.storageBlocked) {
    setAddTeamError(
      dom,
      'No se creó el equipo: hay un estado guardado ilegible. Guárdalo explícitamente para reemplazarlo primero.',
    );
    return;
  }
  if (app.dirty) {
    const saved = await flushDraftBeforeLeaving(dom, app);
    if (!saved) {
      setAddTeamError(dom, 'No se creó el equipo: corrige y guarda el borrador actual primero.');
      showError(
        dom,
        'No se creó el equipo. El borrador actual se conserva y no se reemplazó ningún equipo.',
        app,
      );
      return;
    }
  }
  const created = createCustomTeam(app.workspace, check.name, {plantId:app.selectedPlantId});
  if (!created.ok) {
    setAddTeamError(dom, created.error);
    return;
  }
  setBusy(dom, app, true, 'Creando el equipo nuevo…');
  try {
    await enqueueStorageTask(app, async () => {
      if (app.saveFailed) throw new Error('previous_save_failed');
      await app.storage.putText(WORKSPACE_KEYS.state, JSON.stringify(created.state));
    });
    app.workspace = created.state;
    app.catalog = profileCatalogForWorkspace(created.state);
    app.draft = cloneDraftFromProfile(created.state.profiles[created.profileId]);
    app.teamToolsOpen=true;
    rememberTeamToolsSelection(dom,app,created.profileId);
    app.workspaceView = WORKSPACE_VIEW_TEAMS;
    app.editorTool = null;
    app.dirty = false;
    app.persistedRevision = app.draftRevision;
    app.storageBlocked = false;
    app.persistent = app.storage.persistent !== false;
    app.proposal = null;
    app.imageDataUrl = null;
    app.loadedImage = null;
    app.loadedImageUrl = '';
    app.drawToken += 1;
    app.addTeamSubmitted = false;
    closeAddTeamDialog(dom);
    renderAll(dom, app, { syncFields: true });
    await loadActiveImage(app);
    renderImage(dom, app);
    showStatus(dom, `Equipo «${created.definition.name}» creado.`, 'success');
  } catch (error) {
    const message = error?.message === 'previous_save_failed'
      ? 'No se creó el equipo: el guardado anterior no se completó.'
      : `No se pudo guardar el equipo nuevo: ${error.message || 'error'}.`;
    setAddTeamError(dom, message);
    showError(dom, `${message} No se asumió ningún cambio.`, app);
  } finally {
    setBusy(dom, app, false);
  }
}

/* ------------------------------------------------------------------------- */
/* Portada de equipo                                                         */
/* ------------------------------------------------------------------------- */

function coverProfileOf(app, draft) {
  if (!draft || !app.workspace?.profiles) return null;
  return app.workspace.profiles[draft.profileId] ?? null;
}

function setCoverError(dom, text) {
  if (!dom.coverError) return;
  dom.coverError.hidden = !text;
  dom.coverError.textContent = text || '';
}

function coverDraftSourceKey(profile, draft) {
  if (!draft) return null;
  if (draft.mode === 'custom') return draft.imageKey;
  if (draft.mode === 'announcement') {
    return profile && isValidVaultKey(profile.imageKey) ? profile.imageKey : null;
  }
  return null;
}

function coverPreviewEmpty(dom, text) {
  if (!dom.coverPreview) return;
  const empty = document.createElement('span');
  empty.className = 'cover-preview-empty';
  empty.textContent = text;
  dom.coverPreview.replaceChildren(empty);
}

function renderCoverPreview(dom, app) {
  const draft = app.coverDraft;
  if (!draft || !dom.coverPreview) return;
  const token = (draft.previewToken ?? 0) + 1;
  draft.previewToken = token;
  const profile = coverProfileOf(app, draft);
  const appearance = {
    mode: draft.mode,
    imageKey: draft.mode === 'custom' ? draft.imageKey : null,
    blur: draft.blur,
    shade: draft.shade,
  };
  for (const [property, value] of Object.entries(cardCoverCssVars(appearance))) {
    if (typeof dom.coverPreview.style?.setProperty === 'function') {
      dom.coverPreview.style.setProperty(property, value);
    }
  }
  dom.coverPreview.dataset.coverMode = draft.mode;

  const showImage = (src) => {
    if (app.coverDraft !== draft || draft.previewToken !== token) return;
    if (typeof src !== 'string' || src.length === 0) return;
    const image = document.createElement('img');
    image.className = 'cover-preview-image';
    image.alt = '';
    image.src = src;
    dom.coverPreview.replaceChildren(image);
  };

  if (draft.mode === 'custom' && draft.pendingImage?.dataUrl) {
    showImage(draft.pendingImage.dataUrl);
    return;
  }
  const sourceKey = coverDraftSourceKey(profile, draft);
  if (!sourceKey || !app.storage) {
    coverPreviewEmpty(dom, 'Sin imagen');
    return;
  }
  const cache = cardThumbnailCacheFor(app);
  const cached = cache.get(sourceKey);
  if (cached) {
    showImage(cached);
    return;
  }
  coverPreviewEmpty(dom, 'Cargando…');
  void cache.load(sourceKey).then((thumbnail) => {
    if (app.coverDraft !== draft || draft.previewToken !== token) return;
    if (thumbnail) showImage(thumbnail);
    else coverPreviewEmpty(dom, 'Sin imagen');
  }).catch(() => {
    if (app.coverDraft === draft && draft.previewToken === token) {
      coverPreviewEmpty(dom, 'Sin imagen');
    }
  });
}

function renderCoverDialog(dom, app) {
  const draft = app.coverDraft;
  if (!draft || !dom.coverDialog) return;
  const profile = coverProfileOf(app, draft);
  const definition = getProfileDefinition(draft.profileId, { catalog: app.catalog });
  if (dom.coverTitle) {
    dom.coverTitle.textContent = `Portada de ${definition?.name ?? profile?.name ?? 'equipo'}`;
  }
  const disabled = app.busy === true || draft.saving === true;
  for (const button of dom.coverBlurButtons ?? []) {
    const blur = Number(button?.dataset?.coverBlur);
    const selected = blur === draft.blur;
    button.setAttribute?.('aria-pressed', selected ? 'true' : 'false');
    if (button.classList && typeof button.classList.toggle === 'function') {
      button.classList.toggle('is-active', selected);
    }
    button.disabled = disabled;
  }
  if (dom.coverUseAnnouncement) {
    const selected = draft.mode === 'announcement';
    dom.coverUseAnnouncement.setAttribute('aria-pressed', selected ? 'true' : 'false');
    if (dom.coverUseAnnouncement.classList?.toggle) {
      dom.coverUseAnnouncement.classList.toggle('is-active', selected);
    }
    dom.coverUseAnnouncement.disabled = disabled;
  }
  if (dom.coverNoImage) {
    const selected = draft.mode === 'none';
    dom.coverNoImage.setAttribute('aria-pressed', selected ? 'true' : 'false');
    if (dom.coverNoImage.classList?.toggle) {
      dom.coverNoImage.classList.toggle('is-active', selected);
    }
    dom.coverNoImage.disabled = disabled;
  }
  if (dom.coverPickImage) {
    dom.coverPickImage.setAttribute('aria-pressed', draft.mode === 'custom' ? 'true' : 'false');
    dom.coverPickImage.disabled = disabled;
  }
  if (dom.coverShade) {
    dom.coverShade.value = String(Math.round(draft.shade * 100));
    dom.coverShade.disabled = disabled;
  }
  if (dom.coverSave) dom.coverSave.disabled = disabled;
  if (dom.coverCancel) dom.coverCancel.disabled = draft.saving === true;
  if (dom.coverClose) dom.coverClose.disabled = draft.saving === true;
  renderCoverPreview(dom, app);
}

function openCoverDialog(dom, app, profileId) {
  if (!isWorkspace(app) || !app.workspace) {
    showStatus(dom, 'Las portadas necesitan el workspace y su almacén.', 'warning');
    return false;
  }
  if (app.busy || app.switching) {
    showStatus(dom, 'Espera a que termine la acción actual antes de editar la portada.', 'warning');
    return false;
  }
  const profile = app.workspace.profiles?.[profileId];
  if (!profile || !dom.coverDialog) return false;
  const saved = normalizeCardAppearance(profile.cardAppearance);
  app.coverDraft = {
    profileId,
    ...createCardCoverDraft(saved),
    previewToken: 0,
    saving: false,
  };
  setCoverError(dom, '');
  renderCoverDialog(dom, app);
  if (typeof dom.coverDialog.showModal === 'function') {
    if (!dom.coverDialog.open) dom.coverDialog.showModal();
  } else {
    dom.coverDialog.setAttribute('open', '');
  }
  dom.coverUseAnnouncement?.focus?.();
  return true;
}

function closeCoverDialog(dom, app, options = {}) {
  const draft = app.coverDraft;
  if (!draft) return false;
  if (draft.saving && options.force !== true) return false;
  app.coverDraft = null;
  setCoverError(dom, '');
  if (dom.coverPreview) dom.coverPreview.replaceChildren();
  if (dom.coverDialog) {
    if (typeof dom.coverDialog.close === 'function' && dom.coverDialog.open) {
      dom.coverDialog.close();
    } else {
      dom.coverDialog.removeAttribute('open');
    }
  }
  return true;
}

function chooseCoverMode(dom, app, mode) {
  const draft = app.coverDraft;
  if (!draft || draft.saving || !['announcement', 'custom', 'none'].includes(mode)) return;
  draft.mode = mode;
  if (mode === 'custom') {
    draft.imageKey = draft.newKey ?? draft.customImageKey ?? null;
  }
  renderCoverDialog(dom, app);
}

function setCoverBlur(dom, app, value) {
  const draft = app.coverDraft;
  const blur = Number(value);
  if (!draft || draft.saving || ![0, 6, 12].includes(blur)) return;
  draft.blur = blur;
  renderCoverDialog(dom, app);
}

function setCoverShade(dom, app, value) {
  const draft = app.coverDraft;
  const number = Number(value);
  if (!draft || draft.saving || !Number.isFinite(number)) return;
  draft.shade = Math.min(
    CARD_COVER_SHADE_MAX,
    Math.max(CARD_COVER_SHADE_MIN, number / 100),
  );
  renderCoverDialog(dom, app);
}

function applyPendingCoverImage(dom, app, draft, dataUrl, width, height) {
  if (!draft || app.coverDraft !== draft) return false;
  if (!isPngDataUrl(dataUrl)) {
    setCoverError(dom, 'La imagen elegida no es un PNG válido. No se agregó a la portada.');
    return false;
  }
  const profileId = draft.profileId;
  const key = coverKeyForProfile(
    profileId,
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
  );
  draft.pendingImage = { dataUrl, width, height };
  draft.newKey = key;
  draft.imageKey = key;
  draft.customImageKey = key;
  draft.mode = 'custom';
  setCoverError(dom, '');
  renderCoverDialog(dom, app);
  return true;
}

async function handleCoverPickFile(dom, app, file) {
  const draft = app.coverDraft;
  if (!draft || draft.saving || app.busy) return;
  if (!file || typeof file !== 'object') return;
  const type = String(file.type ?? '').toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) {
    setCoverError(dom, 'Elige una imagen PNG, JPEG o WebP para la portada.');
    return;
  }
  setBusy(dom, app, true, 'Preparando la portada…');
  try {
    const prepared = await prepareImageFile(file);
    applyPendingCoverImage(dom, app, draft, prepared.dataUrl, prepared.width, prepared.height);
  } catch (error) {
    if (app.coverDraft === draft) {
      setCoverError(dom, `No se pudo preparar la portada: ${error.message || 'error'}.`);
    }
  } finally {
    setBusy(dom, app, false);
    renderCoverDialog(dom, app);
  }
}

async function handleCoverPickImage(dom, app) {
  const draft = app.coverDraft;
  if (!draft || draft.saving || app.busy) return;
  setCoverError(dom, '');
  if (app.uiMode === 'browser') {
    if (!dom.coverImageInput) {
      setCoverError(dom, 'Este navegador no ofrece el selector de imagen.');
      return;
    }
    dom.coverImageInput.value = '';
    dom.coverImageInput.click();
    return;
  }
  if (!ensureNative(dom, app)) {
    setCoverError(dom, 'La portada propia necesita la app Android conectada.');
    return;
  }
  if (!capability(app, CAPABILITIES.RAW_IMAGE)) {
    setCoverError(dom, 'Esta app no anunció raw-image-v1. Actualiza a la BASE para elegir la portada.');
    return;
  }
  setBusy(dom, app, true, 'Abriendo el selector de portada…');
  try {
    const result = await requestNative(dom, app, 'IMPORT_IMAGE', {}, {
      timeoutMs: MN1_LIMITS.IMPORT_IMAGE_TIMEOUT_MS,
      silent: true,
    });
    if (app.coverDraft !== draft) return;
    if (!result?.ok) {
      setCoverError(dom, result?.message || 'No se eligió ninguna portada. No se asumió una imagen.');
      return;
    }
    const data = result.data ?? {};
    if (!isPngDataUrl(data.imageDataUrl)) {
      setCoverError(dom, 'La app no devolvió un PNG válido para la portada.');
      return;
    }
    let width = Number(data.width);
    let height = Number(data.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      try {
        const size = await imageDimensions(data.imageDataUrl);
        width = size.width;
        height = size.height;
      } catch {
        setCoverError(dom, 'No se pudieron leer las dimensiones de la portada.');
        return;
      }
    }
    applyPendingCoverImage(dom, app, draft, data.imageDataUrl, width, height);
  } catch (error) {
    if (app.coverDraft === draft) {
      setCoverError(dom, `No se pudo elegir la portada: ${error.message || 'error'}.`);
    }
  } finally {
    setBusy(dom, app, false);
    renderCoverDialog(dom, app);
  }
}

async function handleCoverSave(dom, app) {
  const draft = app.coverDraft;
  if (!draft || draft.saving || app.busy) return;
  if (!isWorkspace(app) || !app.workspace || !app.storage) {
    setCoverError(dom, 'No hay un almacén disponible para guardar la portada.');
    return;
  }
  const pendingKey = draft.pendingImage?.dataUrl
    ? (draft.newKey ?? coverKeyForProfile(draft.profileId, Date.now()))
    : null;
  const resolved = resolveCoverSave(
    { ...draft, imageKey: draft.imageKey },
    { newImageKey: pendingKey },
  );
  if (!resolved.ok) {
    setCoverError(dom, resolved.error);
    return;
  }
  const usesPendingImage = resolved.appearance.mode === 'custom'
    && Boolean(draft.pendingImage?.dataUrl);
  const newImageKey = usesPendingImage ? pendingKey : null;
  let base64 = null;
  if (usesPendingImage) {
    base64 = pngBase64FromDataUrl(draft.pendingImage.dataUrl);
    if (!base64) {
      setCoverError(dom, 'La imagen de la portada no es un PNG válido.');
      return;
    }
  }

  // Se espera la cadena existente y se cancela el guardado diferido para que
  // ninguna instantánea anterior pueda pisar la portada recién guardada.
  draft.saving = true;
  setCoverError(dom, '');
  renderCoverDialog(dom, app);
  cancelScheduledSave(app);
  try {
    await app.saveChain;
  } catch {
    // El error real se evalúa en la tarea encadenada de abajo.
  }
  if (!isWorkspace(app) || !app.workspace || !app.storage) {
    draft.saving = false;
    renderCoverDialog(dom, app);
    return;
  }
  setBusy(dom, app, true, 'Guardando la portada…');
  renderCoverDialog(dom, app);
  let oldCoverKey = null;
  try {
    let nextProfile = null;
    let nextWorkspace = null;
    await enqueueStorageTask(app, async () => {
      if (app.saveFailed) throw new Error('previous_save_failed');
      const profile = app.workspace?.profiles?.[draft.profileId];
      if (!profile) throw new Error('missing_profile');
      const previous = normalizeCardAppearance(profile.cardAppearance);
      if (previous.mode === 'custom' && previous.imageKey !== resolved.appearance.imageKey) {
        oldCoverKey = previous.imageKey;
      }
      nextProfile = normalizeTemplate({
        ...profile,
        cardAppearance: resolved.appearance,
      }, draft.profileId, { customProfiles: app.workspace.customProfiles });
      nextWorkspace = {
        ...app.workspace,
        profiles: {
          ...app.workspace.profiles,
          [draft.profileId]: nextProfile,
        },
      };
      let wroteKey = null;
      try {
        if (base64 && newImageKey) {
          await app.storage.putText(newImageKey, base64);
          wroteKey = newImageKey;
        }
        await app.storage.putText(WORKSPACE_KEYS.state, JSON.stringify(nextWorkspace));
      } catch (error) {
        if (wroteKey) {
          try {
            await app.storage.removeText(wroteKey);
          } catch {
            // La portada tampoco quedó referenciada por el estado.
          }
        }
        throw error;
      }
    });
    app.workspace = nextWorkspace;
    app.catalog = profileCatalogForWorkspace(app.workspace);
    if (app.draft && draft.profileId === app.workspace.activeProfileId) {
      app.draft.cardAppearance = { ...normalizeCardAppearance(nextProfile.cardAppearance) };
    }
    app.storageBlocked = false;
    app.persistent = app.storage.persistent !== false;
    app.lastSavedAt = new Date().toISOString();
    if (oldCoverKey && oldCoverKey !== nextProfile.cardAppearance.imageKey
        && !imageKeyIsReferenced(app, oldCoverKey)
        && !app.pendingImageRemovals.includes(oldCoverKey)) {
      app.pendingImageRemovals.push(oldCoverKey);
    }
    draft.saving = false;
    closeCoverDialog(dom, app, { force: true });
    renderProfiles(dom, app);
    showStatus(dom, 'Portada guardada.', 'success');
    await removeReplacedImages(dom, app);
  } catch (error) {
    draft.saving = false;
    const message = error?.message === 'previous_save_failed'
      ? 'No se guardó la portada: el guardado anterior no se completó.'
      : `No se pudo guardar la portada: ${error.message || 'error'}.`;
    setCoverError(dom, `${message} La portada sigue en este diálogo.`);
  } finally {
    setBusy(dom, app, false);
    if (app.coverDraft) renderCoverDialog(dom, app);
    if (app.dirty) scheduleSave(dom, app);
  }
}

/* ------------------------------------------------------------------------- */
/* Acciones workspace                                                        */
/* ------------------------------------------------------------------------- */

async function handleWorkspaceSave(dom, app) {
  if (app.busy) return;
  clearError(dom);
  setBusy(dom, app, true, 'Guardando el borrador…');
  try {
    await persistDraft(dom, app, { force: true });
  } finally {
    setBusy(dom, app, false);
  }
}

async function applyImportedImage(dom, app, dataUrl, width, height) {
  try {
    const key = await storeImportedImage(app, dataUrl, width, height);
    app.imageDataUrl = dataUrl;
    app.loadedImage = null;
    app.loadedImageUrl = '';
    app.drawToken += 1;
    // Tras importar, el editor vuelve al HERO con la imagen ya visible.
    selectEditorTool(dom, app, null);
    const valid = activeValidation(app).ok;
    if (valid) {
      const saved = await persistDraft(dom, app, { quiet: true });
      if (saved) {
        showStatus(dom, 'Foto original guardada.', 'success');
      } else {
        showStatus(dom, 'La foto se guardó en el almacén, pero el estado del equipo no se pudo persistir. Guarda explícitamente para asociarla.', 'warning');
      }
    } else {
      showStatus(dom, 'Foto importada y conservada, pero el borrador tiene errores. Corrige el mensaje/hora y guarda para asociarla al equipo.', 'warning');
    }
    renderAll(dom, app, { syncFields: false });
    return key;
  } catch (error) {
    showError(dom, `No se pudo guardar la foto original: ${error.message || 'error'}.`);
    return null;
  }
}

async function imageDimensions(dataUrl) {
  const image = await loadImageElement(dataUrl);
  return {
    width: Math.max(1, Math.round(image.naturalWidth || image.width)),
    height: Math.max(1, Math.round(image.naturalHeight || image.height)),
  };
}

async function handleImportImage(dom, app) {
  if (app.busy) return;
  // La imagen abre el selector directamente: no hay formulario intermedio.
  selectEditorTool(dom, app, null);
  if (app.uiMode === 'browser') {
    dom.browserImageInput.value = '';
    dom.browserImageInput.click();
    return;
  }
  if (!ensureNative(dom, app)) return;
  if (!capability(app, CAPABILITIES.RAW_IMAGE)) {
    showStatus(dom, 'Esta app no anunció raw-image-v1. Actualiza a la APK BASE para importar la foto original.', 'warning');
    return;
  }
  clearError(dom);
  setBusy(dom, app, true, 'Abriendo el selector de foto original…');
  try {
    const result = await requestNative(dom, app, 'IMPORT_IMAGE', {}, {
      timeoutMs: MN1_LIMITS.IMPORT_IMAGE_TIMEOUT_MS,
    });
    if (!result) return;
    if (!result.ok) {
      showStatus(dom, result.message || 'No se importó ninguna foto. No se asumió una imagen.', 'warning');
      return;
    }
    const data = result.data ?? {};
    if (!isPngDataUrl(data.imageDataUrl)) {
      showError(dom, 'La app no devolvió un PNG original válido. No se guardó ninguna imagen.');
      return;
    }
    let width = Number(data.width);
    let height = Number(data.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      try {
        const size = await imageDimensions(data.imageDataUrl);
        width = size.width;
        height = size.height;
      } catch {
        showError(dom, 'No se pudieron leer las dimensiones de la foto. No se guardó.');
        return;
      }
    }
    await applyImportedImage(dom, app, data.imageDataUrl, width, height);
  } finally {
    setBusy(dom, app, false);
  }
}

async function handleBrowserFile(dom, app, file) {
  if (!file || app.busy) return;
  clearError(dom);
  setBusy(dom, app, true, 'Preparando la foto original en el navegador…');
  try {
    const prepared = await prepareImageFile(file);
    await applyImportedImage(dom, app, prepared.dataUrl, prepared.width, prepared.height);
  } catch (error) {
    showError(dom, `No se pudo preparar la imagen: ${error.message || 'error'}.`);
  } finally {
    setBusy(dom, app, false);
  }
}

async function handleWorkspaceShare(dom, app) {
  if (!ensureNative(dom, app) || app.busy) return;
  if (!capability(app, CAPABILITIES.SHARE_PNG)) {
    showStatus(dom, 'Esta app no anunció share-png-v1. Actualiza a la APK BASE; no se abrió el compartir.', 'warning');
    return;
  }
  const validation = activeValidation(app);
  if (!validation.ok) {
    app.validationShown = true;
    renderValidation(dom, app);
    showError(dom, 'Revisa el mensaje, la hora y los destinos antes de preparar el compartir.');
    return;
  }
  if (!isPngDataUrl(app.imageDataUrl)) {
    showError(dom, 'Falta la foto original del equipo. Elige una foto antes de compartir.');
    return;
  }
  let shareMessage = renderHourMessage(app.draft.message, app.draft.hour);
  if (textLength(shareMessage) > MN1_LIMITS.SHARE_MESSAGE_MAX_LENGTH) {
    showError(dom, `El mensaje con la hora supera ${MN1_LIMITS.SHARE_MESSAGE_MAX_LENGTH} caracteres. Acórtalo antes de compartir.`);
    return;
  }
  clearError(dom);
  setBusy(dom, app, true, 'Guardando el borrador y preparando el PNG…');
  try {
    const saved = await persistDraft(dom, app, { quiet: true });
    if (!saved) return;
    shareMessage = renderHourMessage(app.draft.message, app.draft.hour);
    if (textLength(shareMessage) > MN1_LIMITS.SHARE_MESSAGE_MAX_LENGTH) {
      showError(dom, `El mensaje con la hora supera ${MN1_LIMITS.SHARE_MESSAGE_MAX_LENGTH} caracteres. Acórtalo antes de compartir.`);
      return;
    }
    let png;
    try {
      png = await renderCompositePng({
        imageDataUrl: app.imageDataUrl,
        hour: app.draft.hour,
        overlay: app.draft.overlay,
      });
    } catch (error) {
      showError(dom, `No se pudo componer el PNG: ${error.message || 'error'}. No se abrió el compartir.`);
      return;
    }
    const result = await requestNative(dom, app, 'SHARE_PNG', {
      imageDataUrl: png.dataUrl,
      message: shareMessage,
    }, { timeoutMs: MN1_LIMITS.SHARE_PNG_TIMEOUT_MS });
    if (!result) return;
    if (!result.ok) {
      showStatus(dom, result.message || 'No se abrió el selector. No se asumió ningún envío.', 'warning');
      return;
    }
    showStatus(dom, 'Listo. Confirma en tu teléfono.', 'success');
  } finally {
    setBusy(dom, app, false);
  }
}

async function handleDownloadPng(dom, app) {
  if (app.uiMode !== 'browser' || app.busy) return;
  if (!isPngDataUrl(app.imageDataUrl)) {
    showError(dom, 'Falta la foto original del equipo. Elige una foto antes de descargar el PNG.');
    return;
  }
  const validation = activeValidation(app);
  if (!validation.ok) {
    app.validationShown = true;
    renderValidation(dom, app);
    showError(dom, 'Revisa el mensaje, la hora y los destinos antes de generar el PNG.');
    return;
  }
  clearError(dom);
  setBusy(dom, app, true, 'Componiendo el PNG para descargar…');
  try {
    const png = await renderCompositePng({
      imageDataUrl: app.imageDataUrl,
      hour: app.draft.hour,
      overlay: app.draft.overlay,
    });
    const definition = getProfileDefinition(app.workspace.activeProfileId, {
      customProfiles: app.workspace.customProfiles,
    });
    const safeName = (definition?.shortName ?? 'equipo')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    const anchor = document.createElement('a');
    anchor.href = png.dataUrl;
    anchor.download = `mn1-${safeName}-${app.draft.hour.replace(':', '')}.png`;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    showStatus(dom, 'PNG descargado.', 'success');
  } catch (error) {
    showError(dom, `No se pudo generar el PNG: ${error.message || 'error'}.`);
  } finally {
    setBusy(dom, app, false);
  }
}

async function handleSelectProfile(dom, app, profileId) {
  if (app.uiMode === 'legacy') {
    if (app.busy) return;
    clearError(dom, app);
    // APK3 conserva una única plantilla accesible; no se simulan cuatro equipos.
    openWorkspaceFor(dom, app, isProfileId(profileId) ? profileId : DEFAULT_PROFILE_ID);
    showStatus(
      dom,
      'APK3: se abre la plantilla única conservada. Los cuatro equipos guardados necesitan una BASE, pero no se pide ni se instala nada desde aquí.',
      'warning',
    );
    return;
  }
  if (!isWorkspace(app)) {
    showError(
      dom,
      'El workspace todavía no está disponible. No se abrió ningún equipo ni se asumió un guardado.',
      app,
    );
    return;
  }
  clearError(dom, app);
  await navigateToProfile({
    profileId,
    activeProfileId: app.workspace?.activeProfileId ?? '',
    isBusy: app.busy || app.switching,
    isListening: app.listening,
    catalog: app.catalog,
    switchProfile: (id) => switchWorkspaceProfile(dom, app, id),
    openProfile: (id) => openTeamTools(dom, app, id),
    reportBlocked: (reason) => {
      if (reason === 'listening') {
        showError(dom, 'Detén la escucha antes de cambiar de equipo. No se cambió nada.', app);
      } else if (reason === 'busy') {
        showError(dom, 'Espera a que termine la acción actual. No se cambió nada.', app);
      } else if (reason === 'invalid_profile') {
        showError(dom, 'El equipo solicitado no está en el catálogo. No se abrió nada.', app);
      }
      // switch_failed ya dejó su error específico desde switchWorkspaceProfile.
    },
  });
}

async function handleRefresh(dom, app) {
  if (app.busy) return;
  clearError(dom);
  if (app.uiMode === 'browser') {
    setBusy(dom, app, true, 'Leyendo el almacén del navegador…');
    try {
      const loaded = await readWorkspaceFromStorage(app);
      if (loaded.status === 'corrupt') {
        app.storageBlocked = true;
        showStatus(dom, 'El estado guardado no se pudo leer; no se sobrescribió.', 'warning');
        return;
      }
      if (loaded.state && !app.dirty) {
        app.workspace = loaded.state;
        app.catalog = profileCatalogForWorkspace(loaded.state);
        app.draft = cloneDraftFromProfile(activeProfileOf(app));
        await loadActiveImage(app);
        renderAll(dom, app, { syncFields: true });
        showStatus(dom, 'Vista actualizada.', 'info');
      } else if (!loaded.state) {
        showStatus(dom, 'No hay cambios guardados.', 'warning');
      } else {
        showStatus(dom, 'Hay cambios sin guardar.', 'warning');
      }
    } catch (error) {
      showError(dom, `No se pudo leer el almacén del navegador: ${error.message || 'error'}. No se sobrescribió nada.`);
    } finally {
      setBusy(dom, app, false);
    }
    return;
  }
  if (app.uiMode === 'legacy') {
    if (!ensureNative(dom, app)) return;
    setBusy(dom, app, true, 'Actualizando la vista desde la app…');
    try {
      await loadLegacyState(dom, app, {
        silent: false,
        preserveDirty: app.dirty,
        successMessage: 'Vista actualizada.',
      });
    } finally {
      setBusy(dom, app, false);
    }
    return;
  }
  if (!ensureNative(dom, app)) return;
  setBusy(dom, app, true, 'Actualizando capacidades de la app…');
  try {
    const result = await requestNative(dom, app, 'GET_STATE', {}, { timeoutMs: 12_000 });
    if (!result) return;
    if (!result.ok) {
      showStatus(dom, result.message || 'No se pudo leer el estado de la app.', 'warning');
      return;
    }
    applyNativeMeta(dom, app, result.data ?? {});
    if (!capability(app, CAPABILITIES.WORKSPACE)) {
      showStatus(dom, 'La app dejó de anunciar web-workspace-v1. No se escribió nada; revisa la actualización BASE.', 'warning');
    } else {
      showStatus(dom, 'Vista actualizada.', 'info');
    }
    renderAll(dom, app, { syncFields: false });
  } finally {
    setBusy(dom, app, false);
  }
}

/* ------------------------------------------------------------------------- */
/* Voz                                                                       */
/* ------------------------------------------------------------------------- */

async function cancelSpeech(dom, app, { quiet = false } = {}) {
  app.speechToken += 1;
  app.listening = false;
  renderVoice(dom, app);
  renderProfiles(dom, app);
  const result = await requestNative(dom, app, 'CANCEL_SPEECH', {}, {
    timeoutMs: 8_000,
    silent: true,
  });
  if (quiet) return result;
  if (result?.ok && result.data?.cancelled === true) {
    showStatus(dom, 'Escucha cancelada.', 'info');
  } else if (result?.ok && result.data?.cancelled === false) {
    showStatus(dom, 'La app indicó que no había una escucha activa. No se usó ninguna transcripción.', 'warning');
  } else {
    showStatus(dom, 'No se pudo confirmar la cancelación en la app. No se usará ninguna transcripción; revisa el micrófono.', 'warning');
  }
  return result;
}

async function handleSpeak(dom, app) {
  if (!isWorkspace(app)) return;
  if (!canUseNative(app)) {
    showStatus(dom, 'El dictado necesita la app BASE. En el navegador no se simula el micrófono.', 'warning');
    return;
  }
  if (!capability(app, CAPABILITIES.SPEECH)) {
    showStatus(dom, 'Esta app no anunció speech-input-v1. Actualiza a la BASE para dictar.', 'warning');
    return;
  }
  if (app.listening) {
    showStatus(dom, 'Solicitando a la app que detenga la escucha…', 'busy');
    await cancelSpeech(dom, app);
    return;
  }
  if (app.busy) return;
  clearError(dom);
  const token = ++app.speechToken;
  const speechTargets = [...app.draft.targetLabels];
  app.listening = true;
  app.proposal = null;
  renderVoice(dom, app);
  renderProfiles(dom, app);
  renderProposal(dom, app);
  showStatus(dom, 'Escuchando una sola frase… No se enviará nada.', 'busy');
  try {
    const result = await requestNative(dom, app, 'RECOGNIZE_SPEECH', {
      language: SPEECH_LANGUAGE,
    }, { timeoutMs: MN1_LIMITS.SPEECH_TIMEOUT_MS });
    if (token !== app.speechToken) return;
    if (!result) return;
    if (!result.ok) {
      showStatus(dom, result.message || 'No se pudo reconocer la voz. No se envió nada.', 'warning');
      return;
    }
    const transcript = typeof result.data?.transcript === 'string'
      ? result.data.transcript.trim()
      : '';
    if (!transcript) {
      showStatus(dom, 'No se reconoció ninguna frase. No se envió nada.', 'warning');
      return;
    }
    const proposal = parseSpanishCommand(transcript, {
      targets: speechTargets,
    });
    app.proposal = proposal;
    renderProposal(dom, app);
    showStatus(
      dom,
      proposal.ok
        ? 'Propuesta lista.'
        : proposal.cancelled
          ? 'La frase pide cancelar o no preparar. No se preparó ninguna propuesta.'
          : 'La propuesta está incompleta o es ambigua. Complétala antes de preparar; no se envió nada.',
      proposal.ok ? 'info' : 'warning',
    );
  } finally {
    if (token === app.speechToken) {
      app.listening = false;
      renderVoice(dom, app);
      renderProfiles(dom, app);
    }
  }
}

async function handleApplyProposal(dom, app) {
  const proposal = app.proposal;
  if (!proposal?.ok || app.busy || !isWorkspace(app)) return;
  if (!isProfileId(proposal.profileId, { customProfiles: app.workspace?.customProfiles })) {
    showError(dom, 'La propuesta no identifica un equipo válido.');
    return;
  }
  clearError(dom);
  if (proposal.profileId === app.workspace.activeProfileId) {
    if (app.busy) return;
    app.draft.hour = proposal.hour;
    app.draft.targetLabels = [...proposal.targetLabels];
    markDirty(app);
    setBusy(dom, app, true, 'Preparando la propuesta para este equipo…');
    try {
      const saved = await persistDraft(dom, app, { force: true });
      if (!saved) return;
      app.proposal = null;
      renderAll(dom, app, { syncFields: true });
      showStatus(dom, `Propuesta lista para ${proposal.profileName}.`, 'success');
    } finally {
      setBusy(dom, app, false);
    }
    return;
  }

  const switched = await switchWorkspaceProfile(dom, app, proposal.profileId, {
    mutate: (profile) => ({
      ...profile,
      hour: proposal.hour,
      targetLabels: [...proposal.targetLabels],
    }),
  });
  if (switched) {
    app.proposal = null;
    renderProposal(dom, app);
    showStatus(dom, `Propuesta lista para ${proposal.profileName}.`, 'success');
  }
}

/* ------------------------------------------------------------------------- */
/* Acciones del drawer y Acerca de                                           */
/* ------------------------------------------------------------------------- */

function changeOverlay(dom, app, changes) {
  if (app.busy || !isWorkspace(app)) return;
  app.draft.overlay = normalizeOverlay({ ...app.draft.overlay, ...changes });
  markDirty(app);
  renderOverlayControls(dom, app);
  renderImage(dom, app);
  scheduleSave(dom, app);
}

function changeOverlaySize(dom, app, direction) {
  changeOverlay(dom, app, {
    size: stepOverlaySize(app.draft.overlay.size, direction),
  });
}

function chooseOverlayFont(dom, app, font) {
  if (!OVERLAY_FONTS.includes(font)) return;
  changeOverlay(dom, app, { font });
}

function chooseOverlayColor(dom, app, color) {
  changeOverlay(dom, app, { color });
}

function openAboutDialog(dom) {
  if (!dom.aboutDialog) return;
  if (typeof dom.aboutDialog.showModal === 'function') {
    if (!dom.aboutDialog.open) dom.aboutDialog.showModal();
  } else {
    dom.aboutDialog.setAttribute('open', '');
  }
  if (dom.closeAbout && typeof dom.closeAbout.focus === 'function') dom.closeAbout.focus();
}

function closeAboutDialog(dom) {
  if (!dom.aboutDialog) return;
  if (typeof dom.aboutDialog.close === 'function' && dom.aboutDialog.open) {
    dom.aboutDialog.close();
  } else {
    dom.aboutDialog.removeAttribute('open');
  }
}

/* ------------------------------------------------------------------------- */
/* Arranque                                                                  */
/* ------------------------------------------------------------------------- */

function collectDom() {
  const dom = {
    app: byId('app'),
    appHeader: byId('app-header'),
    appFooter: byId('app-footer'),
    welcomeScreen: byId('welcome-screen'),
    teamToolsHome: byId('team-tools-home'),
    skipLink: document.querySelector('.skip-link'),
    profilesTitle: byId('profiles-title'),
    teamsScreen: byId('teams-screen') ?? document.querySelector('.profiles-panel'),
    main: byId('contenido'),
    workspaceTitle: byId('workspace-title'),
    heroPanel: byId('hero-panel'),
    toolDrawer: byId('tool-drawer'),
    closeTool: byId('close-tool'),
    toolTitle: byId('tool-title'),
    editorTools: Array.from(document.querySelectorAll('[data-editor-tool]')),
    backToTeams: byId('back-to-teams'),
    modeBadge: byId('mode-badge'),
    versionBadge: byId('version-badge'),
    previewNote: byId('preview-note'),
    heroHour: byId('hero-hour'),
    canvasPreview: byId('canvas-preview'),
    lockOverlay: byId('lock-overlay'),
    imageFrame: byId('image-frame'),
    previewImage: byId('preview-image'),
    imagePlaceholder: byId('image-placeholder'),
    placeholderTitle: byId('image-placeholder-title'),
    placeholderCopy: byId('image-placeholder-copy'),
    imageMeta: byId('image-meta'),
    previewMessage: byId('preview-message'),
    hourRadios: Array.from(document.querySelectorAll('[data-hour-option]')),
    hourLabels: Array.from(document.querySelectorAll('[data-hour-label]')),
    hourDefaultStars: Array.from(document.querySelectorAll('[data-hour-default-star]')),
    quickHoursEdit: byId('quick-hours-edit'),
    useDefaultHour: byId('use-default-hour'),
    widgetDefaultLabel: byId('widget-default-label'),
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
    profileList: byId('profile-list'),
    profilesStatus: byId('profiles-status'),
    profilesNotice: byId('profiles-notice'),
    addTeam: byId('add-team'),
    addTeamDialog: byId('add-team-dialog'),
    addTeamInput: byId('add-team-input'),
    addTeamError: byId('add-team-error'),
    addTeamCreate: byId('add-team-create'),
    addTeamCancel: byId('add-team-cancel'),
    addTeamClose: byId('add-team-close'),
    coverDialog: byId('cover-dialog'),
    coverTitle: byId('cover-title'),
    coverPreview: byId('cover-preview'),
    coverUseAnnouncement: byId('cover-use-announcement'),
    coverPickImage: byId('cover-pick-image'),
    coverNoImage: byId('cover-no-image'),
    coverShade: byId('cover-shade'),
    coverSave: byId('cover-save'),
    coverCancel: byId('cover-cancel'),
    coverClose: byId('cover-close'),
    coverError: byId('cover-error'),
    coverImageInput: byId('cover-image-input'),
    coverBlurButtons: Array.from(document.querySelectorAll('[data-cover-blur]')),
    importImage: byId('import-image'),
    pickImage: byId('pick-image'),
    openEditor: byId('open-editor'),
    browserImageInput: byId('browser-image-input'),
    refreshState: byId('refresh-state'),
    saveTemplate: byId('save-template'),
    prepareShare: byId('prepare-share'),
    downloadPng: byId('download-png'),
    status: byId('status'),
    error: byId('error'),
    busyOverlay: byId('busy-overlay'),
    busyLabel: byId('busy-label'),
    editorPanel: byId('editor-panel'),
    templatePanel: byId('template-panel'),
    overlayX: byId('overlay-x'),
    overlayY: byId('overlay-y'),
    overlaySize: byId('overlay-size'),
    overlayFont: byId('overlay-font'),
    overlayColor: byId('overlay-color'),
    overlayShowDate: byId('overlay-show-date'),
    overlayDateField: byId('overlay-date-field'),
    overlayDate: byId('overlay-date'),
    resetOverlay: byId('reset-overlay'),
    overlaySmaller: byId('overlay-smaller'),
    overlayBigger: byId('overlay-bigger'),
    fontChoices: Array.from(document.querySelectorAll('[data-font-choice]')),
    colorChoices: Array.from(document.querySelectorAll('[data-color-choice]')),
    voicePanel: byId('voice-panel'),
    speakToggle: byId('speak-toggle'),
    speechStatus: byId('speech-status'),
    speechResult: byId('speech-result'),
    speechTranscript: byId('speech-transcript'),
    proposalList: byId('proposal-list'),
    applyProposal: byId('apply-proposal'),
    hourDialog: byId('hour-dialog'),
    hourField: byId('hour-field'),
    minuteField: byId('minute-field'),
    hourError: byId('hour-error'),
    hourPreview: byId('hour-preview'),
    hourConfirm: byId('hour-confirm'),
    hourCancel: byId('hour-cancel'),
    hourClose: byId('hour-close'),
    quickHoursDialog: byId('quick-hours-dialog'),
    quickHourInputs: Array.from(document.querySelectorAll('[data-quick-hour-input]')),
    quickHoursError: byId('quick-hours-error'),
    quickHoursDefaultNote: byId('quick-hours-default-note'),
    quickHoursSave: byId('quick-hours-save'),
    quickHoursCancel: byId('quick-hours-cancel'),
    quickHoursClose: byId('quick-hours-close'),
    aboutDialog: byId('about-dialog'),
    openAbout: byId('open-about'),
    editorAbout: byId('editor-about'),
    closeAbout: byId('close-about'),
    nativeVersion: byId('native-version'),
    capabilityText: byId('capability-text'),
  };
  dom.profileInput = dom.browserImageInput;
  return dom;
}

async function hydrateNative(dom, app) {
  app.connection = 'checking';
  setBusy(dom, app, true, 'Conectando con la app MN1…');
  const result = await requestNative(dom, app, 'GET_STATE', {}, { timeoutMs: 12_000 });
  if (!result) {
    app.uiMode = 'offline';
    app.connection = 'offline';
    setBusy(dom, app, false);
    renderAll(dom, app, { syncFields: false });
    showStatus(dom, 'La app no respondió. No se asumió ningún estado; usa «Actualizar vista».', 'warning');
    return;
  }
  if (!result.ok) {
    app.uiMode = 'offline';
    app.connection = 'offline';
    setBusy(dom, app, false);
    renderAll(dom, app, { syncFields: false });
    showStatus(dom, result.message || 'No se pudo leer el estado de la app.', 'warning');
    return;
  }
  const data = result.data ?? {};
  applyNativeMeta(dom, app, data);
  if (capability(app, CAPABILITIES.WORKSPACE)) {
    app.uiMode = 'workspace';
    app.connection = 'connected';
    await initNativeWorkspace(dom, app, data);
    setBusy(dom, app, false);
    renderAll(dom, app, { syncFields: true });
    showStatus(
      dom,
      app.persistent
        ? 'Workspace listo.'
        : 'Almacén no disponible: cambios sólo en memoria.',
      app.persistent ? 'info' : 'warning',
    );
  } else {
    app.uiMode = 'legacy';
    app.connection = 'connected';
    applyLegacyState(dom, app, data, { preserveDirty: false });
    setBusy(dom, app, false);
    renderAll(dom, app, { syncFields: true });
    showStatus(dom, 'APK3: sólo plantilla única.', 'warning');
  }
}

async function hydrateBrowser(dom, app) {
  app.uiMode = 'browser';
  app.connection = 'preview';
  app.mode = 'preview';
  setBusy(dom, app, true, 'Abriendo el workspace local…');
  try {
    await initBrowserWorkspace(dom, app);
  } catch (error) {
    app.storage = new VaultClient(new MemoryVault(), {
      persistent: false,
      label: 'memoria temporal',
      reason: error.message || 'IndexedDB no disponible',
    });
    app.persistent = false;
    app.storageBlocked = false;
    app.workspace = createDefaultWorkspace();
    app.catalog = profileCatalogForWorkspace(app.workspace);
    app.draft = cloneDraftFromProfile(activeProfileOf(app));
    app.imageDataUrl = null;
    showStatus(dom, `No se pudo abrir el workspace local: ${error.message || 'error'}. Usando memoria temporal.`, 'warning');
  }
  setBusy(dom, app, false);
  renderAll(dom, app, { syncFields: true });
  if (app.persistent) {
    showStatus(dom, 'Workspace local listo.', 'info');
  } else {
    showStatus(dom, 'Sin almacén duradero: cambios sólo en memoria.', 'warning');
  }
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

function handleResume(dom, app) {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  if (app.mode !== 'native' || app.busy || app.refreshInFlight) return;
  const now = Date.now();
  if (now - app.lastResumeAt < 1200) return;
  app.lastResumeAt = now;
  if (app.uiMode === 'legacy') {
    const resumeKind = app.pendingResume;
    const preserveDirty = resumeKind !== 'editor';
    app.pendingResume = '';
    void loadLegacyState(dom, app, { silent: true, preserveDirty }).then((result) => {
      if (result && resumeKind === 'pick') {
        window.setTimeout(() => {
          if (!app.busy && app.mode === 'native') {
            void loadLegacyState(dom, app, { silent: true, preserveDirty: true });
          }
        }, 1600);
      }
    });
    return;
  }
  if (app.uiMode === 'workspace') {
    void requestNative(dom, app, 'GET_STATE', {}, { timeoutMs: 12_000, silent: true }).then((result) => {
      if (result?.ok) {
        applyNativeMeta(dom, app, result.data ?? {});
        renderCapabilities(dom, app);
      }
    });
  }
}

function wireUiEvents(dom, app) {
  dom.messageInput.addEventListener('input', (event) => {
    app.draft.message = event.target.value;
    markDirty(app);
    renderCounts(dom, app);
    renderPreview(dom, app);
    if (app.validationShown) renderValidation(dom, app);
    scheduleSave(dom, app);
  });

  for (const radio of dom.hourRadios) {
    radio.addEventListener('change', (event) => {
      if (!event.target.checked) return;
      app.draft.hour = event.target.value;
      markDirty(app);
      renderHour(dom, app);
      renderPreview(dom, app);
      renderImage(dom, app);
      if (app.validationShown) renderValidation(dom, app);
      scheduleSave(dom, app);
    });
  }

  if (dom.quickHoursEdit) {
    dom.quickHoursEdit.addEventListener('click', () => openQuickHoursDialog(dom, app));
  }
  if (dom.useDefaultHour) {
    dom.useDefaultHour.addEventListener('click', () => useCurrentHourForWidget(dom, app));
  }
  for (const input of dom.quickHourInputs ?? []) {
    input.addEventListener('input', () => updateQuickHoursDialog(dom, app));
  }
  if (dom.quickHoursSave) {
    dom.quickHoursSave.addEventListener('click', () => saveQuickHoursDialog(dom, app));
  }
  if (dom.quickHoursCancel) {
    dom.quickHoursCancel.addEventListener('click', () => closeQuickHoursDialog(dom));
  }
  if (dom.quickHoursClose) {
    dom.quickHoursClose.addEventListener('click', () => closeQuickHoursDialog(dom));
  }
  if (dom.quickHoursDialog) {
    dom.quickHoursDialog.addEventListener('click', (event) => {
      if (event.target === dom.quickHoursDialog) closeQuickHoursDialog(dom);
    });
    dom.quickHoursDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeQuickHoursDialog(dom);
    });
    dom.quickHoursDialog.addEventListener('close', () => {
      if (dom.quickHoursEdit && typeof dom.quickHoursEdit.focus === 'function') {
        dom.quickHoursEdit.focus();
      }
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
    markDirty(app);
    closeHourDialog(dom);
    renderHour(dom, app);
    renderPreview(dom, app);
    renderImage(dom, app);
    if (app.validationShown) renderValidation(dom, app);
    scheduleSave(dom, app);
    showStatus(dom, `Hora personalizada ${normalized}. Aún no se ha guardado.`, 'info');
    dom.customHour.focus();
  });
  dom.hourCancel.addEventListener('click', () => closeHourDialog(dom));
  dom.hourClose.addEventListener('click', () => closeHourDialog(dom));
  dom.hourDialog.addEventListener('close', () => dom.customHour.focus());

  dom.targetsList.addEventListener('input', (event) => {
    const input = event.target.closest('[data-target-input]');
    if (!input) return;
    const index = Number(input.dataset.targetInput);
    if (!Number.isInteger(index) || index < 0 || index >= app.draft.targetLabels.length) return;
    app.draft.targetLabels[index] = input.value;
    markDirty(app);
    renderCounts(dom, app);
    renderPreview(dom, app);
    if (app.validationShown) renderValidation(dom, app);
    scheduleSave(dom, app);
  });

  dom.targetsList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-target]');
    if (!button || app.busy) return;
    if (app.draft.targetLabels.length <= targetMinimum(app)) return;
    const index = Number(button.dataset.removeTarget);
    if (!Number.isInteger(index) || index < 0 || index >= app.draft.targetLabels.length) return;
    app.draft.targetLabels.splice(index, 1);
    markDirty(app);
    renderTargetsEditor(dom, app);
    renderCounts(dom, app);
    renderPreview(dom, app);
    if (app.validationShown) renderValidation(dom, app);
    const nextInput = dom.targetsList.querySelector(`[data-target-input="${Math.min(index, app.draft.targetLabels.length - 1)}"]`);
    if (nextInput) nextInput.focus();
    scheduleSave(dom, app);
  });

  dom.addTarget.addEventListener('click', () => {
    if (app.busy || app.draft.targetLabels.length >= MN1_LIMITS.TARGETS_MAX) return;
    app.draft.targetLabels.push('');
    markDirty(app);
    renderTargetsEditor(dom, app);
    renderCounts(dom, app);
    renderPreview(dom, app);
    if (app.validationShown) renderValidation(dom, app);
    const inputs = dom.targetsList.querySelectorAll('[data-target-input]');
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
    scheduleSave(dom, app);
  });

  dom.profileList.addEventListener('click', (event) => {
    const coverButton = event.target.closest('[data-edit-cover]');
    if (coverButton) {
      if (coverButton.disabled) return;
      event.preventDefault();
      openCoverDialog(dom, app, coverButton.dataset.editCover);
      return;
    }
    const card = event.target.closest('.profile-card[data-profile-id]');
    if (!card || card.disabled) return;
    void handleSelectProfile(dom, app, card.dataset.profileId);
  });

  if (dom.addTeam) {
    dom.addTeam.addEventListener('click', () => openAddTeamDialog(dom, app));
  }
  if (dom.addTeamInput) {
    dom.addTeamInput.addEventListener('input', () => {
      if (app.addTeamSubmitted) validateAddTeamDraft(dom, app);
      else setAddTeamError(dom, '');
    });
    dom.addTeamInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (!dom.addTeamCreate?.disabled) void handleCreateTeam(dom, app);
    });
  }
  if (dom.addTeamCreate) {
    dom.addTeamCreate.addEventListener('click', () => void handleCreateTeam(dom, app));
  }
  if (dom.addTeamCancel) {
    dom.addTeamCancel.addEventListener('click', () => closeAddTeamDialog(dom));
  }
  if (dom.addTeamClose) {
    dom.addTeamClose.addEventListener('click', () => closeAddTeamDialog(dom));
  }
  if (dom.addTeamDialog) {
    dom.addTeamDialog.addEventListener('click', (event) => {
      if (event.target === dom.addTeamDialog) closeAddTeamDialog(dom);
    });
    dom.addTeamDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeAddTeamDialog(dom);
    });
    dom.addTeamDialog.addEventListener('close', () => {
      app.addTeamSubmitted = false;
      setAddTeamError(dom, '');
    });
  }

  if (dom.coverUseAnnouncement) {
    dom.coverUseAnnouncement.addEventListener('click', () => chooseCoverMode(dom, app, 'announcement'));
  }
  if (dom.coverNoImage) {
    dom.coverNoImage.addEventListener('click', () => chooseCoverMode(dom, app, 'none'));
  }
  if (dom.coverPickImage) {
    dom.coverPickImage.addEventListener('click', () => void handleCoverPickImage(dom, app));
  }
  for (const button of dom.coverBlurButtons ?? []) {
    button.addEventListener('click', () => setCoverBlur(dom, app, button.dataset.coverBlur));
  }
  if (dom.coverShade) {
    dom.coverShade.addEventListener('input', () => setCoverShade(dom, app, dom.coverShade.value));
  }
  document.getElementById('delete-team').addEventListener('click', () => void changeTeamVisibility(dom, app, app.coverDraft?.profileId, true));
  document.getElementById('restore-team').addEventListener('click', () => void changeTeamVisibility(dom, app, document.getElementById('restore-team-select').value, false));
  if (dom.coverSave) {
    dom.coverSave.addEventListener('click', () => void handleCoverSave(dom, app));
  }
  if (dom.coverCancel) {
    dom.coverCancel.addEventListener('click', () => closeCoverDialog(dom, app));
  }
  if (dom.coverClose) {
    dom.coverClose.addEventListener('click', () => closeCoverDialog(dom, app));
  }
  if (dom.coverImageInput) {
    dom.coverImageInput.addEventListener('change', () => {
      const file = dom.coverImageInput.files?.[0] ?? null;
      dom.coverImageInput.value = '';
      if (file) void handleCoverPickFile(dom, app, file);
    });
  }
  if (dom.coverDialog) {
    dom.coverDialog.addEventListener('click', (event) => {
      if (event.target === dom.coverDialog) closeCoverDialog(dom, app);
    });
    dom.coverDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeCoverDialog(dom, app);
    });
    dom.coverDialog.addEventListener('close', () => {
      if (!app.coverDraft?.saving) {
        app.coverDraft = null;
        setCoverError(dom, '');
        if (dom.coverPreview) dom.coverPreview.replaceChildren();
      }
    });
  }

  if (dom.backToTeams) {
    dom.backToTeams.addEventListener('click', () => void handleBackToTeams(dom, app));
  }
  if (dom.openAbout) {
    dom.openAbout.addEventListener('click', () => openAboutDialog(dom));
  }
  if (dom.editorAbout) {
    dom.editorAbout.addEventListener('click', () => openAboutDialog(dom));
  }
  if (dom.closeAbout) {
    dom.closeAbout.addEventListener('click', () => closeAboutDialog(dom));
  }
  if (dom.aboutDialog) {
    dom.aboutDialog.addEventListener('click', (event) => {
      if (event.target === dom.aboutDialog) closeAboutDialog(dom);
    });
    dom.aboutDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeAboutDialog(dom);
    });
    dom.aboutDialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeAboutDialog(dom);
    });
  }
  for (const button of dom.editorTools ?? []) {
    const tool = resolveEditorTool(button.dataset?.editorTool);
    if (!tool) continue;
    button.addEventListener('click', () => {
      const next = toggleEditorTool(app.editorTool, tool);
      selectEditorTool(dom, app, next, { focus: next !== null });
    });
  }
  if (dom.closeTool) {
    dom.closeTool.addEventListener('click', () => {
      const previous = app.editorTool;
      selectEditorTool(dom, app, null);
      focusEditorTool(dom, previous);
    });
  }
  if (dom.toolDrawer) {
    dom.toolDrawer.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || app.editorTool === null) return;
      event.preventDefault();
      const previous = app.editorTool;
      selectEditorTool(dom, app, null);
      focusEditorTool(dom, previous);
    });
  }

  dom.importImage.addEventListener('click', () => void handleImportImage(dom, app));
  dom.pickImage.addEventListener('click', () => void handleLegacyPickImage(dom, app));
  dom.openEditor.addEventListener('click', () => void handleLegacyOpenEditor(dom, app));
  dom.refreshState.addEventListener('click', () => void handleRefresh(dom, app));
  dom.saveTemplate.addEventListener('click', () => {
    if (app.uiMode === 'legacy') void handleLegacySave(dom, app);
    else void handleWorkspaceSave(dom, app);
  });
  dom.prepareShare.addEventListener('click', () => {
    if (app.uiMode === 'legacy') void handleLegacyShare(dom, app);
    else if (app.uiMode === 'workspace') void handleWorkspaceShare(dom, app);
    else showStatus(dom, 'El compartir nativo necesita la app BASE. En navegador usa «Descargar PNG».', 'warning');
  });
  dom.downloadPng.addEventListener('click', () => void handleDownloadPng(dom, app));

  dom.browserImageInput.addEventListener('change', () => {
    const file = dom.browserImageInput.files?.[0] ?? null;
    dom.browserImageInput.value = '';
    if (file) void handleBrowserFile(dom, app, file);
  });

  const updateOverlay = () => {
    app.draft.overlay = normalizeOverlay({
      ...app.draft.overlay,
      x: Number(dom.overlayX.value) / 100,
      y: Number(dom.overlayY.value) / 100,
      size: Number(dom.overlaySize.value) / 100,
      font: dom.overlayFont.value,
      color: dom.overlayColor.value,
      showDate: dom.overlayShowDate.checked,
      date: dom.overlayDate.value,
    });
    markDirty(app);
    renderOverlayControls(dom, app);
    renderImage(dom, app);
    scheduleSave(dom, app);
  };
  dom.overlayX.addEventListener('input', updateOverlay);
  dom.overlayY.addEventListener('input', updateOverlay);
  dom.overlaySize.addEventListener('input', updateOverlay);
  dom.overlayFont.addEventListener('change', updateOverlay);
  dom.overlayColor.addEventListener('input', updateOverlay);
  dom.overlayShowDate.addEventListener('change', () => {
    if (dom.overlayShowDate.checked && !dom.overlayDate.value) {
      dom.overlayDate.value = new Date().toISOString().slice(0, 10);
    }
    updateOverlay();
  });
  dom.overlayDate.addEventListener('input', updateOverlay);
  dom.resetOverlay.addEventListener('click', () => {
    app.draft.overlay = normalizeOverlay({
      ...app.draft.overlay,
      x: 0.5,
      y: 0.78,
      size: 0.075,
      font: 'bold',
      color: '#ffffff',
      showDate: false,
      date: '',
    });
    markDirty(app);
    renderOverlayControls(dom, app);
    renderImage(dom, app);
    scheduleSave(dom, app);
  });

  if (dom.overlaySmaller) {
    dom.overlaySmaller.addEventListener('click', () => changeOverlaySize(dom, app, 'smaller'));
  }
  if (dom.overlayBigger) {
    dom.overlayBigger.addEventListener('click', () => changeOverlaySize(dom, app, 'bigger'));
  }
  for (const button of dom.fontChoices ?? []) {
    button.addEventListener('click', () => {
      chooseOverlayFont(dom, app, choiceValue(button, 'fontChoice', 'data-font-choice'));
    });
  }
  for (const button of dom.colorChoices ?? []) {
    button.addEventListener('click', () => {
      chooseOverlayColor(dom, app, choiceValue(button, 'colorChoice', 'data-color-choice'));
    });
  }

  if (dom.lockOverlay) {
    dom.lockOverlay.addEventListener('click', () => toggleOverlayLock(dom, app));
  }

  dom.canvasPreview.addEventListener('pointerdown', (event) => {
    if (!canEditOverlayByPointer({
      overlay: app.draft.overlay,
      busy: app.busy,
      workspace: isWorkspace(app),
      hasImage: isPngDataUrl(app.imageDataUrl),
    })) return;
    app.dragging = true;
    if (typeof dom.canvasPreview.setPointerCapture === 'function') {
      try {
        dom.canvasPreview.setPointerCapture(event.pointerId);
      } catch {
        // El arrastre sigue funcionando con pointermove.
      }
    }
    updateOverlayFromPointer(dom, app, event);
  });
  dom.canvasPreview.addEventListener('pointermove', (event) => {
    if (!canMoveOverlayByPointer(app.dragging, app.draft.overlay)) return;
    updateOverlayFromPointer(dom, app, event);
  });
  const stopDragging = () => {
    if (!app.dragging) return;
    app.dragging = false;
    scheduleSave(dom, app);
  };
  dom.canvasPreview.addEventListener('pointerup', stopDragging);
  dom.canvasPreview.addEventListener('pointercancel', stopDragging);
  dom.canvasPreview.addEventListener('pointerleave', stopDragging);

  dom.speakToggle.addEventListener('click', () => void handleSpeak(dom, app));
  dom.applyProposal.addEventListener('click', () => void handleApplyProposal(dom, app));

  dom.previewImage.addEventListener('error', () => {
    if (!dom.previewImage.getAttribute('src')) return;
    app.legacyImageDataUrl = null;
    renderImage(dom, app);
    showStatus(dom, 'No se pudo mostrar el PNG recibido. La app puede regenerarlo; no se inventa una vista previa.', 'warning');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && app.listening) {
      void cancelSpeech(dom, app, { quiet: true });
    }
    handleResume(dom, app);
  });
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

function consumeWidgetHash(dom, app) {
  if (typeof window === 'undefined' || !isWidgetHash(window.location?.hash)) return;
  const hash = workspaceRouteFor(app.workspace?.activeProfileId, {
    view: WORKSPACE_VIEW_OPEN,
    catalog: app.catalog,
  });
  try {
    window.history?.replaceState?.(null, '', hash);
  } catch {
    // La navegación interna sigue funcionando aunque history esté restringido.
  }
}

async function handleWidgetOpen(dom, app, source = 'warm') {
  if (!isWorkspace(app) || !app.workspace) {
    showStatus(dom, 'El widget no pudo abrir el equipo: el workspace no está disponible. No se cambió nada.', 'warning');
    return false;
  }
  if (app.widgetOpening) return false;
  app.widgetOpening = true;
  try {
    const profile = activeProfileOf(app);
    const defaultHour = profile
      ? normalizeDefaultHour(app.draft.defaultHour, app.draft.quickHours)
      : '';
    const result = await openWidgetDefault({
      defaultHour,
      isBusy: app.busy === true,
      isListening: app.listening === true,
      flushSave: () => flushDraftBeforeLeaving(dom, app),
      applyDefaultHour: (hour) => {
        app.draft.hour = hour;
        markDirty(app);
      },
      openEditor: () => {
        app.workspaceView = WORKSPACE_VIEW_OPEN;
        app.editorTool = 'hour';
        clearError(dom, app);
        renderAll(dom, app, { syncFields: true });
        consumeWidgetHash(dom, app);
        focusEditorTool(dom, 'hour');
        scheduleSave(dom, app);
      },
      consumeHash: () => consumeWidgetHash(dom, app),
      report: (reason) => {
        if (reason === 'busy') {
          showStatus(dom, 'El widget esperó, pero hay una acción en curso. No se cambió la hora ni se abrió el editor.', 'warning');
        } else if (reason === 'listening') {
          showStatus(dom, 'El widget no abrió el editor porque hay una escucha activa. Deténla y vuelve a tocar el widget.', 'warning');
        } else if (reason === 'missing_default') {
          showStatus(dom, 'Este equipo no tiene una hora válida para el widget. No se abrió el editor.', 'warning');
        } else if (reason === 'save_failed') {
          showError(dom, 'No se abrió la hora del widget: el borrador actual no se pudo guardar. No se cambió la hora ni se envió nada.', app);
        } else if (reason === 'apply_failed' || reason === 'open_failed') {
          showError(dom, 'No se pudo aplicar la hora del widget ni abrir el editor. No se envió nada.', app);
        } else if (reason === 'opened') {
          showStatus(dom, `Hora del widget aplicada: ${defaultHour}.`, 'info');
        }
      },
    });
    return result.ok;
  } finally {
    app.widgetOpening = false;
  }
}

function wireWidgetLaunch(dom, app) {
  const queue = createWidgetOpenQueue();
  app.widgetQueue = queue;
  const cold = typeof window !== 'undefined' && isWidgetHash(window.location?.hash);
  if (cold) queue.enqueue('cold');
  window.addEventListener(WIDGET_OPEN_EVENT, () => {
    app.startupWidgetRequested=true;
    if (!queue.enqueue('warm')) void handleWidgetOpen(dom, app, 'warm');
  });
  return async function processWidgetLaunch() {
    const pending = queue.markHydrated();
    app.hydrated = true;
    if (pending.length === 0) return false;
    let opened = false;
    for (const source of pending) {
      opened = await handleWidgetOpen(dom, app, source);
      if (opened) break;
    }
    return opened;
  };
}

export const REPORT_WIDGET_HASH = '#report-widget';
export async function openWidgetReport(options={}) {
  if(options.isBusy||options.isListening||!options.activeProfileId)return false;
  if(!await options.flushSave())return false;
  const opened=await options.openReport({fromWidget:true});
  if(opened===false)return false;
  options.consumeHash?.();return true;
}
function wireReportWidgetLaunch(dom,app) {
  const queue=createWidgetOpenQueue();
  const cold=window.location?.hash===REPORT_WIDGET_HASH;if(cold)queue.enqueue('cold');
  const open=async()=>{
    if(app.reportWidgetOpening||!app.reportStudio)return false;
    app.reportWidgetOpening=true;
    try{return await openWidgetReport({isBusy:app.busy||app.switching,isListening:app.listening,activeProfileId:app.workspace?.activeProfileId,flushSave:()=>flushDraftBeforeLeaving(dom,app),openReport:options=>{app.selectedPlantId=plantForTeam(getProfileDefinition(app.workspace?.activeProfileId,{catalog:app.catalog}));return app.reportStudio.open(options);},consumeHash:()=>{if(window.location.hash===REPORT_WIDGET_HASH)window.history?.replaceState?.(null,'','#equipos');}});}catch(error){showError(dom,'No se pudo abrir el reporte del widget. '+(error.message||''),app);return false;}finally{app.reportWidgetOpening=false;}
  };
  window.addEventListener('mn1:report-open',()=>{app.startupWidgetRequested=true;if(!queue.enqueue('warm'))void open();});
  return async()=>{const pending=queue.markHydrated();if(pending.length)await open();};
}

async function boot() {
  const dom = collectDom();
  if (!dom.main || !dom.messageInput || !dom.previewMessage) return;
  const startupFromWidget=isWidgetHash(window.location?.hash)||window.location?.hash===REPORT_WIDGET_HASH;

  const bridge = createMn1Bridge({ root: window });
  const app = {
    dom,
    bridge,
    mode: bridge.mode,
    connection: bridge.mode === 'native' ? 'checking' : 'preview',
    uiMode: 'loading',
    teamToolsOpen: false,
    toolShortcuts: {},
    plantNavigation: true,
    selectedPlantId: null,
    workspaceView: WORKSPACE_VIEW_TEAMS,
    editorTool: null,
    navigationError: '',
    catalog: PROFILE_CATALOG,
    addTeamSubmitted: false,
    capabilitySet: new Set(),
    workspace: null,
    draft: createDefaultDraft(),
    storage: null,
    persistent: false,
    storageBlocked: false,
    migrationNotice: '',
    migrationPending: false,
    legacyImageDataUrl: null,
    imageDataUrl: null,
    pendingImageRemovals: [],
    loadedImage: null,
    loadedImageUrl: '',
    imageLoadToken: 0,
    drawToken: 0,
    dirty: false,
    draftRevision: 0,
    persistedRevision: 0,
    saveChain: Promise.resolve(),
    saveFailed: false,
    busy: false,
    switching: false,
    validationShown: false,
    refreshInFlight: false,
    nativeVersion: '',
    pendingResume: '',
    lastResumeAt: 0,
    protocolMismatch: false,
    proposal: null,
    listening: false,
    speechToken: 0,
    dragging: false,
    saveTimer: null,
    lastSavedAt: '',
    hydrated: false,
    widgetOpening: false,
    widgetQueue: null,
    starterSeedState: 'idle',
    starterSeedResult: null,
    coverDraft: null,
    cardThumbnailCache: null,
  };

  const processWidgetLaunch = wireWidgetLaunch(dom, app);
  const processReportWidgetLaunch = wireReportWidgetLaunch(dom, app);
  window.addEventListener('resize', syncEditorViewport);
  window.visualViewport?.addEventListener('resize', syncEditorViewport);
  window.requestAnimationFrame(syncEditorViewport);
  renderAll(dom, app);
  readVersion(dom, app);
  wireUiEvents(dom, app);
  for (const button of document.querySelectorAll('[data-plant]')) button.addEventListener('click',()=>{
    if (!selectPlant(app,button.dataset.plant)) return;
    app.startupNavigationChosen=true;
    void rememberSelectedPlant(app.storage,app.selectedPlantId).catch(()=>showError(dom,'No se pudo recordar la planta. Tus equipos se conservan.',app));
    renderAll(dom,app,{syncFields:true});dom.teamsScreen?.focus();
  });
  document.getElementById('back-to-plants').addEventListener('click',()=>{
    app.startupNavigationChosen=true;
    app.selectedPlantId=null;app.workspaceView=WORKSPACE_VIEW_TEAMS;
    renderAll(dom,app,{syncFields:true});dom.welcomeScreen?.focus();
  });

  if (app.mode === 'native') {
    await hydrateNative(dom, app);
  } else {
    await hydrateBrowser(dom, app);
  }
  try {
    if (app.selectedPlantId) await rememberSelectedPlant(app.storage,app.selectedPlantId);
    else app.selectedPlantId=await readSelectedPlant(app.storage);
  } catch { showError(dom,'No se pudo leer la planta guardada. Puedes elegirla de nuevo.',app); }
  if(app.workspace) {
    try {
      await restoreTeamToolsSession({storage:app.storage,catalog:app.catalog,activeProfileId:app.workspace.activeProfileId,fromWidget:startupFromWidget,navigationChanged:()=>app.startupNavigationChosen===true||app.startupWidgetRequested===true,selectProfile:id=>switchWorkspaceProfile(dom,app,id),openTools:id=>openTeamTools(dom,app,id)});
    } catch { showStatus(dom,'No se pudo recuperar el equipo guardado. Puedes elegirlo de nuevo; tus datos se conservan.','warning'); }
  }
  renderAll(dom,app,{syncFields:true});
  window.mn1HandleBack = () => handleAppBack(dom,app);
  document.getElementById('tools-back-teams').addEventListener('click',()=>{app.teamToolsOpen=false;renderAll(dom,app,{syncFields:true});dom.teamsScreen?.focus();});
  wireTeamLogo(dom, app);
  installIsoCalendar({storage:app.storage});
  const toolLibrary=createTeamToolLibrary({getTeam:()=>getProfileDefinition(app.workspace?.activeProfileId,{catalog:app.catalog}),onRequest:(toolId,teamId)=>app.cloud?.requestTool(toolId,teamId)});
  document.getElementById('open-tool-library').addEventListener('click',()=>{if(!app.busy&&!app.switching)toolLibrary.open();});
  document.getElementById('open-announcement').addEventListener('click',()=>launchTeamTool(dom,app,'announcement'));
  const shortcutsDialog=document.getElementById('shortcuts-dialog');
  document.getElementById('manage-shortcuts').addEventListener('click',()=>{
    const definition=getProfileDefinition(app.workspace.activeProfileId,{catalog:app.catalog});
    syncToolAvailability(document,definition);
    const chosen=toolShortcutsForTeam(app.toolShortcuts[app.workspace.activeProfileId],definition);
    for(const input of shortcutsDialog.querySelectorAll('[data-shortcut]'))input.checked=chosen.includes(input.value);
    document.getElementById('shortcuts-error').textContent='';shortcutsDialog.showModal();
  });
  document.getElementById('shortcuts-close').addEventListener('click',()=>shortcutsDialog.close());
  document.getElementById('shortcuts-save').addEventListener('click',async()=>{
    const id=app.workspace.activeProfileId,button=document.getElementById('shortcuts-save');button.disabled=true;
    const definition=getProfileDefinition(id,{catalog:app.catalog});
    const selected=toolShortcutsForTeam([...shortcutsDialog.querySelectorAll('[data-shortcut]:checked')].map(input=>input.value),definition);
    try{await app.storage.putText(teamShortcutsKey(id),JSON.stringify(selected));app.toolShortcuts[id]=selected;renderTeamTools(dom,app);shortcutsDialog.close();}
    catch{document.getElementById('shortcuts-error').textContent='No se pudieron guardar los accesos. Inténtalo de nuevo.';}
    finally{button.disabled=false;}
  });
  installSettings(app.capabilitySet.has('settings-menu-v1'));
  await installThemes(app.storage);
  installCoffeeLink({native:app.mode==='native',canOpenExternal:app.capabilitySet.has('paypal-external-v1')});
  installContactCopy();
  app.reportStudio=createMeetingReport(() => ({activeProfileId:app.workspace?.activeProfileId,onClose:()=>{app.teamToolsOpen=true;if(!app.selectedPlantId)app.selectedPlantId=plantForTeam(getProfileDefinition(app.workspace?.activeProfileId,{catalog:app.catalog}));app.workspaceView=WORKSPACE_VIEW_TEAMS;app.editorTool=null;renderAll(dom,app,{syncFields:true});},mode:app.mode,bridge:app.bridge,capabilities:app.capabilitySet||new Set(),storage:app.storage,catalog:app.catalog,plantId:app.selectedPlantId || plantForTeam(getProfileDefinition(app.workspace?.activeProfileId,{catalog:app.catalog})),blocked:app.busy||app.switching}));
  const exportProduction = async (report, catalog, downloadOnly = false) => {
    const native = app.mode === 'native';
    if(native && !app.capabilitySet.has(CAPABILITIES.SHARE_PDF)) throw Error('Para compartir PDF, abre Settings → Actualizaciones y actualiza desde la app. El borrador queda guardado.');
    const bytes = createProductionPdf(report,catalog);
    const fileName = productionReportFileName(report), message = productionShareMessage(report);
    if(native){const result=await app.bridge.request('SHARE_PDF',{pdfDataUrl:pdfBytesDataUrl(bytes),fileName,message},{timeoutMs:300000});if(!result.ok)throw Error(result.message);return result.message;}
    const blob=new Blob([bytes],{type:'application/pdf'});
    const file=new File([blob],fileName,{type:'application/pdf'});
    if(!downloadOnly && navigator.canShare?.({files:[file]}) && navigator.share){await navigator.share({files:[file],text:message,title:'Reporte de planta'});return 'Selector cerrado. Comprueba el envío en la aplicación elegida.';}
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=fileName;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return 'PDF preparado para descargar. Puedes adjuntarlo en WhatsApp y confirmar el envío.';
  };
  app.productionStudio=createProductionStudio(()=>({storage:app.storage,onClose:()=>{app.teamToolsOpen=true;renderAll(dom,app,{syncFields:false});dom.teamToolsHome?.focus();},onShare:(report,catalog)=>exportProduction(report,catalog),onDownload:app.mode==='native'?null:(report,catalog)=>exportProduction(report,catalog,true)}));
  document.getElementById('open-production').addEventListener('click',()=>launchTeamTool(dom,app,'production'));
  app.laminationStudio=createLaminationStudio(()=>({storage:app.storage}));
  document.getElementById('open-lamination').addEventListener('click',()=>launchTeamTool(dom,app,'lamination'));
  await seedStarterImagesOnBoot(dom, app);
  app.cloud=createCloudWorkspace(()=>({bridge:app.bridge,mode:app.mode,openTeamSpace:async id=>{if(app.busy||app.switching)return false;if(!(await flushDraftBeforeLeaving(dom,app)))return false;if(id!==app.workspace?.activeProfileId&&!(await switchWorkspaceProfile(dom,app,id)))return false;return openTeamTools(dom,app,id);},openPersonalSpace:async()=>{if(app.busy||app.switching)return false;if(!(await flushDraftBeforeLeaving(dom,app)))return false;const id=app.workspace?.activeProfileId;const definition=getProfileDefinition(id,{catalog:app.catalog});if(definition&&(!app.selectedPlantId||plantForTeam(definition)===app.selectedPlantId)){openTeamTools(dom,app,id);}else{app.teamToolsOpen=false;app.workspaceView=WORKSPACE_VIEW_TEAMS;app.editorTool=null;renderAll(dom,app,{syncFields:true});}return true;},isEditing:()=>app.busy||app.dirty||app.workspaceView===WORKSPACE_VIEW_OPEN||Boolean(document.querySelector('dialog[open]:not(#cloud-dialog)'))||!document.getElementById('report-studio').hidden||app.productionStudio?.isOpen(),activeProfileId:app.workspace?.activeProfileId,storage:app.storage,catalog:app.catalog,blocked:()=>app.changingTeam||app.busy||app.switching||app.listening||app.dirty||app.workspaceView===WORKSPACE_VIEW_OPEN||Boolean(document.querySelector('dialog[open]'))||!document.getElementById('admin-dashboard').hidden||!document.getElementById('report-studio').hidden||app.productionStudio?.isOpen(),flush:()=>flushDraftBeforeLeaving(dom,app),setSyncing:value=>{document.getElementById('sync-indicator').hidden=!value;},setLocked:value=>{app.cloudManualBusy=value;app.busy=value;renderAll(dom,app,{syncFields:false});},commitReceive:async task=>{const manual=app.cloudManualBusy===true;if((app.busy&&!manual)||app.switching||app.dirty||app.listening||(!manual&&(app.workspaceView===WORKSPACE_VIEW_OPEN||!document.getElementById('report-studio').hidden||app.productionStudio?.isOpen()||document.querySelector('dialog[open]'))))throw Object.assign(Error('Se aplaza la recepción mientras trabajas.'),{code:'deferred'});const wasBusy=app.busy;app.busy=true;try{return await enqueueStorageTask(app,task);}finally{app.busy=wasBusy;}},applyState:async state=>{app.workspace=normalizeWorkspaceState(state);app.catalog=profileCatalogForWorkspace(app.workspace);app.draft=cloneDraftFromProfile(activeProfileOf(app));app.cardThumbnailCache=null;app.loadedImage=null;app.loadedImageUrl='';app.dirty=false;app.persistedRevision=app.draftRevision;await loadActiveImage(app);renderAll(dom,app,{syncFields:true});}}));
  void app.cloud.start();
  await processWidgetLaunch();
  await processReportWidgetLaunch();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}

async function changeTeamVisibility(dom, app, id, archived) {
  if (app.busy || app.switching || app.changingTeam || !id || app.storageBlocked) return;
  const name = getProfileDefinition(id, {customProfiles:app.workspace.customProfiles})?.name || 'equipo';
  if (archived && !confirm('¿Borrar «' + name + '» de este teléfono? Sus imágenes y ajustes se conservarán para restaurarlo desde Agregar equipo. No se borrará de otros teléfonos.')) return;
  app.changingTeam = true;
  setBusy(dom, app, true, archived ? 'Quitando equipo…' : 'Restaurando equipo…');
  try {
    if (!await flushDraftBeforeLeaving(dom, app)) return;
    const next = setTeamArchived(app.workspace, id, archived);
    await enqueueStorageTask(app, () => app.storage.putText(WORKSPACE_KEYS.state, JSON.stringify(next)));
    app.workspace = next; app.catalog = profileCatalogForWorkspace(next);
    app.draft = cloneDraftFromProfile(activeProfileOf(app));
    app.cardThumbnailCache = null;
    app.workspaceView = WORKSPACE_VIEW_OPEN;
    closeCoverDialog(dom, app); closeAddTeamDialog(dom);
    await loadActiveImage(app); renderAll(dom, app, {syncFields:true});
    showStatus(dom, archived ? 'Equipo quitado de este teléfono. Puedes restaurarlo desde Agregar equipo.' : 'Equipo restaurado con sus imágenes y ajustes.', 'success');
  } catch (error) { showError(dom, error.message || 'No se pudo guardar el cambio.', app); }
  finally { app.changingTeam = false; setBusy(dom, app, false); }
}
