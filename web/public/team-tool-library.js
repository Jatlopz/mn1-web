import {TEAM_TOOLS,isToolEnabledForTeam} from './profiles.js';
import {calculateEfficiency,efficiencyBand,createProductionReport} from './production-model.js';
import {defaultCatalog} from './plant-catalog.js';
import {createProductionPdf} from './production-pdf.js';

/** Fresh, fictitious snapshot; never reads a team's catalogue, draft or assets. */
export function createProductionExample() {
  const catalog=defaultCatalog('sacos');
  const report=createProductionReport(catalog,{teamId:'example-only',teamName:'Equipo de ejemplo · Datos ficticios',date:'2026-10-25',efficiencyDate:'2026-10-25',efficiencyShift:'TA',statusShift:'TC'});
  let index=0;
  for(const [id,row] of Object.entries(report.rows)) {
    row.active=['extrusion','telares','conversion-3'].includes(id);
    if(row.active){row.product='Producto de ejemplo';row.action='Producción';row.comment='En operación (ejemplo)';}
    if(row.includeEfficiency){row.target='100';row.actual=String([79,80,89,90,100][index++]);row.efficiencyComment=Number(row.actual)<=90?'Ajuste de proceso (ejemplo)':'Meta alcanzada (ejemplo)';row.wasteTarget='0.25';row.wasteActual='0.20';}
  }
  report.rows.telares.runningCount='2';report.rows.telares.totalCount='3';
  return {report,catalog};
}

/** Shared by rendering and shortcut editing; saved preferences themselves are not rewritten. */
export function syncToolAvailability(root,team) {
  const production=root.getElementById('production-tools-section');
  if(production)production.hidden=!isToolEnabledForTeam('production',team);
  const lamination=root.getElementById('lamination-tools-section');
  if(lamination)lamination.hidden=!isToolEnabledForTeam('lamination',team);
  for(const input of root.querySelectorAll('[data-shortcut]')) {
    const available=isToolEnabledForTeam(input.value,team);
    input.disabled=!available;input.closest('label').hidden=!available;
  }
}

