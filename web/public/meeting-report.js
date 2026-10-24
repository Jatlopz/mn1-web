import { teamsForPlant } from './profiles.js';
import { CAPABILITIES, isValidVaultKey, isPngDataUrl, pngBase64FromDataUrl, pngDataUrlFromBase64 } from './bridge.js';
import { loadImageElement, prepareImageFile } from './renderer.js';

export const REPORT_PREFS_KEY = 'mn1.report.preferences';
export const REPORT_STYLES_KEY = 'mn1.report.styles';
export const REPORT_PHOTO_KEY = 'mn1.report.photo';
export function greetingForHour(hour) {
  if(!Number.isInteger(hour)||hour<0||hour>23)throw Error('Hora de captura no válida.');
  return hour>=6&&hour<18?'Buenos días':'Buenas noches';
}
export function createCaptureRecord(dataUrl,date=new Date()) {
  if(!isPngDataUrl(dataUrl)||!Number.isFinite(date.getTime()))throw Error('Foto u hora no válida.');
  return {imageBase64:pngBase64FromDataUrl(dataUrl),capturedAt:date.toISOString(),localHour:date.getHours()};
}
export function parseCaptureRecord(raw) {
  if(typeof raw!=='string')return null;
  if(!raw.startsWith('{'))return isPngDataUrl(pngDataUrlFromBase64(raw))?{imageBase64:raw,capturedAt:null,localHour:null}:null;
  try{const r=JSON.parse(raw);if(!isPngDataUrl(pngDataUrlFromBase64(r.imageBase64)))return null;if(!Number.isInteger(r.localHour)||r.localHour<0||r.localHour>23||!Number.isFinite(Date.parse(r.capturedAt)))return null;return {imageBase64:r.imageBase64,capturedAt:r.capturedAt,localHour:r.localHour};}catch{return null;}
}
export function reportLogoKey(teamId,stamp=Date.now().toString(36)+Math.random().toString(36).slice(2,6)) {
  const id=String(teamId).replace(/^custom-/,'').replaceAll('-','');
  const key='mn1.report.logo.'+id+'.'+String(stamp).replace(/[^a-zA-Z0-9]/g,'').slice(-13);
  if(!isValidVaultKey(key))throw Error('Equipo no válido para logo.');return key;
}
export const REPORT_FRAMES = Object.freeze(['signal','clean','gold']);
export function normalizeReportPreferences(value = {}, catalog = []) {
  if(!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const first = catalog[0]?.id || 'indestructibles';
  return { teamId:catalog.some(t=>t.id===value.teamId)?value.teamId:first,
    frame:REPORT_FRAMES.includes(value.frame)?value.frame:'signal',
    frameColor:typeof value.frameColor==='string'&&/^#[a-f0-9]{6}$/i.test(value.frameColor)?value.frameColor.toLowerCase():null,
    heading:typeof value.heading==='string'?value.heading.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,60)||'Reunión realizada':'Reunión realizada',
    showDate:value.showDate!==false,
    watermark:value.watermark===true,
    watermarkOpacity:Number.isFinite(Number(value.watermarkOpacity))?Math.min(.65,Math.max(.15,Number(value.watermarkOpacity))):.28,
    watermarkPosition:['top-left','top-right','bottom-left','bottom-right'].includes(value.watermarkPosition)?value.watermarkPosition:'bottom-right',
    logoKeys:Object.fromEntries(catalog.filter(t=>typeof value.logoKeys?.[t.id]==='string'&&value.logoKeys[t.id].startsWith('mn1.report.logo.')&&isValidVaultKey(value.logoKeys[t.id])).map(t=>[t.id,value.logoKeys[t.id]])),
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
export function resolveReportFrameColor(prefs,team={}) {
  if(typeof prefs.frameColor==='string'&&/^#[a-f0-9]{6}$/i.test(prefs.frameColor))return prefs.frameColor.toLowerCase();
  return prefs.frame==='gold'?'#f5c542':/^#[a-f0-9]{6}$/i.test(team.color||'')?team.color:'#c8f751';
}
export function drawReport(canvas,image,prefs,team,date=new Date(),logo=null) {
  const size=reportDimensions(image.naturalWidth||image.width,image.naturalHeight||image.height);
  canvas.width=size.width;canvas.height=size.height;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas no disponible.');
  const w=size.width,h=size.height,p=size.photoHeight;const accent=resolveReportFrameColor(prefs,team);
  ctx.fillStyle='#0a1711';ctx.fillRect(0,0,w,h);ctx.drawImage(image,0,0,w,p);
  if(prefs.watermark&&logo){
    const lw=logo.naturalWidth||logo.width,lh=logo.naturalHeight||logo.height;
    if(lw>0&&lh>0){const ratio=Math.min(w*.23/lw,p*.2/lh),dw=lw*ratio,dh=lh*ratio,pad=w*.04;
      const left=prefs.watermarkPosition.endsWith('left'),top=prefs.watermarkPosition.startsWith('top');
      ctx.save();ctx.globalAlpha=prefs.watermarkOpacity;ctx.drawImage(logo,left?pad:w-pad-dw,top?pad:p-pad-dh,dw,dh);ctx.restore();}
  }
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
export function reportShareMessage(preferences,team,hour) {
  const clean=normalizeReportPreferences(preferences,team?[team]:[]);
  return greetingForHour(hour)+'. '+clean.heading+' · '+(team?.name||'Equipo')+'.';
}
export function createMeetingReport(getServices) {
  const $=id=>document.getElementById(id),root=$('report-studio'),canvas=$('report-canvas');
  let lastRenderedValues=null,teamStyles={},photo=null,capture=null,frameColor=null,logoKeys={},logoCache=new Map(),logoToken=0,prefs=null,busy=false,dirty=false,loadToken=0,priorTitle='';
  const services=()=>getServices();
  const message=(text,error=false)=>{const el=$('report-status');el.textContent=text;el.dataset.tone=error?'error':'info';};
  const lock=value=>{busy=value;root.setAttribute('aria-busy',String(value));for(const e of root.querySelectorAll('button,input,select'))e.disabled=value;$('report-share').disabled=value||!photo;$('report-preview').classList.toggle('is-loading',value);};
  const values=()=>normalizeReportPreferences({frameColor,watermark:$('report-watermark').checked,watermarkOpacity:Number($('report-watermark-opacity').value)/100,watermarkPosition:$('report-watermark-position').value,logoKeys,teamId:$('report-team').value,frame:$('report-frame').value,heading:$('report-heading').value,showDate:$('report-date').checked},services().catalog);
  const render=()=>{const selected=values();lastRenderedValues=selected;const selectedTeam=services().catalog.find(t=>t.id===selected.teamId)||{};$('report-frame-color').value=resolveReportFrameColor(selected,selectedTeam);$('report-color-auto').setAttribute('aria-pressed',String(frameColor===null));for(const b of root.querySelectorAll('[data-report-color]'))b.setAttribute('aria-pressed',String(b.dataset.reportColor===frameColor));if(!photo)return;const v=values(),team=services().catalog.find(t=>t.id===v.teamId)||{};drawReport(canvas,photo,v,team,capture?.capturedAt?new Date(capture.capturedAt):new Date(),logoCache.get(v.logoKeys[v.teamId])||null);$('report-capture-info').textContent=capture?.capturedAt?'Saludo del reporte: '+greetingForHour(capture.localHour):'Hora original no disponible; saludo según la hora actual.';canvas.hidden=false;$('report-placeholder').hidden=true;};
  const persist=async(next=values())=>{const {storage}=services();if(!storage)throw Error('No hay almacenamiento disponible.');teamStyles[next.teamId]={...next,logoKeys:{}};await storage.putText(REPORT_STYLES_KEY,JSON.stringify(teamStyles));await storage.putText(REPORT_PREFS_KEY,JSON.stringify(next));prefs=next;dirty=false;};
  async function acceptPhoto(dataUrl) {
    if(!isPngDataUrl(dataUrl))throw Error('La cámara no devolvió una imagen válida.');
    const decoded=await loadImageElement(dataUrl);const {storage}=services();if(!storage)throw Error('No hay almacenamiento disponible.');
    const next=createCaptureRecord(dataUrl);await storage.putText(REPORT_PHOTO_KEY,JSON.stringify(next));photo=decoded;capture=next;render();message('Foto lista. Elige el equipo y el marco; después comparte.');
  }
  async function pick(camera) {
    if(busy)return;const s=services();
    if(s.mode!=='native'){const input=camera?$('report-camera-input'):$('report-file-input');input.value='';input.click();return;}
    if(camera&&!s.capabilities.has(CAPABILITIES.CAMERA)){message('Abre Settings → Actualizaciones para activar la cámara. Mientras puedes elegir una foto.',true);return;}
    lock(true);message(camera?'Abriendo cámara…':'Abriendo fotos…');
    try {const result=await s.bridge.request(camera?'CAPTURE_PHOTO':'IMPORT_IMAGE',{}, {timeoutMs:300000});if(!result.ok)throw Error(result.message);await acceptPhoto(result.data?.imageDataUrl);}catch(e){message(e.message||'Captura cancelada. Tu foto anterior sigue disponible.',true);}finally{lock(false);}
  }
  async function open(options = {}) {
    if(busy)return false;
    if(!root.hidden&&dirty){try{await persist();}catch(e){message(e.message,true);return false;}}
    const s=services();if(s.blocked){message('Espera a que termine la operación actual.',true);return false;}
    const visibleTeams=teamsForPlant(s.catalog,s.plantId);if(!visibleTeams.length)return false;
    priorTitle=document.title;document.title='Reporte de reunión · SuperTools';$('app').hidden=true;root.hidden=false;lock(true);message('Preparando estudio…');
    const token=++loadToken;
    try {
      const saved=s.storage?await s.storage.getText(REPORT_PREFS_KEY):null;prefs=normalizeReportPreferences(saved?JSON.parse(saved):{},s.catalog);
      const requestedTeam=options.fromWidget?s.activeProfileId:options.teamId;
      if(visibleTeams.some(t=>t.id===requestedTeam))prefs.teamId=requestedTeam;
      if(!visibleTeams.some(t=>t.id===prefs.teamId))prefs.teamId=visibleTeams[0].id;
      const rawStyles=s.storage?await s.storage.getText(REPORT_STYLES_KEY):null;teamStyles=rawStyles?JSON.parse(rawStyles):{};if(!teamStyles||typeof teamStyles!=='object'||Array.isArray(teamStyles))throw Error('Estilos no válidos');
      prefs=normalizeReportPreferences({...prefs,...teamStyles[prefs.teamId],teamId:prefs.teamId,logoKeys:prefs.logoKeys},s.catalog);
      frameColor=prefs.frameColor;
      const select=$('report-team');select.replaceChildren();for(const team of visibleTeams){const option=document.createElement('option');option.value=team.id;option.textContent=team.name;select.append(option);}
      select.value=prefs.teamId;$('report-frame').value=prefs.frame;$('report-heading').value=prefs.heading;$('report-date').checked=prefs.showDate;dirty=false;logoKeys={...prefs.logoKeys};$('report-watermark').checked=prefs.watermark;$('report-watermark-opacity').value=String(Math.round(prefs.watermarkOpacity*100));$('report-watermark-position').value=prefs.watermarkPosition;
      if(!photo&&s.storage){const stored=await s.storage.getText(REPORT_PHOTO_KEY);if(stored){const savedPhoto=parseCaptureRecord(stored);if(savedPhoto){const url=pngDataUrlFromBase64(savedPhoto.imageBase64);photo=await loadImageElement(url);capture=savedPhoto;}}}
      if(token!==loadToken)return;await loadLogo();render();message(photo?'Tu último reporte está listo para editar.':'Toma una foto para crear el reporte.');
    }catch(e){message('No se pudieron leer los datos del reporte: '+e.message,true);return false;}finally{lock(false);}
    await pick(true);
    return true;
  }
  async function loadLogo(){
    const token=++logoToken,v=values(),key=v.logoKeys[v.teamId];$('report-logo-status').textContent=key?'Logo guardado para este equipo':'Este equipo aún no tiene logo de reporte.';
    if(!key||logoCache.has(key)){render();return;}
    try{const raw=await services().storage.getText(key);const url=pngDataUrlFromBase64(raw);if(!isPngDataUrl(url))throw Error('Logo no legible.');const image=await loadImageElement(url);if(token!==logoToken)return;logoCache.set(key,image);while(logoCache.size>24)logoCache.delete(logoCache.keys().next().value);render();}catch(e){if(token===logoToken){$('report-logo-status').textContent='No se pudo leer el logo; elige otro.';message(e.message,true);}}
  }
  async function acceptLogo(dataUrl){
    if(!isPngDataUrl(dataUrl))throw Error('Logo no válido.');const image=await loadImageElement(dataUrl),v=values(),key=reportLogoKey(v.teamId);
    await services().storage.putText(key,pngBase64FromDataUrl(dataUrl));logoKeys={...logoKeys,[v.teamId]:key};logoCache.set(key,image);$('report-watermark').checked=true;dirty=true;await persist();await loadLogo();render();message('Logo guardado para este equipo.');
  }
  $('report-logo-pick').addEventListener('click',async()=>{if(busy)return;const s=services();if(s.mode!=='native'){$('report-logo-input').value='';$('report-logo-input').click();return;}lock(true);try{const r=await s.bridge.request('IMPORT_IMAGE',{}, {timeoutMs:300000});if(!r.ok)throw Error(r.message);await acceptLogo(r.data?.imageDataUrl);}catch(e){message(e.message,true);}finally{lock(false);}});
  $('report-logo-input').addEventListener('change',async()=>{const file=$('report-logo-input').files?.[0];if(!file||busy)return;lock(true);try{const prepared=await prepareImageFile(file);await acceptLogo(prepared.dataUrl);}catch(e){message(e.message,true);}finally{lock(false);}});
  async function close(){if(busy)return;lock(true);try{if(dirty)await persist();root.hidden=true;$('app').hidden=false;document.title=priorTitle;services().onClose?.();$('open-report').focus();}catch(e){message('No se guardaron los ajustes: '+e.message,true);}finally{lock(false);}}
  $('open-report').addEventListener('click',()=>void open({teamId:services().activeProfileId}));$('report-back').addEventListener('click',()=>void close());
  for(const button of root.querySelectorAll('[data-report-color]'))button.addEventListener('click',()=>{if(busy)return;frameColor=button.dataset.reportColor;dirty=true;render();});
  $('report-frame-color').addEventListener('input',()=>{if(busy)return;frameColor=$('report-frame-color').value;dirty=true;render();});
  $('report-color-auto').addEventListener('click',()=>{if(busy)return;frameColor=null;dirty=true;render();});
  $('report-take').addEventListener('click',()=>void pick(true));$('report-pick').addEventListener('click',()=>void pick(false));
  for(const id of ['report-frame','report-heading','report-date','report-watermark','report-watermark-opacity','report-watermark-position'])$(id).addEventListener('input',()=>{dirty=true;render();if(id==='report-team')void loadLogo();});
  $('report-team').addEventListener('change',async()=>{if(busy)return;const id=$('report-team').value;lock(true);try{if(dirty&&lastRenderedValues)await persist(lastRenderedValues);const raw=await services().storage.getText(REPORT_STYLES_KEY);teamStyles=raw?JSON.parse(raw):{};const next=normalizeReportPreferences({...teamStyles[id],teamId:id,logoKeys},services().catalog);frameColor=next.frameColor;$('report-frame').value=next.frame;$('report-heading').value=next.heading;$('report-date').checked=next.showDate;$('report-watermark').checked=next.watermark;$('report-watermark-opacity').value=String(Math.round(next.watermarkOpacity*100));$('report-watermark-position').value=next.watermarkPosition;dirty=true;await loadLogo();render();}catch(e){message(e.message,true);}finally{lock(false);}});
  for(const id of ['report-camera-input','report-file-input'])$(id).addEventListener('change',async()=>{const file=$(id).files?.[0];if(!file||busy)return;lock(true);try{const prepared=await prepareImageFile(file);await acceptPhoto(prepared.dataUrl);}catch(e){message(e.message,true);}finally{lock(false);}});
  $('report-save').addEventListener('click',async()=>{if(busy)return;lock(true);try{await persist();message('Ajustes guardados en este teléfono.');}catch(e){message(e.message,true);}finally{lock(false);}});
  $('report-share').addEventListener('click',async()=>{
    if(busy||!photo)return;lock(true);try{
      const v=values();
      await loadLogo();if(v.watermark&&!logoCache.get(v.logoKeys[v.teamId]))throw Error('Elige el logo de este equipo para usar la marca de agua.');await persist();render();let dataUrl=canvas.toDataURL('image/png');let out=canvas;
      for(let attempt=0;dataUrl.length>8*1024*1024&&attempt<8;attempt++){const small=document.createElement('canvas');small.width=Math.round(out.width*.8);small.height=Math.round(out.height*.8);small.getContext('2d').drawImage(out,0,0,small.width,small.height);out=small;dataUrl=out.toDataURL('image/png');}
      if(!isPngDataUrl(dataUrl))throw Error('La imagen supera el tamaño permitido.');
      const s=services(),team=s.catalog.find(t=>t.id===v.teamId);const text=reportShareMessage(v,team,capture?.localHour??new Date().getHours());
      if(s.mode!=='native'){if(typeof navigator.share!=='function'||typeof File!=='function')throw Error('Comparte desde SuperTools Android.');const bytes=Uint8Array.from(atob(pngBase64FromDataUrl(dataUrl)),c=>c.charCodeAt(0));const file=new File([bytes],'reporte-reunion.png',{type:'image/png'});if(!navigator.canShare?.({files:[file]}))throw Error('Este navegador no comparte imágenes.');await navigator.share({files:[file],text});message('Se cerró el selector; la entrega se confirma en WhatsApp.');}
      else {const result=await s.bridge.request('SHARE_PNG',{imageDataUrl:dataUrl,message:text},{timeoutMs:300000});if(!result.ok)throw Error(result.message);message(result.message+' Elige y confirma los grupos en WhatsApp.');}
    }catch(e){message(e.message||'No se compartió.',true);}finally{lock(false);}
  });
  return {open,close};
}
