import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {nearestTeamIndex,teamInitials} from '../public/team-carousel.js';
test('el carrusel centra por geometría, conserva orden y limita los extremos',()=>{
 const items=[{left:40,width:300},{left:364,width:300},{left:688,width:300}];
 assert.equal(nearestTeamIndex(items,0,380),0);assert.equal(nearestTeamIndex(items,324,380),1);assert.equal(nearestTeamIndex(items,9999,380),2);assert.equal(nearestTeamIndex(items,-200,380),0);assert.equal(nearestTeamIndex([],0,400),-1);
});
test('identidad alternativa para equipos sin imagen sin inventar un logo',()=>{
 assert.equal(teamInitials('Los Indestructibles'),'I');assert.equal(teamInitials('Los Super Guerreros'),'SG');assert.equal(teamInitials('Equipo de producción y calidad'),'EP');assert.equal(teamInitials(''),'E');
});
test('la integración conserva claves de logo, portada y selección existentes',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),css=await readFile(new URL('../public/team-carousel.css',import.meta.url),'utf8'),source=await readFile(new URL('../public/team-carousel.js',import.meta.url),'utf8');
 assert.match(app,/createTeamCarousel\(dom.profileList\)/);assert.match(app,/readTeamLogo\(app.storage,definition.id\)/);assert.match(app,/data-edit-team-logo/);assert.match(app,/app\.teamLogoCache\?\.clear\(\);renderProfiles/);assert.match(app,/openCoverDialog\(dom, app, coverButton.dataset.editCover\)/);assert.match(app,/handleSelectProfile\(dom, app, card.dataset.profileId\)/);
 assert.match(css,/object-fit:contain/);assert.match(css,/scroll-snap-type:x mandatory/);assert.match(css,/prefers-reduced-motion/);assert.match(css,/@media\(hover:hover\) and \(pointer:fine\)/);assert.doesNotMatch(source,/localStorage|putText|setInterval/);
});
