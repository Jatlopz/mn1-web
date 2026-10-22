import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RendererError,
  drawOverlay,
  fontSpecFor,
  formatDateEs,
  formatHourText,
  layoutOverlay,
  nextDownscaleScale,
  prepareImageFile,
  renderCompositePng,
  scaleDimensions,
} from '../public/renderer.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function fakeContext(log = []) {
  return {
    save() { log.push('save'); },
    restore() { log.push('restore'); },
    clearRect() {},
    drawImage() {},
    strokeText(text) { log.push(`stroke:${text}`); },
    fillText(text) { log.push(`fill:${text}`); },
  };
}

function fakeCanvas(dataUrl = PNG, log = []) {
  const ctx = fakeContext(log);
  return {
    width: 0,
    height: 0,
    getContext() { return ctx; },
    toDataURL() { return dataUrl; },
  };
}

test('formatea hora 24/12 y fecha es-MX sin interpretar zonas horarias', () => {
  assert.equal(formatHourText('08:05'), '08:05');
  assert.equal(formatHourText('00:00', true), '12:00 AM');
  assert.equal(formatHourText('12:15', true), '12:15 PM');
  assert.equal(formatHourText('20:30', true), '8:30 PM');
  assert.equal(formatHourText('8:05'), '');
  assert.equal(formatHourText('24:00'), '');
  assert.equal(formatDateEs('2026-10-22'), '22/10/2026');
  assert.equal(formatDateEs('texto'), 'texto');
  assert.equal(formatDateEs(null), '');
});

test('escala dimensiones y reduce sin deformar', () => {
  assert.deepEqual(scaleDimensions(1000, 500, 4096), { width: 1000, height: 500, scale: 1 });
  assert.deepEqual(scaleDimensions(8000, 4000, 4096), { width: 4096, height: 2048, scale: 0.512 });
  assert.deepEqual(scaleDimensions(10, 20, 2048), { width: 10, height: 20, scale: 1 });
  assert.equal(nextDownscaleScale(1), 0.82);
  assert.equal(nextDownscaleScale(0.5, 0.5), 0.25);
  assert.equal(nextDownscaleScale(0.5, 2), 0.41);
  assert.equal(nextDownscaleScale(0, 0.8), 1);
});

test('layout centra la hora, limita el overlay y coloca la fecha debajo', () => {
  const layout = layoutOverlay({
    x: 2,
    y: -1,
    size: 0.5,
    font: 'mono',
    color: '#123456',
    showDate: true,
    date: '2026-10-22',
  }, 1000, 500, '09:30');
  assert.equal(layout.x, 1000);
  assert.equal(layout.y, 0);
  assert.equal(layout.hourText, '09:30');
  assert.equal(layout.dateText, '22/10/2026');
  assert.equal(layout.fontSize, 90);
  assert.equal(layout.dateFontSize, 48.6);
  assert.ok(layout.dateY > layout.y);
  assert.match(fontSpecFor('bold', 90), /^700 90px/);
  assert.match(fontSpecFor('serif', 90), /^500 90px/);
  assert.match(fontSpecFor('mono', 90), /^700 90px/);
});

test('drawOverlay dibuja hora y fecha con contorno, sin modificar la foto', () => {
  const log = [];
  const layout = drawOverlay(fakeContext(log), 1000, 500, '08:00', {
    x: 0.5,
    y: 0.8,
    size: 0.1,
    color: '#abcdef',
    showDate: true,
    date: '2026-10-22',
  });
  assert.equal(layout.hourText, '08:00');
  assert.deepEqual(log, [
    'save',
    'stroke:08:00',
    'fill:08:00',
    'stroke:22/10/2026',
    'fill:22/10/2026',
    'restore',
  ]);
  assert.throws(() => drawOverlay(null, 100, 100, '08:00', {}), RendererError);
});

test('renderCompositePng compone a 4096 px máximo y devuelve un PNG válido', async () => {
  const canvases = [];
  const result = await renderCompositePng({
    imageDataUrl: PNG,
    hour: '08:00',
    overlay: { x: 0.5, y: 0.8, size: 0.08, color: '#ffffff' },
    createCanvas: () => {
      const canvas = fakeCanvas();
      canvases.push(canvas);
      return canvas;
    },
    loadImage: async () => ({ naturalWidth: 8000, naturalHeight: 4000 }),
  });
  assert.equal(result.width, 4096);
  assert.equal(result.height, 2048);
  assert.equal(result.scale, 0.512);
  assert.equal(result.dataUrl, PNG);
  assert.equal(canvases[0].width, 4096);
  assert.equal(canvases[0].height, 2048);
});

test('renderCompositePng reduce si el PNG supera el límite y falla con honestidad', async () => {
  const sizes = [];
  const result = await renderCompositePng({
    imageDataUrl: PNG,
    hour: '08:00',
    overlay: {},
    maxDataUrlLength: PNG.length,
    createCanvas: () => {
      const canvas = fakeCanvas();
      sizes.push(canvas);
      return canvas;
    },
    loadImage: async () => ({ naturalWidth: 1000, naturalHeight: 1000 }),
  });
  assert.equal(result.width, 1000);
  assert.equal(result.dataUrl, PNG);

  await assert.rejects(renderCompositePng({
    imageDataUrl: PNG,
    hour: '08:00',
    overlay: {},
    maxDataUrlLength: 1,
    createCanvas: () => fakeCanvas(),
    loadImage: async () => ({ naturalWidth: 1000, naturalHeight: 1000 }),
  }), (error) => error.code === 'png_too_large');

  await assert.rejects(renderCompositePng({
    imageDataUrl: 'data:image/jpeg;base64,AAAA',
    hour: '08:00',
    overlay: {},
    createCanvas: () => fakeCanvas(),
    loadImage: async () => ({ naturalWidth: 1000, naturalHeight: 1000 }),
  }), (error) => error.code === 'invalid_image');
});

test('prepareImageFile limita el lado a 2048 y devuelve la copia sin hora', async () => {
  const canvases = [];
  const result = await prepareImageFile({ name: 'foto.png' }, {
    maxSide: 2048,
    createCanvas: () => {
      const canvas = fakeCanvas();
      canvases.push(canvas);
      return canvas;
    },
    createImageBitmapFn: async () => ({ width: 5000, height: 3000 }),
  });
  assert.equal(result.width, 2048);
  assert.equal(result.height, 1229);
  assert.equal(result.scale, 0.4096);
  assert.equal(canvases[0].width, 2048);
  assert.equal(canvases[0].height, 1229);
  await assert.rejects(prepareImageFile(null), (error) => error.code === 'invalid_file');
});
