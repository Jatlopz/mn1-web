import test from 'node:test';import assert from 'node:assert/strict';
import {THEMES,THEME_KEY,normalizeTheme,installThemes,installSettings,APPEARANCE_KEY,DEFAULT_APPEARANCE,normalizeAppearance,installAppearance} from '../public/themes.js';
function page(){const handlers={},buttons=THEMES.map(t=>({dataset:{themeChoice:t.id},setAttribute(k,v){this[k]=v}}));const elements=new Map();
 for(const id of ['theme-dialog','theme-error','open-themes','close-themes'])elements.set(id,{open:false,textContent:'',addEventListener(type,fn){handlers[id+':'+type]=fn},querySelectorAll(){return buttons},showModal(){this.open=true},close(){this.open=false}});
 return {root:{documentElement:{dataset:{}},getElementById:id=>elements.get(id)},events:{addEventListener(type,fn){handlers[type]=fn}},handlers,buttons,elements};}
test('six themes normalize unsupported stored values and keep readable primary buttons',()=>{
 assert.equal(THEMES.length,6);assert.equal(normalizeTheme('unknown'),'halloween');
 for(const theme of THEMES){assert.equal(normalizeTheme(theme.id),theme.id);const rgb=theme.accent.match(/[a-f0-9]{2}/gi).map(x=>parseInt(x,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);assert.ok((.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]+.05)/.057>4.5);}
});
test('theme preference persists independently, opens from Settings event, and rolls back failed save',async()=>{
 const ui=page();const values=new Map([[THEME_KEY,'violet'],['team-original','UNCHANGED']]);let fail=false;
 const storage={getText:async k=>values.get(k),putText:async(k,v)=>{if(fail)throw Error('full');values.set(k,v)}};
 await installThemes(storage,ui.root,ui.events);assert.equal(ui.root.documentElement.dataset.theme,'violet');
 ui.handlers['mn1:open-themes']();assert.equal(ui.elements.get('theme-dialog').open,true);
 await ui.handlers['theme-dialog:click']({target:{closest:()=>ui.buttons[2]}});assert.equal(values.get(THEME_KEY),'amber');
 fail=true;await ui.handlers['theme-dialog:click']({target:{closest:()=>ui.buttons[0]}});assert.equal(ui.root.documentElement.dataset.theme,'amber');assert.ok(ui.elements.get('theme-error').textContent);
 assert.equal(values.get('team-original'),'UNCHANGED');
});

test('native unified Settings hides web fallback gear while browser retains it',()=>{
 const handlers={};const button={hidden:false,addEventListener:(name,fn)=>handlers[name]=fn};const dialog={open:false,showModal(){this.open=true},close(){this.open=false}};
 const close={addEventListener:(name,fn)=>handlers['close']=fn};const root={getElementById:id=>id==='open-web-settings'?button:id==='web-settings-dialog'?dialog:close};
 installSettings(true,root);assert.equal(button.hidden,true);
 installSettings(false,root);assert.equal(button.hidden,false);
 handlers.click();assert.equal(dialog.open,true);handlers.close();assert.equal(dialog.open,false);
});

test('theme collections restore seasonal selection and support arrows without changing the saved theme',async()=>{
 const ui=page(),values=new Map([[THEME_KEY,'halloween']]);let writes=0,focused='';
 for(const id of ['base-themes','seasonal-themes','theme-tab-base','theme-tab-season'])ui.elements.set(id,{hidden:false,tabIndex:0,setAttribute(k,v){this[k]=v},addEventListener(type,fn){ui.handlers[id+':'+type]=fn},focus(){focused=id}});
 await installThemes({getText:async k=>values.get(k),putText:async()=>writes++},ui.root,ui.events);
 ui.handlers['mn1:open-themes']();
 assert.equal(ui.elements.get('base-themes').hidden,true);assert.equal(ui.elements.get('seasonal-themes').hidden,false);
 assert.equal(ui.elements.get('theme-tab-season').tabIndex,0);
 ui.handlers['theme-tab-season:keydown']({key:'ArrowLeft',preventDefault(){}});
 assert.equal(ui.elements.get('base-themes').hidden,false);assert.equal(focused,'theme-tab-base');
 ui.handlers['theme-tab-base:keydown']({key:'End',preventDefault(){}});
 assert.equal(ui.elements.get('seasonal-themes').hidden,false);assert.equal(focused,'theme-tab-season');
 assert.equal(writes,0);assert.equal(ui.root.documentElement.dataset.theme,'halloween');
});


