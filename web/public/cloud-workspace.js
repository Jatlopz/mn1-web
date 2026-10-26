import {createRegistryAdmin} from './registry-admin.js';
import {loadImageElement,prepareImageFile} from './renderer.js';
import { TEAM_TOOLS,toolsForTeam,toolRequestNote,mergeToolRequestDraft,isToolEnabledForTeam } from './profiles.js';
import { CloudClient } from "./cloud-client.js";
import {
  CLOUD_META_KEY,
  localTeamPacket,
  canPublish,
  publishPacket,
  receivePacket,
  preserveOriginal,
  restoreOriginal,
  originalBackupKey,
} from "./cloud-model.js";
import { WORKSPACE_KEYS } from "./storage.js";
import { REPORT_PREFS_KEY, REPORT_STYLES_KEY } from "./meeting-report.js";
export function isCreatorPhoto(value){return typeof value==='string'&&value.length<=350000&&new RegExp('^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$').test(value);}
export function isCompanyLogo(value){return typeof value==='string'&&value.length<=350000&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);}
export async function prepareCompanyLogo(dataUrl){
 const image=await loadImageElement(dataUrl);
 for(const maxSide of [512,384,256,192,128]){
  const scale=Math.min(1,maxSide/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('No se pudo preparar el logo.');
  ctx.drawImage(image,0,0,canvas.width,canvas.height);const logo=canvas.toDataURL('image/png');if(isCompanyLogo(logo))return logo;
 }
 throw Error('El logo es demasiado grande. Elige una imagen más pequeña.');
}
export function installCompanyLogo({getServices,client,root=document}){
 const image=root.getElementById('company-logo'),change=root.getElementById('company-logo-change'),input=root.getElementById('company-logo-input'),status=root.getElementById('company-logo-status'),about=root.getElementById('about-dialog');
 if(!image||!change||!input||!status)return {ready:Promise.resolve(),refresh:async()=>{}};
 const storage=getServices().storage,cacheKey='mn1.company.logo';let revision=0,busy=false;
 const valid=row=>row&&Number.isSafeInteger(row.revision)&&row.revision>=0&&(row.logo===null||isCompanyLogo(row.logo));
 const show=logo=>{image.hidden=!logo;if(logo)image.src=logo;else image.removeAttribute('src');};
 image.addEventListener('error',()=>{image.hidden=true;image.removeAttribute('src');});
 async function refresh(){if(busy)return;try{const rows=await client.companyLogo(),value=rows?.[0],row=value&&{revision:value.logo_revision,logo:value.logo};if(busy||!valid(row)||row.revision<revision)return;revision=row.revision;show(row.logo);try{await storage.putText(cacheKey,JSON.stringify(row));}catch{/* La imagen recibida sigue disponible. */}}catch{/* Conserva la marca anterior sin conexión. */}}
 async function save(dataUrl){const logo=await prepareCompanyLogo(dataUrl);const next=await client.setCompanyLogo(revision,logo);if(!Number.isSafeInteger(next)||next<=revision)throw Error('No se pudo confirmar el cambio de logo.');revision=next;show(logo);try{await storage.putText(cacheKey,JSON.stringify({revision,logo}));}catch{/* El servidor ya confirmó la publicación. */}status.textContent='Logo actualizado para todos los teléfonos.';}
 async function run(task){if(busy)return;busy=true;change.disabled=true;status.textContent='Preparando el logo…';try{if(!(await client.access()).admin)throw Error('Sólo el administrador general puede cambiar el logo.');await task();}catch(error){status.textContent=error.code==='conflict'?'El logo cambió en otro teléfono. Cierra y abre Acerca de antes de reintentar.':(error.message||'No se pudo guardar el logo. El anterior se conserva.');}finally{busy=false;change.disabled=false;}}
 change.addEventListener('click',()=>{const service=getServices();if(service.mode!=='native'){input.value='';input.click();return;}void run(async()=>{const result=await service.bridge.request('IMPORT_IMAGE',{}, {timeoutMs:300000});if(!result.ok||!result.data?.imageDataUrl)throw Error(result.message||'Selección cancelada.');await save(result.data.imageDataUrl);});});
 input.addEventListener('change',()=>{const file=input.files?.[0];if(file)void run(async()=>{const prepared=await prepareImageFile(file,{maxSide:512,minDimension:1,maxDataUrlLength:350000});await save(prepared.dataUrl);});});
 if(about&&typeof MutationObserver!=='undefined')new MutationObserver(()=>{if(about.open)void refresh();}).observe(about,{attributes:true,attributeFilter:['open']});
 const ready=(async()=>{try{const row=JSON.parse(await storage.getText(cacheKey)||'null');if(valid(row)&&row.revision>=revision){revision=row.revision;show(row.logo);}}catch{/* Datos anteriores no válidos: se conserva la vista actual. */}await refresh();})();
 return {ready,refresh};
}
export function applyAccountVisibility(access,root=document){
 const admin=access?.admin===true;
 for(const id of ['settings-admin','cloud-dashboard-access','cloud-refresh','cloud-teams','cloud-sync-details','creator-photo-change','company-logo-change']){const node=root.getElementById(id);if(node)node.hidden=!admin;}
}
export function setAdminScreenVisible(screen,visible,root=document) {
 screen.hidden=!visible;
 const app=root.getElementById('app');if(app)app.hidden=visible;
 if(visible)screen.focus();
}
export function applyAdminDashboardView(dashboard, view) {
  if (!['overview', 'tools', 'inbox', 'catalog'].includes(view)) return false;
  dashboard.dataset.view = view;
  for (const panel of dashboard.querySelectorAll('[data-admin-panel]')) panel.hidden = panel.dataset.adminPanel !== view;
  for (const button of dashboard.querySelectorAll('[data-admin-view]')) button.setAttribute('aria-pressed', String(button.dataset.adminView === view));
  dashboard.scrollTop = 0;
  return true;
}
export async function leaveAdminDashboard(dashboard,openSpace) {
 const restored=await openSpace();
 if(restored===false)return false;
 dashboard.close();return true;
}
export const IDEA_STATES = Object.freeze({pending:'Pendiente',reviewing:'En análisis',in_progress:'En proceso',integrated:'Ejecutada'});
const IDEAS_ENABLED = true; // Migración autorizada y verificada con RLS e idempotencia.
export async function performCloudSync(operation,{background=false,setSyncing=()=>{},setLocked=()=>{}}={}) {
 setSyncing(true);
 if(!background)setLocked(true);
 try{return await operation();}finally{if(!background)setLocked(false);setSyncing(false);}
}
export function createCloudWorkspace(getServices,{client:providedClient=null}={}) {
  const $ = (id) => document.getElementById(id),
    dialog = $("cloud-dialog"),
    client = providedClient || new CloudClient(getServices().storage);
  let registry = null;
  let meta = {},
    access = null,
    rows = [],
    busy = false,
    applying = false,
    timer = null;
  const status = (text, error = false) => {
    $("cloud-status").textContent = text;
    $("cloud-status").dataset.tone = error ? "error" : "info";
  };
  const saveMeta = () =>
    getServices().storage.putText(CLOUD_META_KEY, JSON.stringify(meta));
  const lock = (value) => {
    busy = value;
    for (const e of dialog.querySelectorAll("button,input,select"))
      e.disabled = value;

  };
  const definitions = () => getServices().catalog;
  function render() {
    const logged = Boolean(client.session);
    applyAccountVisibility(access);
    $("cloud-login").hidden = logged;
    $("cloud-connected").hidden = false;
    $("cloud-logout").hidden = !logged;
    $("cloud-password-settings").hidden = !logged;
    $('open-admin-dashboard').hidden=!access?.admin;
    if(!access?.admin){registry?.clear();$('admin-incoming').hidden=true;$('admin-unread').hidden=true;$('admin-ideas-list').replaceChildren();if(adminIsOpen())hideAdmin();}
    if(access?.admin&&!adminOffered&&!getServices().isEditing?.()){adminOffered=true;queueMicrotask(()=>void openAdmin());}
    $("cloud-admin").hidden = !access?.admin;
    $("cloud-ideas-admin").hidden = !access?.admin || !IDEAS_ENABLED;
    $("cloud-account").textContent = logged
      ? (client.session.user?.email || "Cuenta conectada") +
        (access?.admin ? " · Administrador general" : "")
      : "No has iniciado sesión.";
    const list = $("cloud-teams");
    list.replaceChildren();
    const ids = new Set([
      ...definitions().map((t) => t.id),
      ...rows.map((r) => r.id),
    ]);
    for (const id of ids) {
      const definition =
        definitions().find((t) => t.id === id) ||
        rows.find((r) => r.id === id)?.data?.definition;
      if (!definition) continue;
      const remote = rows.find((r) => r.id === id),
        item = document.createElement("div");
      item.className = "cloud-team";
      const label = document.createElement("strong");
      label.textContent = definition.name;
      item.append(label);
      const detail = document.createElement("p");
      detail.className = "hint";
      detail.textContent = remote?.revision
        ? "Versión compartida " +
          remote.revision +
          (meta[id]?.paused ? " · Recepción pausada; pulsa Recibir para volver a vincular" : meta[id]?.conflict ? " · Requiere revisión" : "")
        : "Sólo en este teléfono; aún sin publicar";
      item.append(detail);
      if (access?.member && remote?.revision) {
        const receive = document.createElement("button");
        receive.className = "button button-secondary";
        receive.textContent = "Recibir";
        receive.disabled = busy;
        receive.addEventListener(
          "click",
          () =>
            void action(async () => {
              if (
                !confirm(
                  "Recibir «" +
                    definition.name +
                    "» reemplazará su plantilla y logo locales. Se guardará una copia de respaldo. ¿Continuar?",
                )
              )
                return;
              await receiveRow(remote);
              status(
                "Equipo recibido. Las siguientes versiones se recibirán cuando tu copia no tenga cambios pendientes.",
              );
            }),
        );
        item.append(receive);
      }
      if (canPublish(access, id) && definitions().some((t) => t.id === id)) {
        const publish = document.createElement("button");
        publish.className = "button button-primary";
        publish.textContent = remote?.revision
          ? "Publicar mi copia"
          : "Publicar equipo";
        publish.disabled = busy;
        publish.addEventListener(
          "click",
          () =>
            void action(async () => {
              const latest = (await client.list()).find((r) => r.id === id);
              if (
                !confirm(
                  "Publicar «" +
                    definition.name +
                    "» compartirá su arte, logo, marco y horarios con los teléfonos autorizados" +
                    (latest?.revision
                      ? " y creará una nueva versión sobre la " +
                        latest.revision
                      : "") +
                    ". ¿Continuar?",
                )
              )
                return;
              await publishTeam(id, latest?.revision || 0);
              status(
                "Equipo publicado. Los cambios guardados después se sincronizarán automáticamente.",
              );
            }),
        );
        item.append(publish);
      }
      if (meta[id]?.original) {
        const restore = document.createElement("button");
        restore.className = "button button-secondary";
        restore.textContent = "Restaurar mi copia original";
        restore.disabled = busy;
        restore.addEventListener(
          "click",
          () =>
            void action(async () => {
              if (
                !confirm(
                  "Restaurarás la copia de este equipo guardada antes de vincularlo a la nube. No se publicará automáticamente. ¿Continuar?",
                )
              )
                return;
              applying = true;
              try {
                meta[id] = {original:true, paused:true};
                await saveMeta();
                const state = await restoreOriginal(getServices().storage, id);
                await getServices().applyState(state);
                status("Copia original restaurada sólo en este teléfono.");
              } finally {
                applying = false;
              }
            }),
        );
        item.append(restore);
      }
      list.append(item);
    }
    const selected = $("cloud-editor-team").value;
    $("cloud-editor-team").replaceChildren();
    for (const d of definitions()) {
      const option = document.createElement("option");
      option.value = d.id;
      option.textContent = d.name;
      $("cloud-editor-team").append(option);
    }
    if ([...$("cloud-editor-team").options].some((o) => o.value === selected))
      $("cloud-editor-team").value = selected;
  }
  async function refresh() {
    access = client.session ? await client.access() : {member:true,admin:false,teams:[]};
    render(); // El acceso no depende de que el catálogo termine de cargar.
    if (!access.member) {
      rows = [];
      status(
        "Cuenta sin equipo asignado. Pide al administrador general que autorice tu correo.",
        true,
      );
    } else rows = client.session ? await client.list() : await client.publicList();
    render();
  }
  async function action(fn,{background=false}={}) {
    if (busy) return;
    lock(true);
    try {
      await performCloudSync(async()=>{
      if (!background && !(await getServices().flush()))
        throw Error("Corrige y guarda el borrador antes de sincronizar.");
      await fn();
      if (client.session && !background) await refresh();
      },{background,setSyncing:getServices().setSyncing,setLocked:getServices().setLocked});
    } catch (e) {
      if(e.code==='deferred')return;
      status(e.message || "No se completó la sincronización.", true);
    } finally {
      lock(false);
      render();
    }
  }
  async function publishTeam(id, expected) {
    if (!canPublish(access, id))
      throw Error("Tu cuenta no puede publicar este equipo.");
    await preserveOriginal(getServices().storage, id);
    const packet = await localTeamPacket(getServices().storage, id);
    const published = await publishPacket(
      client,
      getServices().storage,
      packet,
      expected,
      meta[id] || {},
    );
    meta[id] = {
      ...published,
      fingerprint: packet.fingerprint,
      original: Boolean(
        await getServices().storage.getText(originalBackupKey(id)),
      ),
      conflict: false,
    };
    await saveMeta();
  }
  async function receiveRow(row) {
    applying = true;
    try {
      const state = await receivePacket(getServices().storage, client, row, {commit: getServices().commitReceive});
      await getServices().applyState(state);
      const packet = await localTeamPacket(getServices().storage, row.id);
      meta[row.id] = {
        revision: row.revision,
        fingerprint: packet.fingerprint,
        original: Boolean(
          await getServices().storage.getText(originalBackupKey(row.id)),
        ),
        conflict: false,
      };
      await saveMeta();
    } finally {
      applying = false;
    }
  }
  async function tick() {
    if (busy || getServices().blocked()) return;
    await action(async () => {
      await refresh();
      if (!access.member) return;
      const localState = JSON.parse(await getServices().storage.getText(WORKSPACE_KEYS.state) || "{}");
      for (const row of rows) {
        if(getServices().blocked())return;
        if (localState.archivedProfileIds?.includes(row.id)) continue;
        const bound = meta[row.id];
        if (!bound) {
          if (row.data)
            await receiveRow(row);
          continue;
        }
        if (bound.paused || bound.conflict) continue;
        const local = await localTeamPacket(getServices().storage, row.id);
        const changed = local.fingerprint !== bound.fingerprint;
        if (row.revision > bound.revision) {
          if (changed) {
            bound.conflict = true;
            await saveMeta();
            status(
              "Hay cambios locales y remotos en " +
                (row.data?.definition?.name || row.id) +
                ". Abre Cuenta y equipos para elegir cuál conservar.",
              true,
            );
            continue;
          }
          if (row.data) await receiveRow(row);
        } else if (changed && canPublish(access, row.id)) {
          try {
            await publishTeam(row.id, bound.revision);
          } catch (e) {
            if (e.code === "conflict") {
              bound.conflict = true;
              await saveMeta();
            }
            throw e;
          }
        }
      }
    },{background:true});
  }
  const schedule = () => {
    if (applying) return;
    clearTimeout(timer);
    timer = setTimeout(() => void tick(), 2500);
  };
  const storage = getServices().storage,
    originalPut = storage.putText.bind(storage);
  storage.putText = async (key, value) => {
    const result = await originalPut(key, value);
    if (
      [WORKSPACE_KEYS.state, REPORT_PREFS_KEY, REPORT_STYLES_KEY].includes(key)
    )
      schedule();
    return result;
  };
  const openCloud = () => {
    $("web-settings-dialog")?.close();
    dialog.showModal();
    render();
    void tick();
  };
  $("open-cloud").addEventListener("click", openCloud);
  window.addEventListener("mn1:open-cloud", openCloud);
  $("close-cloud").addEventListener("click", () => dialog.close());
  $("cloud-login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = $("cloud-email").value,
      password = $("cloud-password").value;
    $("cloud-password").value = "";
    void action(async () => {
      access = await client.login(email, password);
      await refresh();
      status(
        access.member
          ? (access.admin?"Cuenta conectada. Administración disponible.":"Cuenta conectada.")
          : "Cuenta sin permisos. Solicita asignación de equipo.",
        !access.member,
      );
    });
  });
  $("cloud-logout").addEventListener(
    "click",
    () =>
      void action(async () => {
        await client.logout();
        access = null;adminOffered=false;
        rows = [];
        await refresh();
        status("Sesión cerrada.");
      }),
  );
  $("cloud-refresh").addEventListener(
    "click",
    () =>
      void action(async () => {
        await refresh();
        status("Lista de versiones actualizada.");
      }),
  );
  $("cloud-grant").addEventListener("submit", (e) => {
    e.preventDefault();
    void action(async () => {
      await client.grant(
        $("cloud-editor-team").value,
        $("cloud-editor-email").value,
        $("cloud-editor-enabled").checked,
      );
      status("Permisos de equipo actualizados.");
    });
  });
  $("cloud-create-account").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = $("cloud-new-email").value,
      password = $("cloud-new-password").value;
    $("cloud-new-password").value = "";
    void action(async () => {
      const result = await client.createAccount(email, password);
      status(result.message);
    });
  });
  $("cloud-change-password").addEventListener("submit", (e) => {
    e.preventDefault();
    const password = $("cloud-own-password").value;
    $("cloud-own-password").value = "";
    void action(async () => {
      await client.changePassword(password);
      status("Contraseña actualizada.");
    });
  });
  installCompanyLogo({getServices,client});
  let creatorRevision=0,creatorBusy=false;const creatorCacheKey='mn1.creator.photo';
  const defaultCreatorSrc=$('creator-photo').getAttribute('src');
  function showCreatorPhoto(photo){$('creator-photo').src=photo||defaultCreatorSrc;$('creator-photo').classList.toggle('is-custom',Boolean(photo));}
  async function loadCreatorPhoto(){
    if(creatorBusy)return;
    try{const rows=await client.creatorProfile();const row=rows?.[0];if(creatorBusy||!row||!Number.isSafeInteger(row.revision)||row.revision<creatorRevision||(row.photo!==null&&!isCreatorPhoto(row.photo)))return;creatorRevision=row.revision;showCreatorPhoto(row.photo);await storage.putText(creatorCacheKey,JSON.stringify(row));}catch{/* Conserva la foto anterior cuando no hay conexión. */}
  }
  async function saveCreatorPhoto(dataUrl){
    if(!(await client.access()).admin)throw Error('Sólo el administrador puede cambiar esta foto.');
    const image=await loadImageElement(dataUrl),canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('No se pudo preparar la foto.');const side=Math.min(image.naturalWidth,image.naturalHeight);
    ctx.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,256,256);
    const photo=canvas.toDataURL('image/jpeg',.85);if(!isCreatorPhoto(photo))throw Error('La foto es demasiado grande.');
    creatorRevision=await client.setCreatorPhoto(creatorRevision,photo);showCreatorPhoto(photo);
    try{await storage.putText(creatorCacheKey,JSON.stringify({revision:creatorRevision,photo}));}catch{/* La publicación ya se confirmó en el servidor. */}
    $('creator-photo-status').textContent='Foto actualizada para todos los teléfonos.';
  }
  async function runCreatorChange(task){if(creatorBusy)return;creatorBusy=true;$('creator-photo-change').disabled=true;$('creator-photo-status').textContent='Preparando tu foto…';try{await task();}catch(e){$('creator-photo-status').textContent=e.code==='conflict'?'La foto cambió en otro teléfono. Cierra y abre Acerca de antes de reintentar.':(e.message||'No se pudo confirmar el cambio; la foto anterior se conserva.');}finally{creatorBusy=false;$('creator-photo-change').disabled=false;}}
  $('creator-photo-change').addEventListener('click',()=>{
    const service=getServices();if(service.mode!=='native'){$('creator-photo-input').value='';$('creator-photo-input').click();return;}
    void runCreatorChange(async()=>{const result=await service.bridge.request('IMPORT_IMAGE',{}, {timeoutMs:300000});if(!result.ok||!result.data?.imageDataUrl)throw Error(result.message||'Selección cancelada.');await saveCreatorPhoto(result.data.imageDataUrl);});
  });
  $('creator-photo-input').addEventListener('change',()=>{const file=$('creator-photo-input').files?.[0];if(file)void runCreatorChange(async()=>{const result=await prepareImageFile(file);await saveCreatorPhoto(result.dataUrl);});});
  if(typeof MutationObserver!=='undefined')new MutationObserver(()=>{if($('about-dialog').open)void loadCreatorPhoto();}).observe($('about-dialog'),{attributes:true,attributeFilter:['open']});
  async function restoreCreatorPhoto(){try{const row=JSON.parse(await storage.getText(creatorCacheKey)||'null');if(row&&Number.isSafeInteger(row.revision)&&(row.photo===null||isCreatorPhoto(row.photo))){creatorRevision=row.revision;showCreatorPhoto(row.photo);}}catch{}void loadCreatorPhoto();}
  void restoreCreatorPhoto();
  const ideasDialog=$('ideas-dialog'),ideaStatus=$('ideas-status');
  let ideaBusy=false,ideaRequest=null,ideaOffset=0,ideaDraftLoaded=false,ideaTeamId=null;
  const ideaDraftKey=id=>'mn1.idea.draft.'+id;
  const ideaRequestKey=id=>'mn1.idea.req.'+id;
  const ideasLock=value=>{ideaBusy=value;for(const control of ideasDialog.querySelectorAll('button,input,select,textarea'))control.disabled=value;$('idea-send').disabled=value||!IDEAS_ENABLED;};
  $('ideas-close').addEventListener('click',()=>{if(!ideaBusy)ideasDialog.close();});
  ideasDialog.addEventListener('cancel',event=>{if(ideaBusy)event.preventDefault();});
  async function openIdeas({toolId=null,teamId=null}={}) {
    if(ideaBusy||ideasDialog.open)return false;
    const services=getServices(),team=services.catalog.find(t=>t.id===services.activeProfileId);
    if(!team||(teamId&&teamId!==team.id))return false;
    const requestNote=toolId?toolRequestNote(toolId,team):null;
    ideaStatus.textContent=IDEAS_ENABLED?'':'Buzón preparado. El envío estará disponible cuando se active la nube de ideas.';ideaRequest=null;ideaDraftLoaded=false;ideaTeamId=team.id;
    $('my-ideas-panel').hidden=true;$('ideas-form').hidden=false;$('ideas-inbox').hidden=true;$('ideas-team').textContent='Equipo: '+team.name;
    $('idea-note').value='';ideasDialog.showModal();ideasLock(true);
    try{
      const existing=await services.storage.getText(ideaDraftKey(team.id))||'';
      const merged=requestNote?mergeToolRequestDraft(existing,requestNote):existing;
      $('idea-note').value=merged??existing;ideaDraftLoaded=true;
      if(merged===null)ideaStatus.textContent='Tu borrador anterior se conserva. Hay que acortarlo para añadir la solicitud de adaptación.';
    }catch{ideaStatus.textContent='No se pudo leer tu borrador anterior. No se reemplazará al cerrar.';}finally{ideasLock(false);}
    return true;
  }
  $('open-ideas').addEventListener('click',()=>void openIdeas());
  $('idea-note').addEventListener('input',()=>{ideaRequest=null;});
  ideasDialog.addEventListener('close',()=>{
    if(!$('ideas-form').hidden&&ideaDraftLoaded){const id=ideaTeamId;void getServices().storage.putText(ideaDraftKey(id),$('idea-note').value).catch(()=>{});}
  });
  $('ideas-form').addEventListener('submit',async event=>{
    event.preventDefault();if(ideaBusy||!IDEAS_ENABLED)return;
    const note=$('idea-note').value.trim(),team=getServices().activeProfileId;
    if(note.length<10||note.length>1500){ideaStatus.textContent='Describe la idea entre 10 y 1500 caracteres.';return;}
    ideasLock(true);ideaStatus.textContent='Enviando tu propuesta…';
    try{
      await getServices().storage.putText(ideaDraftKey(team),note);
      let device=await getServices().storage.getText('mn1.idea.client');
      if(!/^[0-9a-f-]{36}$/.test(device||'')){device=crypto.randomUUID();await getServices().storage.putText('mn1.idea.client',device);}
      if(!ideaRequest){let pending=null;try{pending=JSON.parse(await getServices().storage.getText(ideaRequestKey(team)));}catch{}ideaRequest=pending?.note===note&&/^[0-9a-f-]{36}$/.test(pending.id)?pending.id:crypto.randomUUID();await getServices().storage.putText(ideaRequestKey(team),JSON.stringify({id:ideaRequest,note}));}
      await client.submitIdea(ideaRequest,device,team,note);
      $('idea-note').value='';await getServices().storage.putText(ideaDraftKey(team),'');await getServices().storage.putText(ideaRequestKey(team),'');
      ideaStatus.textContent='Idea enviada al administrador general. Gracias por ayudar a mejorar SuperTools.';ideaRequest=null;
    }catch(e){ideaStatus.textContent=e.message+' Tu nota se conserva. Si el equipo es nuevo, el administrador debe publicarlo primero.';}finally{ideasLock(false);}
  });
  async function loadIdeas(append=false){
    if(ideaBusy)return;ideasLock(true);ideaStatus.textContent='Cargando bandeja…';
    try{
      if(!(await client.access()).admin)throw Error('Sólo el administrador general puede leer esta bandeja.');
      if(!append){ideaOffset=0;$('ideas-list').replaceChildren();}
      const ideas=await client.listIdeas(ideaOffset);ideaOffset+=ideas.length;$('ideas-more').hidden=ideas.length<50;
      for(const idea of ideas){const card=document.createElement('article');card.className='idea-card';const title=document.createElement('strong');title.textContent=idea.team_name+' · '+(idea.plant_id==='polietileno'?'Polietileno':'Sacos');const date=document.createElement('small');date.textContent=new Date(idea.created_at).toLocaleString('es-HN');const note=document.createElement('p');note.textContent=idea.note;const select=document.createElement('select');select.setAttribute('aria-label','Estado de la idea de '+idea.team_name);for(const [value,label] of Object.entries(IDEA_STATES)){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}select.value=idea.status;select.addEventListener('change',async()=>{const previous=idea.status;ideasLock(true);try{await client.updateIdea(idea.id,previous,select.value);idea.status=select.value;ideaStatus.textContent='Estado guardado.';}catch{select.value=previous;ideaStatus.textContent='No se pudo cambiar el estado. Recarga la bandeja antes de reintentar.';}finally{ideasLock(false);}});card.append(title,date,note,select);$('ideas-list').append(card);}
      ideaStatus.textContent=ideaOffset?ideaOffset+' propuestas cargadas.':'Todavía no hay propuestas.';
    }catch(e){ideaStatus.textContent=e.message;}finally{ideasLock(false);}
  }
  $('cloud-ideas-admin').addEventListener('click',()=>void openAdmin());
  $('ideas-refresh').addEventListener('click',()=>void loadIdeas());$('ideas-more').addEventListener('click',()=>void loadIdeas(true));

  const adminDashboard=$('admin-dashboard');
  const adminIsOpen=()=>!adminDashboard.hidden;
  const showAdmin=()=>{setAdminScreenVisible(adminDashboard,true);adminDashboard.scrollTop=0;renderAdminTeams();selectAdminView('overview');};
  const hideAdmin=()=>setAdminScreenVisible(adminDashboard,false);
  const screenCloser={close:hideAdmin};
  registry=createRegistryAdmin($('admin-registry'),{client,onAccessLost:()=>{access={...access,admin:false};render();}});
  function selectAdminView(view){const changed=applyAdminDashboardView(adminDashboard,view);if(changed&&view==='catalog')void registry.open();return changed;}
  function renderAdminTeams(){
    const all=definitions(),plant=$('admin-plant').value;
    $('admin-team-count').textContent=String(all.length);$('admin-tool-count').textContent=String(TEAM_TOOLS.length);$('admin-published-count').textContent=String(rows.filter(row=>row.revision).length);
    const host=$('admin-team-list');host.replaceChildren();
    for(const team of all.filter(t=>!plant||(t.plantId||'sacos')===plant)){
      const card=document.createElement('article');card.className='admin-team-card';const name=document.createElement('h3');name.textContent=team.name;
      const detail=document.createElement('p'),row=rows.find(r=>r.id===team.id);detail.className='hint';detail.textContent=((team.plantId||'sacos')==='polietileno'?'Polietileno':'Sacos')+' · '+(row?.revision?'Publicación '+row.revision:'Copia local');
      const tools=document.createElement('p');tools.textContent=toolsForTeam(team).map(t=>t.name).join(' · ');
      const button=document.createElement('button');button.className='button button-secondary';button.textContent='Abrir vista del equipo';button.addEventListener('click',async()=>{button.disabled=true;try{if(!(await client.access()).admin)throw Error('Vuelve a iniciar sesión como administrador.');if(await getServices().openTeamSpace(team.id))hideAdmin();else throw Error('Guarda la edición pendiente antes de cambiar de equipo.');}catch(e){$('admin-status').textContent=e.message;selectAdminView('inbox');}finally{button.disabled=false;}});const badge=document.createElement('span');badge.className='admin-team-avatar';badge.textContent=team.name.replace(/^Los /i,'').split(' ').slice(0,2).map(word=>word[0]).join('').toUpperCase();card.append(badge,name,detail,tools,button);host.append(card);
    }
    $('admin-team-empty').hidden=host.childElementCount>0;
    const toolsHost=$('admin-tool-list');toolsHost.replaceChildren();for(const tool of TEAM_TOOLS){const card=document.createElement('article');card.className='admin-team-card';const title=document.createElement('h3');title.textContent=tool.name;const text=document.createElement('p');text.textContent=tool.description;const note=document.createElement('p');note.className='hint';note.textContent=tool.scope==='general'?'General · Todos los equipos':'Exclusiva · Cuatro equipos originales de Sacos';const button=document.createElement('button');button.className='button button-secondary';button.textContent='Elegir equipo';button.addEventListener('click',()=>selectAdminView('overview'));card.append(title,text,note,button);toolsHost.append(card);}
  }
  for(const button of adminDashboard.querySelectorAll('[data-admin-view]'))button.addEventListener('click',()=>selectAdminView(button.dataset.adminView));
  for(const button of adminDashboard.querySelectorAll('[data-admin-jump]'))button.addEventListener('click',()=>{selectAdminView(button.dataset.adminJump);adminDashboard.querySelector('[data-admin-view="'+button.dataset.adminJump+'"]')?.focus();});
  $('admin-to-themes').addEventListener('click',()=>window.dispatchEvent(new Event('mn1:open-themes')));
  $('admin-plant').addEventListener('change',renderAdminTeams);let adminOffered=false,adminBusy=false,adminOffset=0,seenCursor=0,myOffset=0;
  const seenKey='mn1.ideas.seen';
  function incoming(summary){
    const unread=Number(summary.unread)||0;$('admin-unread').hidden=unread===0;$('admin-unread').textContent=String(unread);
    $('admin-incoming').hidden=unread===0||adminIsOpen();
    $('admin-incoming').textContent=unread===1?'Nueva solicitud en el buzón':unread+' solicitudes nuevas en el buzón';
  }
  async function pollAdmin(){
    if(!access?.admin||document.hidden||adminBusy)return;
    try{incoming(await client.ideaDashboard(seenCursor));}catch(e){if(['401','403'].includes(e.code)){access={...access,admin:false};$('open-admin-dashboard').hidden=true;$('admin-incoming').hidden=true;hideAdmin();render();}}
  }
  function appendRequest(host,idea,{editable=false}={}){
    const card=document.createElement('article');card.className='idea-card';card.dataset.state=idea.status;
    const title=document.createElement('strong');title.textContent=idea.team_name+' · '+(idea.plant_id==='polietileno'?'Polietileno':'Sacos');
    const date=document.createElement('small');date.textContent=new Date(idea.created_at).toLocaleString('es-HN');
    const note=document.createElement('p');note.textContent=idea.note;
    const badge=document.createElement('span');badge.className='idea-state';badge.textContent=IDEA_STATES[idea.status]||'Pendiente';card.append(title,date,note,badge);
    if(editable){
      const label=document.createElement('label');label.className='field';label.textContent='Cambiar estado';const select=document.createElement('select');select.className='select';
      for(const [value,text] of Object.entries(IDEA_STATES)){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.value=idea.status;
      select.addEventListener('change',async()=>{const previous=idea.status;select.disabled=true;try{await client.updateIdea(idea.id,previous,select.value);idea.status=select.value;badge.textContent=IDEA_STATES[idea.status];$('admin-status').textContent='Estado guardado. El remitente podrá ver el avance.';const summary=await client.ideaDashboard(seenCursor);renderAdminTeams();for(const key of Object.keys(IDEA_STATES))$('count-'+key).textContent=String(summary.counts[key]||0);}catch{select.value=previous;$('admin-status').textContent='No se guardó el cambio. Actualiza la bandeja e inténtalo de nuevo.';}finally{select.disabled=false;}});
      label.append(select);card.append(label);
    }
    if(Array.isArray(idea.history)){const history=document.createElement('ol');history.className='idea-history';for(const item of idea.history){const entry=document.createElement('li');entry.textContent=(IDEA_STATES[item.status]||item.status)+' · '+new Date(item.at).toLocaleString('es-HN');history.append(entry);}card.append(history);}
    host.append(card);
  }
  async function loadAdmin(append=false){
    if(adminBusy)return;adminBusy=true;$('admin-refresh').disabled=true;$('admin-filter').disabled=true;$('admin-more').disabled=true;$('admin-status').textContent='Cargando solicitudes…';$('admin-feedback').textContent='';
    try{
      if(!(await client.access()).admin)throw Error('Esta pantalla es exclusiva del administrador general.');
      const summary=await client.ideaDashboard(seenCursor);for(const key of Object.keys(IDEA_STATES))$('count-'+key).textContent=String(summary.counts[key]||0);
      if(!append){adminOffset=0;$('admin-ideas-list').replaceChildren();}
      const ideas=await client.listIdeas(adminOffset,$('admin-filter').value);adminOffset+=ideas.length;
      for(const idea of ideas)appendRequest($('admin-ideas-list'),idea,{editable:true});
      $('admin-more').hidden=ideas.length<50;$('admin-status').textContent=adminOffset?adminOffset+' solicitudes cargadas.':'No hay solicitudes en este estado.';
      seenCursor=Number(summary.cursor)||0;await getServices().storage.putText(seenKey,String(seenCursor));incoming({...summary,unread:0});
    }catch(e){$('admin-status').textContent=e.message;$('admin-feedback').textContent=e.message;}finally{adminBusy=false;$('admin-refresh').disabled=false;$('admin-filter').disabled=false;$('admin-more').disabled=false;}
  }
  async function openAdmin(){
    try{access=await client.access();if(!access.admin)throw Error('Inicia sesión con tu cuenta principal de administrador.');dialog.close();if(!adminIsOpen())showAdmin();await loadAdmin();}
    catch(e){status(client.session?e.message:'Inicia sesión con tu cuenta principal para abrir el dashboard del buzón.',true);if(!dialog.open)dialog.showModal();if(!client.session){$('cloud-login').open=true;$('cloud-email').focus();}}
  }
  $('cloud-dashboard-access').addEventListener('click',()=>void openAdmin());
  $('settings-admin').addEventListener('click',()=>{ $('web-settings-dialog')?.close();void openAdmin(); });
  $('open-admin-dashboard').addEventListener('click',()=>void openAdmin());$('admin-incoming').addEventListener('click',()=>void openAdmin());
  $('admin-close').addEventListener('click',async()=>{const button=$('admin-close');button.disabled=true;try{if(!(await leaveAdminDashboard(screenCloser,()=>getServices().openPersonalSpace())))$('admin-feedback').textContent='Guarda la edición pendiente antes de abrir la vista de usuario.';}catch{$('admin-status').textContent='No se pudo volver a Mi espacio. Tu trabajo se conserva; inténtalo de nuevo.';}finally{button.disabled=false;}});$('admin-refresh').addEventListener('click',()=>void loadAdmin());$('admin-filter').addEventListener('change',()=>void loadAdmin());$('admin-more').addEventListener('click',()=>void loadAdmin(true));
  for(const button of adminDashboard.querySelectorAll('[data-admin-state]'))button.addEventListener('click',()=>{$('admin-filter').value=button.dataset.adminState;selectAdminView('inbox');void loadAdmin();});
  $('admin-to-inbox').addEventListener('click',()=>{selectAdminView('inbox');$('admin-filter').focus();});
  $('admin-to-accounts').addEventListener('click',()=>{hideAdmin();void openCloud();});
  $('admin-to-about').addEventListener('click',()=>{hideAdmin();$('open-about').click();});
  async function loadMine(append=false){
    if(ideaBusy)return;ideasLock(true);ideaStatus.textContent='Consultando tus solicitudes…';
    try{if(!append){myOffset=0;$('my-ideas-list').replaceChildren();}const device=await getServices().storage.getText('mn1.idea.client');const ideas=device?await client.myIdeas(device,myOffset):[];myOffset+=ideas.length;for(const idea of ideas)appendRequest($('my-ideas-list'),idea);$('my-ideas-more').hidden=ideas.length<50;ideaStatus.textContent=myOffset?myOffset+' solicitudes cargadas.':'Todavía no has enviado solicitudes desde este teléfono.';}catch(e){ideaStatus.textContent=e.message;}finally{ideasLock(false);}
  }
  $('my-ideas-open').addEventListener('click',async()=>{
    try{await getServices().storage.putText(ideaDraftKey(getServices().activeProfileId),$('idea-note').value);$('ideas-form').hidden=true;$('ideas-inbox').hidden=true;$('my-ideas-panel').hidden=false;await loadMine();}catch{ideaStatus.textContent='No se pudo conservar el borrador. No se cambió de pantalla.';}
  });
  $('my-ideas-refresh').addEventListener('click',()=>void loadMine());$('my-ideas-more').addEventListener('click',()=>void loadMine(true));

  async function start() {
    try {
      const raw = await storage.getText(CLOUD_META_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          meta = parsed;
      }
      seenCursor=Number(await storage.getText(seenKey))||0;
      await client.restore();
      await refresh();
    } catch (e) {
      status(e.message, true);
    }
    render();
    setInterval(() => void tick(), 60000);
    setInterval(()=>void pollAdmin(),30000);
    void pollAdmin();
    window.addEventListener("online", schedule);
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) schedule();
    });
    void tick();
  }
  return { start, tick, requestTool:(toolId,teamId)=>{const team=getServices().catalog.find(t=>t.id===teamId);if(!team||isToolEnabledForTeam(toolId,team)||!TEAM_TOOLS.some(t=>t.id===toolId))return false;return openIdeas({toolId,teamId});} };
}
