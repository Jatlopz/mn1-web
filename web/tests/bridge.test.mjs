import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BridgeError,
  MAX_ENVELOPE_BYTES,
  Mn1Bridge,
  PROTOCOL_VERSION,
  createMn1Bridge,
  utf8ByteLength,
  validateRequestEnvelope,
  validateResultEnvelope,
} from '../public/bridge.js';

const CustomEventCtor = globalThis.CustomEvent ?? class extends Event {
  constructor(type, init = {}) {
    super(type);
    this.detail = init.detail;
  }
};

class FakeRoot extends EventTarget {
  constructor() {
    super();
    this.CustomEvent = CustomEventCtor;
  }
}

function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeoutFn(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    tick(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.due <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

function setup({ withNative = true, requestId = 'req-1', timeoutMs = 1000 } = {}) {
  const root = new FakeRoot();
  const calls = [];
  const native = {
    onmessage: null,
    postMessage(json) {
      calls.push(json);
    },
  };
  if (withNative) root.MN1Bridge = native;
  const clock = createClock();
  const bridge = createMn1Bridge({
    root,
    timeoutMs,
    requestIdFactory: () => requestId,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });
  return { root, native, calls, clock, bridge };
}

function reply(native, result) {
  native.onmessage({ data: JSON.stringify(result) });
}

function result(requestId, overrides = {}) {
  return {
    version: PROTOCOL_VERSION,
    requestId,
    ok: true,
    message: 'ok',
    ...overrides,
  };
}

test('preview sin MN1Bridge rechaza honestamente y no publica nada', async () => {
  const { bridge, calls } = setup({ withNative: false });
  assert.equal(bridge.mode, 'preview');
  await assert.rejects(
    bridge.request('GET_STATE', {}),
    (error) => error instanceof BridgeError && error.code === 'bridge_unavailable',
  );
  assert.equal(calls.length, 0);
});

test('envía el sobre version 1 exacto, resuelve y emite mn1:native-result', async () => {
  const { bridge, native, calls, root } = setup();
  const events = [];
  root.addEventListener('mn1:native-result', (event) => events.push(event.detail));

  const pending = bridge.request('GET_STATE', {}, { requestId: 'abc-123' });
  assert.equal(calls.length, 1);
  const envelope = JSON.parse(calls[0]);
  assert.deepEqual(envelope, {
    version: 1,
    requestId: 'abc-123',
    action: 'GET_STATE',
    payload: {},
  });

  const expected = result('abc-123', { message: 'estado leído', data: { message: 'hola' } });
  reply(native, expected);
  const received = await pending;

  assert.deepEqual(received, expected);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], expected);
  assert.equal(bridge.pendingCount(), 0);
});

test('deduplica una petición idéntica en vuelo y no la publica dos veces', async () => {
  const { bridge, native, calls } = setup();
  const first = bridge.request('GET_STATE', {}, { requestId: 'same-id' });
  const second = bridge.request('GET_STATE', {}, { requestId: 'same-id' });

  assert.equal(first, second);
  assert.equal(calls.length, 1);

  reply(native, result('same-id'));
  await first;
});

test('rechaza reutilizar un requestId con otra acción o payload', async () => {
  const { bridge, native, calls } = setup();
  const first = bridge.request('GET_STATE', {}, { requestId: 'dup-id' });
  await assert.rejects(
    bridge.request('PICK_IMAGE', {}, { requestId: 'dup-id' }),
    (error) => error.code === 'duplicate_request_id',
  );
  assert.equal(calls.length, 1);

  reply(native, result('dup-id'));
  await first;

  await assert.rejects(
    bridge.request('GET_STATE', {}, { requestId: 'dup-id' }),
    (error) => error.code === 'duplicate_request_id',
  );
});

test('rechaza acciones fuera del contrato y no llama a Android', async () => {
  const { bridge, calls } = setup();
  await assert.rejects(
    bridge.request('DELETE_EVERYTHING', {}),
    (error) => error.code === 'unsupported_action',
  );
  assert.equal(calls.length, 0);
});

test('valida IDs ASCII seguros de 1 a 128 caracteres', async () => {
  const { bridge, native, calls } = setup();
  await assert.rejects(
    bridge.request('GET_STATE', {}, { requestId: 'id con espacios' }),
    (error) => error.code === 'invalid_request',
  );
  await assert.rejects(
    bridge.request('GET_STATE', {}, { requestId: 'x'.repeat(129) }),
    (error) => error.code === 'invalid_request',
  );
  assert.equal(calls.length, 0);

  const pending = bridge.request('GET_STATE', {}, { requestId: 'a'.repeat(128) });
  assert.equal(calls.length, 1);
  reply(native, result('a'.repeat(128)));
  await pending;
});

