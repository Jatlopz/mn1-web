import test from "node:test";
import assert from "node:assert/strict";
import { CloudClient } from "../public/cloud-client.js";
import { createDefaultWorkspace } from "../public/profiles.js";
import {
  localTeamPacket,
  publishPacket,
  receivePacket,
  canPublish,
  validateRemoteTeam,
  bytesPngBase64,
} from "../public/cloud-model.js";
import { WORKSPACE_KEYS } from "../public/storage.js";
import {
  REPORT_PREFS_KEY,
  REPORT_STYLES_KEY,
} from "../public/meeting-report.js";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const vault = () => {
  const data = new Map();
  return {
    getText: async (k) => data.get(k) ?? null,
    putText: async (k, v) => data.set(k, v),
    removeText: async (k) => data.delete(k),
    data,
  };
};
test("permissions allow general administrator and only assigned team editors", () => {
  assert.equal(canPublish({ admin: true }, "champions"), true);
  assert.equal(canPublish({ teams: ["champions"] }, "champions"), true);
  assert.equal(canPublish({ teams: ["champions"] }, "espartanos"), false);
  assert.equal(canPublish(null, "champions"), false);
});
test("two separate phones exchange team original, cover and logo without sharing report photo", async () => {
  const a = vault(),
    b = vault(),
    initial = createDefaultWorkspace();
  initial.profiles.indestructibles.imageKey =
    "mn1.workspace.image.indestructibles.fixture";
  initial.profiles.indestructibles.imageWidth = 1;
  initial.profiles.indestructibles.imageHeight = 1;
  initial.profiles.indestructibles.hour = "09:30";
  await a.putText(WORKSPACE_KEYS.state, JSON.stringify(initial));
  await a.putText(initial.profiles.indestructibles.imageKey, png);
  await a.putText("mn1.report.logo.fixture", png);
  await a.putText(
    REPORT_PREFS_KEY,
    JSON.stringify({
      teamId: "indestructibles",
      logoKeys: { indestructibles: "mn1.report.logo.fixture" },
      frameColor: "#58a6ff",
    }),
  );
  await a.putText("mn1.report.photo", "DO_NOT_UPLOAD_CAPTURE");
  const old = createDefaultWorkspace();
  old.activeProfileId = "champions";
  await b.putText(WORKSPACE_KEYS.state, JSON.stringify(old));
  const files = new Map();
  let remote;
  const server = {
    upload: async (k, v) => files.set(k, v),
    publish: async (id, expected, data) => {
      assert.equal(expected, 0);
      remote = { id, revision: 1, data };
      return 1;
    },
    download: async (k) => files.get(k),
  };
  const packet = await localTeamPacket(a, "indestructibles");
  await publishPacket(server, a, packet, 0);
  assert.equal(files.size, 2);
  assert.ok(!JSON.stringify(remote).includes("DO_NOT_UPLOAD_CAPTURE"));
  const next = await receivePacket(b, server, remote);
  assert.equal(next.activeProfileId, "champions");
  assert.equal(next.profiles.indestructibles.hour, "09:30");
  assert.equal(await b.getText(next.profiles.indestructibles.imageKey), png);
  assert.ok([...b.data.keys()].some((k) => k.startsWith("mn1.cloud.backup.")));
  assert.equal(
    JSON.parse(await b.getText(REPORT_STYLES_KEY)).indestructibles.frameColor,
    "#58a6ff",
  );
  assert.equal(await b.getText("mn1.report.photo"), null);
});
test("invalid remote path and image cannot overwrite a workspace", async () => {
  assert.throws(
    () =>
      validateRemoteTeam({
        id: "champions",
        revision: 1,
        data: {
          schema: 1,
          definition: { id: "champions", name: "QA", color: "#123456" },
          template: {},
          assets: { image: "other-team/x.png" },
        },
      }),
    /Imagen remota/,
  );
  assert.throws(() => bytesPngBase64(new Uint8Array([1, 2, 3])), /PNG/);
});
test("other team report preferences cannot contaminate fingerprint", async () => {
  const s = vault();
  await s.putText(
    WORKSPACE_KEYS.state,
    JSON.stringify(createDefaultWorkspace()),
  );
  await s.putText(
    REPORT_PREFS_KEY,
    JSON.stringify({ teamId: "espartanos", frameColor: "#ff0000" }),
  );
  const a = await localTeamPacket(s, "champions");
  assert.equal(a.report.frameColor, null);
});
test("conflict from actual HTTP interface is surfaced without retry or overwrite", async () => {
  const s = vault(),
    c = new CloudClient(s, {
      fetcher: async () =>
        new Response(JSON.stringify({ code: "40001" }), { status: 400 }),
    });
  c.session = {
    access_token: "fixture",
    refresh_token: "fixture",
    expires_at: Date.now() / 1000 + 3600,
  };
  await assert.rejects(
    () => c.publish("champions", 1, {}),
    (e) => e.code === "conflict",
  );
});
test("access token is not sent to redirected or nonconfigured origins", async () => {
  const s = vault();
  let request;
  const c = new CloudClient(s, {
    fetcher: async (url, options) => {
      request = { url, options };
      return new Response('{"member":true}');
    },
  });
  c.session = {
    access_token: "fixture",
    refresh_token: "fixture",
    expires_at: Date.now() / 1000 + 3600,
  };
  await c.access();
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.cache, "no-store");
  assert.equal(
    request.url,
    "https://wnfqqqorktjiruxlzvlr.supabase.co/rest/v1/rpc/mn1_access",
  );
  await assert.rejects(() => c.request("//evil.example"), /Servidor/);
});

