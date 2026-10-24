import test from 'node:test';import assert from 'node:assert/strict';
import {THEMES,THEME_KEY,normalizeTheme,installThemes,installSettings} from '../public/themes.js';
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
