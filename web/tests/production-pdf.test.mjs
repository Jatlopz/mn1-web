import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeJpegPdf,wrapReportText,productionReportFileName,pdfBytesDataUrl,createProductionPdf,createProductionImages} from '../public/production-pdf.js';
const jpeg=Uint8Array.from(atob("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q=="),c=>c.charCodeAt(0));
test('el PDF pagina imágenes completas y tiene referencias a posiciones reales',()=>{
 const bytes=encodeJpegPdf([{width:1,height:1,bytes:jpeg},{width:1,height:1,bytes:jpeg}]);
 const raw=new TextDecoder('latin1').decode(bytes);
 assert.ok(raw.startsWith('%PDF-1.4'));
 assert.ok(raw.trimEnd().endsWith('%%EOF'));
 assert.match(raw,/\/Count 2/);
 const xref=Number(raw.match(/startxref\n(\d+)/)[1]);
 assert.equal(new TextDecoder().decode(bytes.slice(xref,xref+4)),'xref');
 const table=new TextDecoder().decode(bytes.slice(xref)).split('\n');
 const count=Number(table[1].split(' ')[1]);
 for(let id=1;id<count;id++){const offset=Number(table[id+2].slice(0,10));assert.ok(new TextDecoder().decode(bytes.slice(offset,offset+20)).startsWith(id+' 0 obj'));}
 assert.ok(pdfBytesDataUrl(bytes).startsWith('data:application/pdf;base64,JVBER'));
 assert.throws(()=>encodeJpegPdf([]));
});
test('texto Unicode y palabras largas se ajustan sin perder caracteres',()=>{
 const ctx={measureText:t=>({width:[...t].length})};
 const text='Extrusión revisión extraordinariamente';
 const lines=wrapReportText(ctx,text,8);
 assert.ok(lines.every(line=>[...line].length<=8));
 assert.equal(lines.join('').replaceAll(' ',''),text.replaceAll(' ',''));
});
test('no se genera un PDF con datos incompletos y el nombre no admite rutas',()=>{
 assert.throws(()=>createProductionPdf({version:1,rows:{}},null),/Selecciona|Agrega/);
 assert.equal(productionReportFileName({plantId:'../sacos',date:'2026-10-24'}),'reporte-sacos-2026-10-24.pdf');
});

test('genera una imagen recortada por página y conserva los valores del reporte',async()=>{
 const {defaultCatalog}=await import('../public/plant-catalog.js');const {createProductionReport}=await import('../public/production-model.js');
 const catalog=defaultCatalog('sacos'),report=createProductionReport(catalog,{teamId:'fixture',teamName:'Equipo ficticio',date:'2026-11-09'});for(const row of Object.values(report.rows))row.active=false;Object.assign(report.rows.extrusion,{target:'10,000',actual:'10,504.4'});const before=JSON.stringify(report),captures=[],canvases=[];
 const createCanvas=()=>{const canvas={width:0,height:0,getContext:()=>({scale(){},fillRect(){},fillText(t){captures.push(String(t));},measureText:t=>({width:String(t).length*4}),drawImage(){}}),toDataURL:type=>type==='image/png'?'data:image/png;base64,AAAA':'data:image/jpeg;base64,'+Buffer.from(jpeg).toString('base64')};canvases.push(canvas);return canvas;};
 const images=createProductionImages(report,catalog,{createCanvas});assert.deepEqual(images.map(i=>i.section),['Eficiencia y desperdicio','Estatus de planta']);assert.ok(images.every(i=>i.dataUrl.startsWith('data:image/png;base64,')));assert.ok(canvases.every(canvas=>canvas.width===2856&&canvas.height<=4096));assert.ok(captures.some(t=>t.includes('10,504.4')));assert.equal(JSON.stringify(report),before);
});

test('PDF y mensaje conservan las fechas separadas y exportan sólo las eficiencias capturadas',async()=>{
 const {defaultCatalog}=await import('../public/plant-catalog.js');
 const {createProductionReport}=await import('../public/production-model.js');
 const {productionShareMessage}=await import('../public/production-pdf.js');
 const c=defaultCatalog('sacos'),r=createProductionReport(c,{teamId:'fixture',teamName:'Equipo ficticio',now:new Date('2026-10-25T07:00:00')});
 for(const row of Object.values(r.rows))row.active=false;
 Object.assign(r.rows.extrusion,{target:'100',actual:'80',efficiencyComment:'Paro de prueba'});
 const drawn=[];
 const createCanvas=()=>{const lines=[];drawn.push(lines);const ctx={scale(){},fillRect(){},fillText:t=>lines.push(String(t)),measureText:t=>({width:String(t).length*4})};return {getContext:()=>ctx,toDataURL:()=> 'data:image/jpeg;base64,'+Buffer.from(jpeg).toString('base64')};};
 const pdf=createProductionPdf(r,c,{createCanvas});
 assert.match(new TextDecoder().decode(pdf),/\/Count 2/);
 assert.ok(drawn[0].includes('Extrusión (kg)'));assert.ok(drawn[0].includes('Paro de prueba'));
 assert.ok(!drawn[0].includes('Imprenta (m)'));assert.ok(!drawn[0].includes('Conversión 1 (sacos)'));
 assert.ok(!drawn[0].includes('Totales por unidad'));assert.ok(!drawn[0].includes('Meta total'));assert.ok(!drawn[0].includes('Real total'));assert.ok(drawn[0].some(t=>t.includes('24/10/2026')&&t.includes('25/10/2026')));
 assert.match(productionShareMessage(r),/TC del 24\/10\/2026.*TA del 25\/10\/2026/);
});

