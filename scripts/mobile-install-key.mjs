import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/mobile');
const npm = process.platform === 'win32' ? process.execPath : 'npm';
const npmArgs = process.platform === 'win32' ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const config = JSON.parse(execFileSync(npm, [...npmArgs, 'config', 'list', '--json'], { cwd: app, encoding: 'utf8' }));
for (const key of ['cache', 'prefix', 'userconfig', 'globalconfig', 'logs-dir', 'heading', 'node-version', 'npm-version']) delete config[key];
const hash = createHash('sha256');
for (const file of ['apps/mobile/package.json', 'apps/mobile/package-lock.json',
  '.github/actions/setup-mobile/action.yml', 'scripts/mobile-install-key.mjs',
  ...fs.readdirSync(path.join(app, 'patches')).sort().map(name => `apps/mobile/patches/${name}`),
  ...['.npmrc', 'apps/mobile/.npmrc'].filter(file => fs.existsSync(path.join(root, file)))]) {
  hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0');
}
hash.update(JSON.stringify(Object.fromEntries(Object.entries(config).sort(([a], [b]) => a.localeCompare(b)))));
const version = execFileSync(npm, [...npmArgs, '--version'], { cwd: app, encoding: 'utf8' }).trim();
console.log(`key=mobile-installed-v1-${process.platform}-${process.arch}-${process.version}-npm${version}-${hash.digest('hex')}`);
