import { CAPABILITIES, isPngDataUrl, pngBase64FromDataUrl, pngDataUrlFromBase64 } from './bridge.js';
import { loadImageElement, prepareImageFile } from './renderer.js';

export const REPORT_PREFS_KEY = 'mn1.report.preferences';
export const REPORT_PHOTO_KEY = 'mn1.report.photo';
export const REPORT_FRAMES = Object.freeze(['signal','clean','gold']);
export function normalizeReportPreferences(value = {}, catalog = []) {
  if(!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const first = catalog[0]?.id || 'indestructibles';
  return { teamId:catalog.some(t=>t.id===value.teamId)?value.teamId:first,
    frame:REPORT_FRAMES.includes(value.frame)?value.frame:'signal',
    heading:typeof value.heading==='string'?value.heading.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,60)||'Reunión realizada':'Reunión realizada',
    showDate:value.showDate!==false,
    destinations:[0,1].map(i=>typeof value.destinations?.[i]==='string'?value.destinations[i].replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,40):''),
  };
}
export function reportDimensions(width,height,maxSide=1600) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)throw Error('Foto sin dimensiones válidas.');
  const scale=Math.min(1,maxSide/Math.max(width,height*1.22));
  const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  const footer=Math.max(Math.round(w*.2),Math.round(h*.16));
  return {width:w,height:h+footer,photoHeight:h,footer};
}
function fitText(ctx,text,width,size,min=2) { while(size>min){ctx.font='900 '+size+'px system-ui,sans-serif';if(ctx.measureText(text).width<=width)break;size-=1;}ctx.font='900 '+size+'px system-ui,sans-serif';return size; }
/** La foto completa ocupa su propia zona; el membrete se añade debajo, sin recortarla. */
export function drawReport(canvas,image,prefs,team,date=new Date()) {
  const size=reportDimensions(image.naturalWidth||image.width,image.naturalHeight||image.height);
  canvas.width=size.width;canvas.height=size.height;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas no disponible.');
  const w=size.width,h=size.height,p=size.photoHeight;const accent=prefs.frame==='gold'?'#f5c542':/^#[a-f0-9]{6}$/i.test(team.color||'')?team.color:'#c8f751';
  ctx.fillStyle='#0a1711';ctx.fillRect(0,0,w,h);ctx.drawImage(image,0,0,w,p);
  const border=prefs.frame==='clean'?Math.max(2,w*.005):Math.max(4,w*.012);
  ctx.strokeStyle=accent;ctx.lineWidth=border;ctx.strokeRect(border/2,border/2,w-border,h-border);
  ctx.fillStyle=accent;ctx.fillRect(0,p,w,Math.max(3,w*.006));
  if(prefs.frame!=='clean'){ctx.fillStyle=accent;ctx.globalAlpha=.12;ctx.fillRect(0,p,w,size.footer);ctx.globalAlpha=1;}
  const pad=w*.045;ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillStyle='#edf5ee';
  fitText(ctx,prefs.heading.toUpperCase(),w-pad*2,w*.046);ctx.fillText(prefs.heading.toUpperCase(),pad,p+size.footer*.25);
  const name=team.name||'Equipo';const font=fitText(ctx,name,w-pad*2,w*.065);ctx.fillStyle=accent;
  if(prefs.frame==='signal'){ctx.strokeStyle='#050b08';ctx.lineWidth=Math.max(1,font*.08);ctx.strokeText(name,pad,p+size.footer*.59);}
  ctx.fillText(name,pad,p+size.footer*.59);
  if(prefs.showDate){ctx.fillStyle='#c1d0c5';ctx.font='500 '+Math.max(11,w*.024)+'px system-ui,sans-serif';ctx.fillText(date.toLocaleDateString('es-HN',{year:'numeric',month:'long',day:'numeric'}),pad,p+size.footer*.86);}
  return size;
}
export function createMeetingReport(getServices) {
  const $=id=>document.getElementById(id),root=$('report-studio'),canvas=$('report-canvas');
  let photo=null,prefs=null,busy=false,dirty=false,loadToken=0,priorTitle='';
  const services=()=>getServices();
  const message=(text,error=false)=>{const el=$('report-status');el.textContent=text;el.dataset.tone=error?'error':'info';};
  const lock=value=>{busy=value;root.setAttribute('aria-busy',String(value));for(const e of root.querySelectorAll('button,input,select'))e.disabled=value;$('report-share').disabled=value||!photo;$('report-preview').classList.toggle('is-loading',value);};
  const values=()=>normalizeReportPreferences({teamId:$('report-team').value,frame:$('report-frame').value,heading:$('report-heading').value,showDate:$('report-date').checked,destinations:[$('report-target-1').value,$('report-target-2').value]},services().catalog);
  const render=()=>{if(!photo)return;const v=values(),team=services().catalog.find(t=>t.id===v.teamId)||{};drawReport(canvas,photo,v,team);canvas.hidden=false;$('report-placeholder').hidden=true;};
  const persist=async()=>{const {storage}=services();if(!storage)throw Error('No hay almacenamiento disponible.');const next=values();await storage.putText(REPORT_PREFS_KEY,JSON.stringify(next));prefs=next;dirty=false;};
  async function acceptPhoto(dataUrl) {
    if(!isPngDataUrl(dataUrl))throw Error('La cámara no devolvió una imagen válida.');
    const decoded=await loadImageElement(dataUrl);const {storage}=services();if(!storage)throw Error('No hay almacenamiento disponible.');
    await storage.putText(REPORT_PHOTO_KEY,pngBase64FromDataUrl(dataUrl));photo=decoded;render();message('Foto lista. Elige el equipo y el marco; después comparte.');
  }
  async function pick(camera) {
    if(busy)return;const s=services();
    if(s.mode!=='native'){const input=camera?$('report-camera-input'):$('report-file-input');input.value='';input.click();return;}
    if(camera&&!s.capabilities.has(CAPABILITIES.CAMERA)){message('Abre Settings → Actualizaciones para activar la cámara. Mientras puedes elegir una foto.',true);return;}
    lock(true);message(camera?'Abriendo cámara…':'Abriendo fotos…');
    try {const result=await s.bridge.request(camera?'CAPTURE_PHOTO':'IMPORT_IMAGE',{}, {timeoutMs:300000});if(!result.ok)throw Error(result.message);await acceptPhoto(result.data?.imageDataUrl);}catch(e){message(e.message||'Captura cancelada. Tu foto anterior sigue disponible.',true);}finally{lock(false);}
  }
  async function open() {
    const s=services();if(s.blocked){message('Espera a que termine la operación actual.',true);return;}
    priorTitle=document.title;document.title='Reporte de reunión · Batiseñal';$('app').hidden=true;root.hidden=false;lock(true);message('Preparando estudio…');
    const token=++loadToken;
    try {
      const saved=s.storage?await s.storage.getText(REPORT_PREFS_KEY):null;prefs=normalizeReportPreferences(saved?JSON.parse(saved):{},s.catalog);
      const select=$('report-team');select.replaceChildren();for(const team of s.catalog){const option=document.createElement('option');option.value=team.id;option.textContent=team.name;select.append(option);}
      select.value=prefs.teamId;$('report-frame').value=prefs.frame;$('report-heading').value=prefs.heading;$('report-date').checked=prefs.showDate;$('report-target-1').value=prefs.destinations[0];$('report-target-2').value=prefs.destinations[1];dirty=false;
      if(!photo&&s.storage){const stored=await s.storage.getText(REPORT_PHOTO_KEY);if(stored){const url=pngDataUrlFromBase64(stored);if(isPngDataUrl(url)){photo=await loadImageElement(url);}}}
      if(token!==loadToken)return;render();message(photo?'Tu último reporte está listo para editar.':'Toma una foto para crear el reporte.');
    }catch(e){message('No se pudieron leer los datos del reporte: '+e.message,true);}finally{lock(false);}
    await pick(true);
  }
  async function close(){if(busy)return;lock(true);try{if(dirty)await persist();root.hidden=true;$('app').hidden=false;document.title=priorTitle;$('open-report').focus();}catch(e){message('No se guardaron los ajustes: '+e.message,true);}finally{lock(false);}}
  $('open-report').addEventListener('click',()=>void open());$('report-back').addEventListener('click',()=>void close());
  $('report-take').addEventListener('click',()=>void pick(true));$('report-pick').addEventListener('click',()=>void pick(false));
  for(const id of ['report-team','report-frame','report-heading','report-date','report-target-1','report-target-2'])$(id).addEventListener('input',()=>{dirty=true;render();});
  for(const id of ['report-camera-input','report-file-input'])$(id).addEventListener('change',async()=>{const file=$(id).files?.[0];if(!file||busy)return;lock(true);try{const prepared=await prepareImageFile(file);await acceptPhoto(prepared.dataUrl);}catch(e){message(e.message,true);}finally{lock(false);}});
  $('report-save').addEventListener('click',async()=>{if(busy)return;lock(true);try{await persist();message('Ajustes guardados en este teléfono.');}catch(e){message(e.message,true);}finally{lock(false);}});
  $('report-share').addEventListener('click',async()=>{
    if(busy||!photo)return;lock(true);try{
      const v=values();if(v.destinations.some(x=>!x)){throw Error('Escribe los nombres de los dos grupos de reporte.');}
      if(v.destinations[0].toLocaleLowerCase()===v.destinations[1].toLocaleLowerCase())throw Error('Los dos grupos deben tener nombres distintos.');
      await persist();render();let dataUrl=canvas.toDataURL('image/png');let out=canvas;
      for(let attempt=0;dataUrl.length>8*1024*1024&&attempt<8;attempt++){const small=document.createElement('canvas');small.width=Math.round(out.width*.8);small.height=Math.round(out.height*.8);small.getContext('2d').drawImage(out,0,0,small.width,small.height);out=small;dataUrl=out.toDataURL('image/png');}
      if(!isPngDataUrl(dataUrl))throw Error('La imagen supera el tamaño permitido.');
      const s=services(),team=s.catalog.find(t=>t.id===v.teamId);const text=v.heading+' · '+team.name+'. Grupos de reporte: '+v.destinations.join(' y ')+'.';
      if(s.mode!=='native'){if(typeof navigator.share!=='function'||typeof File!=='function')throw Error('Comparte desde Batiseñal Android.');const bytes=Uint8Array.from(atob(pngBase64FromDataUrl(dataUrl)),c=>c.charCodeAt(0));const file=new File([bytes],'reporte-reunion.png',{type:'image/png'});if(!navigator.canShare?.({files:[file]}))throw Error('Este navegador no comparte imágenes.');await navigator.share({files:[file],text});message('Se cerró el selector; la entrega se confirma en WhatsApp.');}
      else {const result=await s.bridge.request('SHARE_PNG',{imageDataUrl:dataUrl,message:text},{timeoutMs:300000});if(!result.ok)throw Error(result.message);message(result.message+' Elige y confirma los grupos en WhatsApp.');}
    }catch(e){message(e.message||'No se compartió.',true);}finally{lock(false);}
  });
  return {open};
}
