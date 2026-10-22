import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const publicUrl = new URL('../public/', import.meta.url);
const rootUrl = new URL('../', import.meta.url);

async function readPublic(name) {
  return readFile(new URL(name, publicUrl), 'utf8');
}

test('version.json es visible, parseable y usa el contrato v1', async () => {
  const version = JSON.parse(await readPublic('version.json'));
  assert.equal(typeof version.version, 'string');
  assert.match(version.version, /^\d+\.\d+\.\d+$/);
  assert.equal(version.protocol, 1);
  assert.equal(typeof version.updated, 'string');
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
  assert.match(html, /href="\.\/styles\.css\?v=\d+\.\d+\.\d+"/);
  assert.match(html, /src="\.\/app\.js\?v=\d+\.\d+\.\d+"/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test('la interfaz incluye los controles del encargo', async () => {
  const html = await readPublic('index.html');
  assert.match(html, /id="hour-08"/);
  assert.match(html, /id="hour-09"/);
  assert.match(html, /id="custom-hour"/);
  assert.match(html, /id="hour-dialog"/);
  assert.match(html, /id="message-input"/);
  assert.match(html, /id="targets-list"/);
  assert.match(html, /id="pick-image"/);
  assert.match(html, /id="open-editor"/);
  assert.match(html, /id="save-template"/);
  assert.match(html, /id="prepare-share"/);
  assert.match(html, /id="preview-image"/);
  assert.match(html, /id="mode-badge"/);
  assert.match(html, /Vista previa · sin envío/);
});

test('el puente implementa las seis acciones del contrato', async () => {
  const bridge = await readPublic('bridge.js');
  for (const action of [
    'GET_STATE',
    'UPDATE_TEMPLATE',
    'PICK_IMAGE',
    'OPEN_EDITOR',
    'SAVE_TEMPLATE',
    'PREPARE_SHARE',
  ]) {
    assert.match(bridge, new RegExp(`'${action}'`));
  }
  assert.match(bridge, /mn1:native-result/);
  assert.match(bridge, /PROTOCOL_VERSION = 1/);
  assert.match(bridge, /MAX_ENVELOPE_BYTES = 32 \* 1024/);
  assert.match(bridge, /bridge_unavailable/);
  assert.match(bridge, /timeout/);
  assert.match(bridge, /requestId/);
  assert.match(bridge, /DEFAULT_TIMEOUT_MS/);
});

test('app no usa innerHTML ni simula éxito en modo preview', async () => {
  const app = await readPublic('app.js');
  assert.match(app, /from '\.\/bridge\.js'/);
  assert.doesNotMatch(app, /\.innerHTML\s*=/);
  assert.match(app, /Vista previa en navegador/);
  assert.match(app, /No se guardó ni se compartió nada/);
  assert.match(app, /No se ha enviado nada/);
  assert.match(app, /La web no confirma la entrega/);
  assert.match(app, /OPEN_EDITOR/);
  assert.match(app, /PREPARE_SHARE/);
});

test('no se referencia file:// y package.json no tiene dependencias', async () => {
  const [html, app, bridge, pkg] = await Promise.all([
    readPublic('index.html'),
    readPublic('app.js'),
    readPublic('bridge.js'),
    readFile(new URL('package.json', rootUrl), 'utf8'),
  ]);
  assert.doesNotMatch(`${html}\n${app}\n${bridge}`, /file:\/\//);
  const packageJson = JSON.parse(pkg);
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.equal(packageJson.scripts.test, 'node --test tests/*.test.mjs');
});

test('los tests existen para bridge y lógica de app', async () => {
  const [bridgeTests, appTests] = await Promise.all([
    readFile(new URL('tests/bridge.test.mjs', rootUrl), 'utf8'),
    readFile(new URL('tests/app-logic.test.mjs', rootUrl), 'utf8'),
  ]);
  assert.match(bridgeTests, /bridge_unavailable/);
  assert.match(bridgeTests, /timeout/);
  assert.match(bridgeTests, /mn1:native-result/);
  assert.match(appTests, /validateDraft/);
  assert.match(appTests, /normalizeHourDraft/);
});
