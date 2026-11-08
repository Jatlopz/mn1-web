// Native horizontal scrolling supplies touch momentum; mouse dragging is progressive enhancement.
export function nearestTeamIndex(items,scrollLeft,width){
 if(!items.length)return -1;
 const center=scrollLeft+width/2;
 return items.reduce((best,item,index)=>Math.abs(item.left+item.width/2-center)<Math.abs(items[best].left+items[best].width/2-center)?index:best,0);
}
export function teamInitials(name){return String(name||'Equipo').split(/\s+/).filter(w=>w&&!/^(los|las|el|la|de|del|y)$/i.test(w)).slice(0,2).map(w=>Array.from(w)[0]).join('').toLocaleUpperCase('es');}
export function createTeamCarousel(track){
 const root=track.ownerDocument,win=root.defaultView,reduce=()=>win.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const shell=root.createElement('section');shell.className='team-carousel';shell.setAttribute('aria-label','Selector de equipos');shell.setAttribute('aria-roledescription','carrusel');
 track.before(shell);shell.append(track);track.classList.add('team-carousel-track');track.setAttribute('role','group');track.setAttribute('aria-label','Equipos. Desliza o usa las flechas para cambiar.');
 const controls=root.createElement('div');controls.className='team-carousel-controls';
 function arrow(label,path){const b=root.createElement('button');b.type='button';b.className='team-carousel-arrow';b.setAttribute('aria-label',label);const svg=root.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=root.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',path);svg.append(p);b.append(svg);return b;}
 const prev=arrow('Equipo anterior','m14 5-7 7 7 7'),next=arrow('Equipo siguiente','m10 5 7 7-7 7'),count=root.createElement('span');count.className='team-carousel-count';count.setAttribute('aria-live','polite');count.setAttribute('aria-atomic','true');controls.append(prev,count,next);shell.append(controls);
 const hint=root.createElement('p');hint.className='team-carousel-hint';hint.textContent='Desliza para explorar · Toca el logo del centro para entrar';shell.append(hint);
 let items=[],index=0,intentIndex=null,focusedId=null,lastActive=null,lastPlant=null,frame=0,drag=null,suppressUntil=0,disposed=false,accentPending=false,settleTimer=null,accent=null;
 const idAt=i=>items[i]?.querySelector('[data-profile-id]')?.dataset.profileId;
 const layout=()=>items.map(item=>({left:item.offsetLeft,width:item.offsetWidth}));
 function emphasize(){
  if(!accentPending||drag||disposed)return;accentPending=false;if(reduce())return;
  const logo=items[index]?.querySelector('.profile-card-logo:not([hidden]),.profile-logo-fallback:not([hidden])');if(!logo||typeof logo.animate!=='function')return;
  accent?.cancel();accent=logo.animate([{transform:'translateY(0) scale(1)'},{transform:'translateY(-5px) scale(1.06)',offset:.45},{transform:'translateY(0) scale(1)'}],{duration:260,easing:win.getComputedStyle(track).getPropertyValue('--ease-out').trim()||'cubic-bezier(.23,1,.32,1)'});
 }
 function paint(i,force=false){
  if(i<0||!items[i])return;index=i;focusedId=idAt(i);
  if(!force&&items[i].dataset.carouselPosition==='center')return;
  items.forEach((item,n)=>{item.dataset.carouselPosition=n===i?'center':Math.abs(n-i)===1?'near':'far';const b=item.querySelector('[data-profile-id]');b.tabIndex=n===i?0:-1;b.removeAttribute('role');b.removeAttribute('aria-checked');if(n===i)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');});
  prev.disabled=i===0;next.disabled=i===items.length-1;const label=items[i].querySelector('.profile-name')?.textContent||'Equipo';count.textContent=`${i+1} / ${items.length}`;count.setAttribute('aria-label',`${label}, equipo ${i+1} de ${items.length}`);
 }
 function go(i,{smooth=false,focus=false}={}){
  if(!items.length||track.clientWidth===0)return;const target=Math.max(0,Math.min(items.length-1,i));intentIndex=smooth?target:null;accentPending=smooth;paint(target);
  track.dataset.motion=smooth?'animated':'instant';track.scrollTo({left:items[target].offsetLeft+items[target].offsetWidth/2-track.clientWidth/2,behavior:smooth&&!reduce()?'smooth':'instant'});
  if(focus)items[target].querySelector('[data-profile-id]')?.focus({preventScroll:true});
 }
 function onScroll(){win.clearTimeout(settleTimer);settleTimer=win.setTimeout(emphasize,140);if(frame||disposed)return;frame=win.requestAnimationFrame(()=>{frame=0;if(track.clientWidth)paint(nearestTeamIndex(layout(),track.scrollLeft,track.clientWidth));});}
 function refresh({activeId,plantId}={}){
  items=[...track.children].filter(e=>e.classList.contains('profile-card-wrap'));shell.hidden=items.length===0;controls.hidden=items.length<2;hint.hidden=items.length<2;
  let target=items.findIndex((_,i)=>idAt(i)===focusedId);
  if(activeId!==lastActive||plantId!==lastPlant||target<0)target=Math.max(0,items.findIndex((_,i)=>idAt(i)===activeId));
  lastActive=activeId;lastPlant=plantId;paint(target,true);win.requestAnimationFrame(()=>{if(!disposed)go(target);});
 }
 function onClick(e){
  if(e.detail!==0&&win.performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();return;}
  const settings=e.target.closest('.team-carousel-settings');if(settings){const target=items.indexOf(settings.parentElement);if(target>=0&&target!==index)go(target);return;}
  const card=e.target.closest('.profile-card[data-profile-id]');if(!card||card.disabled)return;const target=items.indexOf(card.parentElement);
  if(target!==index){e.preventDefault();e.stopImmediatePropagation();go(target,{smooth:true});}
 }
 function onKey(e){
  if(!e.target.closest('.profile-card[data-profile-id]'))return;let target;
  if(e.key==='ArrowLeft')target=index-1;else if(e.key==='ArrowRight')target=index+1;else if(e.key==='Home')target=0;else if(e.key==='End')target=items.length-1;else return;
  e.preventDefault();go(target,{focus:true});
 }
 function down(e){accent?.cancel();accentPending=true;intentIndex=null;track.scrollTo({left:track.scrollLeft,behavior:'instant'});track.dataset.motion='animated';if(e.pointerType!=='mouse'||e.button!==0||e.target.closest('.team-carousel-settings'))return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:track.scrollLeft,moved:false};}
 function move(e){
  if(!drag||e.pointerId!==drag.id)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(!drag.moved){if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>8){drag=null;return;}if(Math.abs(dx)<8)return;drag.moved=true;track.setPointerCapture(e.pointerId);track.classList.add('is-dragging');}
  e.preventDefault();track.scrollLeft=drag.left-dx;
 }
 function finish(e){if(!drag||e.pointerId!==drag.id)return;const moved=drag.moved;drag=null;track.classList.remove('is-dragging');if(track.hasPointerCapture(e.pointerId))track.releasePointerCapture(e.pointerId);if(moved){suppressUntil=win.performance.now()+400;go(nearestTeamIndex(layout(),track.scrollLeft,track.clientWidth),{smooth:true});}}
 prev.addEventListener('click',e=>go((intentIndex??index)-1,{smooth:e.detail!==0}));next.addEventListener('click',e=>go((intentIndex??index)+1,{smooth:e.detail!==0}));track.addEventListener('scrollend',()=>{intentIndex=null;emphasize();});track.addEventListener('wheel',()=>{accentPending=true;intentIndex=null;},{passive:true});track.addEventListener('scroll',onScroll,{passive:true});track.addEventListener('click',onClick,true);track.addEventListener('keydown',onKey);track.addEventListener('pointerdown',down);track.addEventListener('pointermove',move);track.addEventListener('pointerup',finish);track.addEventListener('pointercancel',finish);track.addEventListener('lostpointercapture',finish);
 const resize=()=>{if(!disposed)go(Math.max(0,items.findIndex((_,i)=>idAt(i)===focusedId)));};
 const observer=typeof win.ResizeObserver==='function'?new win.ResizeObserver(resize):null;observer?.observe(track);if(!observer)win.addEventListener('resize',resize);
 shell.addEventListener('focusin',e=>{const item=e.target.closest('.profile-card-wrap');if(item&&e.target.matches(':focus-visible')){const i=items.indexOf(item);if(i!==index)go(i);}});
 return {refresh,center:id=>{const i=items.findIndex((_,n)=>idAt(n)===id);if(i>=0)go(i,{smooth:true});},dispose(){disposed=true;accent?.cancel();win.clearTimeout(settleTimer);observer?.disconnect();if(frame)win.cancelAnimationFrame(frame);if(!observer)win.removeEventListener('resize',resize);}};
}
