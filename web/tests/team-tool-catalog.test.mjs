import test from 'node:test';
import assert from 'node:assert/strict';
import {PROFILE_CATALOG,TEAM_TOOLS,isToolEnabledForTeam,toolsForTeam,toolShortcutsForTeam,toolRequestNote,mergeToolRequestDraft} from '../public/profiles.js';
import {launchTeamTool} from '../public/app.js';
const custom={id:'custom-11111111-1111-4111-8111-111111111111',name:'Equipo ficticio',plantId:'sacos'};
test('anuncios y reporte son generales; eficiencia es exclusiva de los cuatro equipos de Sacos',()=>{
 assert.deepEqual(TEAM_TOOLS.filter(t=>t.includedByDefault===true).map(t=>t.id),['announcement','report']);
 for(const team of PROFILE_CATALOG)assert.deepEqual(toolsForTeam(team).map(t=>t.id),['announcement','report','production']);
 for(const team of [custom,{...custom,plantId:'polietileno'},{...PROFILE_CATALOG[0],plantId:'polietileno'}]){
  assert.deepEqual(toolsForTeam(team).map(t=>t.id),['announcement','report']);assert.equal(isToolEnabledForTeam('production',team),false);
 }
 assert.equal(isToolEnabledForTeam('production',null),false);assert.equal(isToolEnabledForTeam('fake',PROFILE_CATALOG[0]),false);
 assert.equal(isToolEnabledForTeam('production',{...custom,name:'Los Champions'}),false);
});
test('accesos heredados se filtran sin borrar ni alterar preferencias originales',()=>{
 const original=['announcement','production','report'];const snapshot=JSON.stringify(original);
 assert.deepEqual(toolShortcutsForTeam(original,custom),['announcement','report']);
 assert.deepEqual(toolShortcutsForTeam(null,custom),['announcement','report']);
 assert.deepEqual(toolShortcutsForTeam([],custom),[]);
 assert.deepEqual(toolShortcutsForTeam(original,PROFILE_CATALOG[0]),original);assert.equal(JSON.stringify(original),snapshot);
});
test('el punto de apertura rechaza herramientas ajenas incluso con un acceso antiguo',()=>{
 let opened=0;const app={workspace:{activeProfileId:custom.id},catalog:[custom],productionStudio:{open:()=>opened++}};
 assert.equal(launchTeamTool({},app,'production'),false);assert.equal(opened,0);
 app.workspace.activeProfileId='champions';app.catalog=[PROFILE_CATALOG[0]];
 assert.equal(launchTeamTool({},app,'production'),true);assert.equal(opened,1);
 app.busy=true;assert.equal(launchTeamTool({},app,'production'),false);assert.equal(opened,1);
});
test('solicitud nombra herramienta y equipo; añadirla respeta el borrador y el límite',()=>{
 const note=toolRequestNote('production',custom);assert.match(note,/Eficiencias y estatus/);assert.match(note,/Equipo ficticio/);assert.match(note,/adaptación/);
 assert.equal(mergeToolRequestDraft('Mi idea anterior',note),'Mi idea anterior\n\n'+note);
 const large='x'.repeat(1490);assert.equal(mergeToolRequestDraft(large,note),null);assert.equal(large.length,1490);
 assert.throws(()=>toolRequestNote('unknown',custom));
});

test('altura del catálogo usa el viewport medido de Android y permite desplazamiento',async()=>{
 const {readFile}=await import('node:fs/promises');const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
 const rules=[...css.matchAll(/\.tool-library\s*\{([^}]+)\}/g)].map(match=>match[1]);const heightRule=rules.find(rule=>rule.includes('max-height'));
 assert.match(heightRule,/var\(--mn1-editor-height,\s*100vh\)/);assert.doesNotMatch(heightRule,/\d(?:dvh|svh|lvh)/);assert.match(heightRule,/overflow-y:\s*auto/);
});
