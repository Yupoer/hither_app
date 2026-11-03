import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('installed cache key binds exact runtime, Bun installer, locked inputs, patch names and repository configuration', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mobile-install-key-'));
  try {
    for (const directory of ['scripts','apps/mobile/patches','.github/actions/setup-mobile']) fs.mkdirSync(path.join(root,directory),{recursive:true});
    const script=path.join(root,'scripts/mobile-install-key.mjs');
    fs.writeFileSync(script,fs.readFileSync(new URL('./mobile-install-key.mjs',import.meta.url),'utf8').replace("from 'node:child_process'","from './bun-fixture.mjs'"));
    fs.writeFileSync(path.join(root,'scripts/bun-fixture.mjs'),"export const execFileSync = (command,args) => { if (command !== 'bun' || String(args) !== '--version') throw new Error('unexpected installer probe'); return process.env.KEY_BUN_VERSION; };");
    const files=['apps/mobile/package.json','apps/mobile/package-lock.json','apps/mobile/patches/one.patch','.github/actions/setup-mobile/action.yml','scripts/install-mobile-dependencies.sh','.npmrc','apps/mobile/.npmrc','bunfig.toml','apps/mobile/bunfig.toml'];
    for(const file of files) fs.writeFileSync(path.join(root,file),file);
    const run=(extra={})=>{
      const result=spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8',env:{...process.env,KEY_BUN_VERSION:'1.4.4',...extra}});
      assert.equal(result.status,0,result.stderr);
      return result.stdout.trim();
    };
    const original=run();
    assert.ok(original.startsWith(`key=mobile-installed-v2-${process.platform}-${process.arch}-${process.version}-bun1.4.4-`));
    for(const file of [...files,'scripts/mobile-install-key.mjs']) {
      const target=path.join(root,file), bytes=fs.readFileSync(target);
      fs.appendFileSync(target,'\n');
      assert.notEqual(run(),original,file);
      fs.writeFileSync(target,bytes);
    }
    fs.renameSync(path.join(root,'apps/mobile/patches/one.patch'),path.join(root,'apps/mobile/patches/two.patch'));
    assert.notEqual(run(),original,'patch name');
    fs.renameSync(path.join(root,'apps/mobile/patches/two.patch'),path.join(root,'apps/mobile/patches/one.patch'));
    assert.notEqual(run({KEY_BUN_VERSION:'1.4.5'}),original);
    assert.equal(run(),original);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});
