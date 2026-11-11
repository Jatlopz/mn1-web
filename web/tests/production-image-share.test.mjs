import test from 'node:test';
import assert from 'node:assert/strict';
import {productionImageShareMode} from '../public/production-studio.js';
test('Windows descarga imágenes sin abrir el selector que puede quedar cargando',()=>{
 assert.equal(productionImageShareMode('web','Mozilla/5.0 (Windows NT 10.0; Win64; x64)'),'download');
 assert.equal(productionImageShareMode('native','Android'),'share');
 assert.equal(productionImageShareMode('web','Mozilla/5.0 (Linux; Android 15)'),'share');
});
