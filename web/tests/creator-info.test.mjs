import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCreatorInfo,publicCreatorInfo} from '../public/creator-info.js';
const info=()=>({showCeo:true,showCoffee:true,showContact:true,contacts:[{kind:'email',value:'support@fixture.invalid'},{kind:'whatsapp',value:'+504 9999-0000'}]});
test('perfil normaliza contactos editables y oculta los datos de contacto al publicarlos',()=>{const v=info();v.contacts[0].value=' support@fixture.invalid ';assert.equal(normalizeCreatorInfo(v).contacts[0].value,'support@fixture.invalid');v.showContact=false;const out=publicCreatorInfo(v);assert.deepEqual(out.contacts,[]);assert.equal(v.contacts.length,2);});
test('rechaza tipos, enlaces e inyección, duplicados y límite por canal',()=>{for(const change of [v=>v.showCeo='false',v=>v.extra=true,v=>v.contacts[0].value='javascript:alert(1)',v=>v.contacts[0].value='<b>x</b>@fixture.invalid',v=>v.contacts.push({kind:'whatsapp',value:'+50499990000'}),v=>v.contacts=Array.from({length:4},(_,i)=>({kind:'email',value:'user'+i+'@fixture.invalid'}))]){const v=info();change(v);assert.throws(()=>normalizeCreatorInfo(v));}});

test('el workspace real instala el editor y lo vincula al rol confirmado',async()=>{const {readFile}=await import('node:fs/promises');const s=await readFile(new URL('../public/cloud-workspace.js',import.meta.url),'utf8');assert.match(s,/creatorInfo=installCreatorInfo/);assert.match(s,/creatorInfo\?\.setAdmin\(access\?\.admin===true\)/);});
