import { createClient } from '@insforge/sdk';

let client;
const api = () => client ||= createClient({baseUrl: INSFORGE_BASE_URL, anonKey: INSFORGE_ANON_KEY});
const NOTICE_CACHE_KEY = 'supertools.site-notice.v2';
const NOTICE_CACHE_TTL_MS = 60 * 60 * 1000;

export function readSiteNoticeCache(storage, now = Date.now()) {
  if (!storage) return null;
  const cached = JSON.parse(storage.getItem(NOTICE_CACHE_KEY) || 'null');
  if (!cached || typeof cached.message !== 'string' || cached.message.length > 240 ||
      !Number.isInteger(cached.revision) || !Number.isFinite(cached.at) ||
      cached.at > now || now - cached.at >= NOTICE_CACHE_TTL_MS) return null;
  return {message:cached.message, revision:cached.revision};
}

export function writeSiteNoticeCache(storage, notice, now = Date.now()) {
  storage?.setItem(NOTICE_CACHE_KEY, JSON.stringify({message:notice.message, revision:notice.revision, at:now}));
}

function unwrap(result) {
  if (result.error) throw new Error(result.error.message || 'No se pudo conectar con la administración.');
  return result.data;
}

// Esta conexión gestiona el acceso del creador, un aviso de texto y el mural.
// Perfiles, logos, artes y fotos no se envían a InsForge.
export const siteAdmin = Object.freeze({
  async status() {
    const identityResult = await api().auth.getCurrentUser();
    if (identityResult.error && /unauthori[sz]ed|not authenticated|no session|no refresh token|401/i.test(identityResult.error.message || ''))
      return {authorized:false, email:null};
    const identity = unwrap(identityResult);
    if (!identity?.user?.id) return {authorized:false, email:null};
    const authorized = unwrap(await api().database.rpc('st_admin_allowed'));
    return {authorized: authorized === true, email: identity.user.email || null};
  },
  async requestCode(email) {
    unwrap(await api().auth.signInWithOtp({email: String(email).trim()}));
  },
  async verifyCode(email, otp) {
    unwrap(await api().auth.verifyOtp({email: String(email).trim(), otp: String(otp).trim()}));
    return this.status();
  },
  async signOut() { unwrap(await api().auth.signOut()); },
  async notice({force=false, storage=globalThis.localStorage}={}) {
    if (!force) {
      try { const cached=readSiteNoticeCache(storage); if (cached) return cached; }
      catch { /* La lectura remota sigue disponible si el almacenamiento local falla. */ }
    }
    const data = unwrap(await api().database.rpc('st_site_notice_read'));
    const row = Array.isArray(data) ? data[0] : data;
    const notice={message: typeof row?.message === 'string' ? row.message : '', revision: Number(row?.revision) || 0};
    try { writeSiteNoticeCache(storage, notice); } catch { /* Sin caché local. */ }
    return notice;
  },
  async saveNotice(revision, message) {
    return unwrap(await api().database.rpc('st_site_notice_set', {expected_revision:revision, new_message:message}));
  },
});

// El mural usa la misma sesión InsForge, pero sus permisos se comprueban en RPC.
export const assignmentBoard = Object.freeze({
  async identity() {
    const result=await api().auth.getCurrentUser();
    if(result.error && /unauthori[sz]ed|not authenticated|no session|no refresh token|401/i.test(result.error.message||''))return null;
    return unwrap(result)?.user||null;
  },
  async requestCode(email){return siteAdmin.requestCode(email);},
  async verifyCode(email,otp){unwrap(await api().auth.verifyOtp({email:String(email).trim(),otp:String(otp).trim()}));return this.identity();},
  async feed(archived=false,offset=0){return unwrap(await api().database.rpc('st_board_feed',{p_archived:archived,p_offset:offset}));},
  async save(id,revision,draft){return unwrap(await api().database.rpc('st_board_save',{p_id:id,p_expected:revision,p_draft:draft}));},
  async publishers(){return unwrap(await api().database.rpc('st_board_publishers'));},
  async grant(email,allowed){return unwrap(await api().database.rpc('st_board_grant',{p_email:email,p_allowed:allowed}));},
});

export const personnelCatalog = Object.freeze({
  async read(plantId) { return unwrap(await api().database.rpc('st_staff_read', {p_plant:plantId})); },
  async save(draft) { return unwrap(await api().database.rpc('st_staff_save', {p_id:draft.id,p_expected:draft.revision,p_plant:draft.plantId,p_name:draft.name,p_code:draft.code,p_active:draft.active,p_process_codes:draft.processes})); },
});

export const loomSharing = Object.freeze({
 async read(plant,monday){
  return unwrap(await api().database.rpc('st_loom_read',{p_plant:plant,p_monday:monday}));
 },
 async publish(team,monday,revision,payload){
  return unwrap(await api().database.rpc('st_loom_publish',{
   p_plant:team.plantId,p_monday:monday,p_team:team.id,p_name:team.name,p_expected:revision,p_payload:payload
  }));
 }
});
