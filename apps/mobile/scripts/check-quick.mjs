import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));

try {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--base' || !args[1])) {
    throw new Error('Usage: check:quick [--base <git-ref>]');
  }
  const base = args[1] ?? 'origin/master';
  const git = args => execFileSync('git', args, { cwd: appRoot, encoding: 'utf8' });
  const repoRoot = git(['rev-parse', '--show-toplevel']).replace(/\r?\n$/, '');
  let baseSha;
  try {
    baseSha = git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  } catch {
    throw new Error(`Cannot resolve quick-check base ${JSON.stringify(base)}. Fetch it or pass --base <git-ref>.`);
  }
  const changed = new Set([
    ...git(['diff', '--name-only', '-z', '--no-renames', `${baseSha}...HEAD`, '--']).split('\0'),
    ...git(['diff', '--cached', '--name-only', '-z', '--no-renames', '--']).split('\0'),
    ...git(['diff', '--name-only', '-z', '--no-renames', '--']).split('\0'),
    ...git(['-C', repoRoot, 'ls-files', '--others', '--exclude-standard', '--full-name', '-z']).split('\0'),
  ].filter(Boolean));
  const appPrefix = `${path.relative(repoRoot, appRoot).split(path.sep).join('/')}/`;
  const fullLint = [...changed].some(file =>
    /(?:^|\/)(?:eslint\.config\.[^/]+|\.eslintrc(?:\.[^/]+)?|\.eslintignore|tsconfig(?:\.[^/]+)?\.json|babel\.config\.[^/]+|metro\.config\.[^/]+)$/.test(file) ||
    ['package.json', 'package-lock.json', '.npmrc', `${appPrefix}package.json`, `${appPrefix}package-lock.json`, `${appPrefix}.npmrc`].includes(file));
  const lintFiles = [...changed].filter(file => file.startsWith(appPrefix) && /\.[cm]?[jt]sx?$/.test(file))
    .map(file => file.slice(appPrefix.length))
    .filter(file => fs.statSync(path.join(appRoot, file), { throwIfNoEntry: false })?.isFile())
    .sort();
  const lintInputs = fullLint ? ['src', 'app', 'components'].filter(file => fs.existsSync(path.join(appRoot, file))) : lintFiles;
  const run = (cli, args) => {
    const result = spawnSync(process.execPath, [path.join(appRoot, 'node_modules', cli), ...args], {
      cwd: appRoot, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  };
  console.log(`Quick check base ${baseSha}. ${fullLint ? 'Full lint' : `${lintFiles.length} changed lint file(s)`}.`);
  const lintStatus = lintInputs.length ? run('eslint/bin/eslint.js', ['--ext', '.js,.jsx,.ts,.tsx', '--', ...lintInputs]) : 0;
  const typeStatus = run('typescript/bin/tsc', ['--noEmit']);
  process.exitCode = lintStatus || typeStatus;
} catch (error) {
  console.error(`Quick check failed: ${error.message}`);
  process.exitCode = 1;
}
