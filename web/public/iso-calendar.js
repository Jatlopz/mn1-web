/** Shared ISO week context. Date inputs use the phone's local civil date; arithmetic uses UTC to avoid DST. */
const DAY=86400000;
const utc=(year,month,day)=>{const date=new Date(0);date.setUTCHours(0,0,0,0);date.setUTCFullYear(year,month,day);return date;};
const key=date=>String(date.getUTCFullYear()).padStart(4,'0')+'-'+String(date.getUTCMonth()+1).padStart(2,'0')+'-'+String(date.getUTCDate()).padStart(2,'0');
function civil(value,allowWeekBoundary=false) {
  let year,month,day;
  if(value instanceof Date){if(!Number.isFinite(value.getTime()))throw Error('Fecha no válida.');year=value.getFullYear();month=value.getMonth()+1;day=value.getDate();}
  else if(typeof value==='string'&&(/^\d{4}-\d{2}-\d{2}$/.test(value)||(allowWeekBoundary&&/^10000-\d{2}-\d{2}$/.test(value)))){[year,month,day]=value.split('-').map(Number);}
  else throw Error('Usa una fecha válida en formato AAAA-MM-DD.');
  const date=utc(year,month-1,day);
  if(year<1||year>(allowWeekBoundary?10000:9999)||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw Error('Fecha no válida.');
  return date;
}
export function isoWeekInfo(value=new Date()) {
  const date=civil(value),weekday=date.getUTCDay()||7;
  const thursday=new Date(date);thursday.setUTCDate(date.getUTCDate()+4-weekday);
  const weekYear=thursday.getUTCFullYear(),week=Math.ceil(((thursday-utc(weekYear,0,1))/DAY+1)/7);
  const monday=new Date(date);monday.setUTCDate(date.getUTCDate()+1-weekday);const sunday=new Date(monday);sunday.setUTCDate(monday.getUTCDate()+6);
  return {date:key(date),week,weekYear,weekKey:String(weekYear).padStart(4,'0')+'-W'+String(week).padStart(2,'0'),weekday,startDate:key(monday),endDate:key(sunday)};
}
export function isoMonthWeeks(month) {
  if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month))throw Error('Mes no válido.');
  const first=civil(month+'-01'),last=utc(first.getUTCFullYear(),first.getUTCMonth()+1,0),cursor=new Date(first);
  cursor.setUTCDate(first.getUTCDate()+1-(first.getUTCDay()||7));const rows=[];
  while(cursor<=last){const info=isoWeekInfo(key(cursor)),days=[];for(let i=0;i<7;i++){days.push(key(cursor));cursor.setUTCDate(cursor.getUTCDate()+1);}rows.push({week:info.week,weekYear:info.weekYear,weekKey:info.weekKey,days});}
  return rows;
}
export function formatIsoCalendarDate(value,locale='es-HN') {
  const date=civil(value,true);const month=new Intl.DateTimeFormat(locale,{month:'long',timeZone:'UTC'}).format(date);
  return String(date.getUTCDate()).padStart(2,'0')+'/'+month+'/'+String(date.getUTCFullYear()).padStart(4,'0');
}

