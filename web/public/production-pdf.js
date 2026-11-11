/** PDF local de alta resolución; el mismo snapshot produce tablas y gráfico. */
import {calculateEfficiency,validateProductionReport,efficiencyRows,efficiencyBand,productionStatusDisplay,efficiencyMeetsTarget,efficiencyCommentDisplay,parseProductionNumber,PRODUCTION_REPORT_TITLE} from './production-model.js';
const W=595,H=842,PDF_SCALE=2,IMAGE_SCALE=4.8,M=32;
const encoder=new TextEncoder();
const ascii=s=>encoder.encode(s);
function join(chunks){const out=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return out;}
export function pdfBytesDataUrl(bytes){let raw='';for(let i=0;i<bytes.length;i+=16384)raw+=String.fromCharCode(...bytes.subarray(i,i+16384));return 'data:application/pdf;base64,'+btoa(raw);}
export function productionReportFileName(report){return 'reporte-'+String(report.plantId).replace(/[^A-Za-z0-9_-]/g,'').slice(0,20)+'-'+String(report.date).replace(/[^0-9-]/g,'')+'.pdf';}
export function productionShareMessage(report, now=new Date()){
 const hour=now.getHours(), greeting=hour<12?'Buenos días':hour<18?'Buenas tardes':'Buenas noches';
 const sent=[String(now.getDate()).padStart(2,'0'),String(now.getMonth()+1).padStart(2,'0'),now.getFullYear()].join('/');
 return greeting+', comparto eficiencias del turno '+report.efficiencyShift+' del '+(report.efficiencyDate??report.date).split('-').reverse().join('/')+' y estatus de planta del turno '+report.statusShift+' del '+report.date.split('-').reverse().join('/')+'. Enviado el '+sent+'. Equipo '+report.teamName+'.';
}
export function encodeJpegPdf(pages){
 if(!Array.isArray(pages)||!pages.length||pages.length>100)throw Error('Número de páginas no válido.');
 const chunks=[ascii('%PDF-1.4\n%SuperTools\n')],offsets=[0];let length=chunks[0].length;
 const add=(id,body)=>{offsets[id]=length;const parts=[ascii(id+' 0 obj\n'),...(Array.isArray(body)?body:[ascii(body)]),ascii('\nendobj\n')];for(const c of parts){chunks.push(c);length+=c.length;}};
 add(1,'<< /Type /Catalog /Pages 2 0 R >>');
 add(2,'<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>');
 pages.forEach((page,i)=>{const id=3+i*3;if(!(page.bytes instanceof Uint8Array)||page.bytes[0]!==255||page.bytes[1]!==216||page.width<1||page.height<1)throw Error('Página de reporte no válida.');
 add(id,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /PageImage '+(id+1)+' 0 R >> >> /Contents '+(id+2)+' 0 R >>');
 add(id+1,[ascii('<< /Type /XObject /Subtype /Image /Width '+page.width+' /Height '+page.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+page.bytes.length+' >>\nstream\n'),page.bytes,ascii('\nendstream')]);
 const content='q\n595 0 0 842 0 0 cm\n/PageImage Do\nQ';add(id+2,'<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream');});
 const xref=length,count=3+pages.length*3;
 const table='xref\n0 '+count+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
 chunks.push(ascii(table+'trailer\n<< /Size '+count+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n'));
 const bytes=join(chunks);if(bytes.length>8*1024*1024)throw Error('El PDF supera 8 MiB. Reduce la extensión del reporte.');return bytes;
}
export function wrapReportText(ctx,value,width){
 const result=[];for(const paragraph of String(value??'').split('\n')){let line='';for(const word of paragraph.split(/\s+/)){if(!word)continue;if(ctx.measureText(line?(line+' '+word):word).width<=width){line=line?line+' '+word:word;continue;}if(line){result.push(line);line='';}let fragment='';for(const c of word){if(fragment&&ctx.measureText(fragment+c).width>width){result.push(fragment);fragment='';}fragment+=c;}line=fragment;}result.push(line);}return result.length?result:[''];
}
export function createProductionPdf(report,catalog,{createCanvas=()=>document.createElement('canvas'),onPage=null,scale=PDF_SCALE,imagesOnly=false}={}){
 const errors=validateProductionReport(report,catalog);if(errors.length)throw Error(errors.slice(0,5).join('\n'));
 const pages=[];let canvas,ctx,y,section='',pageCount=0;
 const fmt=value=>{const parsed=typeof value==='number'&&Number.isFinite(value)?{kind:'number',value}:parseProductionNumber(value);return parsed.kind==='number'?parsed.value.toLocaleString('es-HN',{maximumFractionDigits:2}):'Sin dato';};
 const pct=value=>value===null?'Sin dato':fmt(value)+' %';
 const text=(value,x,top,size=10,color='#183142',weight=400)=>{ctx.font=weight+' '+size+'px Arial, sans-serif';ctx.fillStyle=color;ctx.textBaseline='top';ctx.fillText(String(value),x,top);};
 const rect=(x,top,width,height,color)=>{ctx.fillStyle=color;ctx.fillRect(x,top,width,height);};
 const finish=()=>{if(!canvas)return;if(onPage)onPage(canvas,Math.min(H-42,Math.max(1,y+12))*scale,section,pageCount);if(!imagesOnly){text('SuperTools · '+report.teamName,M,H-32,8,'#687b87');text('Página '+(pageCount+1),W-85,H-32,8,'#687b87');const raw=atob(canvas.toDataURL('image/jpeg',.93).split(',')[1]);pages.push({width:canvas.width,height:canvas.height,bytes:Uint8Array.from(raw,c=>c.charCodeAt(0))});}pageCount++;};
 const page=title=>{
  finish();section=title.replace(/(?: \(continuación\))+$/,'');canvas=createCanvas();canvas.width=Math.round(W*scale);canvas.height=Math.round(H*scale);ctx=canvas.getContext('2d');if(!ctx)throw Error('No se pudo dibujar el PDF.');
  ctx.scale(scale,scale);rect(0,0,W,H,'#ffffff');rect(0,0,W,8,'#176a69');text('SUPERTOOLS',M,24,9,'#176a69',700);
  ctx.font='700 18px Arial';const titleLines=wrapReportText(ctx,PRODUCTION_REPORT_TITLE,W-2*M);titleLines.forEach((line,i)=>text(line,M,44+i*22,18,'#102e3f',700));y=44+titleLines.length*22+8;
  text(title,M,y,14,'#102e3f',700);y+=24;
  const plant=report.plantId==='sacos'?'Sacos':report.plantId==='polietileno'?'Polietileno':report.plantId;
  ctx.font='400 10px Arial';const contextLines=wrapReportText(ctx,'Planta '+plant+' · '+report.teamName,W-2*M);contextLines.forEach((line,i)=>text(line,M,y+i*13,10));y+=contextLines.length*13+4;
  ctx.font='400 10px Arial';const dateLines=wrapReportText(ctx,'Eficiencias '+report.efficiencyShift+' · '+(report.efficiencyDate??report.date).split('-').reverse().join('/')+' | Estatus '+report.statusShift+' · '+report.date.split('-').reverse().join('/'),W-2*M);dateLines.forEach((line,i)=>text(line,M,y+i*13,10,'#536b79'));y+=dateLines.length*13+20;
 };
 const room=height=>{if(y+height>H-50)page(section+' (continuación)');};
 const table=(headers,widths,records,highlightRows=[],okRows=[])=>{
  const heading=()=>{room(36);rect(M,y,W-2*M,34,'#e7f0f0');let x=M;headers.forEach((h,i)=>{ctx.font='700 8.5px Arial';wrapReportText(ctx,h,widths[i]-10).forEach((l,j)=>text(l,x+5,y+6+j*10,8.5,'#164c52',700));x+=widths[i];});y+=34;};heading();
  records.forEach((record,index)=>{ctx.font='400 9px Arial';let lines=record.map((v,i)=>wrapReportText(ctx,v,widths[i]-10));let rest=true;while(rest){if(y+25>H-50){page(section+' (continuación)');heading();}const take=Math.max(1,Math.floor((H-50-y-12)/12));const count=Math.min(take,Math.max(...lines.map(l=>l.length)));const height=count*12+12;const active=highlightRows[index]===true;rect(M,y,W-2*M,height,active?'#dff3e7':index%2===0?'#f5f8fa':'#ffffff');let x=M;lines.forEach((ls,i)=>{if(okRows[index]&&i===headers.length-1){rect(x,y,widths[i],height,'#218547');ctx.font='700 14px Arial, sans-serif';text('OK',x+(widths[i]-ctx.measureText('OK').width)/2,y+(height-14)/2,14,'#ffffff',700);}else{ls.slice(0,count).forEach((l,j)=>text(l,x+5,y+6+j*12,9,active&&i===1?'#17633e':'#183142',active&&i===1?700:400));}x+=widths[i];});rect(M,y+height-1,W-2*M,1,'#dfe8ed');y+=height;lines=lines.map(ls=>ls.slice(count));rest=lines.some(ls=>ls.length);}});y+=16;};
 const entries=Object.entries(report.rows);const eff=efficiencyRows(report);
 page('Eficiencia y desperdicio');
 text('Datos capturados manualmente · Real / Meta × 100',M,y,9,'#536b79');y+=23;
 if(eff.length)table(['Proceso / unidad','Meta','Real','Eficiencia','Meta desp.','Real desp.','Comentarios'],[94,58,58,60,51,51,159],eff.map(([,r])=>{const c=calculateEfficiency(r);return [r.name+' ('+r.unit+')',fmt(r.target),fmt(r.actual),pct(c.efficiency),pct(c.wasteTarget),pct(c.wasteActual),efficiencyCommentDisplay(r)];}),[],eff.map(([,r])=>efficiencyMeetsTarget(r)));
 else{text('No se incluyeron procesos para eficiencia.',M,y);y+=28;}
 if(eff.length){room(60);text('Cumplimiento de la meta',M,y,15,'#102e3f',700);y+=28;const maximum=Math.max(100,...eff.map(([,r])=>calculateEfficiency(r).efficiency||0));const max=Math.ceil(maximum/25)*25;for(const [,r] of eff){const c=calculateEfficiency(r),hasWaste=c.wasteTarget!==null&&c.wasteActual!==null;room(hasWaste?71:45);text(r.name,M,y,9,'#536b79');y+=15;const width=W-2*M-60;rect(M,y,width,10,'#e6edf0');rect(M,y,width*(c.efficiency/max),10,efficiencyBand(r)==='critical'?'#c92532':efficiencyBand(r)==='warning'?'#d97706':'#237b80');const target=M+width*100/max;rect(target,y-2,1,14,'#607584');text(pct(c.efficiency),M+width+8,y-1,9,'#183142',700);y+=17;
if(hasWaste){const wasteMax=Math.max(c.wasteTarget*1.25,c.wasteActual,.01);text('Desperdicio real: '+pct(c.wasteActual)+' · Meta: '+pct(c.wasteTarget),M,y,8,'#536b79');y+=12;rect(M,y,width,5,'#e6edf0');rect(M,y,width*c.wasteActual/wasteMax,5,c.wasteActual>c.wasteTarget?'#c92532':'#218547');rect(M+width*c.wasteTarget/wasteMax,y-2,1,9,'#607584');y+=12;}else y+=7;
}room(40);ctx.font='400 8px Arial';const legend=wrapReportText(ctx,'Naranja: 80 % a menos de 90 %. Rojo: menos de 80 %. Marca vertical: 100 % de la meta. Desperdicio: barra secundaria con escala propia; menor es mejor, rojo si supera su meta.',W-2*M);legend.forEach((line,i)=>text(line,M,y+i*11,8,'#687b87'));y+=legend.length*11+14;}
 page('Estatus de planta');const active=entries.filter(([,r])=>r.active).length;text(active+' procesos en funcionamiento · '+(entries.length-active)+' inactivos',M,y,10,'#176a69',700);y+=26;
 table(['Proceso','Estatus','Producto / acción','Observaciones'],[108,97,155,171],entries.map(([,r])=>{const display=productionStatusDisplay(r);return [r.name,display.status,display.productAction,display.observations];}),entries.map(([,r])=>r.active===true));
 room(40);text('Estatus: '+report.statusShift+' · Eficiencias: '+report.efficiencyShift,M,y,9,'#536b79');y+=18;text('La eficiencia reportada puede corresponder al turno que finaliza y el estatus al entrante.',M,y,8,'#687b87');
 finish();return imagesOnly?null:encodeJpegPdf(pages);
}

/** Imágenes recortadas al contenido, dibujadas con el mismo reporte que el PDF. */
export function createProductionImages(report,catalog,{createCanvas=()=>document.createElement('canvas')}={}){
 const images=[];createProductionPdf(report,catalog,{createCanvas,scale:IMAGE_SCALE,imagesOnly:true,onPage:(page,height,section,index)=>{
  const crop=createCanvas();crop.width=page.width;crop.height=Math.min(page.height,Math.ceil(height));const context=crop.getContext('2d');if(!context)throw Error('No se pudo preparar la imagen del reporte.');context.drawImage(page,0,0,page.width,crop.height,0,0,page.width,crop.height);
  const dataUrl=crop.toDataURL('image/png');if(!dataUrl.startsWith('data:image/png;base64,')||dataUrl.length>8*1024*1024)throw Error('La imagen del reporte supera el tamaño admitido.');
  images.push({section,index:index+1,dataUrl});
 }});return images;
}

export async function combineProductionImages(images){
    const loaded=await Promise.all(images.map(image=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('No se pudo abrir una imagen del reporte.'));img.src=image.dataUrl;})));
    const width=Math.max(...loaded.map(image=>image.naturalWidth)),totalHeight=loaded.reduce((sum,image)=>sum+image.naturalHeight,0);
    const scale=Math.min(1,Math.sqrt(30000000/(width*totalHeight)),16000/totalHeight);
    const canvas=document.createElement('canvas');canvas.width=Math.floor(width*scale);canvas.height=Math.floor(totalHeight*scale);
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('No se pudo preparar la imagen conjunta.');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    let top=0;for(const image of loaded){const w=Math.floor(image.naturalWidth*scale),h=Math.floor(image.naturalHeight*scale);ctx.drawImage(image,0,top,w,h);top+=h;}
    const dataUrl=canvas.toDataURL('image/png');if(dataUrl.length>8*1024*1024)throw Error('La imagen conjunta es demasiado grande. Comparte cada sección por separado.');
    return {dataUrl,section:'Reporte completo',index:1};
}
