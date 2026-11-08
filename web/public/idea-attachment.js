import {prepareImageFile} from './renderer.js';

export const IDEA_IMAGE_LIMIT=350000;
export function isIdeaImage(value){return typeof value==='string'&&value.length>=100&&value.length<=IDEA_IMAGE_LIMIT&&/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value);}
export async function prepareIdeaImage(file){
 if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||!file.size||file.size>8*1024*1024)throw Error('Elige una imagen PNG, JPG o WebP de hasta 8 MB.');
 const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
 const valid=file.type==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:file.type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 if(!valid)throw Error('El archivo no corresponde a una imagen compatible.');
 try{const result=await prepareImageFile(file,{maxSide:1600,minDimension:1,maxDataUrlLength:IDEA_IMAGE_LIMIT});if(isIdeaImage(result.dataUrl))return result.dataUrl;}catch{/* Show a limit appropriate to this attachment, not the general photo importer. */}
 throw Error('No se pudo preparar la imagen. Prueba con una imagen más pequeña.');
}
export function prepareNativeIdeaImage(value){
 if(typeof value!=='string'||value.length>12*1024*1024||!value.startsWith('data:image/png;base64,'))throw Error('El selector no devolvió una imagen compatible.');
 const bytes=Uint8Array.from(atob(value.slice(22)),c=>c.charCodeAt(0));
 return prepareIdeaImage(new File([bytes],'adjunto.png',{type:'image/png'}));
}

/** Lazy private retrieval: the public team feed never contains attachments. */
export function appendIdeaAttachment(host,idea,{client,receipt=null,root=document}={}){
 if(!idea.has_attachment)return;
 const details=root.createElement('details'),summary=root.createElement('summary'),status=root.createElement('p');details.className='idea-attachment';summary.textContent='Ver imagen adjunta';status.className='hint';status.setAttribute('role','status');details.append(summary,status);host.append(details);
 let loaded=false,busy=false;
 details.addEventListener('toggle',async()=>{
  if(!details.open||loaded||busy)return;busy=true;status.textContent='Cargando imagen…';
  try{const value=await client.ideaImage(idea.id,receipt);if(!isIdeaImage(value))throw Error();const image=root.createElement('img');image.src=value;image.alt='Imagen adjunta a la idea de '+idea.team_name;image.loading='lazy';details.append(image);status.textContent='';loaded=true;}
  catch{status.textContent='No se pudo cargar la imagen. Cierra y vuelve a abrir este apartado para reintentar.';}
  finally{busy=false;}
 });
}