/** Read-only calendar. Selecting a date never changes a report or the current-week indicator. */
export function installIsoCalendar({root=document,now=()=>new Date(),timers=true}={}) {
  const triggers=['iso-calendar-open','teams-iso-calendar-open'].map(id=>root.getElementById(id)).filter(Boolean);if(!triggers.length)return null;
  const view=root.defaultView;
  const node=(tag,className,text)=>{const el=root.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const button=(text,fn,className='iso-secondary')=>{const el=node('button',className,text);el.type='button';el.addEventListener('click',fn);return el;};
  const dialog=node('dialog','dialog iso-calendar-dialog');dialog.id='iso-calendar-dialog';dialog.setAttribute('aria-labelledby','iso-calendar-title');
  const head=node('div','dialog-head'),title=node('h2','','Calendario ISO');title.id='iso-calendar-title';const close=button('×',()=>dialog.close(),'dialog-close');close.setAttribute('aria-label','Cerrar calendario');head.append(title,close);
  const selectedTitle=node('h3','iso-selected-week'),selectedDate=node('time','iso-selected-date'),range=node('p','hint');
  const selectedBox=node('div','iso-selected');selectedBox.append(selectedTitle,selectedDate,range);selectedBox.setAttribute('aria-live','polite');
  const navigation=node('div','iso-month-nav'),monthLabel=node('h3');monthLabel.id='iso-month-title';
  const previous=button('‹',()=>moveMonth(-1)),next=button('›',()=>moveMonth(1)),todayButton=button('Hoy',()=>selectToday());previous.setAttribute('aria-label','Mes anterior');next.setAttribute('aria-label','Mes siguiente');navigation.append(previous,monthLabel,next,todayButton);
  const table=node('table','iso-month-table');table.setAttribute('aria-labelledby','iso-month-title');const caption=node('caption','sr-only','Selecciona una fecha para consultar su semana ISO.');
  const thead=node('thead'),heading=node('tr');for(const [short,full] of [['#','Semana ISO'],['L','Lunes'],['M','Martes'],['X','Miércoles'],['J','Jueves'],['V','Viernes'],['S','Sábado'],['D','Domingo']]){const th=node('th','',short);th.scope='col';th.setAttribute('aria-label',full);heading.append(th);}thead.append(heading);const body=node('tbody');table.append(caption,thead,body);
  const explanation=node('details','iso-help');explanation.append(node('summary','','Cómo se cuenta la semana'),node('p','hint','Las semanas van de lunes a domingo. La semana 1 contiene el primer jueves del año. Por eso, cerca de Año Nuevo, el año ISO puede ser distinto del año de la fecha.'));
  dialog.append(head,selectedBox,navigation,table,explanation);root.body.append(dialog);
  let current=isoWeekInfo(now()),selected=current.date,month=selected.slice(0,7),timer=null;
  const monthFormatter=new Intl.DateTimeFormat('es-HN',{month:'long',year:'numeric',timeZone:'UTC'});
  function render() {
    const info=isoWeekInfo(selected);selectedTitle.textContent='Semana '+info.week+' · '+info.weekYear;selectedDate.textContent=formatIsoCalendarDate(selected);selectedDate.dateTime=selected;range.textContent='Del '+formatIsoCalendarDate(info.startDate)+' al '+formatIsoCalendarDate(info.endDate);
    const monthText=monthFormatter.format(civil(month+'-01'));monthLabel.textContent=monthText.charAt(0).toLocaleUpperCase('es-HN')+monthText.slice(1);previous.disabled=month==='0001-01';next.disabled=month==='9999-12';body.replaceChildren();
    const focusDate=selected.startsWith(month)?selected:month+'-01';
    for(const row of isoMonthWeeks(month)){
      const tr=node('tr');tr.classList.toggle('iso-week-selected',row.weekKey===info.weekKey);const week=node('th','iso-week-number',String(row.week));week.scope='row';week.title='Semana '+row.week+' · '+row.weekYear;tr.append(week);
      for(const date of row.days){const td=node('td'),day=button(String(Number(date.slice(-2))),()=>selectDate(date,true),'iso-day');day.dataset.date=date;day.disabled=!/^\d{4}-\d{2}-\d{2}$/.test(date);day.tabIndex=date===focusDate?0:-1;
        if(!day.disabled)day.setAttribute('aria-label',formatIsoCalendarDate(date));day.setAttribute('aria-pressed',String(date===selected));if(date===current.date)day.setAttribute('aria-current','date');day.classList.toggle('iso-other-month',!date.startsWith(month));
        day.addEventListener('keydown',event=>{const weekday=isoWeekInfo(date).weekday;const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:1-weekday,End:7-weekday}[event.key];if(offset===undefined)return;event.preventDefault();const target=civil(date);target.setUTCDate(target.getUTCDate()+offset);if(target.getUTCFullYear()>=1&&target.getUTCFullYear()<=9999)selectDate(key(target),true);});td.append(day);tr.append(td);
      }body.append(tr);
    }
  }
  function selectDate(date,focus=false){selected=isoWeekInfo(date).date;month=selected.slice(0,7);render();if(focus)body.querySelector('[data-date="'+selected+'"]').focus();}
  function moveMonth(offset){const target=civil(month+'-01');target.setUTCMonth(target.getUTCMonth()+offset);if(target.getUTCFullYear()>=1&&target.getUTCFullYear()<=9999){month=key(target).slice(0,7);render();}}
  function selectToday(){refresh();selectDate(current.date,true);}
  function refresh(){const next=isoWeekInfo(now()),changed=next.date!==current.date;current=next;for(const trigger of triggers){const weekLabel=trigger.querySelector('strong'),number=node('span','iso-calendar-week-number',String(current.week));weekLabel.replaceChildren(root.createTextNode('Semana '),number);const date=trigger.querySelector('time');date.textContent=formatIsoCalendarDate(current.date);date.dateTime=current.date;trigger.setAttribute('aria-label','Semana '+current.week+', '+formatIsoCalendarDate(current.date)+'. Abrir calendario ISO');trigger.hidden=false;}if(changed&&dialog.open)render();}
  const onOpen=()=>{refresh();selected=current.date;month=selected.slice(0,7);render();if(!dialog.open)dialog.showModal();};
  const onVisible=()=>{if(!root.hidden)refresh();};for(const trigger of triggers)trigger.addEventListener('click',onOpen);view?.addEventListener('focus',refresh);root.addEventListener('visibilitychange',onVisible);refresh();
  if(timers)timer=view.setInterval(onVisible,60000);
  return {refresh,destroy(){if(timer!==null)view.clearInterval(timer);for(const trigger of triggers){trigger.removeEventListener('click',onOpen);trigger.hidden=true;}view?.removeEventListener('focus',refresh);root.removeEventListener('visibilitychange',onVisible);dialog.close();dialog.remove();}};
}
