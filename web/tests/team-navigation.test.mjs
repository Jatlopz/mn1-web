/*
 * Comportamiento de navegación de equipos (web 0.4.0).
 *
 * Estos tests no levantan un navegador: construyen el mínimo DOM de navegación
 * que el contrato exige (#teams-screen, #contenido, pestañas y paneles) y
 * comprueban el orden real de guardar/abrir, la exclusividad de paneles y la
 * salida sin pérdida del borrador.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_VERSION,
  WORKSPACE_TABS,
  WORKSPACE_VIEW_OPEN,
  WORKSPACE_VIEW_TEAMS,
  applyWorkspaceNavigation,
  isWorkspaceTab,
  leaveWorkspaceToTeams,
  navigateToProfile,
  resolveWorkspaceTab,
  workspaceDocumentTitle,
  workspaceRouteFor,
} from '../public/app.js';

function fakeElement(options = {}) {
  const attributes = new Map();
  return {
    hidden: options.hidden ?? false,
    dataset: { ...(options.dataset ?? {}) },
    textContent: options.textContent ?? '',
    classList: {
      toggle() {},
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    focus() {},
  };
}

function buildNavigationDom() {
  const tabs = WORKSPACE_TABS.map((tab) => fakeElement({ dataset: { workspaceTab: tab } }));
  const panels = WORKSPACE_TABS.map((tab) => ({
    tab,
    element: fakeElement({ dataset: { workspacePanel: tab } }),
  }));
  return {
    teamsScreen: fakeElement({ hidden: false }),
    main: fakeElement({ hidden: true }),
    workspaceTitle: fakeElement(),
    workspaceTabs: tabs,
    workspacePanels: panels,
    profileList: null,
  };
}

function baseApp(overrides = {}) {
  return {
    uiMode: 'browser',
    workspaceView: WORKSPACE_VIEW_TEAMS,
    workspaceTab: 'preview',
    workspace: {
      activeProfileId: 'champions',
      profiles: {},
    },
    ...overrides,
  };
}

test('APP_VERSION es 0.4.0 y las cuatro pestañas del contrato son válidas', () => {
  assert.equal(APP_VERSION, '0.4.0');
  assert.deepEqual([...WORKSPACE_TABS], ['preview', 'design', 'message', 'voice']);
  for (const tab of WORKSPACE_TABS) assert.equal(isWorkspaceTab(tab), true);
  assert.equal(isWorkspaceTab('otra'), false);
  assert.equal(resolveWorkspaceTab('otra'), 'preview');
  assert.equal(resolveWorkspaceTab('voice'), 'voice');
});

test('la ruta y el título reflejan el equipo y la vista', () => {
  assert.equal(workspaceRouteFor('champions'), '#equipo/champions');
  assert.equal(workspaceRouteFor('no-existe'), '#equipos');
  assert.equal(workspaceRouteFor('champions', { view: WORKSPACE_VIEW_TEAMS }), '#equipos');
  assert.equal(workspaceDocumentTitle('champions'), 'MN1 · Los Champions');
  assert.equal(
    workspaceDocumentTitle('champions', { view: WORKSPACE_VIEW_TEAMS }),
    'MN1 · Equipos',
  );
  assert.equal(
    workspaceDocumentTitle('indestructibles', { legacy: true }),
    'MN1 · Plantilla única (APK3)',
  );
});

test('main empieza oculto y sólo una pestaña queda visible al abrir', () => {
  const dom = buildNavigationDom();
  const app = baseApp();

  applyWorkspaceNavigation(dom, app);
  assert.equal(dom.teamsScreen.hidden, false);
  assert.equal(dom.main.hidden, true);
  for (const panel of dom.workspacePanels) assert.equal(panel.element.hidden, true);
  assert.equal(dom.workspaceTitle.textContent, 'Los Champions');

  app.workspaceView = WORKSPACE_VIEW_OPEN;
  app.workspaceTab = 'message';
  applyWorkspaceNavigation(dom, app);

  assert.equal(dom.teamsScreen.hidden, true);
  assert.equal(dom.main.hidden, false);
  const visible = dom.workspacePanels.filter((panel) => panel.element.hidden === false);
  assert.deepEqual(visible.map((panel) => panel.tab), ['message']);
  for (const button of dom.workspaceTabs) {
    assert.equal(button.getAttribute('aria-selected'), String(button.dataset.workspaceTab === 'message'));
    assert.equal(button.getAttribute('tabindex'), button.dataset.workspaceTab === 'message' ? '0' : '-1');
  }

  app.workspaceTab = 'inexistente';
  applyWorkspaceNavigation(dom, app);
  const fallbackVisible = dom.workspacePanels.filter((panel) => panel.element.hidden === false);
  assert.deepEqual(fallbackVisible.map((panel) => panel.tab), ['preview']);
});

test('tocar la tarjeta activa abre su plantilla sin guardar ni cambiar de equipo', async () => {
  const calls = [];
  const opened = await navigateToProfile({
    profileId: 'champions',
    activeProfileId: 'champions',
    switchProfile: async () => {
      calls.push('switch');
      return true;
    },
    openProfile: (profileId, meta) => calls.push(`open:${profileId}:${meta.switched}`),
  });

  assert.equal(opened, true);
  assert.deepEqual(calls, ['open:champions:false']);
});

test('cambiar de equipo guarda/carga primero y sólo después abre el nuevo', async () => {
  const calls = [];
  const opened = await navigateToProfile({
    profileId: 'espartanos',
    activeProfileId: 'champions',
    switchProfile: async (profileId) => {
      calls.push(`switch:${profileId}`);
      await Promise.resolve();
      return true;
    },
    openProfile: (profileId, meta) => calls.push(`open:${profileId}:${meta.switched}`),
  });

  assert.equal(opened, true);
  assert.deepEqual(calls, ['switch:espartanos', 'open:espartanos:true']);
});

test('si el guardado/carga falla, el equipo anterior sigue abierto y el error se informa', async () => {
  const calls = [];
  let blocked = '';
  const opened = await navigateToProfile({
    profileId: 'espartanos',
    activeProfileId: 'champions',
    switchProfile: async () => false,
    openProfile: (profileId) => calls.push(`open:${profileId}`),
    reportBlocked: (reason) => { blocked = reason; },
  });

  assert.equal(opened, false);
  assert.deepEqual(calls, []);
  assert.equal(blocked, 'switch_failed');

  const threw = await navigateToProfile({
    profileId: 'espartanos',
    activeProfileId: 'champions',
    switchProfile: async () => { throw new Error('vault'); },
    openProfile: (profileId) => calls.push(`open:${profileId}`),
    reportBlocked: (reason) => { blocked = reason; },
  });
  assert.equal(threw, false);
  assert.deepEqual(calls, []);
});

test('no se cambia ni se abre mientras hay escucha o una acción en curso', async () => {
  const calls = [];
  for (const state of ['listening', 'busy']) {
    let blocked = '';
    const result = await navigateToProfile({
      profileId: 'champions',
      activeProfileId: 'espartanos',
      isListening: state === 'listening',
      isBusy: state === 'busy',
      switchProfile: async () => { calls.push('switch'); return true; },
      openProfile: () => calls.push('open'),
      reportBlocked: (reason) => { blocked = reason; },
    });
    assert.equal(result, false);
    assert.equal(blocked, state);
  }
  assert.deepEqual(calls, []);
});

test('volver espera la escucha y el guardado vigente antes de mostrar equipos', async () => {
  const calls = [];
  const result = await leaveWorkspaceToTeams({
    isListening: true,
    cancelListening: async () => { calls.push('cancel-speech'); },
    flushSave: async () => { calls.push('flush-save'); return true; },
    showTeams: () => { calls.push('show-teams'); },
  });

  assert.equal(result, true);
  assert.deepEqual(calls, ['cancel-speech', 'flush-save', 'show-teams']);
});

test('un fallo de guardado al volver no bloquea la salida ni descarta el borrador', async () => {
  const calls = [];
  let error = null;
  const result = await leaveWorkspaceToTeams({
    isListening: false,
    flushSave: async () => false,
    showTeams: () => { calls.push('show-teams'); },
    onError: (cause) => { error = cause; },
  });

  assert.equal(result, false);
  assert.deepEqual(calls, ['show-teams']);
  assert.equal(error, null);
});

test('aplicar una propuesta de voz que cambia equipo actualiza título y ruta', () => {
  const dom = buildNavigationDom();
  const app = baseApp({
    workspaceView: WORKSPACE_VIEW_OPEN,
    workspaceTab: 'voice',
    workspace: {
      activeProfileId: 'champions',
      profiles: {},
    },
  });

  applyWorkspaceNavigation(dom, app);
  assert.equal(dom.workspaceTitle.textContent, 'Los Champions');
  assert.equal(workspaceRouteFor(app.workspace.activeProfileId), '#equipo/champions');

  // Lo que hace switchWorkspaceProfile al aceptar la propuesta de otro equipo.
  app.workspace.activeProfileId = 'espartanos';
  applyWorkspaceNavigation(dom, app);

  assert.equal(dom.workspaceTitle.textContent, 'Los Espartanos');
  assert.equal(workspaceRouteFor(app.workspace.activeProfileId), '#equipo/espartanos');
  const visible = dom.workspacePanels.filter((panel) => panel.element.hidden === false);
  assert.deepEqual(visible.map((panel) => panel.tab), ['voice']);
});
