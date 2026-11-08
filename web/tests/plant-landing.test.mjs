import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('la bienvenida proporciona el viewport sin recortar zoom y selección con movimiento reducido',async()=>{
 const css=await readFile(new URL('../public/team-carousel.css',import.meta.url),'utf8'),motion=await readFile(new URL('../public/team-carousel.js',import.meta.url),'utf8');
 assert.match(css,/min-height:100svh/);assert.match(css,/@media\(max-height:700px\)/);assert.match(css,/#welcome-screen \.plant-grid/);assert.match(css,/#welcome-screen \.plant-count\{min-height:2.6em/);
 assert.match(motion,/accentPending=false;if\(reduce\(\)\)return/);assert.match(motion,/accent\?\.cancel\(\)/);assert.match(motion,/duration:260/);assert.match(motion,/mouseenter',startHoverLoop/);assert.match(motion,/mouseleave',stopHoverLoop/);assert.match(motion,/2200\)/);assert.match(motion,/if\(items.length<2\|\|reduce\(\)\|\|!/);
});
