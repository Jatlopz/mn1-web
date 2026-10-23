import {
  normalizeWorkspaceState,
  profileCatalogForWorkspace,
  normalizeTemplate,
  PROFILE_IDS,
  MAX_TOTAL_TEAMS,
} from "./profiles.js";
import {
  imageKeyForProfile,
  coverKeyForProfile,
  WORKSPACE_KEYS,
} from "./storage.js";
import {
  isPngDataUrl,
  pngBase64FromDataUrl,
  pngDataUrlFromBase64,
} from "./bridge.js";
import {
  REPORT_PREFS_KEY,
  REPORT_STYLES_KEY,
  normalizeReportPreferences,
  reportLogoKey,
} from "./meeting-report.js";
export const CLOUD_META_KEY = "mn1.cloud.meta";
export const CLOUD_PENDING_KEY = "mn1.cloud.pending";
export const originalBackupKey = (id) =>
  "mn1.cloud.backup." + id.replaceAll("-", "").slice(0, 32);
const recordKeys = [WORKSPACE_KEYS.state, REPORT_PREFS_KEY, REPORT_STYLES_KEY];
async function records(storage) {
  return Object.fromEntries(
    await Promise.all(
      recordKeys.map(async (k) => [k, await storage.getText(k)]),
    ),
  );
}
export async function recoverPendingReceive(storage) {
  const raw = await storage.getText(CLOUD_PENDING_KEY);
  if (!raw) return false;
  const journal = JSON.parse(raw);
  if (
    journal.version !== 1 ||
    !journal.before ||
    !normalizeWorkspaceState(JSON.parse(journal.before[WORKSPACE_KEYS.state]))
  )
    throw Error(
      "Respaldo de sincronización ilegible. No se reemplazó ningún dato.",
    );
  for (const k of recordKeys) {
    const value = journal.before[k];
    if (value !== null && typeof value !== "string")
      throw Error("Registro de recuperación no válido.");
    if (value === null) await storage.removeText(k);
    else await storage.putText(k, value);
  }
  await storage.removeText(CLOUD_PENDING_KEY);
  return true;
}
async function commitRecords(storage, before, next) {
  for (const k of recordKeys)
    if ((await storage.getText(k)) !== before[k])
      throw Error(
        "Los datos locales cambiaron durante la descarga. Se conserva tu copia.",
      );
  await storage.putText(
    CLOUD_PENDING_KEY,
    JSON.stringify({ version: 1, before }),
  );
  try {
    for (const k of recordKeys) await storage.putText(k, next[k]);
    await storage.removeText(CLOUD_PENDING_KEY);
  } catch (error) {
    try {
      await recoverPendingReceive(storage);
    } catch {
      throw Error(
        "No se completó la recepción. Hay una copia de recuperación pendiente; vuelve a abrir la app cuando el almacenamiento esté disponible.",
      );
    }
    throw error;
  }
}
export async function preserveOriginal(storage, id) {
  const key = originalBackupKey(id);
  if (await storage.getText(key)) return;
  const state = normalizeWorkspaceState(
    await json(storage, WORKSPACE_KEYS.state, null),
  );
  if (!state?.profiles[id]) return;
  const prefs = await json(storage, REPORT_PREFS_KEY, {}),
    styles = await json(storage, REPORT_STYLES_KEY, {});
  const profile = state.profiles[id],
    refs = {
      image: profile.imageKey,
      cover: profile.cardAppearance.imageKey,
      logo: prefs.logoKeys?.[id],
    };
  const saved = {};
  for (const [kind, source] of Object.entries(refs)) {
    if (!source) continue;
    const value = await storage.getText(source);
    if (!value) throw Error("Falta una imagen local; no se reemplazó nada.");
    const target =
      kind === "image"
        ? imageKeyForProfile(id, "cloudoriginal")
        : kind === "cover"
          ? coverKeyForProfile(id, "cloudoriginal")
          : reportLogoKey(id, "cloudoriginal");
    await storage.putText(target, value);
    saved[kind] = target;
  }
  profile.imageKey = saved.image || null;
  profile.cardAppearance.imageKey = saved.cover || null;
  prefs.logoKeys = { ...prefs.logoKeys };
  if (saved.logo) prefs.logoKeys[id] = saved.logo;
  await storage.putText(
    key,
    JSON.stringify({ state, prefs, styles, at: new Date().toISOString() }),
  );
}
export async function restoreOriginal(storage, id) {
  const backup = await json(storage, originalBackupKey(id), null);
  if (!backup?.state?.profiles?.[id])
    throw Error("No hay una copia original local para este equipo.");
  const before = await records(storage),
    state = normalizeWorkspaceState(JSON.parse(before[WORKSPACE_KEYS.state]));
  if (!state) throw Error("Workspace no válido.");
  const original = normalizeWorkspaceState(backup.state);
  if (!original?.profiles[id]) throw Error("Respaldo no válido.");
  if (!PROFILE_IDS.includes(id)) {
    state.customProfiles = state.customProfiles.filter((t) => t.id !== id);
    const definition = original.customProfiles.find((t) => t.id === id);
    if (definition) state.customProfiles.push(definition);
  }
  const savedProfile = original.profiles[id],
    copies = {};
  const references = {
    image: savedProfile.imageKey,
    cover: savedProfile.cardAppearance.imageKey,
    logo: backup.prefs.logoKeys?.[id],
  };
  for (const [kind, source] of Object.entries(references)) {
    if (!source) continue;
    const value = await storage.getText(source);
    if (!value)
      throw Error(
        "La imagen original no está disponible. No se reemplazó la plantilla.",
      );
    const stamp =
      Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const key =
      kind === "image"
        ? imageKeyForProfile(id, stamp)
        : kind === "cover"
          ? coverKeyForProfile(id, stamp)
          : reportLogoKey(id, stamp);
    await storage.putText(key, value);
    copies[kind] = key;
  }
  state.profiles[id] = {
    ...savedProfile,
    imageKey: copies.image || null,
    cardAppearance: {
      ...savedProfile.cardAppearance,
      imageKey: copies.cover || null,
    },
  };
  const prefs = before[REPORT_PREFS_KEY]
      ? JSON.parse(before[REPORT_PREFS_KEY])
      : {},
    styles = before[REPORT_STYLES_KEY]
      ? JSON.parse(before[REPORT_STYLES_KEY])
      : {};
  styles[id] =
    backup.styles[id] ||
    normalizeReportPreferences(
      { ...backup.prefs, teamId: id },
      profileCatalogForWorkspace(original),
    );
  prefs.logoKeys = { ...prefs.logoKeys };
  if (copies.logo) prefs.logoKeys[id] = copies.logo;
  else delete prefs.logoKeys[id];
  await commitRecords(storage, before, {
    [WORKSPACE_KEYS.state]: JSON.stringify(state),
    [REPORT_PREFS_KEY]: JSON.stringify(prefs),
    [REPORT_STYLES_KEY]: JSON.stringify(styles),
  });
  return state;
}

