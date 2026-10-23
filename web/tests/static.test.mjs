import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const publicUrl = new URL('../public/', import.meta.url);
const rootUrl = new URL('../', import.meta.url);

async function readPublic(name) {
  return readFile(new URL(name, publicUrl), 'utf8');
}

test('version.json es visible, parseable, 0.5.2 y usa el contrato v1', async () => {
  const version = JSON.parse(await readPublic('version.json'));
  assert.equal(version.version, '0.5.2');
  assert.match(version.version, /^\d+\.\d+\.\d+$/);
  assert.equal(version.protocol, 1);
  assert.equal(version.updated, '2026-10-23');
});

test('index.html carga sólo assets locales versionados y declara CSP', async () => {
  const html = await readPublic('index.html');
  assert.match(html, /<html lang="es"/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /style-src 'self'/);
  assert.match(html, /img-src 'self' data:/);
  assert.match(html, /connect-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /frame-ancestors 'none'/);
  assert.match(html, /href="\.\/styles\.css\?v=0\.5\.2"/);
  assert.match(html, /src="\.\/app\.js\?v=0\.5\.2"/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html.replaceAll('https://wnfqqqorktjiruxlzvlr.supabase.co',''), /https?:\/\//i);
});

test('la interfaz incluye workspace, editor, voz y compatibilidad APK3', async () => {
  const html = await readPublic('index.html');
  for (const id of [
    'profile-list',
    'profiles-status',
    'profiles-notice',
    'import-image',
    'preview-message',
    'canvas-preview',
    'editor-panel',
    'overlay-x',
    'overlay-y',
    'overlay-size',
    'overlay-font',
    'overlay-color',
    'overlay-show-date',
    'overlay-date',
    'voice-panel',
    'speak-toggle',
    'speech-status',
    'speech-result',
    'speech-transcript',
    'proposal-list',
    'apply-proposal',
    'hour-08',
    'hour-09',
    'custom-hour',
    'hour-dialog',
    'message-input',
    'targets-list',
    'pick-image',
    'open-editor',
    'save-template',
    'prepare-share',
    'download-png',
    'preview-image',
    'mode-badge',
    'browser-image-input',
    'native-version',
    'capability-text',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `Falta #${id}`);
  }
  assert.doesNotMatch(html, /id="image-url"/);
  assert.match(html, /Cuatro equipos|cuatro equipos|los cuatro equipos/i);
});

test('el puente implementa las acciones heredadas y genéricas', async () => {
  const bridge = await readPublic('bridge.js');
  for (const action of [
    'GET_STATE',
    'UPDATE_TEMPLATE',
    'PICK_IMAGE',
    'OPEN_EDITOR',
    'SAVE_TEMPLATE',
    'PREPARE_SHARE',
    'VAULT_GET',
    'VAULT_PUT',
    'VAULT_REMOVE',
    'IMPORT_IMAGE',
    'GET_LEGACY_IMAGE',
    'SHARE_PNG',
    'RECOGNIZE_SPEECH',
    'CANCEL_SPEECH',
  ]) {
    assert.match(bridge, new RegExp(`'${action}'`));
  }
  assert.match(bridge, /mn1:native-result/);
  assert.match(bridge, /PROTOCOL_VERSION = 1/);
  assert.match(bridge, /MAX_ENVELOPE_BYTES = 32 \* 1024/);
  assert.match(bridge, /MAX_GLOBAL_ENVELOPE_BYTES = 12 \* 1024 \* 1024/);
  assert.match(bridge, /VAULT_KEY_PATTERN/);
  assert.match(bridge, /speech-input-v1/);
  assert.match(bridge, /bridge_unavailable/);
  assert.match(bridge, /requestId/);
});

test('app no usa innerHTML ni simula éxito en modo preview', async () => {
  const app = await readPublic('app.js');
  const storage = await readPublic('storage.js');
  assert.match(app, /from '\.\/bridge\.js'/);
  assert.match(app, /from '\.\/profiles\.js'/);
  assert.match(app, /from '\.\/storage\.js'/);
  assert.match(app, /from '\.\/renderer\.js'/);
  assert.match(app, /from '\.\/voice\.js'/);
  assert.doesNotMatch(app, /\.innerHTML\s*=/);
  assert.match(app, /No se guardó ni se compartió nada/);
  assert.match(app, /La web no confirma la entrega/);
  assert.match(app, /OPEN_EDITOR/);
  assert.match(app, /PREPARE_SHARE/);
  assert.match(app, /VAULT_GET/);
  assert.match(app, /removeText\(/);
  assert.match(storage, /VAULT_REMOVE/);
  assert.match(app, /CANCEL_SPEECH/);
  assert.match(app, /web-workspace-v1|CAPABILITIES\.WORKSPACE/);
});

test('no se referencia file:// y package.json no tiene dependencias', async () => {
  const [html, app, bridge, storage, pkg] = await Promise.all([
    readPublic('index.html'),
    readPublic('app.js'),
    readPublic('bridge.js'),
    readPublic('storage.js'),
    readFile(new URL('package.json', rootUrl), 'utf8'),
  ]);
  assert.doesNotMatch(`${html}\n${app}\n${bridge}\n${storage}`, /file:\/\//);
  const packageJson = JSON.parse(pkg);
  assert.equal(packageJson.version, '0.5.2');
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.equal(packageJson.scripts.test, 'node --test tests/*.test.mjs');
});

test('los tests cubren puente, perfiles, voz, almacén, renderer y app', async () => {
  const names = [
    'bridge.test.mjs',
    'app-logic.test.mjs',
    'profiles.test.mjs',
    'voice.test.mjs',
    'storage.test.mjs',
    'renderer.test.mjs',
  ];
  for (const name of names) {
    const source = await readFile(new URL(`tests/${name}`, rootUrl), 'utf8');
    assert.ok(source.includes("from 'node:test'"), `Falta node:test en ${name}`);
  }
});


test('la portada editable tiene controles y el símbolo es un proyector local', async () => {
  const html = await readPublic('index.html');
  assert.match(html, /class="brand-projector"/);
  assert.match(html, /class="projector-beam"/);
  assert.doesNotMatch(html, /brand-signal/);
  for (const id of ['cover-dialog','cover-title','cover-preview','cover-close','cover-use-announcement','cover-pick-image','cover-no-image','cover-shade','cover-save','cover-cancel','cover-error','cover-image-input']) {
    assert.ok(html.includes('id="'+id+'"'), id);
  }
  for (const blur of [0,6,12]) assert.ok(html.includes('data-cover-blur="'+blur+'"'));
});
