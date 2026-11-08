import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile, lstat, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const MODULES = ['team-carousel.js','corporate-board.js','creator-info.js','idea-attachment.js','desktop-install.js','looms-model.js','looms-studio.js','lamination-model.js','lamination-studio.js','registry-model.js','registry-admin.js','iso-calendar.js','team-tool-library.js','plant-catalog.js','production-model.js','production-pdf.js','production-studio.js', 'themes.js', 'cloud-client.js', 'cloud-model.js', 'cloud-workspace.js', 'app.js', 'meeting-report.js', 'bridge.js', 'profiles.js', 'renderer.js', 'starter-templates.js', 'storage.js', 'voice.js'];
const LOCAL_IMPORT = /from\s+(['"])\.\/([A-Za-z0-9_-]+\.js)\1/g;
const MAX_STARTER_IMAGE_BYTES = 4 * 1024 * 1024;
const THEME_TEXTURES = Object.freeze([
  'themes/texture-ice.svg',
  'themes/texture-violet.svg',
  'themes/texture-amber.svg',
  'themes/texture-lime.svg',
  'themes/texture-halloween.svg',
  'themes/texture-winter.svg',
]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Metadatos aprobados en docs/STARTER-IMAGES.json. Se fijan aquí para que el empaquetado
// no dependa de un JSON móvil y sólo pueda publicar estas dos imágenes.
export const STARTER_IMAGES = Object.freeze([
  Object.freeze({
    path: 'templates/indestructibles.c9e3d4ac8d3d6f3f.png',
    sha256: 'c9e3d4ac8d3d6f3f3594e4883c4d1f9c3daeb7b4dbf4055a8225a1a90ab6c203',
    size: 2168242,
    width: 1254,
    height: 1254,
  }),
  Object.freeze({
    path: 'templates/super-guerreros.8200d4c6f9ede505.png',
    sha256: '8200d4c6f9ede50597c078bbb5ad7192fc9879dde83d7bd6fc8ef98ad8795a5a',
    size: 2378319,
    width: 1254,
    height: 1254,
  }),
]);

export const BRAND_SYMBOL=Object.freeze({"path":"brand/supertools-symbol.dde519ee1d6b5bbf.png","sha256":"dde519ee1d6b5bbfcc0c70332c81d3beb6f0af39c1d270219b6300d9a59fa6e3","size":586169});
export const CREATOR_PHOTO=Object.freeze({"path":"about/joel-triminio.2b1337ff184694b0.jpg","sha256":"2b1337ff184694b09ae27fb0a015ec32cdd3979aec1f157af0011841a33955b5","size":83059});
export const THEME_ART = Object.freeze([
  {"id":"ice-aurora","path":"themes/ice-aurora.1f8a7f5195899fec.webp","sha256":"1f8a7f5195899fec30bd51e55aa3dbfab68da2193a7a8ed09917b7cc5e2e4d9b","size":62192,"width":1672,"height":941},
  {"id":"lime-forest","path":"themes/lime-forest.171611d1d7ec124f.webp","sha256":"171611d1d7ec124fca35e04e2d52ce188618334fcb79ef9e73a543409855d587","size":96584,"width":1672,"height":941},
  {"id":"night-neural","path":"themes/night-neural.a240614da278ac75.webp","sha256":"a240614da278ac75a3b54fe1757099f319f7d8ad2ea144312f2a129a6094f592","size":63854,"width":1672,"height":941},
  {"id":"violet-eclipse","path":"themes/violet-eclipse.fcaf7e41bdd1727b.webp","sha256":"fcaf7e41bdd1727ba9649ababb77a78afef5d32131b1ef7f4505abbf5739bb65","size":34034,"width":1672,"height":941},
  {"id":"amber-topology","path":"themes/amber-topology.1d1bbae34676b97f.webp","sha256":"1d1bbae34676b97f2fe3680b7b32998e98e57fafbb2068cd1c74df98befd39a3","size":118390,"width":1672,"height":941},
  {"id":"ice-aurora-desktop","path":"themes/ice-aurora-desktop.9f9194e873d97063.jpg","sha256":"9f9194e873d9706309035e108808c4eb2cb12c133962e5a23428b4ebf706514e","size":620382,"width":3840,"height":2160,"desktop":true},
  {"id":"lime-forest-desktop","path":"themes/lime-forest-desktop.5333a47af2aa228f.jpg","sha256":"5333a47af2aa228fe72786e6d464ed945140045b6d1812b3cf669bd951f8610e","size":697911,"width":3840,"height":2160,"desktop":true},
  {"id":"night-neural-desktop","path":"themes/night-neural-desktop.a298bbf3273b0d98.jpg","sha256":"a298bbf3273b0d985e7b33865f07008359a24c9e529ef717ddba86f9405c3e78","size":522478,"width":3840,"height":2160,"desktop":true},
  {"id":"violet-eclipse-desktop","path":"themes/violet-eclipse-desktop.d363ca64123994c8.jpg","sha256":"d363ca64123994c8c1b731ffea42db2fee0405d984208efe27ed32fe6fc008ce","size":472043,"width":3840,"height":2160,"desktop":true},
  {"id":"amber-topology-desktop","path":"themes/amber-topology-desktop.e1992b41c96628f1.jpg","sha256":"e1992b41c96628f100ba2f9fc0cd44567c61d0411189daadd6d1ab02df139165","size":780126,"width":3840,"height":2160,"desktop":true},
  {"id":"halloween-desktop","path":"themes/halloween-desktop-4k.344a5f1d7bd0d7c3.webp","sha256":"344a5f1d7bd0d7c32e9ab25fa83de4a71214c690f1eecda2da79afc8cebbc9fd","size":665704,"width":3840,"height":2160,"desktop":true},
  {"id":"halloween-moon-desktop","path":"themes/halloween-moon-desktop-4k.02f9bd8c5ac84c40.webp","sha256":"02f9bd8c5ac84c40ae4f04d338eca77bd89b193ae20e65a4044986fd719794a6","size":994814,"width":3840,"height":2160,"desktop":true},
  {"id":"winter-desktop","path":"themes/winter-desktop-4k.b0c5d358abef9729.webp","sha256":"b0c5d358abef972935016638e51536a0c0c685f71627b2b8c587fdf3a89c5ce5","size":684908,"width":3840,"height":2160,"desktop":true},
  {"id":"winter-gold-desktop","path":"themes/winter-gold-desktop-4k.f5ad8a1f634c4a28.webp","sha256":"f5ad8a1f634c4a284dcbba3d92a181013afdd1132bedb294e19194f6a1e5f598","size":1153160,"width":3840,"height":2160,"desktop":true},
  {"id":"winter-snow-desktop","path":"themes/winter-snow-desktop-4k.73c847bbb35b189b.webp","sha256":"73c847bbb35b189bd7fa9d8e1d885f196ae5c07d23d3f7dfaa8aa250939124b7","size":997980,"width":3840,"height":2160,"desktop":true},
  {"id":"winter-gold","path":"themes/winter-gold.5ddd3ec92bde6765.webp","sha256":"5ddd3ec92bde6765c5c7d095e93fff7202aa2943a9b6b5ae42e59843bfaa090f","size":359112,"width":1024,"height":1536},
  {"id":"winter-snow","path":"themes/winter-snow.42fca70e703ce4c0.webp","sha256":"42fca70e703ce4c054c1a6cf684390a8ffd2860d241402895063926ea131ffb8","size":299506,"width":1024,"height":1536},
  {
    "id": "halloween-moon",
    "path": "themes/halloween-moon.8fbffa02c070af42.webp",
    "sha256": "8fbffa02c070af42c3659edbd2b45de13ba923050b1ba59d3fc2207209c68fdf",
    "size": 312308,
    "width": 1024,
    "height": 1536
  },
  {
    "id": "halloween",
    "path": "themes/halloween.270bd76a04c0f76c.webp",
    "sha256": "270bd76a04c0f76cff9b44f8b9522f4b57a71a886b2e221e15a0765b7435e894",
    "size": 152984,
    "width": 1024,
    "height": 1536
  },
  {
    "id": "winter",
    "path": "themes/winter.2b84eaa69482468d.webp",
    "sha256": "2b84eaa69482468d01e2cb3f72aa3d67daae471d7413ccca6ff2144e4ae7185a",
    "size": 145940,
    "width": 1024,
    "height": 1536
  }
]);

async function readThemeArt(source, sourceReal, art) {
  const file=path.join(source,art.path),info=await lstat(file);
  const maximum=art.desktop?2*1024*1024:512*1024;
  if(art.desktop&&(art.width!==3840||art.height!==2160))throw Error('Desktop artwork must be UHD');
  if(!info.isFile()||info.isSymbolicLink()||info.size>maximum)throw Error('Invalid theme artwork: '+art.path);
  if(!isWithin(await realpath(file),sourceReal))throw Error('Theme artwork outside source');
  const bytes=await readFile(file);
  if(bytes.length!==art.size||createHash('sha256').update(bytes).digest('hex')!==art.sha256)throw Error('Theme artwork integrity mismatch');
  const jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&art.path.endsWith('.jpg');
  if(!jpeg&&(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'))throw Error('Invalid theme artwork');
  const dimensions=jpeg?jpegDimensions(bytes):webpDimensions(bytes);
  if(dimensions.width!==art.width||dimensions.height!==art.height)throw Error('Theme artwork dimensions mismatch');
  return bytes;
}

export function webpDimensions(bytes){
  if(bytes.length<30||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('Invalid WebP dimensions');
  for(let offset=12;offset+8<=bytes.length;){const type=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),data=offset+8;if(data+size>bytes.length)throw Error('Truncated WebP');
    if(type==='VP8X'&&size>=10){if(bytes[data]&2)throw Error('Animated theme artwork is not supported');return {width:bytes.readUIntLE(data+4,3)+1,height:bytes.readUIntLE(data+7,3)+1};}
    if(type==='VP8 '&&size>=10&&bytes[data+3]===0x9d&&bytes[data+4]===1&&bytes[data+5]===0x2a)return {width:bytes.readUInt16LE(data+6)&0x3fff,height:bytes.readUInt16LE(data+8)&0x3fff};
    if(type==='VP8L'&&size>=5&&bytes[data]===0x2f){const bits=bytes.readUInt32LE(data+1);return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};}
    offset=data+size+(size%2);
  }throw Error('Missing WebP dimensions');
}

export function jpegDimensions(bytes){
  if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9)throw Error('Invalid JPEG dimensions');
  const frames=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  for(let offset=2;offset<bytes.length;){if(bytes[offset]!==0xff){offset++;continue;}while(bytes[offset]===0xff)offset++;const marker=bytes[offset++];if(marker===0xd9||marker===0xda)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;if(offset+2>bytes.length)break;const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)throw Error('Truncated JPEG');if(frames.has(marker)){if(length<7)throw Error('Invalid JPEG frame');return {width:bytes.readUInt16BE(offset+5),height:bytes.readUInt16BE(offset+3)};}offset+=length;}
  throw Error('Missing JPEG dimensions');
}

export function themeArtDimensions(bytes){return bytes[0]===0xff&&bytes[1]===0xd8?jpegDimensions(bytes):webpDimensions(bytes);}

function shortHash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function hashedName(name, hash) {
  return name.replace(/\.js$/, `.${hash}.js`);
}

function isWithin(file, directory) {
  return file.startsWith(directory + path.sep);
}

async function readStarterImage(source, sourceReal, image) {
  const file = path.join(source, image.path);
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Invalid starter image: ${image.path}`);
  if (info.size > MAX_STARTER_IMAGE_BYTES) throw new Error(`Starter image exceeds 4 MiB: ${image.path}`);
  const resolved = await realpath(file);
  if (!isWithin(resolved, sourceReal)) throw new Error(`Starter image outside source: ${image.path}`);
  const data = await readFile(resolved);
  if (data.length !== image.size) throw new Error(`Starter image size mismatch: ${image.path}`);
  if (createHash('sha256').update(data).digest('hex') !== image.sha256) throw new Error(`Starter image hash mismatch: ${image.path}`);
  if (data.length < 33 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`Invalid PNG signature: ${image.path}`);
  if (data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`Invalid PNG IHDR: ${image.path}`);
  if (data.readUInt32BE(16) !== image.width || data.readUInt32BE(20) !== image.height) throw new Error(`Starter image dimensions mismatch: ${image.path}`);
  return data;
}

/**
 * Empaqueta los módulos JS con nombres hasheados. Los imports locales se reescriben en
 * orden topológico para que cada archivo apunte al hash real de su dependencia.
 * No usa bundler ni red; sólo lee los archivos del directorio public.
 */
export async function buildSite(source, destination) {
  if (path.resolve(source) === path.resolve(destination)) throw new Error('Use a separate output directory');
  const sourceFiles = Object.fromEntries(await Promise.all(MODULES.map(async name => [name, await readFile(path.join(source, name), 'utf8')])));
  const htmlSource = await readFile(path.join(source, 'index.html'), 'utf8');
  const css = await readFile(path.join(source, 'styles.css'), 'utf8')+'\n'+await readFile(path.join(source, 'production.css'), 'utf8')+'\n'+await readFile(path.join(source, 'looms.css'), 'utf8')+'\n'+await readFile(path.join(source, 'premium.css'), 'utf8')+'\n'+await readFile(path.join(source, 'corporate-board.css'), 'utf8')+'\n'+await readFile(path.join(source, 'team-carousel.css'), 'utf8');
  const version = JSON.parse(await readFile(path.join(source, 'version.json'), 'utf8'));
  if (version.protocol !== 1 || !/^\d+\.\d+\.\d+$/.test(version.version)) throw new Error('Invalid version/protocol');

  const dependencies = new Map();
  for (const [name, content] of Object.entries(sourceFiles)) {
    LOCAL_IMPORT.lastIndex = 0;
    const found = [...content.matchAll(LOCAL_IMPORT)].map(match => match[2]);
    for (const dependency of found) {
      if (!MODULES.includes(dependency)) throw new Error(`Unknown module imported by ${name}: ${dependency}`);
    }
    dependencies.set(name, found);
  }

  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = name => {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Circular import at ${name}`);
    visiting.add(name);
    for (const dependency of dependencies.get(name) ?? []) visit(dependency);
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  };
  for (const name of MODULES) visit(name);

  const outputNames = new Map();
  const output = {};
  for (const name of ordered) {
    const original = sourceFiles[name];
    const rewritten = original.replace(LOCAL_IMPORT, (match, quote, dependency) => {
      const outputName = outputNames.get(dependency);
      if (!outputName) throw new Error(`Dependency ${dependency} of ${name} was not built first`);
      return `from ${quote}./${outputName}${quote}`;
    });
    const outputName = hashedName(name, shortHash(rewritten));
    outputNames.set(name, outputName);
    output[outputName] = rewritten;
  }

  const cssName = `styles.${shortHash(css)}.css`;
  const appName = outputNames.get('app.js');
  if (!appName) throw new Error('app.js was not built');
  const html = htmlSource.replace(/\s*<link rel="stylesheet" href="\.\/team-carousel\.css">/,'').replace(/\s*<link rel="stylesheet" href="\.\/corporate-board\.css">/,'').replace(/\s*<link rel="stylesheet" href="\.\/looms\.css">/,'').replace(/\s*<link rel="stylesheet" href="\.\/production\.css">/,'')
    .replace(/\s*<link rel="stylesheet" href="\.\/premium\.css">/,'')
    .replace(/\.\/app\.js(?:\?v=[\d.]+)?/, `./${appName}`)
    .replace(/\.\/styles\.css(?:\?v=[\d.]+)?/, `./${cssName}`);
  if (html === htmlSource || html.includes('./app.js?') || html.includes('./styles.css?')) {
    throw new Error('HTML assets missing');
  }

  const sourceReal = await realpath(source);
  for (const image of STARTER_IMAGES) output[image.path] = await readStarterImage(source, sourceReal, image);

  for (const art of THEME_ART) output[art.path] = await readThemeArt(source, sourceReal, art);
  for (const texture of THEME_TEXTURES) {
    const file = path.join(source, texture), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 || !isWithin(await realpath(file), sourceReal)) throw Error('Invalid theme texture: ' + texture);
    const svg = await readFile(file, 'utf8');
    if (!/^<svg\s/.test(svg) || !svg.includes('</svg>') || /<script\b|\son\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/|javascript:)/i.test(svg)) throw Error('Unsafe theme texture: ' + texture);
    output[texture] = svg;
  }
  const creatorFile=path.join(source,CREATOR_PHOTO.path),creatorStat=await lstat(creatorFile);
  if(!creatorStat.isFile()||creatorStat.isSymbolicLink()||creatorStat.size>512*1024||!isWithin(await realpath(creatorFile),sourceReal))throw Error('Invalid creator photo');
  const creatorBytes=await readFile(creatorFile);
  if(creatorBytes.length!==CREATOR_PHOTO.size||createHash('sha256').update(creatorBytes).digest('hex')!==CREATOR_PHOTO.sha256||creatorBytes[0]!==255||creatorBytes[1]!==216)throw Error('Creator photo integrity mismatch');
  output[CREATOR_PHOTO.path]=creatorBytes;
  const brandFile=path.join(source,BRAND_SYMBOL.path),brandStat=await lstat(brandFile);
  if(!brandStat.isFile()||brandStat.isSymbolicLink()||!isWithin(await realpath(brandFile),sourceReal))throw Error('Invalid brand symbol');
  const brandBytes=await readFile(brandFile);
  if(brandBytes.length!==BRAND_SYMBOL.size||createHash('sha256').update(brandBytes).digest('hex')!==BRAND_SYMBOL.sha256||!brandBytes.subarray(0,8).equals(PNG_SIGNATURE))throw Error('Brand symbol integrity mismatch');
  output[BRAND_SYMBOL.path]=brandBytes;


  await mkdir(destination, {recursive:true});
  const installerCss=await readFile(path.join(source,'desktop-install.css'),'utf8');
  const installerCssName='desktop-install.'+shortHash(installerCss)+'.css';
  output[installerCssName]=installerCss;
  output['install.html']=(await readFile(path.join(source,'install.html'),'utf8')).replace('./desktop-install.js','./'+outputNames.get('desktop-install.js')).replace('./desktop-install.css','./'+installerCssName);
  output['app.webmanifest']=await readFile(path.join(source,'app.webmanifest'),'utf8');
  for(const size of [192,512]) {
    const name='brand/desktop-clear-'+size+'.png',bytes=await readFile(path.join(source,name));
    if(!bytes.subarray(0,8).equals(PNG_SIGNATURE)||bytes.readUInt32BE(16)!==size||bytes.readUInt32BE(20)!==size||bytes.length>512*1024)throw Error('Invalid desktop icon');
    output[name]=bytes;
  }
  output['index.html'] = html;
  // Runs before stylesheets so a returning user sees the saved theme on first paint.
  output['theme-bootstrap.js'] = await readFile(path.join(source, 'theme-bootstrap.js'));
  output[cssName] = css;
  output['version.json'] = JSON.stringify(version, null, 2);
  output['.nojekyll'] = '';
  for (const [name, content] of Object.entries(output)) {
    const target = path.join(destination, name);
    await mkdir(path.dirname(target), {recursive:true});
    await writeFile(target, content);
  }
  return Object.keys(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const destination = path.resolve(process.argv[2] || path.join(web, 'dist'));
  console.log(`Built ${(await buildSite(path.join(web,'public'), destination)).length} public files in ${destination}`);
}