export function createTeamToolLibrary({getTeam,onRequest,root=document}) {
  const node=(tag,className,text)=>{const el=root.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const button=(text,fn,className='button button-secondary')=>{const el=node('button',className,text);el.type='button';el.addEventListener('click',fn);return el;};
  const dialog=node('dialog','dialog tool-library');dialog.id='tool-library-dialog';dialog.setAttribute('aria-labelledby','tool-library-title');
  const header=node('div','dialog-head'),title=node('h2','','Agregar herramientas');title.id='tool-library-title';
  const close=button('×',()=>dialog.close(),'dialog-close');close.setAttribute('aria-label','Cerrar catálogo de herramientas');header.append(title,close);
  const context=node('p','hint'),intro=node('p','hint','Las generales acompañan a todos los equipos. Las exclusivas requieren adaptación y aprobación del administrador para otros equipos.');
  const filters=node('nav','tool-library-filters');filters.setAttribute('aria-label','Tipos de herramientas');
  const list=node('div','tool-library-list'),status=node('p','hint');status.setAttribute('role','status');
  let team=null,filter='all';const filterButtons=new Map();
  for(const [id,label] of [['all','Todas'],['general','Generales'],['exclusive','Exclusivas']]){const el=button(label,()=>{filter=id;render();});filterButtons.set(id,el);filters.append(el);}
  function demo() {
    const box=node('details','tool-demo');box.append(node('summary','','Ver cómo funciona'));
    box.append(node('p','hint','Demostración con datos ficticios. No guarda cambios ni envía reportes.'));
    const fields=node('div','tool-demo-fields');
    const input=(label,value)=>{const wrap=node('label','',label),el=node('input');el.type='text';el.inputMode='decimal';el.value=value;el.maxLength=18;wrap.append(el);fields.append(wrap);return el;};
    const target=input('Meta de ejemplo','100'),actual=input('Producción de ejemplo','85');
    const result=node('output','tool-demo-result');result.setAttribute('aria-live','polite');const bar=node('div','tool-demo-bar'),fill=node('span');bar.append(fill);
    const toggle=node('label','tool-demo-state'),check=node('input');check.type='checkbox';check.checked=true;const text=node('span');toggle.append(check,text);
    const update=()=>{const row={target:target.value,actual:actual.value};const value=calculateEfficiency(row).efficiency;result.textContent=value===null?'Completa meta y producción':new Intl.NumberFormat('es-HN',{maximumFractionDigits:2}).format(value)+' %';fill.style.width=(value===null?0:Math.min(value,100))+'%';fill.dataset.band=efficiencyBand(row);text.textContent=check.checked?'Proceso de ejemplo en funcionamiento':'Proceso de ejemplo inactivo';toggle.dataset.active=String(check.checked);};
    target.addEventListener('input',update);actual.addEventListener('input',update);check.addEventListener('change',update);update();
    const preview=node('section','tool-pdf-preview');preview.hidden=true;preview.id='production-example-preview';preview.setAttribute('aria-label','PDF de ejemplo');
    const previewButton=button('Ver reporte de ejemplo',async()=>{
      if(!preview.hidden&&!preview.dataset.error){preview.hidden=true;previewButton.textContent='Ver reporte de ejemplo';previewButton.setAttribute('aria-expanded','false');return;}
      preview.hidden=false;delete preview.dataset.error;preview.setAttribute('aria-busy','true');previewButton.disabled=true;previewButton.setAttribute('aria-expanded','true');
      try {
        if(!preview.querySelector('canvas')) {
          preview.replaceChildren(node('p','hint','Preparando reporte de ejemplo…'));
          await new Promise(resolve=>requestAnimationFrame(resolve));
          const {report,catalog}=createProductionExample(),pages=[];
          createProductionPdf(report,catalog,{createCanvas:()=>{const canvas=node('canvas');pages.push(canvas);return canvas;}});
          preview.replaceChildren(node('h4','','Reporte de ejemplo'),node('p','hint','Datos ficticios. Estas son las mismas páginas que genera el PDF; no se guarda ni se comparte ningún archivo.'));
          pages.forEach((canvas,index)=>{const figure=node('figure');canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Página '+(index+1)+' del reporte de ejemplo: '+(index===0?'eficiencias y gráfica de cumplimiento':'estatus de planta'));const sheet=node('div','tool-pdf-sheet');sheet.tabIndex=0;sheet.setAttribute('role','region');sheet.setAttribute('aria-label','Página '+(index+1)+' del reporte, vista ampliable');sheet.append(canvas);const zoom=button('Ampliar página '+(index+1),()=>{const expanded=sheet.classList.toggle('is-zoomed');zoom.setAttribute('aria-pressed',String(expanded));zoom.textContent=(expanded?'Ajustar página ':'Ampliar página ')+(index+1);});zoom.setAttribute('aria-pressed','false');figure.append(sheet,node('figcaption','hint','Página '+(index+1)+' de '+pages.length),zoom);preview.append(figure);});
        }
        previewButton.textContent='Ocultar reporte de ejemplo';
      }catch{preview.replaceChildren(node('p','hint','No se pudo mostrar el reporte de ejemplo. Puedes volver a intentarlo.'));preview.dataset.error='true';preview.hidden=false;previewButton.textContent='Reintentar reporte de ejemplo';}
      finally{preview.setAttribute('aria-busy','false');previewButton.disabled=false;}
    });
    previewButton.setAttribute('aria-expanded','false');previewButton.setAttribute('aria-controls',preview.id);
    box.append(fields,result,bar,toggle,node('p','hint','La herramienta completa incluye catálogo de procesos, eficiencias por turno, estatus y un reporte PDF para compartir con confirmación.'),previewButton,preview);return box;
  }
  function render() {
    list.replaceChildren();for(const [id,el] of filterButtons)el.setAttribute('aria-pressed',String(filter===id));
    for(const tool of TEAM_TOOLS.filter(item=>filter==='all'||item.scope===filter)) {
      const card=node('article','tool-library-card');card.dataset.toolId=tool.id;const available=isToolEnabledForTeam(tool.id,team);
      card.append(node('p','tool-library-badge',tool.scope==='general'?'General · Incluida':'Exclusiva · Planta Sacos'),node('h3','',tool.name),node('p','hint',tool.description));
      if(tool.id==='production')card.append(node('p','hint','En uso: Los Champions, Los Espartanos, Los Super Guerreros y Los Indestructibles.'));
      if(available){const included=button('Ya disponible en este equipo',()=>{});included.disabled=true;card.append(included);}
      else {const request=button('Solicitar adaptación',async()=>{if(!team)return;const selected=team;dialog.close();try{if(!await onRequest(tool.id,selected.id))throw Error('No se pudo abrir la solicitud. Inténtalo de nuevo.');}catch(error){status.textContent=error.message;dialog.showModal();}});card.append(request);}
      if(tool.id==='production')card.append(demo());list.append(card);
    }
  }
  dialog.append(header,context,intro,filters,list,status);root.body.append(dialog);
  return {open(){team=getTeam();if(!team)return false;filter='all';status.textContent='';context.textContent='Para '+team.name;render();if(!dialog.open)dialog.showModal();return true;}};
}
