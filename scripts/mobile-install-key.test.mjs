import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('installed cache key binds exact runtime, installer, locked inputs, patch names and effective npm settings', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mobile-install-key-'));
  try {
    for (const directory of ['scripts','apps/mobile/patches','.github/actions/setup-mobile']) fs.mkdirSync(path.join(root,directory),{recursive:true});
    const script=path.join(root,'scripts/mobile-install-key.mjs');
    fs.writeFileSync(script,fs.readFileSync(new URL('./mobile-install-key.mjs',import.meta.url),'utf8').replace("from 'node:child_process'","from './npm-fixture.mjs'"));
    fs.writeFileSync(path.join(root,'scripts/npm-fixture.mjs'),"export const execFileSync = (_command,args) => args.includes('--version') ? process.env.KEY_NPM_VERSION : process.env.KEY_NPM_CONFIG;");
    const files=['apps/mobile/package.json','apps/mobile/package-lock.json','apps/mobile/patches/one.patch','.github/actions/setup-mobile/action.yml','apps/mobile/.npmrc'];
    for(const file of files) fs.writeFileSync(path.join(root,file),file);
    const run=(extra={})=>{
      const result=spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8',env:{...process.env,KEY_NPM_VERSION:'10.9.3',KEY_NPM_CONFIG:'{"ignore-scripts":false}',...extra}});
      assert.equal(result.status,0,result.stderr);
      return result.stdout.trim();
    };
    const original=run();
    assert.ok(original.startsWith(`key=mobile-installed-v1-${process.platform}-${process.arch}-${process.version}-npm10.9.3-`));
    for(const file of [...files,'scripts/mobile-install-key.mjs']) {
      const target=path.join(root,file), bytes=fs.readFileSync(target);
      fs.appendFileSync(target,'\n');
      assert.notEqual(run(),original,file);
      fs.writeFileSync(target,bytes);
    }
    fs.renameSync(path.join(root,'apps/mobile/patches/one.patch'),path.join(root,'apps/mobile/patches/two.patch'));
    assert.notEqual(run(),original,'patch name');
    fs.renameSync(path.join(root,'apps/mobile/patches/two.patch'),path.join(root,'apps/mobile/patches/one.patch'));
    assert.notEqual(run({KEY_NPM_VERSION:'10.9.4'}),original);
    assert.notEqual(run({KEY_NPM_CONFIG:'{"ignore-scripts":true}'}),original);
    assert.equal(run(),original);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});