test('valida payload de UPDATE_TEMPLATE y PREPARE_SHARE', () => {
  assert.equal(validateRequestEnvelope({
    version: 1,
    requestId: 'id-1',
    action: 'UPDATE_TEMPLATE',
    payload: { message: 'Hola {hora}', hour: '08:00', targetLabels: ['Telares', 'Extrusión'] },
  }).ok, true);

  assert.equal(validateRequestEnvelope({
    version: 1,
    requestId: 'id-1',
    action: 'UPDATE_TEMPLATE',
    payload: { hour: '24:00' },
  }).code, 'invalid_payload');

  assert.equal(validateRequestEnvelope({
    version: 1,
    requestId: 'id-1',
    action: 'PREPARE_SHARE',
    payload: { slot: '08:00' },
  }).ok, true);

  assert.equal(validateRequestEnvelope({
    version: 1,
    requestId: 'id-1',
    action: 'PREPARE_SHARE',
    payload: { slot: '8:00' },
  }).code, 'invalid_payload');
});

test('aplica timeout, ignora la respuesta tardía y no simula éxito', async () => {
  const { bridge, native, clock, root } = setup({ timeoutMs: 1000 });
  const events = [];
  root.addEventListener('mn1:native-result', (event) => events.push(event.detail));
  const pending = bridge.request('SAVE_TEMPLATE', {}, { requestId: 'late-id' });

  clock.tick(1000);
  await assert.rejects(pending, (error) => error.code === 'timeout');

  reply(native, result('late-id', { message: 'tarde' }));
  assert.equal(events.length, 0);
  assert.equal(bridge.pendingCount(), 0);
});

test('una respuesta ok:false se resuelve, no se convierte en éxito', async () => {
  const { bridge, native } = setup();
  const pending = bridge.request('PREPARE_SHARE', { slot: '09:00' }, { requestId: 'cancel-id' });
  reply(native, result('cancel-id', { ok: false, message: 'Cancelado por el usuario' }));
  const received = await pending;
  assert.equal(received.ok, false);
  assert.equal(received.message, 'Cancelado por el usuario');
});

test('ignora respuestas duplicadas y respuestas mal formadas', async () => {
  const { bridge, native, clock } = setup();
  const events = [];
  bridge.root.addEventListener('mn1:native-result', (event) => events.push(event.detail));

  const pending = bridge.request('GET_STATE', {}, { requestId: 'dup-result' });
  reply(native, result('dup-result'));
  await pending;
  reply(native, result('dup-result'));
  assert.equal(events.length, 1);

  const malformed = bridge.request('GET_STATE', {}, { requestId: 'bad-json' });
  native.onmessage({ data: '{not json' });
  assert.equal(bridge.lastProtocolError, 'La respuesta nativa no es JSON válido.');
  clock.tick(1000);
  await assert.rejects(malformed, (error) => error.code === 'timeout');

  const wrongVersion = bridge.request('GET_STATE', {}, { requestId: 'wrong-version' });
  reply(native, result('wrong-version', { version: 2 }));
  clock.tick(1000);
  await assert.rejects(wrongVersion, (error) => error.code === 'timeout');
});

test('validación de respuesta exige version, requestId, ok y message', () => {
  assert.equal(validateResultEnvelope(result('id-1')).ok, true);
  assert.equal(validateResultEnvelope(result('id-1', { version: 0 })).code, 'invalid_result');
  assert.equal(validateResultEnvelope(result('id-1', { ok: 'sí' })).code, 'invalid_result');
  assert.equal(validateResultEnvelope(result('id-1', { message: undefined })).code, 'invalid_result');
});

test('close rechaza pendientes y deja de aceptar peticiones', async () => {
  const { bridge } = setup();
  const pending = bridge.request('GET_STATE', {}, { requestId: 'close-id' });
  bridge.close();
  await assert.rejects(pending, (error) => error.code === 'bridge_closed');
  await assert.rejects(
    bridge.request('GET_STATE', {}),
    (error) => error.code === 'bridge_closed',
  );
  assert.equal(bridge.handleNativeMessage(JSON.stringify(result('close-id'))), false);
});

test('utf8ByteLength y el límite de sobre de 32 KB están definidos', () => {
  assert.equal(utf8ByteLength('abc'), 3);
  assert.equal(utf8ByteLength('ñ'), 2);
  assert.equal(utf8ByteLength('🙂'), 4);
  assert.equal(MAX_ENVELOPE_BYTES, 32768);
  assert.equal(typeof Mn1Bridge, 'function');
});
