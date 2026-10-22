import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const MODULES = ['app.js', 'bridge.js', 'profiles.js', 'renderer.js', 'storage.js', 'voice.js'];
const LOCAL_IMPORT = /from\s+(['"])\.\/([A-Za-z0-9_-]+\.js)\1/g;

function shortHash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function hashedName(name, hash) {
  return name.replace(/\.js$/, `.${hash}.js`);
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
  const css = await readFile(path.join(source, 'styles.css'), 'utf8');
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
  const html = htmlSource
    .replace(/\.\/app\.js(?:\?v=[\d.]+)?/, `./${appName}`)
    .replace(/\.\/styles\.css(?:\?v=[\d.]+)?/, `./${cssName}`);
  if (html === htmlSource || html.includes('./app.js?') || html.includes('./styles.css?')) {
    throw new Error('HTML assets missing');
  }

  await mkdir(destination, {recursive:true});
  output['index.html'] = html;
  output[cssName] = css;
  output['version.json'] = JSON.stringify(version, null, 2);
  output['.nojekyll'] = '';
  await Promise.all(Object.entries(output).map(([name, content]) => writeFile(path.join(destination,name), content)));
  return Object.keys(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const destination = path.resolve(process.argv[2] || path.join(web, 'dist'));
  console.log(`Built ${(await buildSite(path.join(web,'public'), destination)).length} public files in ${destination}`);
}
