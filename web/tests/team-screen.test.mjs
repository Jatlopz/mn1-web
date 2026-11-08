import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('el selector de equipos compacta la pantalla completa y conserva reflow',async()=>{
 const css=await readFile(new URL('../public/team-carousel.css',import.meta.url),'utf8');
 assert.match(css,/#teams-screen \.plant-navigation\{display:contents/);assert.match(css,/#teams-screen \.teams-intro\{grid-column:1;grid-row:2;margin:0/);assert.match(css,/#teams-screen \.team-carousel\{grid-column:1\/-1;grid-row:3;margin:0/);assert.match(css,/height:clamp\(120px,24svh,160px\)/);
});
