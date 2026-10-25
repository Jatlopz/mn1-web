import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeJpegPdf,wrapReportText,productionReportFileName,pdfBytesDataUrl,createProductionPdf} from '../public/production-pdf.js';
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
