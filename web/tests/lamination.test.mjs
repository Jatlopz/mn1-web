import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateLamination,calculateSlitter,decimal,createLaminationDraft,normalizeLaminationDraft,laminationKey,LAMINATION_DEFAULTS} from '../public/lamination-model.js';
import {isToolEnabledForTeam,PROFILE_CATALOG,toolShortcutsForTeam} from '../public/profiles.js';
import {launchTeamTool} from '../public/app.js';
const row={width:'10',application:'20',labelPounds:'100',labelMetres:'800',reportedPounds:'125'};
const settings={...LAMINATION_DEFAULTS,inchesPerMetre:'40',gramsPerPound:'400'};
test('reproduce la cadena del Excel y conserva el signo calculado menos reportado',()=>{
 assert.deepEqual(calculateLamination(row,settings),{coatingPounds:20,calculatedPounds:120,difference:-5});
 assert.equal(calculateLamination({...row,reportedPounds:'115'},settings).difference,5);
 assert.equal(calculateLamination({...row,reportedPounds:'120'},settings).difference,0);
});
test('no redondea pasos intermedios y conserva los factores originales',()=>{
 assert.deepEqual(LAMINATION_DEFAULTS,{faces:'2',inchesPerMetre:'39.37',gramsPerPound:'454',normal:'17',yara:'46.15'});
 assert.equal(calculateLamination(row).calculatedPounds,100+10*2/39.37*20*800/454);
});
test('cambios de ancho, aplicación, metros, etiquetas y factores recalculan',()=>{
 assert.equal(calculateLamination({...row,width:'20'},settings).coatingPounds,40);
 assert.equal(calculateLamination({...row,application:'40'},settings).coatingPounds,40);
 assert.equal(calculateLamination({...row,labelMetres:'1600'},settings).coatingPounds,40);
 assert.equal(calculateLamination({...row,labelPounds:'200'},settings).calculatedPounds,220);
 assert.equal(calculateLamination(row,{...settings,faces:'1'}).coatingPounds,10);
});
test('campos incompletos, negativos, texto y denominadores cero no producen resultados falsos',()=>{
 for(const key of ['width','application','labelPounds','labelMetres'])assert.equal(calculateLamination({...row,[key]:''},settings).calculatedPounds,null);
 for(const value of ['abc','1e4','-1','Infinity'])assert.equal(calculateLamination({...row,labelPounds:value},settings).calculatedPounds,null);
 for(const key of ['faces','inchesPerMetre','gramsPerPound'])assert.equal(calculateLamination(row,{...settings,[key]:'0'}).calculatedPounds,null);
 assert.equal(calculateLamination({...row,reportedPounds:''},settings).difference,null);
 assert.equal(calculateLamination({...row,labelPounds:'0',labelMetres:'0',reportedPounds:'0'},settings).difference,0);
});
test('coma decimal, espacios y precisión aceptadas; miles ambiguos y no finitos rechazados',()=>{
 assert.equal(decimal(' 12,5 '),12.5);assert.equal(decimal('0'),0);assert.equal(decimal(''),null);
 assert.equal(decimal('1,234.50'),null);assert.equal(decimal('1 234'),null);assert.equal(decimal('9'.repeat(400)),null);
 assert.equal(decimal('-5',{signed:true}),-5);assert.equal(decimal('0',{positive:true}),null);
});
test('Slitter calcula rendimiento y metros con diferencia independiente, incluida negativa',()=>{
 assert.deepEqual(calculateSlitter({metres:'800',pounds:'100',difference:'25'}),{yield:8,metresToRequest:200});
 assert.equal(calculateSlitter({metres:'800',pounds:'100',difference:'-25'}).metresToRequest,-200);
 assert.equal(calculateSlitter({metres:'800',pounds:'100',difference:''}).metresToRequest,null);
 assert.equal(calculateSlitter({metres:'800',pounds:'0',difference:'25'}).yield,null);
});
test('borradores y factores se aíslan por equipo sin mutar el original',()=>{
 const a=createLaminationDraft(),b=createLaminationDraft();a.settings.normal='30';a.rows[0].width='10';
 assert.equal(b.settings.normal,'17');assert.equal(b.rows[0].width,'');
 const restored=normalizeLaminationDraft(JSON.parse(JSON.stringify(a)));assert.deepEqual(restored,a);restored.rows[0].width='20';assert.equal(a.rows[0].width,'10');
 assert.notEqual(laminationKey('a'),laminationKey('b'));
 assert.throws(()=>normalizeLaminationDraft({version:2,rows:[row]}));assert.throws(()=>normalizeLaminationDraft({version:1,rows:[]}));
 assert.throws(()=>normalizeLaminationDraft({...b,rows:[null]}));assert.throws(()=>normalizeLaminationDraft({...b,settings:[]}));
 assert.throws(()=>normalizeLaminationDraft({...b,rows:[{...row,width:'9'.repeat(41)}]}));
});
test('Laminado disponible sólo para equipos Sacos, sin extender Eficiencias',()=>{
 for(const team of PROFILE_CATALOG)assert.equal(isToolEnabledForTeam('lamination',team),true);
 const custom={id:'custom-example',name:'Equipo ficticio',plantId:'sacos'};
 assert.equal(isToolEnabledForTeam('lamination',custom),true);assert.equal(isToolEnabledForTeam('production',custom),false);
 assert.equal(isToolEnabledForTeam('lamination',{...custom,plantId:'polietileno'}),false);
 assert.equal(isToolEnabledForTeam('lamination',null),false);
 assert.deepEqual(toolShortcutsForTeam(['lamination'],custom),['lamination']);
 assert.deepEqual(toolShortcutsForTeam(['lamination'],{...custom,plantId:'polietileno'}),[]);
});
test('lanzador y atajos no permiten abrir Laminado desde Polietileno',()=>{
 let calls=0;const team={id:'qa-custom',name:'Equipo ficticio',plantId:'sacos'},app={workspace:{activeProfileId:team.id},catalog:[team],laminationStudio:{open:context=>{assert.equal(context.id,team.id);calls++;}}};
 assert.equal(launchTeamTool({},app,'lamination'),true);assert.equal(calls,1);
 team.plantId='polietileno';assert.equal(launchTeamTool({},app,'lamination'),false);assert.equal(calls,1);
});