test('Halloween is the default without storing over personal choices',async()=>{
 for(const saved of [null,'unknown',...THEMES.map(t=>t.id)]) {
   const ui=page();let writes=0;
   await installThemes({getText:async()=>saved,putText:async()=>writes++},ui.root,ui.events);
   assert.equal(ui.root.documentElement.dataset.theme,THEMES.some(t=>t.id===saved)?saved:'halloween');
   assert.equal(writes,0);
 }
});
function appearancePage(){
 const elements=new Map(),styles=new Map();
 const node=id=>{const result={value:'',textContent:'',disabled:false,dataset:{},addEventListener(type,fn){this[type]=fn;},setAttribute(k,v){this[k]=v;}};elements.set(id,result);return result;};
 for(const id of ['appearance-controls','appearance-status','appearance-cards','appearance-windows','appearance-cards-value','appearance-windows-value','appearance-reset'])node(id);
 const buttons=['original','moon'].map(value=>{const b=node('wallpaper-'+value);b.dataset.wallpaperChoice=value;return b;});
 elements.get('appearance-controls').querySelectorAll=()=>buttons;
 return {elements,styles,root:{getElementById:id=>elements.get(id),documentElement:{dataset:{theme:'halloween'},style:{setProperty:(key,value)=>styles.set(key,value)}}}};
}
test('appearance validates stored values and limits transparency without accepting CSS',()=>{
 assert.deepEqual(normalizeAppearance(null),DEFAULT_APPEARANCE);
 assert.deepEqual(normalizeAppearance({wallpaper:'url(evil)',cards:Infinity,windows:'40'}),DEFAULT_APPEARANCE);
 assert.deepEqual(normalizeAppearance({wallpaper:'moon',cards:100,windows:-4}),{wallpaper:'moon',cards:60,windows:0});
});
test('appearance previews live, persists independently, restores on reopen and rolls back failed writes',async()=>{
 const values=new Map([['team-original','KEEP'],[THEME_KEY,'halloween']]);let fail=false,writes=0;
 const storage={getText:async key=>values.get(key),putText:async(key,value)=>{if(fail)throw Error('full');writes++;values.set(key,value);}};
 const ui=appearancePage();await installAppearance(storage,ui.root);assert.equal(writes,0);
 const slider=ui.elements.get('appearance-cards');slider.value='46';slider.input();
 assert.equal(ui.styles.get('--ui-card-opacity'),'54%');assert.equal(writes,0);
 await slider.change();assert.equal(JSON.parse(values.get(APPEARANCE_KEY)).cards,46);
 await ui.elements.get('wallpaper-moon').click();assert.equal(ui.root.documentElement.dataset.wallpaper,'moon');
 const next=appearancePage();await installAppearance(storage,next.root);assert.equal(next.styles.get('--ui-card-opacity'),'54%');assert.equal(next.root.documentElement.dataset.wallpaper,'moon');
 fail=true;await next.elements.get('wallpaper-original').click();assert.equal(next.root.documentElement.dataset.wallpaper,'moon');assert.match(next.elements.get('appearance-status').textContent,/No se pudo guardar/);
 fail=false;await next.elements.get('appearance-reset').click();assert.deepEqual(JSON.parse(values.get(APPEARANCE_KEY)),DEFAULT_APPEARANCE);
 assert.equal(values.get('team-original'),'KEEP');assert.equal(values.get(THEME_KEY),'halloween');
});
test('unreadable appearance keeps defaults and remains editable',async()=>{
 const ui=appearancePage();await installAppearance({getText:async()=>'{invalid',putText:async()=>{}},ui.root);
 assert.equal(ui.root.documentElement.dataset.wallpaper,'original');assert.equal(ui.elements.get('appearance-cards').disabled,false);
 assert.match(ui.elements.get('appearance-status').textContent,/No se pudo leer/);
});

test('PayPal usa el enlace público y mantiene el navegador separado de la app',async()=>{
 const {installCoffeeLink,SUPPORT_PAYPAL_URL}=await import('../public/themes.js');
 assert.equal(SUPPORT_PAYPAL_URL,'https://paypal.me/Jatlopz90');
 for(const [native,supported] of [[false,false],[true,false],[true,true]]){
  const elements=new Map();const root={getElementById:id=>{if(!elements.has(id))elements.set(id,{hidden:true,textContent:'',addEventListener(type,handler){this[type]=handler;}});return elements.get(id);}};
  installCoffeeLink({native,canOpenExternal:supported},root);const link=elements.get('about-paypal');assert.equal(link.href,SUPPORT_PAYPAL_URL);assert.equal(link.target,native?'_self':'_blank');
  let prevented=false;link.click({preventDefault(){prevented=true;}});assert.equal(prevented,native&&!supported);
  assert.equal(elements.get('coffee-compat').hidden,!(native&&!supported));
 }
});

test('los contactos copian sólo el número y correo indicados y tienen alternativa sin portapapeles',async()=>{const {installContactCopy}=await import('../public/themes.js');const nodes=new Map();for(const id of ['copy-creator-whatsapp','copy-creator-email','creator-whatsapp','creator-email','creator-contact-status'])nodes.set(id,{textContent:id==='creator-whatsapp'?'+504 8830-1336':id==='creator-email'?'Jatlopz90@gmail.com':'',addEventListener(type,fn){this[type]=fn;},focus(){}});const root={getElementById:id=>nodes.get(id)},copies=[];installContactCopy(root,{writeText:async value=>copies.push(value)});await nodes.get('copy-creator-whatsapp').click();await nodes.get('copy-creator-email').click();assert.deepEqual(copies,['+504 8830-1336','Jatlopz90@gmail.com']);installContactCopy(root,null);await nodes.get('copy-creator-email').click();assert.match(nodes.get('creator-contact-status').textContent,/Mantén pulsado/);});
