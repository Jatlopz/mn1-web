import test from 'node:test';
import assert from 'node:assert/strict';
import {readSiteNoticeCache, writeSiteNoticeCache, siteAdmin} from '../public/insforge-admin.js';

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('a recent public notice is read locally without contacting InsForge', async () => {
  const local = storage();
  writeSiteNoticeCache(local, {message:'Aviso de prueba', revision:4});
  assert.deepEqual(await siteAdmin.notice({storage:local}),
    {message:'Aviso de prueba', revision:4});
});

test('notice cache expires after one hour and rejects corrupt data', () => {
  const local = storage();
  writeSiteNoticeCache(local, {message:'Aviso', revision:2}, 1_000);
  assert.deepEqual(readSiteNoticeCache(local, 1_000 + 3_599_999),
    {message:'Aviso', revision:2});
  assert.equal(readSiteNoticeCache(local, 1_000 + 3_600_000), null);
  local.setItem('supertools.site-notice.v2', JSON.stringify({
    message:'x'.repeat(241), revision:2, at:1_000,
  }));
  assert.equal(readSiteNoticeCache(local, 2_000), null);
});
