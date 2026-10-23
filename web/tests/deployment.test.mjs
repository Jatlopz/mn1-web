import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {buildSite} from '../tools/build-site.mjs';

const publicPath = fileURLToPath(new URL('../public', import.meta.url));
const STARTER_PNGS = [
  'templates/indestructibles.c9e3d4ac8d3d6f3f.png',
  'templates/super-guerreros.8200d4c6f9ede505.png',
];
const MODULE_PATTERN = /^(app|meeting-report|bridge|profiles|renderer|starter-templates|storage|voice|cloud-client|cloud-model|cloud-workspace)\.[a-f0-9]{16}\.js$/;

test('published bundle contains every module with coherent content hashes', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'mn1-pages-'));
  const files = await buildSite(publicPath, out);
  assert.equal(files.length, 17);
  assert.deepEqual((await readdir(path.join(out, 'templates'))).sort(), ['indestructibles.c9e3d4ac8d3d6f3f.png', 'super-guerreros.8200d4c6f9ede505.png']);

  const html = await readFile(path.join(out, 'index.html'), 'utf8');
  const appName = html.match(/src="\.\/(app\.[a-f0-9]{16}\.js)"/)?.[1];
  assert.ok(appName, 'index.html no apunta a app con hash');
  const cssName = html.match(/href="\.\/(styles\.[a-f0-9]{16}\.css)"/)?.[1];
  assert.ok(cssName, 'index.html no apunta a styles con hash');
  assert.ok(files.includes(appName));
  assert.ok(files.includes(cssName));

  const modules = new Map();
  for (const name of files.filter((file) => /\.js$/.test(file))) {
    modules.set(name, await readFile(path.join(out, name), 'utf8'));
  }
  assert.equal(modules.size, 11);
  for (const [name, content] of modules) {
    for (const match of content.matchAll(/from\s+(['"])\.\/([A-Za-z0-9_.-]+\.js)\1/g)) {
      assert.ok(files.includes(match[2]), `${name} importa ${match[2]} que no está en el bundle`);
      assert.doesNotMatch(match[2], /^(app|meeting-report|bridge|profiles|renderer|starter-templates|storage|voice|cloud-client|cloud-model|cloud-workspace)\.js$/);
    }
  }

  const app = modules.get(appName);
  assert.match(app, /from '\.\/bridge\.[a-f0-9]{16}\.js'/);
  assert.match(app, /from '\.\/profiles\.[a-f0-9]{16}\.js'/);
  assert.match(app, /from '\.\/storage\.[a-f0-9]{16}\.js'/);
  assert.match(app, /from '\.\/renderer\.[a-f0-9]{16}\.js'/);
  assert.match(app, /from '\.\/voice\.[a-f0-9]{16}\.js'/);
  assert.match(app, /from '\.\/starter-templates\.[a-f0-9]{16}\.js'/);

  const version = JSON.parse(await readFile(path.join(out, 'version.json'), 'utf8'));
  assert.equal(version.version, '0.5.1');
  assert.equal(version.protocol, 1);
  assert.ok(files.includes('.nojekyll'));

  assert.deepEqual(files.filter((file) => /\.png$/i.test(file)).sort(), [...STARTER_PNGS].sort());
  for (const file of files) {
    assert.ok(
      MODULE_PATTERN.test(file) || file === 'index.html' || /^styles\.[a-f0-9]{16}\.css$/.test(file) || file === 'version.json' || file === '.nojekyll' || STARTER_PNGS.includes(file),
      `Archivo no permitido en el paquete: ${file}`,
    );
  }
  assert.ok(!files.some((file) => /\.(apk|keystore|jks)$|(^|\/)(private|secret)|\.env/i.test(file)));
  assert.deepEqual(files, await buildSite(publicPath, out));
});
