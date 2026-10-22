import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile, lstat, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const BASE = 'https://jatlopz.github.io/mn1-web/downloads/';
const MAX = 128 * 1024 * 1024;
const KEYS = ['schemaVersion','applicationId','versionCode','versionName','apkUrl','sha256','sizeBytes','notes'];
async function regularFile(file, boundary, maximum) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error('Invalid release file');
  const resolved = await realpath(file);
  if (!resolved.startsWith((await realpath(boundary)) + path.sep)) throw new Error('Release outside boundary');
  return readFile(file);
}
/** Publishes only an explicitly approved, hash-pinned APK; never traverses Android sources. */
export async function includeAndroidRelease(source, destination) {
  const manifestPath = path.join(source, 'android-update.json');
  try { await lstat(manifestPath); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  const manifest = JSON.parse((await regularFile(manifestPath, source, 65536)).toString('utf8'));
  if (!manifest || Array.isArray(manifest) || Object.keys(manifest).length !== KEYS.length || KEYS.some(k => !Object.hasOwn(manifest,k))) throw new Error('Invalid release schema');
  if (manifest.schemaVersion !== 1 || manifest.applicationId !== 'com.mn1.avisos' || !Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 1 || typeof manifest.versionName !== 'string' || manifest.versionName.length < 1 || manifest.versionName.length > 80 || typeof manifest.notes !== 'string' || manifest.notes.length > 4000 || !Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes < 1 || manifest.sizeBytes > MAX || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('Invalid release values');
  const name = `mn1-${manifest.versionCode}-${manifest.sha256.slice(0,16)}.apk`;
  if (manifest.apkUrl !== BASE + name) throw new Error('Untrusted APK URL');
  const apk = await regularFile(path.join(source,'downloads',name),source,MAX);
  if (apk.length !== manifest.sizeBytes || apk.length < 4 || !apk.subarray(0,4).equals(Buffer.from([80,75,3,4])) || createHash('sha256').update(apk).digest('hex') !== manifest.sha256) throw new Error('APK integrity mismatch');
  // Validate every input before writing the publication artifact.
  await mkdir(path.join(destination,'downloads'),{recursive:true});
  await writeFile(path.join(destination,'downloads',name),apk);
  await writeFile(path.join(destination,'android-update.json'),JSON.stringify(manifest,null,2)+'\n');
  return true;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../',import.meta.url));
  console.log(await includeAndroidRelease(path.join(root,'releases'),path.join(root,'web/dist')) ? 'Approved Android release included' : 'No Android release configured');
}
