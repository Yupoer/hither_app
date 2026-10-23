const fs = require('node:fs');
const path = require('node:path');
const inventory = require('./operation-inventory.json');

function audit(actions, exclusions = [], root = path.resolve(__dirname, '../..')) {
  const families = new Map(inventory.families.map(entry => [entry.id, entry]));
  const coverage = new Map([...families.keys()].map(id => [id, []]));
  const errors = [];
  const names = new Set();
  const source = anchor => {
    if (!anchor || typeof anchor.file !== 'string' || !anchor.symbol) return false;
    const file = path.resolve(root, anchor.file);
    if (!file.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(file)) return false;
    return fs.readFileSync(file, 'utf8').includes(anchor.symbol);
  };
  for (const action of actions) {
    if (names.has(action.name)) errors.push(`Duplicate action ${action.name}`);
    names.add(action.name);
    if (!action.inventory?.length && !action.support) errors.push(`${action.name}: no source inventory mapping`);
    if (!action.sources?.length || !action.sources.every(source)) errors.push(`${action.name}: invalid production source anchor`);
    for (const id of action.inventory ?? []) {
      if (!families.has(id)) errors.push(`${action.name}: unknown inventory ${id}`);
      else coverage.get(id).push(action.name);
    }
  }
  const exempt = new Map();
  for (const entry of exclusions) {
    if (!families.has(entry.id) || exempt.has(entry.id) || entry.kind !== 'presentationOnly' || !entry.reason || !source(entry.source)) {
      errors.push(`Invalid presentation exclusion ${entry.id}`);
    } else exempt.set(entry.id, entry);
  }
  const missing = [...coverage].filter(([id, entries]) => !entries.length && !exempt.has(id)).map(([id]) => id);
  return { actions: actions.length, families: families.size, mapped: families.size - missing.length - exempt.size,
    presentationOnly: [...exempt.values()], missing, errors,
    entries: [...families.values()].map(entry => ({ ...entry, actions: coverage.get(entry.id), exclusion: exempt.get(entry.id) ?? null })) };
}

exports.audit = audit;
