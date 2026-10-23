// Public client configuration, not a secret. Permissions are enforced in PostgreSQL.
export const CLOUD_CONFIG = Object.freeze({
  url: "https://wnfqqqorktjiruxlzvlr.supabase.co",
  key: "sb_publishable_R3Ct93XQ0mOPeH1ZeVxxnA_LB9MiwCk",
});
export const CLOUD_SESSION_KEY = "mn1.cloud.session";
export class CloudError extends Error {
  constructor(message, code = "cloud_error") {
    super(message);
    this.code = code;
  }
}
export class CloudClient {
  constructor(
    storage,
    { config = CLOUD_CONFIG, fetcher = globalThis.fetch.bind(globalThis) } = {},
  ) {
    this.storage = storage;
    this.config = config;
    this.fetcher = fetcher;
    this.session = null;
    this.refreshing = null;
  }
  async restore() {
    try {
      const raw = await this.storage.getText(CLOUD_SESSION_KEY);
      this.session = raw ? JSON.parse(raw) : null;
    } catch {
      this.session = null;
    }
    return Boolean(this.session?.refresh_token);
  }
  async saveSession(value) {
    if (!value?.access_token || !value?.refresh_token || !value?.user?.id)
      throw new CloudError("La sesión no es válida.");
    await this.storage.putText(CLOUD_SESSION_KEY, JSON.stringify(value));
    this.session = value;
  }
  async token() {
    if (!this.session)
      throw new CloudError("Inicia sesión para sincronizar.", "login");
    if ((this.session.expires_at || 0) * 1000 > Date.now() + 60000)
      return this.session.access_token;
    if (!this.refreshing)
      this.refreshing = (async () => {
        try {
          const value = await this.request(
            "/auth/v1/token?grant_type=refresh_token",
            {
              auth: false,
              body: { refresh_token: this.session.refresh_token },
            },
          );
          await this.saveSession(value);
          return value.access_token;
        } catch (e) {
          if (e.code === "401" || e.code === "400") {
            this.session = null;
            await this.storage.removeText(CLOUD_SESSION_KEY);
          }
          throw e;
        } finally {
          this.refreshing = null;
        }
      })();
    return this.refreshing;
  }
  async request(
    path,
    { method = "POST", body, auth = true, blob = false, raw = false } = {},
  ) {
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(this.config.url)
    )
      throw new CloudError("Servidor no válido.");
    const headers = { apikey: this.config.key };
    if (auth) headers.Authorization = "Bearer " + (await this.token());
    if (body !== undefined)
      headers["Content-Type"] = raw ? "image/png" : "application/json";
    let result;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
    try {
      result = await this.fetcher(this.config.url + path, {
        method,
        headers,
        body:
          body === undefined ? undefined : raw ? body : JSON.stringify(body),
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
        throw new CloudError(
        "Sin conexión con la nube. Tu copia local se conserva.",
        "offline",
      );
    }
    if (!result.ok) {
      let code = String(result.status);
      let authCode = "";
      try {
        const error = await result.json();
        if (error.code === "40001") code = "conflict";
        authCode = error.code || error.error_code || "";
      } catch {}
      throw new CloudError(
        path.startsWith("/auth/v1/token?grant_type=password") && (authCode === "invalid_credentials" || result.status === 400)
          ? "Correo o contraseña incorrectos. Revisa tus datos e intenta de nuevo."
          : result.status === 429
          ? "El servidor recibió demasiados intentos. Espera un momento antes de volver a entrar."
          : code === "conflict"
          ? "El equipo cambió en otro teléfono. Revisa las versiones antes de publicar."
          : result.status === 401
            ? "Tu sesión venció. Vuelve a entrar."
            : result.status === 403
              ? "Tu cuenta no tiene permiso para esta acción."
              : "No se completó la operación en la nube. Revisa tus datos y permisos.",
        code,
      );
    }
    if (blob) {
      const length = Number(result.headers.get("content-length"));
      if (length > 6291456) throw new CloudError("Imagen demasiado grande.");
      const b = await result.arrayBuffer();
      if (b.byteLength > 6291456)
        throw new CloudError("Imagen demasiado grande.");
      return new Uint8Array(b);
    }
    if (result.status === 204) return null;
    const text = await result.text();
    return text ? JSON.parse(text) : null;
    } finally { clearTimeout(timeout); }
  }
  async login(email, password) {
    const value = await this.request("/auth/v1/token?grant_type=password", {
      auth: false,
      body: { email: email.trim().toLowerCase(), password },
    });
    await this.saveSession(value);
    return this.access();
  }
  async logout() {
    try {
      if (this.session) await this.request("/auth/v1/logout?scope=local", {});
    } finally {
      this.session = null;
      await this.storage.removeText(CLOUD_SESSION_KEY);
    }
  }
  access() {
    return this.request("/rest/v1/rpc/mn1_access", { body: {} });
  }
  list() {
    return this.request(
      "/rest/v1/mn1_teams?select=id,revision,data,updated_at&order=id",
      { method: "GET" },
    );
  }
  publish(id, revision, data) {
    return this.request("/rest/v1/rpc/mn1_publish", {
      body: { p_team: id, p_expected: revision, p_data: data },
    });
  }
  grant(team, email, enabled) {
    return this.request("/rest/v1/rpc/mn1_grant_editor", {
      body: {
        p_team: team,
        p_email: email.trim().toLowerCase(),
        p_enabled: enabled,
      },
    });
  }
  createAccount(email, password) {
    return this.request("/functions/v1/create-team-account", {
      body: { email, password },
    });
  }
  changePassword(password) {
    if (password.length < 12 || password.length > 128)
      throw new CloudError("Usa una contraseña de 12 a 128 caracteres.");
    return this.request("/auth/v1/user", { method: "PUT", body: { password } });
  }
  upload(path, bytes) {
    return this.request("/storage/v1/object/mn1-team-art/" + path, {
      body: bytes,
      raw: true,
    });
  }
  download(path) {
    return this.request(
      "/storage/v1/object/authenticated/mn1-team-art/" + path,
      { method: "GET", blob: true },
    );
  }
}
