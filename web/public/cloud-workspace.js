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
    $("cloud-login").hidden = logged;
    $("cloud-connected").hidden = false;
    $("cloud-logout").hidden = !logged;
    $("cloud-password-settings").hidden = !logged;
    $('open-admin-dashboard').hidden=!access?.admin;
    if(!access?.admin){$('admin-incoming').hidden=true;$('admin-unread').hidden=true;$('admin-ideas-list').replaceChildren();if(adminDashboard.open)adminDashboard.close();}
    if(access?.admin&&!adminOffered&&!getServices().isEditing?.()){adminOffered=true;queueMicrotask(()=>void openAdmin());}
    $("cloud-admin").hidden = !access?.admin;
    $("cloud-ideas-admin").hidden = !access?.admin || !IDEAS_ENABLED;
    $("cloud-account").textContent = logged
      ? (client.session.user?.email || "Cuenta conectada") +
        (access?.admin ? " · Administrador general" : "")
      : "Recepción automática · Sin cuenta";
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
          ? "Cuenta conectada. Publica o recibe una primera versión para vincular cada equipo."
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
        status("Sesión cerrada. Seguirás recibiendo los equipos publicados sin cuenta.");
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
  const ideasDialog=$('ideas-dialog'),ideaStatus=$('ideas-status');
  let ideaBusy=false,ideaRequest=null,ideaOffset=0;
  const ideaDraftKey=id=>'mn1.idea.draft.'+id;
  const ideaRequestKey=id=>'mn1.idea.req.'+id;
  const ideasLock=value=>{ideaBusy=value;for(const control of ideasDialog.querySelectorAll('button,input,select,textarea'))control.disabled=value;$('idea-send').disabled=value||!IDEAS_ENABLED;};
  $('ideas-close').addEventListener('click',()=>{if(!ideaBusy)ideasDialog.close();});
  ideasDialog.addEventListener('cancel',event=>{if(ideaBusy)event.preventDefault();});
  $('open-ideas').addEventListener('click',async()=>{
    const services=getServices(),team=services.catalog.find(t=>t.id===services.activeProfileId);
    if(!team)return;ideaStatus.textContent=IDEAS_ENABLED?'':'Buzón preparado. El envío estará disponible cuando se active la nube de ideas.';ideaRequest=null;
    $('my-ideas-panel').hidden=true;$('ideas-form').hidden=false;$('ideas-inbox').hidden=true;$('ideas-team').textContent='Equipo: '+team.name;
    $('idea-note').value='';ideasDialog.showModal();ideasLock(true);
    try{$('idea-note').value=await services.storage.getText(ideaDraftKey(team.id))||'';}catch{ideaStatus.textContent='No se pudo leer tu borrador anterior.';}finally{ideasLock(false);}
  });
  $('idea-note').addEventListener('input',()=>{ideaRequest=null;});
  ideasDialog.addEventListener('close',()=>{
    if(!$('ideas-form').hidden){const id=getServices().activeProfileId;void getServices().storage.putText(ideaDraftKey(id),$('idea-note').value).catch(()=>{});}
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

  const adminDashboard=$('admin-dashboard');let adminOffered=false,adminBusy=false,adminOffset=0,seenCursor=0,myOffset=0;
  const seenKey='mn1.ideas.seen';
  function incoming(summary){
    const unread=Number(summary.unread)||0;$('admin-unread').hidden=unread===0;$('admin-unread').textContent=String(unread);
    $('admin-incoming').hidden=unread===0||adminDashboard.open;
    $('admin-incoming').textContent=unread===1?'Nueva solicitud en el buzón':unread+' solicitudes nuevas en el buzón';
  }
  async function pollAdmin(){
    if(!access?.admin||document.hidden||adminBusy)return;
    try{incoming(await client.ideaDashboard(seenCursor));}catch(e){if(['401','403'].includes(e.code)){access={...access,admin:false};$('open-admin-dashboard').hidden=true;$('admin-incoming').hidden=true;adminDashboard.close();render();}}
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
      select.addEventListener('change',async()=>{const previous=idea.status;select.disabled=true;try{await client.updateIdea(idea.id,previous,select.value);idea.status=select.value;badge.textContent=IDEA_STATES[idea.status];$('admin-status').textContent='Estado guardado. El remitente podrá ver el avance.';const summary=await client.ideaDashboard(seenCursor);for(const key of Object.keys(IDEA_STATES))$('count-'+key).textContent=String(summary.counts[key]||0);}catch{select.value=previous;$('admin-status').textContent='No se guardó el cambio. Actualiza la bandeja e inténtalo de nuevo.';}finally{select.disabled=false;}});
      label.append(select);card.append(label);
    }
    if(Array.isArray(idea.history)){const history=document.createElement('ol');history.className='idea-history';for(const item of idea.history){const entry=document.createElement('li');entry.textContent=(IDEA_STATES[item.status]||item.status)+' · '+new Date(item.at).toLocaleString('es-HN');history.append(entry);}card.append(history);}
    host.append(card);
  }
  async function loadAdmin(append=false){
    if(adminBusy)return;adminBusy=true;$('admin-refresh').disabled=true;$('admin-filter').disabled=true;$('admin-more').disabled=true;$('admin-status').textContent='Cargando solicitudes…';
    try{
      if(!(await client.access()).admin)throw Error('Esta pantalla es exclusiva del administrador general.');
      const summary=await client.ideaDashboard(seenCursor);for(const key of Object.keys(IDEA_STATES))$('count-'+key).textContent=String(summary.counts[key]||0);
      if(!append){adminOffset=0;$('admin-ideas-list').replaceChildren();}
      const ideas=await client.listIdeas(adminOffset,$('admin-filter').value);adminOffset+=ideas.length;
      for(const idea of ideas)appendRequest($('admin-ideas-list'),idea,{editable:true});
      $('admin-more').hidden=ideas.length<50;$('admin-status').textContent=adminOffset?adminOffset+' solicitudes cargadas.':'No hay solicitudes en este estado.';
      seenCursor=Number(summary.cursor)||0;await getServices().storage.putText(seenKey,String(seenCursor));incoming({...summary,unread:0});
    }catch(e){$('admin-status').textContent=e.message;}finally{adminBusy=false;$('admin-refresh').disabled=false;$('admin-filter').disabled=false;$('admin-more').disabled=false;}
  }
  async function openAdmin(){
    try{if(!(await client.access()).admin)throw Error('Inicia sesión con tu cuenta principal de administrador.');dialog.close();if(!adminDashboard.open)adminDashboard.showModal();await loadAdmin();}
    catch(e){status(e.message,true);if(!dialog.open)dialog.showModal();}
  }
  $('cloud-dashboard-access').addEventListener('click',()=>void openAdmin());
  $('settings-admin').addEventListener('click',()=>{ $('web-settings-dialog')?.close();void openAdmin(); });
  $('open-admin-dashboard').addEventListener('click',()=>void openAdmin());$('admin-incoming').addEventListener('click',()=>void openAdmin());
  $('admin-close').addEventListener('click',()=>adminDashboard.close());$('admin-refresh').addEventListener('click',()=>void loadAdmin());$('admin-filter').addEventListener('change',()=>void loadAdmin());$('admin-more').addEventListener('click',()=>void loadAdmin(true));
  for(const button of adminDashboard.querySelectorAll('[data-admin-state]'))button.addEventListener('click',()=>{$('admin-filter').value=button.dataset.adminState;void loadAdmin();});
  $('admin-to-inbox').addEventListener('click',()=>{$('admin-inbox').scrollIntoView({block:'start'});$('admin-filter').focus();});
  $('admin-to-accounts').addEventListener('click',()=>{adminDashboard.close();void openCloud();});
  $('admin-to-about').addEventListener('click',()=>{adminDashboard.close();$('open-about').click();});
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
  return { start, tick };
}
