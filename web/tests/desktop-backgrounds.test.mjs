import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {THEME_ART,themeArtDimensions,buildSite} from '../tools/build-site.mjs';
const source=fileURLToPath(new URL('../public/',import.meta.url));
test('escenas UHD, arte panorámico de temas y fondos verticales conservan dimensiones reales',async()=>{
 const desktop=THEME_ART.filter(a=>a.desktop),portrait=THEME_ART.filter(a=>!a.desktop&&a.height>a.width),landscape=THEME_ART.filter(a=>!a.desktop&&a.width>a.height);
 assert.equal(desktop.length,10);assert.equal(portrait.length,5);assert.equal(landscape.length,5);
 for(const art of THEME_ART){const bytes=await readFile(path.join(source,art.path));assert.deepEqual(themeArtDimensions(bytes),{width:art.width,height:art.height});if(art.desktop){assert.equal(art.width,3840);assert.equal(art.height,2160);assert.ok(art.size<2*1024*1024);}else if(art.height>art.width)assert.deepEqual(themeArtDimensions(bytes),{width:1024,height:1536});else assert.deepEqual(themeArtDimensions(bytes),{width:1672,height:941});}
});
test('el empaquetado rechaza una dimensión declarada que no coincide con la imagen',async()=>{
 const art=THEME_ART.find(a=>!a.desktop),width=art.width,out=await mkdtemp(path.join(tmpdir(),'st-dimensions-'));
 try{art.width=width+1;await assert.rejects(buildSite(source,out),/dimensions mismatch/);}finally{art.width=width;}
});
test('el lector de WebP rechaza cabeceras truncadas y tamaño RIFF falso',async()=>{
 const bytes=await readFile(path.join(source,THEME_ART.find(a=>a.path.endsWith('.webp')).path));assert.throws(()=>themeArtDimensions(bytes.subarray(0,22)),/Invalid/);
 const forged=Buffer.from(bytes);forged.writeUInt32LE(1,4);assert.throws(()=>themeArtDimensions(forged),/Invalid/);
});
