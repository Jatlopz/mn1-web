/*
 * Herramientas del editor único (web 0.5.5).
 *
 * El contrato no tiene pestañas ni pantallas separadas: el HERO presenta el
 * anuncio y un drawer inferior muestra como máximo un formulario. Estos tests
 * cubren apertura, alternancia, exclusividad, cierre, HERO permanente y que el
 * estado guardable no se altere al navegar por las herramientas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EDITOR_TOOLS,
  OVERLAY_SIZE_STEP,
  WORKSPACE_VIEW_OPEN,
  WORKSPACE_VIEW_TEAMS,
  applyWorkspaceNavigation,
  resolveEditorTool,
  stepOverlaySize,
  toggleEditorTool,
} from '../public/app.js';

const TOOL_PANELS = {
  hour: 'editor-panel',
  message: 'template-panel',
  voice: 'voice-panel',
};

const TOOL_TITLES = {
  hour: 'Hora y texto',
  message: 'Mensaje y destinos',
  voice: 'Dictado',
};

function fakeElement(options = {}) {
  const attributes = new Map(Object.entries(options.attributes ?? {}));
  return {
    hidden: options.hidden ?? false,
    id: options.id ?? '',
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

function buildEditorDom() {
  return {
    appHeader: fakeElement({ hidden: true }),
    appFooter: fakeElement({ hidden: true }),
    teamsScreen: fakeElement({ hidden: true }),
    main: fakeElement({ hidden: false }),
    workspaceTitle: fakeElement({ textContent: 'Los Champions' }),
    previewNote: fakeElement({ hidden: true }),
    heroPanel: fakeElement({ id: 'hero-panel', hidden: false }),
    toolDrawer: fakeElement({ id: 'tool-drawer', hidden: true }),
    closeTool: fakeElement({ id: 'close-tool', hidden: true }),
    toolTitle: fakeElement({ id: 'tool-title' }),
    editorTools: EDITOR_TOOLS.map((tool) => fakeElement({
      dataset: { editorTool: tool },
      attributes: { 'aria-controls': TOOL_PANELS[tool] },
    })),
    toolPanels: EDITOR_TOOLS.map((tool) => ({
      tool,
      element: fakeElement({ id: TOOL_PANELS[tool], hidden: true }),
    })),
  };
}

function baseApp(overrides = {}) {
  return {
    uiMode: 'browser',
    workspaceView: WORKSPACE_VIEW_OPEN,
    editorTool: null,
    workspace: {
      activeProfileId: 'champions',
      profiles: {},
    },
    draft: {
      message: 'Entrenamos a las {hora}',
      hour: '08:00',
      targetLabels: ['Planta 1', 'Planta 2'],
      overlay: {
        x: 0.5,
        y: 0.78,
        size: 0.075,
        font: 'bold',
        color: '#ffffff',
        showDate: false,
        date: '',
      },
      imageKey: 'mn1-image-champions',
    },
    ...overrides,
  };
}

function visibleToolPanels(dom) {
  return dom.toolPanels
    .filter((panel) => panel.element.hidden === false)
    .map((panel) => panel.tool);
}

test('null significa drawer cerrado y la misma herramienta alterna a cerrado', () => {
  assert.equal(resolveEditorTool(null), null);
  assert.equal(resolveEditorTool('preview'), null);
  assert.equal(resolveEditorTool('hour'), 'hour');

  assert.equal(toggleEditorTool(null, 'hour'), 'hour');
  assert.equal(toggleEditorTool('hour', 'message'), 'message');
  assert.equal(toggleEditorTool('message', 'message'), null);
  assert.equal(toggleEditorTool('voice', 'desconocida'), null);
});

test('el tamaño del rótulo avanza ±0.005 y respeta los límites', () => {
  assert.equal(OVERLAY_SIZE_STEP, 0.005);
  assert.equal(stepOverlaySize(0.075, 'bigger'), 0.08);
  assert.equal(stepOverlaySize(0.075, 'smaller'), 0.07);
  assert.equal(stepOverlaySize(0.025, 'smaller'), 0.025);
  assert.equal(stepOverlaySize(0.18, 'bigger'), 0.18);
  assert.equal(stepOverlaySize(0.178, 'bigger'), 0.18);
  assert.equal(stepOverlaySize(0.075, 'otra'), 0.075);
  assert.equal(stepOverlaySize('no-numero', 'bigger'), 0.08);
});

test('abrir cada herramienta mantiene el HERO visible y muestra sólo su formulario', () => {
  const dom = buildEditorDom();
  const app = baseApp();

  for (const tool of EDITOR_TOOLS) {
    app.editorTool = tool;
    applyWorkspaceNavigation(dom, app);

    assert.equal(dom.main.hidden, false);
    assert.equal(dom.heroPanel.hidden, false, `HERO visible con ${tool}`);
    assert.equal(dom.toolDrawer.hidden, false, `drawer visible con ${tool}`);
    assert.equal(dom.closeTool.hidden, false);
    assert.equal(dom.toolTitle.textContent, TOOL_TITLES[tool]);
    assert.deepEqual(visibleToolPanels(dom), [tool], `sólo ${tool} debe estar abierto`);

    for (const button of dom.editorTools) {
      assert.equal(
        button.getAttribute('aria-expanded'),
        String(button.dataset.editorTool === tool),
      );
      assert.equal(button.getAttribute('aria-controls'), TOOL_PANELS[button.dataset.editorTool]);
    }
  }
});

test('cerrar el drawer no oculta el HERO ni deja un formulario visible', () => {
  const dom = buildEditorDom();
  const app = baseApp({ editorTool: 'voice' });

  applyWorkspaceNavigation(dom, app);
  assert.deepEqual(visibleToolPanels(dom), ['voice']);

  const clicked = toggleEditorTool(app.editorTool, 'voice');
  app.editorTool = clicked;
  applyWorkspaceNavigation(dom, app);

  assert.equal(app.editorTool, null);
  assert.equal(dom.heroPanel.hidden, false);
  assert.equal(dom.toolDrawer.hidden, true);
  assert.equal(dom.closeTool.hidden, true);
  assert.deepEqual(visibleToolPanels(dom), []);
  for (const button of dom.editorTools) {
    assert.equal(button.getAttribute('aria-expanded'), 'false');
  }
});

test('tras importar una imagen el drawer se cierra y el HERO sigue visible', () => {
  const dom = buildEditorDom();
  const app = baseApp({ editorTool: 'hour' });

  applyWorkspaceNavigation(dom, app);
  assert.equal(dom.toolDrawer.hidden, false);

  // handleImportImage/applyImportedImage vuelven a editorTool = null.
  app.editorTool = null;
  applyWorkspaceNavigation(dom, app);

  assert.equal(dom.heroPanel.hidden, false);
  assert.equal(dom.toolDrawer.hidden, true);
  assert.deepEqual(visibleToolPanels(dom), []);
});

test('las herramientas no modifican el borrador ni el equipo activo', () => {
  const dom = buildEditorDom();
  const app = baseApp();
  const beforeDraft = JSON.stringify(app.draft);
  const beforeWorkspace = JSON.stringify(app.workspace);

  for (const tool of ['hour', 'message', 'voice', null]) {
    app.editorTool = tool;
    applyWorkspaceNavigation(dom, app);
  }

  assert.equal(JSON.stringify(app.draft), beforeDraft);
  assert.equal(JSON.stringify(app.workspace), beforeWorkspace);
  assert.equal(dom.workspaceTitle.textContent, 'Los Champions');
});

test('el chrome global sólo se oculta dentro del editor', () => {
  const dom = buildEditorDom();
  const app = baseApp({ workspaceView: WORKSPACE_VIEW_TEAMS, editorTool: 'message' });

  applyWorkspaceNavigation(dom, app);
  assert.equal(dom.appHeader.hidden, false);
  assert.equal(dom.appFooter.hidden, false);
  assert.equal(dom.teamsScreen.hidden, false);
  assert.equal(dom.main.hidden, true);
  assert.equal(dom.toolDrawer.hidden, true);

  app.workspaceView = WORKSPACE_VIEW_OPEN;
  app.editorTool = 'message';
  applyWorkspaceNavigation(dom, app);
  assert.equal(dom.appHeader.hidden, true);
  assert.equal(dom.appFooter.hidden, true);
  assert.equal(dom.main.hidden, false);
  assert.equal(dom.heroPanel.hidden, false);
});
