if(new URLSearchParams(location.search).has('admin'))document.getElementById('open-admin-dashboard').hidden=false;
await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const failures=[],check=(value,label)=>{if(!value)failures.push(label);},viewport={w:document.documentElement.clientWidth,h:window.innerHeight},cards=[...document.querySelectorAll('[data-plant]')];
const footer=document.querySelector('.welcome-footnote').getBoundingClientRect();
check(footer.bottom<=viewport.h+1,'Todo el contenido dentro de la altura de pantalla');
check(document.documentElement.scrollWidth<=viewport.w+1,'Sin desbordamiento horizontal');
for(const card of cards){const r=card.getBoundingClientRect(),title=card.querySelector('strong').getBoundingClientRect();check(r.width>=100&&r.height>=44,'Objetivo táctil legible');check(title.left>=r.left&&title.right<=r.right+1,'Nombre de planta dentro de su tarjeta');}
check(Math.abs(cards[0].getBoundingClientRect().top-cards[1].getBoundingClientRect().top)<1,'Plantas alineadas');
document.getElementById('layout-result').textContent=failures.length?'FAIL: '+failures.join(' · '):'PASS 7/7';document.title=(failures.length?'FAIL':'PASS 7/7')+' · Plantas '+viewport.w+'×'+viewport.h;
