import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hither quick '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'apps/mobile');
  const write = (file, text = 'export const value = 1;\n') => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  write('.gitignore', 'node_modules/\napps/mobile/scripts/check-quick.mjs\n');
  write('apps/mobile/src/committed.ts');
  write('apps/mobile/src/staged.ts');
  write('apps/mobile/src/working.ts');
  write('apps/mobile/src/deleted.ts');
  write('apps/mobile/src/renamed.ts');
  git(['init', '-q']);
  git(['config', 'user.email', 'quick@example.invalid']);
  git(['config', 'user.name', 'Quick fixture']);
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  git(['update-ref', 'refs/remotes/origin/master', 'HEAD']);
  fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
  fs.copyFileSync(new URL('./check-quick.mjs', import.meta.url), path.join(app, 'scripts/check-quick.mjs'));
  for (const [cli, name] of [['eslint/bin/eslint.js', 'lint'], ['typescript/bin/tsc', 'typecheck']]) {
    write(`apps/mobile/node_modules/${cli}`, `console.log(${JSON.stringify(name)} + ' ' + JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.${name.toUpperCase()}_STATUS ?? 0));`);
  }
  const run = (args = [], env = {}) => {
    const result = spawnSync(process.execPath, ['scripts/check-quick.mjs', ...args], {
      cwd: app, encoding: 'utf8', env: { ...process.env, ...env },
    });
    result.calls = result.stdout.split(/\r?\n/).flatMap(line => {
      const match = /^(lint|typecheck) (.+)$/.exec(line);
      return match ? [{ name: match[1], args: JSON.parse(match[2]) }] : [];
    });
    return result;
  };
  return { root, app, write, git, run };
}

test('lints existing committed, staged, working and untracked paths safely, including rename destinations', t => {
  const f = fixture(t);
  f.write('apps/mobile/src/committed.ts', 'export const value = 2;\n');
  f.git(['mv', 'apps/mobile/src/renamed.ts', 'apps/mobile/src/new name.ts']);
  f.git(['add', '.']);
  f.git(['commit', '-qm', 'branch']);
  f.write('apps/mobile/src/staged.ts', 'export const value = 2;\n');
  f.git(['add', 'apps/mobile/src/staged.ts']);
  f.write('apps/mobile/src/working.ts', 'export const value = 2;\n');
  fs.unlinkSync(path.join(f.app, 'src/deleted.ts'));
  f.write('apps/mobile/src/$shell; [literal].tsx');
  f.write('outside.ts');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    { name: 'lint', args: ['--ext', '.js,.jsx,.ts,.tsx', '--', 'src/$shell; [literal].tsx', 'src/committed.ts', 'src/new name.ts', 'src/staged.ts', 'src/working.ts'] },
    { name: 'typecheck', args: ['--noEmit'] },
  ]);
});

test('shared configuration changes run existing full lint inputs', t => {
  const f = fixture(t);
  f.write('eslint.config.js');
  f.write('apps/mobile/components/Card.tsx');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls[0], { name: 'lint', args: ['--ext', '.js,.jsx,.ts,.tsx', '--', 'src', 'components'] });
  assert.equal(result.calls[1].name, 'typecheck');
});

test('documentation-only changes still run project typecheck without ESLint', t => {
  const f = fixture(t);
  f.write('README.md', 'documentation');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [{ name: 'typecheck', args: ['--noEmit'] }]);
});

test('explicit base is honored and missing bases fail before checking', t => {
  const f = fixture(t);
  f.write('apps/mobile/src/committed.ts', 'export const value = 2;\n');
  f.git(['add', '.']);
  f.git(['commit', '-qm', 'branch']);
  assert.deepEqual(f.run(['--base', 'HEAD']).calls, [{ name: 'typecheck', args: ['--noEmit'] }]);
  const result = f.run(['--base', 'missing-ref']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot resolve quick-check base "missing-ref"/);
  assert.deepEqual(result.calls, []);
  assert.equal(f.run(['--unexpected']).status, 1);
});

test('both checks run and a failed check fails the command', t => {
  const f = fixture(t);
  f.write('apps/mobile/src/working.ts', 'export const value = 2;\n');
  const result = f.run([], { LINT_STATUS: '7' });
  assert.equal(result.status, 7);
  assert.deepEqual(result.calls.map(call => call.name), ['lint', 'typecheck']);
  assert.equal(f.run([], { TYPECHECK_STATUS: '8' }).status, 8);
});
