import {TEAM_TOOLS,isToolEnabledForTeam} from './profiles.js';
import {calculateEfficiency,efficiencyBand} from './production-model.js';

/** Shared by rendering and shortcut editing; saved preferences themselves are not rewritten. */
export function syncToolAvailability(root,team) {
  const production=root.getElementById('production-tools-section');
  if(production)production.hidden=!isToolEnabledForTeam('production',team);
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
    box.append(node('p','hint','Demostración con datos ficticios. No guarda, no genera archivos y no envía reportes.'));
    const fields=node('div','tool-demo-fields');
    const input=(label,value)=>{const wrap=node('label','',label),el=node('input');el.type='text';el.inputMode='decimal';el.value=value;el.maxLength=18;wrap.append(el);fields.append(wrap);return el;};
    const target=input('Meta de ejemplo','100'),actual=input('Producción de ejemplo','85');
    const result=node('output','tool-demo-result');result.setAttribute('aria-live','polite');const bar=node('div','tool-demo-bar'),fill=node('span');bar.append(fill);
    const toggle=node('label','tool-demo-state'),check=node('input');check.type='checkbox';check.checked=true;const text=node('span');toggle.append(check,text);
    const update=()=>{const row={target:target.value,actual:actual.value};const value=calculateEfficiency(row).efficiency;result.textContent=value===null?'Completa meta y producción':new Intl.NumberFormat('es-HN',{maximumFractionDigits:2}).format(value)+' %';fill.style.width=(value===null?0:Math.min(value,100))+'%';fill.dataset.band=efficiencyBand(row);text.textContent=check.checked?'Proceso de ejemplo en funcionamiento':'Proceso de ejemplo inactivo';toggle.dataset.active=String(check.checked);};
    target.addEventListener('input',update);actual.addEventListener('input',update);check.addEventListener('change',update);update();
    box.append(fields,result,bar,toggle,node('p','hint','La herramienta completa incluye catálogo de procesos, eficiencias por turno, estatus y un reporte PDF para compartir con confirmación.'));return box;
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
