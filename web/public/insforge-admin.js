import { createClient } from '@insforge/sdk';

let client;
const api = () => client ||= createClient({baseUrl: INSFORGE_BASE_URL, anonKey: INSFORGE_ANON_KEY});

function unwrap(result) {
  if (result.error) throw new Error(result.error.message || 'No se pudo conectar con la administración.');
  return result.data;
}

// Esta conexión sólo gestiona el acceso del creador y un aviso de texto.
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
  async notice() {
    const data = unwrap(await api().database.rpc('st_site_notice_read'));
    const row = Array.isArray(data) ? data[0] : data;
    return {message: typeof row?.message === 'string' ? row.message : '', revision: Number(row?.revision) || 0};
  },
  async saveNotice(revision, message) {
    return unwrap(await api().database.rpc('st_site_notice_set', {expected_revision:revision, new_message:message}));
  },
});
