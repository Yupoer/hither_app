import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function updateField(hash, value) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length).update(bytes);
}

export function digestTree(input) {
  const requestedRoot = path.resolve(input);
  const rootStats = fs.lstatSync(requestedRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error('Verified CLI root must be a physical directory');
  }

  const hash = createHash('sha256');
  const walk = (absolute, relative) => {
    const stats = fs.lstatSync(absolute);
    if (stats.isSymbolicLink()) throw new Error(`Verified CLI tree contains a link: ${relative}`);
    if (stats.isDirectory()) {
      updateField(hash, 'directory');
      updateField(hash, relative);
      const entries = fs.readdirSync(absolute)
        .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
      for (const name of entries) {
        walk(path.join(absolute, name), relative ? `${relative}/${name}` : name);
      }
      return;
    }
    if (!stats.isFile()) throw new Error(`Verified CLI tree contains a non-file entry: ${relative}`);
    updateField(hash, 'file');
    updateField(hash, relative);
    updateField(hash, fs.readFileSync(absolute));
  };
  walk(requestedRoot, '');
  return hash.digest('hex');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('usage: node scripts/verified-cli-tree.mjs <cli-root>');
  console.log(digestTree(process.argv[2]));
}