test("original backup survives later receives and image garbage collection", async () => {
  const { preserveOriginal, restoreOriginal, originalBackupKey } = await import(
    "../public/cloud-model.js"
  );
  const s = vault(),
    state = createDefaultWorkspace();
  state.profiles.champions.imageKey = "mn1.workspace.image.champions.old";
  await s.putText(WORKSPACE_KEYS.state, JSON.stringify(state));
  await s.putText(state.profiles.champions.imageKey, png);
  await preserveOriginal(s, "champions");
  const first = await s.getText(originalBackupKey("champions"));
  await s.removeText(state.profiles.champions.imageKey);
  const row = {
    id: "champions",
    revision: 1,
    data: {
      schema: 1,
      definition: { id: "champions", name: "Los Champions", color: "#f5c542" },
      template: { message: "Fixture", hour: "10:00" },
      report: {},
      assets: {},
    },
  };
  await receivePacket(s, {}, row);
  row.revision = 2;
  row.data.template.hour = "11:00";
  await receivePacket(s, {}, row);
  assert.equal(await s.getText(originalBackupKey("champions")), first);
  const restored = await restoreOriginal(s, "champions");
  assert.equal(restored.profiles.champions.hour, "08:00");
  assert.equal(await s.getText(restored.profiles.champions.imageKey), png);
});
test("partial receive rolls all shared records back after a storage failure", async () => {
  const s = vault();
  await s.putText(
    WORKSPACE_KEYS.state,
    JSON.stringify(createDefaultWorkspace()),
  );
  await s.putText(REPORT_PREFS_KEY, '{"teamId":"champions"}');
  await s.putText(REPORT_STYLES_KEY, "{}");
  const keys = [WORKSPACE_KEYS.state, REPORT_PREFS_KEY, REPORT_STYLES_KEY],
    before = await Promise.all(keys.map((k) => s.getText(k)));
  const original = s.putText;
  let failed = false;
  s.putText = async (k, v) => {
    if (k === REPORT_STYLES_KEY && !failed) {
      failed = true;
      throw Error("Fixture full storage");
    }
    return original(k, v);
  };
  const row = {
    id: "champions",
    revision: 1,
    data: {
      schema: 1,
      definition: { id: "champions", name: "Los Champions", color: "#f5c542" },
      template: { hour: "11:00" },
      assets: {},
      report: { frame: "gold" },
    },
  };
  await assert.rejects(() => receivePacket(s, {}, row), /Fixture full storage/);
  assert.deepEqual(await Promise.all(keys.map((k) => s.getText(k))), before);
  assert.equal(await s.getText("mn1.cloud.pending"), null);
});

test("save timestamps alone do not create cloud revisions", async () => {
  const s = vault(),
    state = createDefaultWorkspace();
  await s.putText(WORKSPACE_KEYS.state, JSON.stringify(state));
  const first = (await localTeamPacket(s, "champions")).fingerprint;
  state.profiles.champions.updatedAt = "2030-01-01T00:00:00Z";
  await s.putText(WORKSPACE_KEYS.state, JSON.stringify(state));
  assert.equal((await localTeamPacket(s, "champions")).fingerprint, first);
});

test("changing hour reuses immutable artwork instead of uploading it again", async () => {
  const s = vault(),
    state = createDefaultWorkspace();
  state.profiles.champions.imageKey = "mn1.workspace.image.champions.fixture";
  await s.putText(WORKSPACE_KEYS.state, JSON.stringify(state));
  await s.putText(state.profiles.champions.imageKey, png);
  let uploads = 0,
    revision = 0;
  const server = {
    upload: async () => uploads++,
    publish: async () => ++revision,
  };
  const first = await publishPacket(
    server,
    s,
    await localTeamPacket(s, "champions"),
    0,
  );
  state.profiles.champions.hour = "11:00";
  await s.putText(WORKSPACE_KEYS.state, JSON.stringify(state));
  const second = await publishPacket(
    server,
    s,
    await localTeamPacket(s, "champions"),
    1,
    first,
  );
  assert.equal(uploads, 1);
  assert.equal(second.assetPaths.image, first.assetPaths.image);
  assert.equal(second.revision, 2);
});

