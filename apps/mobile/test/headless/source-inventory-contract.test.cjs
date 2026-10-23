const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(require.resolve('typescript', {paths:[process.cwd()]}));
const {scan,compare} = require('./source-inventory.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hither-source-inventory-'));
try {
  fs.mkdirSync(path.join(directory, 'src'));
  fs.writeFileSync(path.join(directory, 'App.tsx'), 'export default function App() { return <Button onPress={save} />; }');
  fs.writeFileSync(path.join(directory, 'src/service.ts'), 'export async function save() { return 1; }');
  const baseline = scan(directory, ts);
  assert(baseline.some(entry => entry.kind === 'callback' && entry.name === 'onPress'));
  assert.deepEqual(compare(baseline, scan(directory, ts)), {added:[],removed:[]});
  fs.writeFileSync(path.join(directory, 'App.tsx'), 'export default function App() { return <Button onPress={save} onLongPress={remove} />; }');
  fs.writeFileSync(path.join(directory, 'src/service.ts'), 'export async function save() { return 2; }');
  const changed = compare(baseline, scan(directory, ts));
  assert(changed.added.some(entry => entry.name === 'onLongPress'));
  assert(changed.removed.some(entry => entry.name === 'save'));
  assert(changed.added.some(entry => entry.name === 'save'));
  fs.writeFileSync(path.join(directory, 'src/service.ts'), 'export {save as persist} from "./other";');
  assert(scan(directory, ts).some(entry => entry.kind === 'export-alias'));
  fs.writeFileSync(path.join(directory, 'src/service.ts'), 'function Screen() { useMountEffect(start); }');
  assert(scan(directory, ts).some(entry => entry.kind === 'lifecycle' && entry.name === 'useMountEffect'));
  console.log('Source inventory detects new callbacks, changed service bodies and exported aliases');
} finally {
  assert(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}hither-source-inventory-`));
  fs.rmSync(directory, {recursive:true,force:true});
}
