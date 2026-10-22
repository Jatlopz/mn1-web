import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {includeAndroidRelease} from '../tools/include-android-release.mjs';
async function fixture() {
  const root=await mkdtemp(path.join(tmpdir(),'mn1-release-')),source=path.join(root,'releases'),out=path.join(root,'out');
  await mkdir(path.join(source,'downloads'),{recursive:true});
  const apk=Buffer.from([80,75,3,4,5,6]),sha256=createHash('sha256').update(apk).digest('hex');
  const name=`mn1-5-${sha256.slice(0,16)}.apk`;
  const manifest={schemaVersion:1,applicationId:'com.mn1.avisos',versionCode:5,versionName:'test',apkUrl:'https://jatlopz.github.io/mn1-web/downloads/'+name,sha256,sizeBytes:apk.length,notes:'test'};
  const save=()=>writeFile(path.join(source,'android-update.json'),JSON.stringify(manifest));
  await writeFile(path.join(source,'downloads',name),apk);await save();return {source,out,manifest,apk,name,save};
}
test('missing release leaves web-only deployment unchanged',async()=>{const root=await mkdtemp(path.join(tmpdir(),'mn1-no-release-'));assert.equal(await includeAndroidRelease(path.join(root,'none'),path.join(root,'out')),false);});
test('copies only the approved APK and coherent manifest',async()=>{const f=await fixture();assert.equal(await includeAndroidRelease(f.source,f.out),true);assert.deepEqual(await readFile(path.join(f.out,'downloads',f.name)),f.apk);assert.deepEqual(JSON.parse(await readFile(path.join(f.out,'android-update.json'),'utf8')),f.manifest);});
test('corrupted and truncated APKs fail before publication',async()=>{for(const bytes of [Buffer.from([80,75,3,4,0,0]),Buffer.from([80,75])]){const f=await fixture();await writeFile(path.join(f.source,'downloads',f.name),bytes);await assert.rejects(includeAndroidRelease(f.source,f.out),/integrity/);await assert.rejects(access(f.out));}});
test('untrusted URL, traversal, wrong app and unknown fields are rejected',async()=>{for(const change of [{apkUrl:'https://evil.example/app.apk'},{apkUrl:'https://jatlopz.github.io/mn1-web/downloads/../app.apk'},{applicationId:'other.app'},{secret:'no'}]){const f=await fixture();Object.assign(f.manifest,change);await f.save();await assert.rejects(includeAndroidRelease(f.source,f.out));await assert.rejects(access(f.out));}});
