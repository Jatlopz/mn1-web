import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isIdeaImage,prepareIdeaImage,prepareNativeIdeaImage} from '../public/idea-attachment.js';
import {CloudClient} from '../public/cloud-client.js';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
test('adjunto sólo PNG acotado; rechaza SVG, URLs y exceso',()=>{
 assert.equal(isIdeaImage(image),true);
 for(const value of [null,'https://fixture.invalid/photo.png','data:image/svg+xml;base64,AAAA',image+'!','data:image/png;base64,iVBORw0KGgo'+'A'.repeat(350000)])assert.equal(isIdeaImage(value),false);
});
test('archivo original acotado y formato comprobado antes de decodificar',async()=>{
 for(const file of [{type:'image/svg+xml',size:8},{type:'image/png',size:9*1024*1024},{type:'image/png',size:0},{type:'image/png',size:200,slice:()=>new Blob(['not a PNG'])}])await assert.rejects(prepareIdeaImage(file));
 assert.throws(()=>prepareNativeIdeaImage('content://private/image'));
});
test('texto sin imagen conserva RPC antiguo; adjunto usa envío atómico y consulta privada',async()=>{
 const calls=[];const client=new CloudClient({}, {fetcher:async(url,options)=>{calls.push({url,options,body:options.body?JSON.parse(options.body):null});return Response.json('ok');}});
 await client.submitIdea('id','receipt','champions','Una propuesta de ejemplo');assert.match(calls[0].url,/mn1_submit_idea$/);assert.equal(calls[0].body.p_image,undefined);
 await client.submitIdea('id2','receipt','champions','Una propuesta de ejemplo',image);assert.match(calls[1].url,/mn1_submit_idea_image$/);assert.equal(calls[1].body.p_image,image);
 await client.ideaImage('id2','receipt');assert.equal(calls[2].body.p_client,'receipt');assert.equal(calls[2].options.headers.Authorization,undefined);
 client.session={access_token:'fixture-jwt',expires_at:Math.floor(Date.now()/1000)+3600};await client.ideaImage('id2');assert.equal(calls[3].options.headers.Authorization,'Bearer fixture-jwt');assert.equal(calls[3].body.p_client,null);
 assert.throws(()=>client.submitIdea('id','receipt','champions','Una propuesta','https://unsafe.invalid/x'));
 await client.listIdeas();assert.match(calls[4].url,/has_attachment/);assert.doesNotMatch(calls[4].url,/,attachment,/);
});
test('formulario integra adjunto y usa el selector Android existente sin nueva APK',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),js=await readFile(new URL('../public/cloud-workspace.js',import.meta.url),'utf8');
 for(const id of ['idea-image-input','idea-image-add','idea-image-remove','idea-image-preview'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(js,/prepareNativeIdeaImage/);assert.match(js,/services\.bridge\.request\('IMPORT_IMAGE'/);assert.match(js,/imageHash/);assert.match(js,/appendIdeaAttachment\(card,idea,\{client,receipt\}\)/);
});
