// Native horizontal scrolling supplies touch momentum; mouse dragging is progressive enhancement.
export function nearestTeamIndex(items,scrollLeft,width){
 if(!items.length)return -1;
 const center=scrollLeft+width/2;
 return items.reduce((best,item,index)=>Math.abs(item.left+item.width/2-center)<Math.abs(items[best].left+items[best].width/2-center)?index:best,0);
}
export function wrapTeamIndex(index,count){return count?((index%count)+count)%count:-1;}
export function teamInitials(name){return String(name||'Equipo').split(/\s+/).filter(w=>w&&!/^(los|las|el|la|de|del|y)$/i.test(w)).slice(0,2).map(w=>Array.from(w)[0]).join('').toLocaleUpperCase('es');}
export function createTeamCarousel(track){
 const root=track.ownerDocument,win=root.defaultView,reduce=()=>win.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const shell=root.createElement('section');shell.className='team-carousel';shell.setAttribute('aria-label','Selector de equipos');shell.setAttribute('aria-roledescription','carrusel');
 track.before(shell);shell.append(track);track.classList.add('team-carousel-track');track.setAttribute('role','group');track.setAttribute('aria-label','Equipos. Desliza o usa las flechas para cambiar.');
 const controls=root.createElement('div');controls.className='team-carousel-controls';
 function arrow(label,path){const b=root.createElement('button');b.type='button';b.className='team-carousel-arrow';b.setAttribute('aria-label',label);const svg=root.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=root.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',path);svg.append(p);b.append(svg);return b;}
 const prev=arrow('Equipo anterior','m14 5-7 7 7 7'),next=arrow('Equipo siguiente','m10 5 7 7-7 7'),count=root.createElement('span');count.className='team-carousel-count';count.setAttribute('aria-live','polite');count.setAttribute('aria-atomic','true');controls.append(prev,count,next);shell.append(controls);
 const hint=root.createElement('p');hint.className='team-carousel-hint';hint.textContent='Desliza o mantén el cursor encima para explorar · Toca el centro para entrar';shell.append(hint);
 let items=[],rendered=[],index=0,intentIndex=null,focusedId=null,lastActive=null,lastPlant=null,frame=0,drag=null,suppressUntil=0,disposed=false,accentPending=false,settleTimer=null,wrapTimer=null,pendingWrap=null,accent=null,hoverTimer=0;
 const idAt=i=>items[i]?.querySelector('[data-profile-id]')?.dataset.profileId;
 const logicalAt=item=>item?.classList.contains('profile-card-wrap-clone')?Number(item.dataset.carouselLogicalIndex):items.indexOf(item);
 const layout=()=>rendered.map(item=>({left:item.offsetLeft,width:item.offsetWidth}));
 function prepareLoop(){
  track.querySelectorAll('.profile-card-wrap-clone').forEach(e=>e.remove());
  if(items.length<2){rendered=items;return;}
  const clone=(source,logical)=>{const copy=source.cloneNode(true);copy.classList.add('profile-card-wrap-clone');copy.dataset.carouselLogicalIndex=String(logical);copy.setAttribute('aria-hidden','true');copy.inert=true;copy.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));copy.querySelectorAll('button,input,summary,a,select,textarea').forEach(e=>{e.tabIndex=-1;e.setAttribute('aria-hidden','true');});return copy;};
  track.insertBefore(clone(items.at(-1),items.length-1),items[0]);track.append(clone(items[0],0));rendered=[...track.children].filter(e=>e.classList.contains('profile-card-wrap'));
 }
 function emphasize(){
  if(!accentPending||drag||disposed)return;accentPending=false;if(reduce())return;
  const logo=rendered.find(item=>item.dataset.carouselPosition==='center')?.querySelector('.profile-card-logo:not([hidden]),.profile-logo-fallback:not([hidden])');if(!logo||typeof logo.animate!=='function')return;
  accent?.cancel();accent=logo.animate([{transform:'translateY(0) scale(1)'},{transform:'translateY(-5px) scale(1.06)',offset:.45},{transform:'translateY(0) scale(1)'}],{duration:260,easing:win.getComputedStyle(track).getPropertyValue('--ease-out').trim()||'cubic-bezier(.23,1,.32,1)'});
 }
 function paint(i,force=false){
  if(i<0||!rendered[i])return;const logical=logicalAt(rendered[i]);if(logical<0||!items[logical])return;index=logical;focusedId=idAt(logical);
  if(!force&&rendered[i].dataset.carouselPosition==='center')return;
  rendered.forEach((item,n)=>{item.dataset.carouselPosition=n===i?'center':Math.abs(n-i)===1?'near':'far';const b=item.querySelector('[data-profile-id]');if(b){b.tabIndex=item.classList.contains('profile-card-wrap-clone')?-1:(logicalAt(item)===logical?0:-1);b.removeAttribute('role');b.removeAttribute('aria-checked');if(!item.classList.contains('profile-card-wrap-clone')&&logicalAt(item)===logical)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');}});
  prev.disabled=false;next.disabled=false;const label=items[logical].querySelector('.profile-name')?.textContent||'Equipo';count.textContent=`${logical+1} / ${items.length}`;count.setAttribute('aria-label',`${label}, equipo ${logical+1} de ${items.length}`);
 }
 function applyLogo(item,url){
  const image=item?.querySelector('.profile-card-logo'),fallback=item?.querySelector('.profile-logo-fallback');
  if(!image||!fallback)return;
  const token=(Number(item.dataset.logoToken)||0)+1;item.dataset.logoToken=String(token);
  if(!url){item.dataset.logoState='missing';image.hidden=true;fallback.hidden=false;return;}
  const source=String(url);item.dataset.logoState='loading';image.hidden=true;fallback.hidden=false;
  const ready=()=>{if(item.dataset.logoToken!==String(token))return;item.dataset.logoState='ready';image.hidden=false;fallback.hidden=true;};
  const failed=()=>{if(item.dataset.logoToken!==String(token))return;item.dataset.logoState='missing';image.hidden=true;fallback.hidden=false;};
  image.onload=ready;
  image.onerror=failed;
  image.src=source;
  if(image.complete){if(image.naturalWidth>0)ready();else failed();}
  else if(typeof image.decode==='function')void image.decode().then(ready).catch(()=>{});
 }
 function go(i,{smooth=false,focus=false}={}){
  if(!items.length||track.clientWidth===0)return;win.clearTimeout(wrapTimer);pendingWrap=null;const target=wrapTeamIndex(i,items.length),wrapped=i<0||i>=items.length,animate=smooth&&!reduce();let visual=target+1;
  if(wrapped&&animate){visual=i>=items.length?rendered.length-1:0;pendingWrap={logical:target};}
  intentIndex=animate?target:null;accentPending=smooth;paint(visual,true);
  track.dataset.motion=animate?'animated':'instant';track.scrollTo({left:rendered[visual].offsetLeft+rendered[visual].offsetWidth/2-track.clientWidth/2,behavior:animate?'smooth':'instant'});
  if(pendingWrap)wrapTimer=win.setTimeout(settleWrap,600);
  if(focus)items[target].querySelector('[data-profile-id]')?.focus({preventScroll:true});
 }
 function settleWrap(){if(!pendingWrap||disposed)return;const target=pendingWrap.logical;pendingWrap=null;win.clearTimeout(wrapTimer);track.dataset.motion='instant';const visual=target+1;track.scrollTo({left:rendered[visual].offsetLeft+rendered[visual].offsetWidth/2-track.clientWidth/2,behavior:'instant'});paint(visual,true);win.requestAnimationFrame(()=>{if(!disposed)track.dataset.motion='animated';});}
 function settleClone(){if(drag)return;if(pendingWrap){settleWrap();return;}const visual=nearestTeamIndex(layout(),track.scrollLeft,track.clientWidth);if(visual<0||!rendered[visual]?.classList.contains('profile-card-wrap-clone'))return;const logical=logicalAt(rendered[visual]),real=logical+1;track.dataset.motion='instant';track.scrollTo({left:rendered[real].offsetLeft+rendered[real].offsetWidth/2-track.clientWidth/2,behavior:'instant'});paint(real,true);win.requestAnimationFrame(()=>{if(!disposed)track.dataset.motion='animated';});}
 function onScroll(){win.clearTimeout(settleTimer);settleTimer=win.setTimeout(()=>{if(!drag)settleClone();emphasize();},160);if(frame||disposed)return;frame=win.requestAnimationFrame(()=>{frame=0;if(track.clientWidth)paint(nearestTeamIndex(layout(),track.scrollLeft,track.clientWidth));});}
 function refresh({activeId,plantId}={}){
  items=[...track.children].filter(e=>e.classList.contains('profile-card-wrap')&&!e.classList.contains('profile-card-wrap-clone'));prepareLoop();shell.hidden=items.length===0;controls.hidden=items.length<2;hint.hidden=items.length<2;
  let target=items.findIndex((_,i)=>idAt(i)===focusedId);
  if(activeId!==lastActive||plantId!==lastPlant||target<0)target=Math.max(0,items.findIndex((_,i)=>idAt(i)===activeId));
  lastActive=activeId;lastPlant=plantId;paint(target+1,true);win.requestAnimationFrame(()=>{if(!disposed)go(target);});
 }
 function onClick(e){
  if(e.detail!==0&&win.performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();return;}
  if(e.target.closest('.profile-card-wrap-clone'))return;
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
 function finish(e){if(!drag||e.pointerId!==drag.id)return;const moved=drag.moved;drag=null;track.classList.remove('is-dragging');if(track.hasPointerCapture(e.pointerId))track.releasePointerCapture(e.pointerId);if(moved){suppressUntil=win.performance.now()+400;const visual=nearestTeamIndex(layout(),track.scrollLeft,track.clientWidth);if(rendered[visual]?.classList.contains('profile-card-wrap-clone')){pendingWrap={logical:logicalAt(rendered[visual])};intentIndex=null;paint(visual,true);wrapTimer=win.setTimeout(settleWrap,600);}else go(logicalAt(rendered[visual]),{smooth:true});}}
 function stopHoverLoop(){win.clearInterval(hoverTimer);hoverTimer=0;}
 function startHoverLoop(){stopHoverLoop();if(items.length<2||reduce()||!win.matchMedia('(hover: hover) and (pointer: fine)').matches||root.hidden||root.visibilityState==='hidden'||shell.contains(root.activeElement))return;hoverTimer=win.setInterval(()=>{if(shell.matches(':hover')&&!shell.contains(root.activeElement)&&!reduce())go(index+1,{smooth:true});else stopHoverLoop();},2200);}
 prev.addEventListener('click',e=>go((intentIndex??index)-1,{smooth:e.detail!==0}));next.addEventListener('click',e=>go((intentIndex??index)+1,{smooth:e.detail!==0}));track.addEventListener('scrollend',()=>{settleClone();intentIndex=null;emphasize();});track.addEventListener('wheel',()=>{accentPending=true;intentIndex=null;pendingWrap=null;win.clearTimeout(wrapTimer);},{passive:true});track.addEventListener('scroll',onScroll,{passive:true});track.addEventListener('click',onClick,true);track.addEventListener('keydown',onKey);track.addEventListener('pointerdown',down);track.addEventListener('pointermove',move);track.addEventListener('pointerup',finish);track.addEventListener('pointercancel',finish);track.addEventListener('lostpointercapture',finish);
 shell.addEventListener('mouseenter',startHoverLoop);shell.addEventListener('mouseleave',stopHoverLoop);shell.addEventListener('focusin',stopHoverLoop);shell.addEventListener('focusout',()=>{if(shell.matches(':hover'))startHoverLoop();});
 const visibility=()=>{if(root.visibilityState==='hidden')stopHoverLoop();else if(shell.matches(':hover'))startHoverLoop();};root.addEventListener('visibilitychange',visibility);
 const resize=()=>{if(!disposed)go(Math.max(0,items.findIndex((_,i)=>idAt(i)===focusedId)));};
 const observer=typeof win.ResizeObserver==='function'?new win.ResizeObserver(resize):null;observer?.observe(track);if(!observer)win.addEventListener('resize',resize);
 shell.addEventListener('focusin',e=>{const item=e.target.closest('.profile-card-wrap');if(item&&e.target.matches(':focus-visible')){const i=items.indexOf(item);if(i>=0&&i!==index)go(i);}});
 return {refresh,syncLogo(id,url){for(const item of rendered)if(idAt(logicalAt(item))===id)applyLogo(item,url);},center:id=>{const i=items.findIndex((_,n)=>idAt(n)===id);if(i>=0)go(i,{smooth:true});},dispose(){disposed=true;stopHoverLoop();root.removeEventListener('visibilitychange',visibility);accent?.cancel();win.clearTimeout(settleTimer);win.clearTimeout(wrapTimer);observer?.disconnect();if(frame)win.cancelAnimationFrame(frame);if(!observer)win.removeEventListener('resize',resize);}};
}
