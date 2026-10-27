import {laminationVariation,LAMINATION_DEFAULTS,laminationKey,emptyLaminationRow,createLaminationDraft,normalizeLaminationDraft,calculateLamination,calculateSlitter,decimal} from './lamination-model.js';

export function createLaminationStudio(getServices,{root=document}={}) {
 const el=(tag,cls,text)=>{const node=root.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const button=(text,action,cls='button button-secondary')=>{const node=el('button',cls,text);node.type='button';node.addEventListener('click',action);return node;};
 const dialog=el('dialog','dialog lamination-studio');dialog.id='lamination-studio';dialog.setAttribute('aria-labelledby','lamination-title');
 const title=el('h2','','Verificador de libras');title.id='lamination-title';
 const heading=el('div','dialog-head'),context=el('p','hint'),status=el('p','hint');status.setAttribute('role','status');
 let team=null,draft=null,dirty=false,busy=false,loading=false;const format=new Intl.NumberFormat('es-HN',{maximumFractionDigits:3});
 const show=value=>value===null?'—':format.format(value);
 const closeButton=button('×',()=>void close(),'dialog-close');closeButton.setAttribute('aria-label','Guardar y cerrar verificador');heading.append(title,closeButton);
 const tabs=el('nav','lamination-tabs');tabs.setAttribute('aria-label','Cálculos');
 const laminate=el('section'),slitter=el('section');slitter.hidden=true;const panels=[laminate,slitter];
 const tabButtons=['Laminado','Slitter'].map((label,index)=>{const b=button(label,()=>{panels.forEach((p,i)=>p.hidden=i!==index);tabButtons.forEach((node,i)=>node.setAttribute('aria-pressed',String(i===index)));});b.setAttribute('aria-pressed',String(index===0));tabs.append(b);return b;});
 const summary=el('output','lamination-summary');summary.setAttribute('aria-live','polite');
 const rows=el('div','lamination-rows'),rowViews=[];
 const details=el('details','lamination-settings');details.append(el('summary','','Aplicaciones y factores del Excel'));
 const factors=el('div','lamination-fields');details.append(factors,el('p','hint','Fórmula: libras de etiqueta + (ancho × caras ÷ pulgadas por metro × aplicación × metros ÷ gramos por libra). Se conservan los factores del archivo, incluido 454.'));
 function changed(){dirty=true;status.textContent='Cambios sin guardar';update();}
 function field(label,value,onInput,parent,{positive=false,signed=false}={}) {
  const wrap=el('label','',label),input=el('input');input.type='text';input.inputMode='decimal';input.maxLength=40;input.value=value;input.autocomplete='off';
  input.addEventListener('input',()=>{onInput(input.value);input.setAttribute('aria-invalid',String(Boolean(input.value.trim())&&decimal(input.value,{positive,signed})===null));changed();});
  wrap.append(input);parent.append(wrap);return input;
 }
 function update() {
  if(!draft)return;
  const results=draft.rows.map(row=>calculateLamination(row,draft.settings));
  results.forEach((result,index)=>{const view=rowViews[index];if(!view)return;view.coating.textContent=show(result.coatingPounds)+' lb';view.total.textContent=show(result.calculatedPounds)+' lb';view.delta.textContent=show(result.difference)+' lb';const band=laminationVariation(result.difference);view.delta.dataset.variation=band;view.variation.textContent=band==='pending'?'Completa los datos para comparar':band==='within'?'Dentro de ±50 lb':'Fuera de ±50 lb';});
  const complete=results.filter(row=>row.calculatedPounds!==null),allCompared=complete.length>0&&complete.every(row=>row.difference!==null);
  summary.replaceChildren(el('small','',complete.length+' de '+draft.rows.length+' etiquetas calculadas'),el('strong','',show(complete.length?complete.reduce((sum,row)=>sum+row.calculatedPounds,0):null)+' lb'),el('span','',allCompared?'Diferencia total: '+show(complete.reduce((sum,row)=>sum+row.difference,0))+' lb':'Ingresa las libras reportadas para comparar.'));
  const compared=results.filter(row=>row.difference!==null),outside=compared.filter(row=>laminationVariation(row.difference)==='outside').length;
  const variationNotice=el('small','lamination-variation',outside?outside+' etiqueta(s) fuera de ±50 lb':compared.length?compared.length+' etiqueta(s) dentro de ±50 lb':'Variación permitida: −50 a +50 lb');variationNotice.dataset.variation=outside?'outside':compared.length?'within':'pending';summary.append(variationNotice);
  const result=calculateSlitter(draft.slitter);slitterYield.textContent=show(result.yield)+' m/lb';slitterMetres.textContent=show(result.metresToRequest)+' m';
 }
 function metric(label,parent){const box=el('div'),output=el('output');box.append(el('small','',label),output);parent.append(box);return output;}
 function renderRows() {
  rows.replaceChildren();rowViews.length=0;
  draft.rows.forEach((row,index)=>{
   const section=el('section','lamination-row'),head=el('div','lamination-row-head');head.append(el('h3','','Etiqueta '+(index+1)));
   const remove=button('Quitar',()=>{draft.rows.splice(index,1);renderRows();changed();});remove.disabled=draft.rows.length===1;remove.setAttribute('aria-label','Quitar etiqueta '+(index+1));head.append(remove);
   const grid=el('div','lamination-fields');
   field('Ancho de tela (pulgadas)',row.width,value=>row.width=value,grid,{positive:true});
   const appInput=field('Aplicación (g/m²)',row.application,value=>row.application=value,grid,{positive:true});
   const presets=el('div','lamination-presets');presets.append(button('Normal',()=>{row.application=draft.settings.normal;appInput.value=row.application;appInput.setAttribute('aria-invalid',String(decimal(row.application,{positive:true})===null));changed();}),button('Yara',()=>{row.application=draft.settings.yara;appInput.value=row.application;appInput.setAttribute('aria-invalid',String(decimal(row.application,{positive:true})===null));changed();}));
   const applicationWrap=el('div');grid.insertBefore(applicationWrap,appInput.parentElement);applicationWrap.append(appInput.parentElement,presets);
   field('Libras de etiqueta',row.labelPounds,value=>row.labelPounds=value,grid);
   field('Metros de etiqueta',row.labelMetres,value=>row.labelMetres=value,grid);
   field('Libras reportadas en Sysprod',row.reportedPounds,value=>row.reportedPounds=value,grid);
   const metrics=el('div','lamination-results');rowViews.push({coating:metric('Recubrimiento calculado',metrics),total:metric('Libras calculadas',metrics),delta:metric('Diferencia',metrics)});
   const view=rowViews.at(-1);view.variation=el('small','lamination-variation');view.delta.parentElement.append(view.variation);
   section.append(head,grid,metrics);rows.append(section);
  });add.disabled=draft.rows.length>=50;update();
 }
 const add=button('+ Agregar etiqueta',()=>{if(draft.rows.length>=50)return;draft.rows.push({...emptyLaminationRow(),application:draft.settings.normal});renderRows();changed();rows.lastElementChild.querySelector('input').focus();});
 laminate.append(el('p','hint','Ingresa los datos de cada etiqueta. La diferencia es libras calculadas menos libras reportadas; variación permitida de −50 a +50 lb, incluidos los límites.'),summary,rows,add,details);
 const slitterFields=el('div','lamination-fields'),slitterResults=el('div','lamination-results');
 const slitterYield=metric('Rendimiento',slitterResults),slitterMetres=metric('Metros a requisar',slitterResults);
 slitter.append(el('p','hint','Cálculo auxiliar del Excel. Ingresa la diferencia de libras y los datos de la viñeta. El signo de la diferencia se conserva.'),slitterFields,slitterResults);
 const saveButton=button('Guardar',()=>void save(),'button button-primary');
 const footer=el('div','lamination-footer'),storageNotice=el('p','hint');footer.append(storageNotice,saveButton);
 dialog.append(heading,context,tabs,laminate,slitter,status,footer);root.body.append(dialog);
 function controls(disabled){for(const input of dialog.querySelectorAll('input,button'))input.disabled=disabled;if(!disabled&&draft){add.disabled=draft.rows.length>=50;rows.querySelector('button').disabled=draft.rows.length===1;}}
 async function save() {
  if(busy||loading||!draft)return false;if(!dirty)return true;
  busy=true;controls(true);status.textContent='Guardando…';
  try{const storage=getServices().storage;await storage.putText(laminationKey(team.id),JSON.stringify(draft));dirty=false;status.textContent=storage.persistent===false?'Sólo durante esta sesión. Al reiniciar la app, estos datos se perderán.':'Guardado en este teléfono';return true;}
  catch{status.textContent='No se pudo guardar. Tus datos siguen abiertos; vuelve a intentarlo.';return false;}
  finally{busy=false;controls(false);}
 }
 async function close(){if(busy||loading)return false;if(dirty&&!await save())return false;dialog.close();return true;}
 dialog.addEventListener('cancel',event=>{event.preventDefault();void close();});
 return {isOpen:()=>dialog.open,close,async open(nextTeam){
  if(dialog.open||loading)return false;team=nextTeam;draft=null;dirty=false;loading=true;rows.replaceChildren();summary.textContent='';slitterYield.textContent='—';slitterMetres.textContent='—';status.textContent='Abriendo borrador…';storageNotice.textContent=getServices().storage.persistent===false?'Almacenamiento temporal: los datos sólo duran esta sesión. No reinicies la app si necesitas conservarlos.':'Borrador local de este equipo en este teléfono.';context.textContent=team.name+' · Laminado · Planta Sacos';panels.forEach((panel,index)=>panel.hidden=index!==0);tabButtons.forEach((node,index)=>node.setAttribute('aria-pressed',String(index===0)));dialog.showModal();controls(true);
  try{
   const raw=await getServices().storage.getText(laminationKey(team.id));draft=raw?normalizeLaminationDraft(JSON.parse(raw)):createLaminationDraft();dirty=false;
   factors.replaceChildren();for(const [key,label] of [['normal','Aplicación Normal (g/m²)'],['yara','Aplicación Yara (g/m²)'],['faces','Caras de tela'],['inchesPerMetre','Pulgadas por metro'],['gramsPerPound','Gramos por libra']])field(label,draft.settings[key],value=>draft.settings[key]=value,factors,{positive:true});
   slitterFields.replaceChildren();for(const [key,label] of [['difference','Diferencia de libras menos lo consumido'],['metres','Metros de viñeta'],['pounds','Libras de viñeta']])field(label,draft.slitter[key],value=>draft.slitter[key]=value,slitterFields,{positive:key==='pounds',signed:key==='difference'});
   renderRows();status.textContent='Usa punto o coma decimal, sin separadores de miles.';return true;
  }catch{status.textContent='No se pudo abrir el borrador. No se ha reemplazado ni borrado. Cierra y vuelve a intentarlo.';rows.replaceChildren();factors.replaceChildren();slitterFields.replaceChildren();summary.textContent='';return false;}
  finally{loading=false;controls(!draft);closeButton.disabled=false;}
 }};
}
