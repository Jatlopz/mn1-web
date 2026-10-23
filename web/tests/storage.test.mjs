import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BridgeVaultAdapter,
  MemoryVault,
  VaultClient,
  VaultError,
  WORKSPACE_KEYS,
  coverKeyForProfile,
  createBrowserVault,
  imageKeyForProfile,
  validateVaultWrite,
} from '../public/storage.js';
import { MN1_LIMITS, VAULT_KEY_PATTERN } from '../public/bridge.js';

test('las claves de imagen son seguras, versionadas y por equipo', () => {
  const key = imageKeyForProfile('super-guerreros', 'abc123');
  assert.equal(key, 'mn1.workspace.image.super-guerreros.abc123');
  assert.match(key, VAULT_KEY_PATTERN);
  assert.match(imageKeyForProfile('champions'), VAULT_KEY_PATTERN);
  assert.notEqual(
    imageKeyForProfile('champions', 'uno'),
    imageKeyForProfile('champions', 'dos'),
  );
  assert.notEqual(
    imageKeyForProfile('champions', 'uno'),
    imageKeyForProfile('espartanos', 'uno'),
  );
});

test('dos importaciones del mismo equipo generan dos claves alfanuméricas distintas', () => {
  const first = imageKeyForProfile('champions', 'lote2026a');
  const second = imageKeyForProfile('champions', 'lote2026b');
  assert.notEqual(first, second);
  for (const key of [first, second]) {
    assert.match(key, VAULT_KEY_PATTERN);
    assert.doesNotMatch(key, /[^A-Za-z0-9._:-]/);
  }
});

test('las claves de un UUID personalizado conservan el UUID completo y caben en 64', () => {
  const firstUuid = '12345678-1234-4123-8123-123456789abc';
  const secondUuid = '12345678-1234-4123-8123-123456789abd';
  const first = `custom-${firstUuid}`;
  const second = `custom-${secondUuid}`;
  const longStamp = 'lote-2026-10-22T12:34:56.789Z-muy-largo';

  for (const profileId of [first, second]) {
    const imageKey = imageKeyForProfile(profileId, longStamp);
    const coverKey = coverKeyForProfile(profileId, longStamp);
    assert.ok(imageKey.length <= 64, imageKey);
    assert.ok(coverKey.length <= 64, coverKey);
    assert.match(imageKey, VAULT_KEY_PATTERN);
    assert.match(coverKey, VAULT_KEY_PATTERN);
    assert.ok(imageKey.startsWith(WORKSPACE_KEYS.imagePrefix));
    assert.ok(coverKey.startsWith(WORKSPACE_KEYS.coverPrefix));
  }

  const firstImage = imageKeyForProfile(first, longStamp);
  const secondImage = imageKeyForProfile(second, longStamp);
  const firstCover = coverKeyForProfile(first, longStamp);
  const secondCover = coverKeyForProfile(second, longStamp);
  assert.notEqual(firstImage, secondImage);
  assert.notEqual(firstCover, secondCover);
  assert.match(firstImage, /12345678123441238123123456789abc/);
  assert.match(secondImage, /12345678123441238123123456789abd/);
});

test('valida clave, texto, tamaño por valor, cuotas y reemplazo', () => {
  assert.equal(validateVaultWrite('clave-1', 'texto').ok, true);
  assert.equal(validateVaultWrite('ruta/no', 'texto').error.code, 'invalid_key');
  assert.equal(validateVaultWrite('clave-1', 1).error.code, 'invalid_value');
  assert.equal(
    validateVaultWrite('clave-1', 'x'.repeat(MN1_LIMITS.VAULT_VALUE_MAX_BYTES + 1)).error.code,
    'value_too_large',
  );
  assert.equal(
    validateVaultWrite('clave-1', 'x', { existingKeys: MN1_LIMITS.VAULT_MAX_KEYS }).error.code,
    'too_many_keys',
  );
  assert.equal(
    validateVaultWrite('clave-1', 'x', {
      existingKeys: MN1_LIMITS.VAULT_MAX_KEYS,
      replacing: true,
    }).ok,
    true,
  );
  assert.equal(
    validateVaultWrite('clave-1', 'xx', {
      totalBytes: MN1_LIMITS.VAULT_TOTAL_MAX_BYTES,
    }).error.code,
    'vault_full',
  );
  assert.equal(
    validateVaultWrite('clave-1', 'xx', {
      totalBytes: MN1_LIMITS.VAULT_TOTAL_MAX_BYTES,
      replacedBytes: 2,
      replacing: true,
    }).ok,
    true,
  );
});

test('MemoryVault guarda, sobrescribe, borra y aplica los mismos límites', async () => {
  const vault = new MemoryVault();
  assert.equal(await vault.get('clave-1'), null);
  await vault.put('clave-1', 'uno');
  assert.equal(await vault.get('clave-1'), 'uno');
  assert.equal(vault.keyCount(), 1);
  assert.equal(vault.totalBytes(), 3);
  await vault.put('clave-1', 'dos');
  assert.equal(await vault.get('clave-1'), 'dos');
  assert.equal(vault.totalBytes(), 3);
  assert.equal(await vault.remove('clave-1'), true);
  assert.equal(await vault.remove('clave-1'), false);
  assert.equal(await vault.get('clave-1'), null);
  await assert.rejects(vault.get('../fuera'), (error) => error.code === 'invalid_key');
});

