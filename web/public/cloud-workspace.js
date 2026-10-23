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
export function createCloudWorkspace(getServices) {
  const $ = (id) => document.getElementById(id),
    dialog = $("cloud-dialog"),
    client = new CloudClient(getServices().storage);
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
    getServices().setLocked?.(value);
  };
  const definitions = () => getServices().catalog;
  function render() {
    const logged = Boolean(client.session);
    $("cloud-login").hidden = logged;
    $("cloud-connected").hidden = false;
    $("cloud-logout").hidden = !logged;
    $("cloud-password-settings").hidden = !logged;
    $("cloud-admin").hidden = !access?.admin;
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
    if (!access.member) {
      rows = [];
      status(
        "Cuenta sin equipo asignado. Pide al administrador general que autorice tu correo.",
        true,
      );
    } else rows = client.session ? await client.list() : await client.publicList();
    render();
  }
  async function action(fn) {
    if (busy) return;
    lock(true);
    try {
      if (!(await getServices().flush()))
        throw Error("Corrige y guarda el borrador antes de sincronizar.");
      await fn();
      if (client.session) await refresh();
    } catch (e) {
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
      const state = await receivePacket(getServices().storage, client, row);
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
    });
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
        access = null;
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
  async function start() {
    try {
      const raw = await storage.getText(CLOUD_META_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          meta = parsed;
      }
      await client.restore();
      await refresh();
    } catch (e) {
      status(e.message, true);
    }
    render();
    setInterval(() => void tick(), 60000);
    window.addEventListener("online", schedule);
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) schedule();
    });
    void tick();
  }
  return { start, tick };
}