const json = async (storage, key, fallback) => {
  const raw = await storage.getText(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw Error("Hay datos locales ilegibles. No se reemplazaron.");
  }
};
export const canPublish = (access, id) =>
  access?.admin === true || access?.teams?.includes(id) === true;
export function validateRemoteTeam(row) {
  const p = row?.data;
  if (
    !row ||
    !Number.isInteger(row.revision) ||
    row.revision < 1 ||
    p?.schema !== 1 ||
    p.definition?.id !== row.id ||
    !/^(champions|espartanos|super-guerreros|indestructibles|custom-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.test(
      row.id,
    ) ||
    typeof p.definition.name !== "string" ||
    !p.definition.name.trim() ||
    p.definition.name.length > 60 ||
    !/^#[a-f0-9]{6}$/i.test(p.definition.color) ||
    !p.template ||
    typeof p.template !== "object" ||
    Array.isArray(p.template) ||
    !p.assets ||
    typeof p.assets !== "object"
  )
    throw Error("El equipo de nube no es válido.");
  for (const k of ["image", "cover", "logo"])
    if (
      p.assets[k] != null &&
      !new RegExp("^" + row.id + "/[a-f0-9-]{36}\\.png$").test(p.assets[k])
    )
      throw Error("Imagen remota no válida.");
  return p;
}
export function pngBytes(base64) {
  const url = pngDataUrlFromBase64(base64);
  if (!isPngDataUrl(url)) throw Error("Imagen local no válida.");
  const binary = atob(base64);
  if (binary.length > 6291456) throw Error("La imagen supera6MB.");
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
export function bytesPngBase64(bytes) {
  if (
    bytes.length < 24 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some((b, i) => bytes[i] !== b)
  )
    throw Error("La nube no devolvió un PNG válido.");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const b = btoa(binary);
  if (!isPngDataUrl(pngDataUrlFromBase64(b)))
    throw Error("PNG remoto no válido.");
  return b;
}
export async function localTeamPacket(storage, id) {
  const state = normalizeWorkspaceState(
    await json(storage, WORKSPACE_KEYS.state, null),
  );
  if (!state) throw Error("Workspace local no válido.");
  const definition = profileCatalogForWorkspace(state).find((t) => t.id === id);
  if (!definition) throw Error("Equipo local no disponible.");
  const prefs = await json(storage, REPORT_PREFS_KEY, {}),
    styles = await json(storage, REPORT_STYLES_KEY, {});
  const report = normalizeReportPreferences(
    { ...(prefs.teamId === id ? prefs : {}), ...styles[id], teamId: id },
    [definition],
  );
  const template = normalizeTemplate(state.profiles[id], id, {
    customProfiles: state.customProfiles,
  });
  const keys = {
    image: template.imageKey,
    cover: template.cardAppearance.imageKey,
    logo: prefs.logoKeys?.[id] || null,
  };
  const fingerprint = JSON.stringify({
    definition,
    template: { ...template, updatedAt: "" },
    report: {
      frame: report.frame,
      frameColor: report.frameColor,
      heading: report.heading,
      showDate: report.showDate,
      watermark: report.watermark,
      watermarkOpacity: report.watermarkOpacity,
      watermarkPosition: report.watermarkPosition,
    },
    keys,
  });
  return { id, definition, template, report, keys, fingerprint };
}
export async function publishPacket(
  client,
  storage,
  packet,
  expected,
  previous = {},
) {
  const assets = { image: null, cover: null, logo: null },
    hashes = {};
  for (const kind of Object.keys(assets)) {
    const key = packet.keys[kind];
    if (!key) continue;
    const data = await storage.getText(key);
    if (!data) throw Error("Falta una imagen local. No se publicó el equipo.");
    const bytes = pngBytes(data);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    hashes[kind] = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const existing = previous.assetPaths?.[kind];
    if (
      previous.assetHashes?.[kind] === hashes[kind] &&
      typeof existing === "string" &&
      existing.startsWith(packet.id + "/")
    ) {
      assets[kind] = existing;
      continue;
    }
    const object = packet.id + "/" + crypto.randomUUID() + ".png";
    await client.upload(object, bytes);
    assets[kind] = object;
  }
  const template = {
    ...packet.template,
    imageKey: null,
    cardAppearance: { ...packet.template.cardAppearance, imageKey: null },
  };
  const report = { ...packet.report, logoKeys: {} };
  const revision = await client.publish(packet.id, expected, {
    schema: 1,
    definition: packet.definition,
    template,
    report,
    assets,
  });
  return { revision, assetPaths: assets, assetHashes: hashes };
}
export async function receivePacket(storage, client, row) {
  const p = validateRemoteTeam(row);
  const before = await records(storage);
  const state = normalizeWorkspaceState(
    before[WORKSPACE_KEYS.state]
      ? JSON.parse(before[WORKSPACE_KEYS.state])
      : null,
  );
  if (!state) throw Error("Workspace no válido.");
  const existing = profileCatalogForWorkspace(state).find(
    (t) => t.id === row.id,
  );
  if (!existing && !PROFILE_IDS.includes(row.id)) {
    if (profileCatalogForWorkspace(state).length >= MAX_TOTAL_TEAMS)
      throw Error("No caben más equipos en este teléfono.");
    state.customProfiles.push(p.definition);
    if (!profileCatalogForWorkspace(state).some((t) => t.id === row.id))
      throw Error("Definición de equipo no válida.");
  }
  if (existing && !PROFILE_IDS.includes(row.id))
    state.customProfiles = state.customProfiles.map((t) =>
      t.id === row.id ? p.definition : t,
    );
  const assets = { image: null, cover: null, logo: null };
  for (const kind of Object.keys(assets)) {
    if (!p.assets[kind]) continue;
    const base64 = bytesPngBase64(await client.download(p.assets[kind]));
    const stamp =
      Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const key =
      kind === "image"
        ? imageKeyForProfile(row.id, stamp)
        : kind === "cover"
          ? coverKeyForProfile(row.id, stamp)
          : reportLogoKey(row.id, stamp);
    await storage.putText(key, base64);
    assets[kind] = key;
  }
  // Versioned image keys are written before publishing state. Prior originals remain intact.
  const template = {
    ...p.template,
    imageKey: assets.image,
    starterImageInitialized: true,
    cardAppearance: { ...p.template.cardAppearance, imageKey: assets.cover },
  };
  state.profiles[row.id] = normalizeTemplate(template, row.id, {
    customProfiles: state.customProfiles,
  });
  const prefs = await json(storage, REPORT_PREFS_KEY, {}),
    styles = await json(storage, REPORT_STYLES_KEY, {});
  await preserveOriginal(storage, row.id);
  const teamReport = normalizeReportPreferences(
    { ...p.report, teamId: row.id, logoKeys: {} },
    profileCatalogForWorkspace(state),
  );
  styles[row.id] = teamReport;
  const logos = { ...prefs.logoKeys };
  if (assets.logo) logos[row.id] = assets.logo;
  else delete logos[row.id];
  await commitRecords(storage, before, {
    [REPORT_STYLES_KEY]: JSON.stringify(styles),
    [REPORT_PREFS_KEY]: JSON.stringify({ ...prefs, logoKeys: logos }),
    [WORKSPACE_KEYS.state]: JSON.stringify(state),
  });
  return state;
}
