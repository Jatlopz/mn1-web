import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function buildSite(source, destination) {
  if (path.resolve(source) === path.resolve(destination)) throw new Error('Use a separate output directory');
  const names = ['index.html', 'app.js', 'bridge.js', 'styles.css', 'version.json'];
  const sourceFiles = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(path.join(source, name), 'utf8')])));
  const version = JSON.parse(sourceFiles['version.json']);
  if (version.protocol !== 1 || !/^\d+\.\d+\.\d+$/.test(version.version)) throw new Error('Invalid version/protocol');
  const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
  const bridgeName = `bridge.${hash(sourceFiles['bridge.js'])}.js`;
  const app = sourceFiles['app.js'].replace("'./bridge.js'", `'./${bridgeName}'`);
  if (!app.includes(`'./${bridgeName}'`)) throw new Error('Bridge import missing');
  const appName = `app.${hash(app)}.js`;
  const cssName = `styles.${hash(sourceFiles['styles.css'])}.css`;
  const html = sourceFiles['index.html']
    .replace(/\.\/app\.js\?v=[\d.]+/, `./${appName}`)
    .replace(/\.\/styles\.css\?v=[\d.]+/, `./${cssName}`);
  if (html === sourceFiles['index.html'] || html.includes('./app.js?')) throw new Error('HTML assets missing');
  await mkdir(destination, {recursive:true});
  const output = {'index.html':html, [appName]:app, [bridgeName]:sourceFiles['bridge.js'], [cssName]:sourceFiles['styles.css'], 'version.json':JSON.stringify(version, null, 2), '.nojekyll':''};
  await Promise.all(Object.entries(output).map(([name, content]) => writeFile(path.join(destination,name), content)));
  return Object.keys(output);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const destination = path.resolve(process.argv[2] || path.join(web, 'dist'));
  console.log(`Built ${(await buildSite(path.join(web,'public'), destination)).length} public files in ${destination}`);
}