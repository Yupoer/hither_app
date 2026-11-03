import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/mobile');
const hash = createHash('sha256');
for (const file of ['apps/mobile/package.json', 'apps/mobile/package-lock.json',
  '.github/actions/setup-mobile/action.yml', 'scripts/install-mobile-dependencies.sh', 'scripts/mobile-install-key.mjs',
  ...fs.readdirSync(path.join(app, 'patches')).sort().map(name => `apps/mobile/patches/${name}`),
  ...['.npmrc', 'apps/mobile/.npmrc', 'bunfig.toml', 'apps/mobile/bunfig.toml'].filter(file => fs.existsSync(path.join(root, file)))]) {
  hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0');
}
const version = execFileSync('bun', ['--version'], { cwd: app, encoding: 'utf8' }).trim();
console.log(`key=mobile-installed-v2-${process.platform}-${process.arch}-${process.version}-bun${version}-${hash.digest('hex')}`);