test("restored live copies can be replaced without deleting immutable originals", async () => {
  const { preserveOriginal, restoreOriginal, originalBackupKey } = await import(
    "../public/cloud-model.js"
  );
  const s = vault(),
    state = createDefaultWorkspace();
  state.profiles.champions.imageKey = "mn1.workspace.image.champions.fixture";
  await s.putText(WORKSPACE_KEYS.state, JSON.stringify(state));
  await s.putText(state.profiles.champions.imageKey, png);
  await preserveOriginal(s, "champions");
  const backup = JSON.parse(await s.getText(originalBackupKey("champions")));
  const first = await restoreOriginal(s, "champions");
  assert.notEqual(
    first.profiles.champions.imageKey,
    backup.state.profiles.champions.imageKey,
  );
  await s.removeText(first.profiles.champions.imageKey);
  const second = await restoreOriginal(s, "champions");
  assert.equal(await s.getText(second.profiles.champions.imageKey), png);
  assert.equal(await s.getText(backup.state.profiles.champions.imageKey), png);
});

test('cloud requests work without AbortSignal.timeout in Android WebView', async () => {
 const previous = AbortSignal.timeout;
 try {
  AbortSignal.timeout = undefined;
  let reached = false;
  const client = new CloudClient(vault(), {fetcher: async (url, options) => {
   reached = true; assert.ok(options.signal instanceof AbortSignal);
   return new Response('{}', {status:200});
  }});
  await client.request('/auth/v1/settings', {auth:false, method:'GET'});
  assert.equal(reached,true);
 } finally { AbortSignal.timeout = previous; }
});

test('two native vault phones save login and exchange artwork during concurrent card reads', async () => {
 const {BridgeVaultAdapter,VaultClient}=await import('../public/storage.js');
 function phone(){
  const data=new Map(); let active=0;
  const bridge={request:async(action,payload)=>{
   active++;
   if(active>4){active--;return {ok:false,message:'Demasiadas solicitudes'};}
   try {
    await new Promise(r=>setTimeout(r,0));
    if(action==='VAULT_PUT'){data.set(payload.key,payload.value);return {ok:true,data:{saved:true}};}
    if(action==='VAULT_REMOVE')return {ok:true,data:{removed:data.delete(payload.key)}};
    return {ok:true,data:{value:data.get(payload.key)??null}};
   }finally{active--;}
  }};
  return new VaultClient(new BridgeVaultAdapter(bridge));
 }
 const a=phone(), b=phone();
 const initial=createDefaultWorkspace();
 initial.profiles.indestructibles.imageKey='mn1.workspace.image.indestructibles.fixture';
 initial.profiles.indestructibles.imageWidth=1; initial.profiles.indestructibles.imageHeight=1;
 initial.profiles.indestructibles.hour='09:45';
 await a.putText(WORKSPACE_KEYS.state,JSON.stringify(initial));
 await a.putText(initial.profiles.indestructibles.imageKey,png);
 await b.putText(WORKSPACE_KEYS.state,JSON.stringify(createDefaultWorkspace()));
 const client=new CloudClient(a,{fetcher:async url=>new Response(JSON.stringify(url.includes('/token?')?{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'fixture-user'}}:{admin:true,member:true,teams:[]}),{status:200})});
 await Promise.all([client.login('fixture@example.invalid','fixture-only'),...Array.from({length:12},()=>a.getText(initial.profiles.indestructibles.imageKey))]);
 const reloaded=new CloudClient(a); assert.equal(await reloaded.restore(),true);
 let row; const files=new Map();
 const server={upload:async(k,v)=>files.set(k,v),publish:async(id,revision,data)=>{row={id,revision:1,data};return 1;},download:async k=>files.get(k)};
 const packet=await localTeamPacket(a,'indestructibles');
 await publishPacket(server,a,packet,0);
 const [received]=await Promise.all([receivePacket(b,server,row),...Array.from({length:12},()=>b.getText(WORKSPACE_KEYS.state))]);
 assert.equal(received.profiles.indestructibles.hour,'09:45');
 assert.equal(await b.getText(received.profiles.indestructibles.imageKey),png);
 assert.equal(initial.profiles.indestructibles.hour,'09:45');
});

test('browser fetch retains its Window receiver rather than the CloudClient instance', async () => {
 const previous=globalThis.fetch;
 try {
  globalThis.fetch=async function(){
   if(this!==globalThis) throw new TypeError('Illegal invocation');
   return new Response('{}',{status:200});
  };
  const client=new CloudClient(vault());
  await client.request('/auth/v1/settings',{auth:false,method:'GET'});
 }finally{globalThis.fetch=previous;}
});

test('actual auth rejection is distinguished from network failure without exposing server details', async () => {
 const client=new CloudClient(vault(),{fetcher:async()=>new Response(JSON.stringify({code:'invalid_credentials',message:'internal detail must not leak'}),{status:400})});
 await assert.rejects(client.login('test@example.invalid','fictitious'),e=>e.code==='400' && e.message==='Correo o contraseña incorrectos. Revisa tus datos e intenta de nuevo.');
});
