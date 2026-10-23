const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { audit, auditScenarios } = require('./inventory.cjs');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hither-inventory-'));
try {
  fs.writeFileSync(path.join(directory, 'screen.ts'), 'function submitEmail() {}');
  const action = { name: 'auth.signIn', inventory: ['A01'], sources: [{file:'screen.ts',symbol:'submitEmail'}] };
  const result = audit([action], [], directory);
  assert(!result.missing.includes('A01'));
  assert(result.missing.includes('A02'));
  assert.deepEqual(result.errors, []);
  assert(audit([action, action], [], directory).errors.some(error => error.includes('Duplicate')));
  assert(audit([{...action, inventory:['invented']}], [], directory).errors.some(error => error.includes('unknown inventory')));
  assert(audit([{...action, sources:[{file:'screen.ts',symbol:'deletedHandler'}]}], [], directory).errors.some(error => error.includes('source anchor')));
  assert(audit([], [{id:'A01',kind:'unsupported',reason:'No fixture',source:action.sources[0]}], directory).errors.length);
  assert(audit([{...action, level:'lifecycle'}], [], directory).errors.some(error => error.includes('trigger')));
  const dead = audit([], [{id:'A01',kind:'unreachable',reason:'No production caller after source review',source:action.sources[0]}], directory);
  assert(!dead.missing.includes('A01'));
  assert.equal(dead.mapped, 0);
  const scenario = { inventory:['A01'], file:'screen.ts', pattern:'submitEmail', assertions:'Observed result', platforms:['ios','android'] };
  assert(!auditScenarios([scenario], [], directory).missing.includes('A01'));
  assert(auditScenarios([{...scenario, platforms:['ios']}], [], directory).errors.length);
  assert(auditScenarios([{...scenario, pattern:'missing test'}], [], directory).errors.length);
  assert(audit([], [{id:'A01',kind:'presentationOnly',reason:'Example only',source:{file:'../screen.ts',symbol:'submitEmail'}}], directory).errors.length);
  console.log('Inventory detects missing operations, duplicate entries, deleted source anchors and invalid exclusions');
} finally {
  assert(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}hither-inventory-`));
  fs.rmSync(directory, {recursive:true,force:true});
}