test('el PDF usa el encabezado solicitado, barras por umbral y resalta activos sin mostrar datos inactivos',async()=>{
 const {normalizeCatalog}=await import('../public/plant-catalog.js');const {createProductionReport}=await import('../public/production-model.js');
 const c=normalizeCatalog({processes:[79,80,89,90,100].map(n=>({id:'p'+n,name:'Proceso '+n,unit:'kg',efficiency:true}))},'sacos');
 const r=createProductionReport(c,{teamId:'fixture',teamName:'Equipo ficticio',date:'2026-10-25'});
 for(const [id,row] of Object.entries(r.rows)){row.active=id==='p100';row.target='100';row.actual=id.slice(1);row.efficiencyComment='Razón ficticia';row.product=row.active?'Producto activo':'PRODUCTO_OCULTO';row.action=row.active?'Producción':'ACCION_OCULTA';row.comment=row.active?'En operación':'COMENTARIO_OCULTO';row.runningCount='2';row.totalCount='3';}
 const before=JSON.stringify(r),drawn=[],rectangles=[];
 const createCanvas=()=>{const lines=[];drawn.push(lines);const ctx={scale(){},fillRect(x,y,w,h){rectangles.push({x,y,w,h,color:this.fillStyle,page:drawn.length});},fillText(t,x,y){lines.push({text:String(t),x,y,color:this.fillStyle,font:this.font});},measureText:t=>({width:String(t).length*4})};return {getContext:()=>ctx,toDataURL:()=> 'data:image/jpeg;base64,'+Buffer.from(jpeg).toString('base64')};};
 createProductionPdf(r,c,{createCanvas});
 for(const page of drawn)assert.ok(page.map(t=>t.text).join(' ').includes('Reporte de estatus y eficiencias de planta'));
 const bars=rectangles.filter(r=>r.h===10&&['#c92532','#d97706','#237b80'].includes(r.color));assert.deepEqual(bars.map(r=>r.color),['#c92532','#d97706','#d97706','#237b80','#237b80']);
 assert.ok(drawn.flat().some(t=>t.text==='OK'&&t.color==='#ffffff'&&t.font.startsWith('700 14px')),'OK grande y claro al cumplir 100%');const ok=drawn.flat().find(t=>t.text==='OK');const cell=rectangles.find(r=>r.page===1&&r.color==='#218547'&&r.w===159);assert.ok(cell);assert.equal(ok.x,cell.x+(cell.w-8)/2);assert.equal(ok.y,cell.y+(cell.h-14)/2);const status=drawn.at(-1);assert.ok(status.some(t=>t.text==='En funcionamiento'&&t.color==='#17633e'));
 assert.ok(rectangles.some(r=>r.page===drawn.length&&r.color==='#dff3e7'));
 for(const token of ['PRODUCTO_OCULTO','ACCION_OCULTA','COMENTARIO_OCULTO','Sin indicar','Sin observaciones'])assert.ok(!status.some(t=>t.text.includes(token)),token);
 assert.ok(status.some(t=>t.text.includes('Producto activo')));assert.equal(JSON.stringify(r),before);
});

test('PDF dibuja desperdicio secundario con meta, cero válido y sin inventar datos',async()=>{
 const {normalizeCatalog}=await import('../public/plant-catalog.js');const {createProductionReport}=await import('../public/production-model.js');
 const c=normalizeCatalog({processes:[0,1,2,3].map(n=>({id:'p'+n,name:'Proceso '+n,unit:'kg',efficiency:true}))},'sacos');const r=createProductionReport(c,{teamId:'fixture',teamName:'Equipo ficticio',date:'2026-11-04'});
 const samples=[['.25','.2'],['.25','.4'],['0','0'],['.25','']];Object.values(r.rows).forEach((row,i)=>Object.assign(row,{active:false,target:'100',actual:'100',wasteTarget:samples[i][0],wasteActual:samples[i][1]}));const original=JSON.stringify(r),rects=[],texts=[];
 const createCanvas=()=>{const ctx={scale(){},fillRect(x,y,w,h){rects.push({x,y,w,h,color:this.fillStyle});},fillText(t){texts.push(String(t));},measureText:t=>({width:String(t).length*4})};return {getContext:()=>ctx,toDataURL:()=> 'data:image/jpeg;base64,'+Buffer.from(jpeg).toString('base64')};};
 createProductionPdf(r,c,{createCanvas});const bars=rects.filter(r=>r.h===5&&['#218547','#c92532'].includes(r.color));assert.equal(bars.length,3);assert.deepEqual(bars.map(b=>b.color),['#218547','#c92532','#218547']);assert.equal(bars[2].w,0);assert.ok(bars.every(b=>Number.isFinite(b.w)&&b.w>=0&&b.w<=471));assert.equal(texts.filter(t=>t.startsWith('Desperdicio real:')).length,3);assert.equal(JSON.stringify(r),original);
});

test('el saludo usa la hora de envío y mantiene las fechas y turnos reales del reporte',async()=>{
 const {productionShareMessage}=await import('../public/production-pdf.js');
 const report={efficiencyShift:'TA',efficiencyDate:'2026-11-10',statusShift:'TC',date:'2026-11-11',teamName:'Equipo de prueba'};
 assert.match(productionShareMessage(report,new Date(2026,10,11,8)),/^Buenos días/);
 assert.match(productionShareMessage(report,new Date(2026,10,11,15)),/^Buenas tardes/);
 const msg=productionShareMessage(report,new Date(2026,10,11,20));
 assert.match(msg,/^Buenas noches/);assert.match(msg,/TA del 10\/11\/2026/);assert.match(msg,/TC del 11\/11\/2026/);assert.match(msg,/Enviado el 11\/11\/2026/);
});
