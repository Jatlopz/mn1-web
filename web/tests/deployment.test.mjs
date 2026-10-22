import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {buildSite} from '../tools/build-site.mjs';

test('published bundle only contains web assets with coherent content hashes', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'mn1-pages-'));
  const files = await buildSite(fileURLToPath(new URL('../public', import.meta.url)), out);
  assert.equal(files.length, 6);
  assert.equal((await readdir(out)).length, 6);
  const html = await readFile(path.join(out,'index.html'),'utf8');
  const appName = html.match(/src="\.\/(app\.[a-f0-9]{16}\.js)"/)[1];
  const app = await readFile(path.join(out,appName),'utf8');
  const bridgeName = app.match(/from '\.\/(bridge\.[a-f0-9]{16}\.js)'/)[1];
  assert.ok(files.includes(bridgeName));
  assert.ok(!files.some(f => /png|apk|keystore|Android|env/.test(f)));
  assert.deepEqual(files, await buildSite(fileURLToPath(new URL('../public', import.meta.url)), out));
});