test('VaultClient expone texto y JSON sin fingir lectura', async () => {
  const vault = new MemoryVault();
  const client = new VaultClient(vault, { persistent: true, label: 'prueba' });
  assert.equal(await client.getText('clave-1'), null);
  assert.deepEqual(await client.getJson('clave-1'), { ok: true, value: null });
  await client.putJson('mn1.workspace.state', { version: 1 });
  assert.deepEqual(await client.getJson('mn1.workspace.state'), {
    ok: true,
    value: { version: 1 },
  });
  await client.putText('mn1.workspace.raw', 'hola');
  assert.equal(await client.getText('mn1.workspace.raw'), 'hola');
  assert.equal(await client.removeText('mn1.workspace.raw'), true);
  assert.equal(await client.getText('mn1.workspace.raw'), null);
  await assert.rejects(client.removeText('clave/invalida'), (error) => error.code === 'invalid_key');

  await vault.put('mn1.workspace.bad', '{no json');
  assert.equal((await client.getJson('mn1.workspace.bad')).ok, false);
});

test('BridgeVaultAdapter usa las acciones del contrato y falla de forma honesta', async () => {
  const calls = [];
  const bridge = {
    async request(action, payload) {
      calls.push([action, payload]);
      if (action === 'VAULT_GET') return { ok: true, data: { key: payload.key, value: 'valor' } };
      if (action === 'VAULT_PUT') return { ok: true, data: { key: payload.key, saved: true } };
      if (action === 'VAULT_REMOVE') return { ok: true, data: { key: payload.key, removed: true } };
      throw new Error('acción inesperada');
    },
  };
  const adapter = new BridgeVaultAdapter(bridge, { timeoutMs: 1 });
  assert.equal(await adapter.get(WORKSPACE_KEYS.state), 'valor');
  assert.equal(await adapter.put(WORKSPACE_KEYS.state, '{"version":1}'), 13);
  assert.equal(await adapter.remove(WORKSPACE_KEYS.state), true);
  assert.deepEqual(calls.map(([action]) => action), ['VAULT_GET', 'VAULT_PUT', 'VAULT_REMOVE']);
  await assert.rejects(adapter.get('ruta/no'), (error) => error.code === 'invalid_key');

  const rejected = new BridgeVaultAdapter({
    async request() {
      return { ok: false, message: 'cuota' };
    },
  });
  await assert.rejects(rejected.put('clave-1', 'x'), (error) => {
    assert.ok(error instanceof VaultError);
    assert.equal(error.code, 'native_rejected');
    return true;
  });

  const invalid = new BridgeVaultAdapter({
    async request() {
      return { ok: true, data: { saved: false } };
    },
  });
  await assert.rejects(invalid.put('clave-1', 'x'), (error) => error.code === 'invalid_response');
});

test('en navegador sin IndexedDB se usa memoria y se declara no persistente', async () => {
  const vault = await createBrowserVault({ indexedDB: {} });
  assert.equal(vault.persistent, false);
  assert.match(vault.label, /memoria/);
  await vault.adapter.put('clave-1', 'x');
  assert.equal(await vault.adapter.get('clave-1'), 'x');
});

test('native vault queues simultaneous cloud and thumbnail operations below Android limit', async () => {
 let active=0, maximum=0;
 const values=new Map();
 const bridge={request:async(action,payload)=>{
  active++; maximum=Math.max(maximum,active);
  if(active>4){active--;return {ok:false,message:'Demasiadas solicitudes'};}
  try {
   await new Promise(resolve=>setTimeout(resolve,2));
   if(action==='VAULT_PUT'){values.set(payload.key,payload.value);return {ok:true,data:{saved:true}};}
   if(action==='VAULT_REMOVE'){return {ok:true,data:{removed:values.delete(payload.key)}};}
   return {ok:true,data:{value:values.get(payload.key)??null}};
  } finally {active--;}
 }};
 const a=new BridgeVaultAdapter(bridge), b=new BridgeVaultAdapter(bridge);
 await Promise.all(Array.from({length:16},(_,i)=>(i%2?a:b).put('test.'+i,'original-'+i)));
 const read=await Promise.all(Array.from({length:16},(_,i)=>(i%2?b:a).get('test.'+i)));
 assert.deepEqual(read,Array.from({length:16},(_,i)=>'original-'+i));
 assert.equal(maximum,1);
});
test('native vault queue continues after a rejected request without repeating writes', async () => {
 let calls=0;
 const adapter=new BridgeVaultAdapter({request:async()=>{
  calls++; if(calls===1) throw Error('interrupted');
  return {ok:true,data:{value:'preserved'}};
 }});
 const results=await Promise.allSettled([adapter.get('first'),adapter.get('second')]);
 assert.equal(results[0].status,'rejected');
 assert.equal(results[1].value,'preserved');
 assert.equal(calls,2);
});
