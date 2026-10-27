import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, mkdir, readFile, unlink, writeFile, symlink, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {buildSite,BRAND_SYMBOL} from '../tools/build-site.mjs';

const publicPath = fileURLToPath(new URL('../public', import.meta.url));
const APPROVED = [
  'templates/indestructibles.c9e3d4ac8d3d6f3f.png',
  'templates/super-guerreros.8200d4c6f9ede505.png',
];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'mn1-starter-'));
  const source = path.join(root, 'public');
  await cp(publicPath, source, {recursive: true});
  return {root, source, out: path.join(root, 'out')};
}

test('empaqueta sólo los dos artes y el símbolo de marca aprobados', async () => {
  const {source, out} = await fixture();
  const files = await buildSite(source, out);
  assert.deepEqual(files.filter((file) => /\.png$/i.test(file)).sort(), [...APPROVED,BRAND_SYMBOL.path].sort());
  for (const file of APPROVED) {
    assert.deepEqual(await readFile(path.join(out, file)), await readFile(path.join(source, file)));
  }
});

test('rechaza un PNG manipulado', async () => {
  const {source, out} = await fixture();
  const file = path.join(source, APPROVED[0]);
  const data = await readFile(file);
  data[Math.floor(data.length / 2)] ^= 0xff;
  await writeFile(file, data);
  await assert.rejects(buildSite(source, out), /hash/i);
});

test('rechaza un PNG truncado', async () => {
  const {source, out} = await fixture();
  const file = path.join(source, APPROVED[0]);
  const data = await readFile(file);
  await writeFile(file, data.subarray(0, data.length - 128));
  await assert.rejects(buildSite(source, out), /size/i);
});

test('rechaza un PNG enlazado simbólicamente', async (t) => {
  const {source, out} = await fixture();
  const file = path.join(source, APPROVED[0]);
  const target = path.join(source, 'templates', 'approved-copy.png');
  await writeFile(target, await readFile(file));
  await unlink(file);
  try {
    await symlink(target, file);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip('El sistema no permite crear enlaces simbólicos');
      return;
    }
    throw error;
  }
  await assert.rejects(buildSite(source, out), /Invalid starter image/i);
});

test('nunca copia assets extra, APK, Android privado ni secretos', async () => {
  const {source, out} = await fixture();
  const approved = await readFile(path.join(source, APPROVED[0]));
  await writeFile(path.join(source, 'templates', 'unapproved.png'), approved);
  await writeFile(path.join(source, 'tracked.apk'), Buffer.from([80, 75, 3, 4]));
  await writeFile(path.join(source, 'secret.txt'), 'secret');
  await mkdir(path.join(source, 'private-android'), {recursive: true});
  await writeFile(path.join(source, 'private-android', 'keystore.txt'), 'private');

  const files = await buildSite(source, out);
  assert.deepEqual(files.filter((file) => /\.png$/i.test(file)).sort(), [...APPROVED,BRAND_SYMBOL.path].sort());
  for (const file of ['templates/unapproved.png', 'tracked.apk', 'secret.txt', 'private-android/keystore.txt']) {
    assert.ok(!files.includes(file));
    await assert.rejects(access(path.join(out, file)));
  }
});
