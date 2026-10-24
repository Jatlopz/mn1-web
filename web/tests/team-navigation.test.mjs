/*
 * Comportamiento de navegación de equipos (web 0.5.12).
 *
 * Estos tests no levantan un navegador: construyen el mínimo DOM compartido del
 * editor único (#teams-screen, #contenido, HERO y drawer de herramientas) y
 * comprueban el orden real de guardar/abrir, el HERO siempre visible, la
 * exclusividad de herramientas y la salida sin pérdida del borrador.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_VERSION,
  EDITOR_TOOLS,
  WORKSPACE_VIEW_OPEN,
  WORKSPACE_VIEW_TEAMS,
  applyWorkspaceNavigation,
  isEditorTool,
  leaveWorkspaceToTeams,
  navigateToProfile,
  resolveEditorTool,
  workspaceDocumentTitle,
  workspaceRouteFor,
} from '../public/app.js';

const TOOL_PANELS = {
  hour: 'editor-panel',
  message: 'template-panel',
  voice: 'voice-panel',
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

function buildNavigationDom() {
  const editorTools = EDITOR_TOOLS.map((tool) => fakeElement({
    dataset: { editorTool: tool },
    attributes: { 'aria-controls': TOOL_PANELS[tool] },
  }));
  const toolPanels = EDITOR_TOOLS.map((tool) => ({
    tool,
    element: fakeElement({ id: TOOL_PANELS[tool], hidden: true }),
  }));
  return {
    appHeader: fakeElement({ hidden: false }),
    appFooter: fakeElement({ hidden: false }),
    teamsScreen: fakeElement({ hidden: false }),
    main: fakeElement({ hidden: true }),
    workspaceTitle: fakeElement(),
    previewNote: fakeElement({ hidden: false }),
    heroPanel: fakeElement({ id: 'hero-panel', hidden: true }),
    toolDrawer: fakeElement({ id: 'tool-drawer', hidden: true }),
    closeTool: fakeElement({ id: 'close-tool', hidden: true }),
    toolTitle: fakeElement({ id: 'tool-title' }),
    editorTools,
    toolPanels,
    profileList: null,
  };
}

function baseApp(overrides = {}) {
  return {
    uiMode: 'browser',
    workspaceView: WORKSPACE_VIEW_TEAMS,
    editorTool: null,
    workspace: {
      activeProfileId: 'champions',
      profiles: {},
    },
    ...overrides,
  };
}

function visibleToolPanels(dom) {
  return dom.toolPanels
    .filter((panel) => panel.element.hidden === false)
    .map((panel) => panel.tool);
}

test('APP_VERSION es 0.5.12 y las herramientas del editor son válidas', () => {
  assert.equal(APP_VERSION, '0.5.12');
  assert.deepEqual([...EDITOR_TOOLS], ['hour', 'message', 'voice']);
  for (const tool of EDITOR_TOOLS) assert.equal(isEditorTool(tool), true);
  assert.equal(isEditorTool('preview'), false);
  assert.equal(isEditorTool('design'), false);
  assert.equal(resolveEditorTool('otra'), null);
  assert.equal(resolveEditorTool(undefined), null);
  assert.equal(resolveEditorTool('voice'), 'voice');
});

test('la ruta y el título reflejan el equipo y la vista', () => {
  assert.equal(workspaceRouteFor('champions'), '#equipo/champions');
  assert.equal(workspaceRouteFor('no-existe'), '#equipos');
  assert.equal(workspaceRouteFor('champions', { view: WORKSPACE_VIEW_TEAMS }), '#equipos');
  assert.equal(workspaceDocumentTitle('champions'), 'SuperTools · Los Champions');
  assert.equal(
    workspaceDocumentTitle('champions', { view: WORKSPACE_VIEW_TEAMS }),
    'SuperTools · Equipos',
  );
  assert.equal(
    workspaceDocumentTitle('indestructibles', { legacy: true }),
    'SuperTools · Plantilla única (APK3)',
  );
});

test('main empieza oculto y al abrir el HERO queda visible con un único formulario', () => {
  const dom = buildNavigationDom();
  const app = baseApp();

  applyWorkspaceNavigation(dom, app);
  assert.equal(dom.teamsScreen.hidden, false);
  assert.equal(dom.main.hidden, true);
  assert.equal(dom.appHeader.hidden, false);
  assert.equal(dom.appFooter.hidden, false);
  assert.equal(dom.heroPanel.hidden, true);
  for (const panel of dom.toolPanels) assert.equal(panel.element.hidden, true);
  assert.equal(dom.workspaceTitle.textContent, 'Los Champions');

  app.workspaceView = WORKSPACE_VIEW_OPEN;
  applyWorkspaceNavigation(dom, app);
  assert.equal(dom.teamsScreen.hidden, true);
  assert.equal(dom.main.hidden, false);
  assert.equal(dom.appHeader.hidden, true);
  assert.equal(dom.appFooter.hidden, true);
  assert.equal(dom.previewNote.hidden, true);
  assert.equal(dom.heroPanel.hidden, false, 'el HERO debe verse sin herramienta abierta');
  assert.equal(dom.toolDrawer.hidden, true);
  assert.deepEqual(visibleToolPanels(dom), []);
  for (const button of dom.editorTools) {
    assert.equal(button.getAttribute('aria-expanded'), 'false');
  }

  app.editorTool = 'message';
  applyWorkspaceNavigation(dom, app);
  assert.equal(dom.heroPanel.hidden, false, 'el HERO sigue visible con el drawer abierto');
  assert.equal(dom.toolDrawer.hidden, false);
  assert.equal(dom.toolTitle.textContent, 'Mensaje y destinos');
  assert.deepEqual(visibleToolPanels(dom), ['message']);
  const messageButton = dom.editorTools.find((button) => button.dataset.editorTool === 'message');
  assert.equal(messageButton.getAttribute('aria-expanded'), 'true');
  assert.equal(messageButton.getAttribute('aria-controls'), 'template-panel');

  app.editorTool = 'inexistente';
  applyWorkspaceNavigation(dom, app);
  assert.equal(app.editorTool, null);
  assert.equal(dom.heroPanel.hidden, false);
  assert.equal(dom.toolDrawer.hidden, true);
  assert.deepEqual(visibleToolPanels(dom), []);

  app.workspaceView = WORKSPACE_VIEW_TEAMS;
  applyWorkspaceNavigation(dom, app);
  assert.equal(dom.appHeader.hidden, false);
  assert.equal(dom.appFooter.hidden, false);
  assert.equal(dom.teamsScreen.hidden, false);
  assert.equal(dom.main.hidden, true);
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
    editorTool: 'voice',
    workspace: {
      activeProfileId: 'champions',
      profiles: {},
    },
  });

  applyWorkspaceNavigation(dom, app);
  assert.equal(dom.workspaceTitle.textContent, 'Los Champions');
  assert.equal(workspaceRouteFor(app.workspace.activeProfileId), '#equipo/champions');
  assert.equal(dom.heroPanel.hidden, false);
  assert.deepEqual(visibleToolPanels(dom), ['voice']);

  // Lo que hace switchWorkspaceProfile al aceptar la propuesta de otro equipo.
  app.workspace.activeProfileId = 'espartanos';
  applyWorkspaceNavigation(dom, app);

  assert.equal(dom.workspaceTitle.textContent, 'Los Espartanos');
  assert.equal(workspaceRouteFor(app.workspace.activeProfileId), '#equipo/espartanos');
  assert.equal(dom.heroPanel.hidden, false);
  assert.deepEqual(visibleToolPanels(dom), ['voice']);
});

test('seleccionar planta sigue disponible durante sincronización sin mutar datos guardados',async()=>{
  const {selectPlant}=await import('../public/app.js');
  const workspace={activeProfileId:'indestructibles',profiles:{}};
  for(const busy of [true,false]) {
    const app={busy,switching:false,workspace,workspaceView:'teams',selectedPlantId:null};
    assert.equal(selectPlant(app,'sacos'),true);
    assert.equal(app.selectedPlantId,'sacos');
    assert.equal(app.workspace,workspace);
    assert.equal(selectPlant(app,'polietileno'),true);
    assert.equal(app.selectedPlantId,'polietileno');
    assert.equal(selectPlant(app,'unknown'),false);
    assert.equal(workspace.activeProfileId,'indestructibles');
  }
});

test('planta recordada sobrevive reinicios sin cambiar el workspace',async()=>{
  const {readSelectedPlant,rememberSelectedPlant,PLANT_SELECTION_KEY}=await import('../public/profiles.js');
  const data=new Map([['mn1.workspace.state','KEEP']]);
  const storage=()=>({getText:async k=>data.get(k)||null,putText:async(k,v)=>data.set(k,v)});
  assert.equal(await readSelectedPlant(storage()),null);
  await rememberSelectedPlant(storage(),'polietileno');
  assert.equal(await readSelectedPlant(storage()),'polietileno');
  await rememberSelectedPlant(storage(),'sacos');
  assert.equal(await readSelectedPlant(storage()),'sacos');
  assert.equal(data.get('mn1.workspace.state'),'KEEP');
  data.set(PLANT_SELECTION_KEY,'invalid');assert.equal(await readSelectedPlant(storage()),null);
  await assert.rejects(()=>rememberSelectedPlant({putText:async()=>{throw Error('full')}},'sacos'),/full/);
});

test('Atrás prioriza diálogo, luego reporte o herramienta; en bienvenida permite salida',async()=>{
  const {handleAppBack}=await import('../public/app.js');let closed=0;
  const dialog={dispatchEvent:event=>{assert.equal(event.type,'cancel');return true},close:()=>closed++};
  const root={querySelectorAll:()=>[dialog],getElementById:()=>({hidden:false})};
  const app={workspaceView:WORKSPACE_VIEW_OPEN,editorTool:'hour',reportStudio:{close:()=>closed+=10}};
  assert.equal(handleAppBack({},app,root),true);assert.equal(closed,1);
  root.querySelectorAll=()=>[];
  assert.equal(handleAppBack({},app,root),true);assert.equal(closed,11);
  root.getElementById=()=>({hidden:true});
  assert.equal(handleAppBack({closeTool:{click:()=>closed+=100}},app,root),true);assert.equal(closed,111);
  app.workspaceView='teams';app.selectedPlantId=null;
  assert.equal(handleAppBack({},app,root),false);
  assert.equal(closed,111);
});


test('accesos rápidos sólo admiten herramientas reales y se guardan por equipo',async()=>{
 const {TEAM_TOOLS,normalizeToolShortcuts,teamShortcutsKey}=await import('../public/profiles.js');
 assert.deepEqual(TEAM_TOOLS.map(t=>t.id),['announcement','report']);
 assert.deepEqual(normalizeToolShortcuts(null),['announcement','report']);
 assert.deepEqual(normalizeToolShortcuts(['report','fake','report']),['report']);
 assert.deepEqual(normalizeToolShortcuts([]),[]);
 assert.notEqual(teamShortcutsKey('champions'),teamShortcutsKey('espartanos'));
 const saved=new Map([[teamShortcutsKey('champions'),JSON.stringify(['report'])]]);
 assert.deepEqual(normalizeToolShortcuts(JSON.parse(saved.get(teamShortcutsKey('champions')))),['report']);
 assert.deepEqual(normalizeToolShortcuts(saved.get(teamShortcutsKey('espartanos'))),['announcement','report']);
});
