import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { digestTree } from './verified-cli-tree.mjs';

function fixture(root, reverse = false) {
  const files = [
    ['package.json', '{"name":"reviewed-cli"}'],
    ['node_modules/tool/bin.js', 'console.log("reviewed")'],
  ];
  for (const [name, contents] of reverse ? files.reverse() : files) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
}

test('CLI tree digest is deterministic and covers every file', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'verified-cli-tree-'));
  try {
    const left = path.join(temporary, 'left');
    const right = path.join(temporary, 'right');
    fs.mkdirSync(left);
    fs.mkdirSync(right);
    fixture(left);
    fixture(right, true);
    assert.equal(digestTree(left), digestTree(right));
    fs.appendFileSync(path.join(right, 'node_modules/tool/bin.js'), '\nchanged');
    assert.notEqual(digestTree(left), digestTree(right));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('CLI tree digest frames file boundaries', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'verified-cli-framing-'));
  const frame = (value) => {
    const bytes = Buffer.from(value);
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    return Buffer.concat([length, bytes]);
  };
  try {
    const split = path.join(temporary, 'split');
    const joined = path.join(temporary, 'joined');
    fs.mkdirSync(split);
    fs.mkdirSync(joined);
    fs.writeFileSync(path.join(split, 'a'), 'A');
    fs.writeFileSync(path.join(split, 'b'), 'B');
    fs.writeFileSync(path.join(joined, 'a'), Buffer.concat([
      Buffer.from('A'), frame('file'), frame('b'), Buffer.from('B'),
    ]));
    assert.notEqual(digestTree(split), digestTree(joined));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('CLI tree digest rejects linked content', { skip: process.platform === 'win32' }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'verified-cli-link-'));
  try {
    const root = path.join(temporary, 'root');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(temporary, 'outside.js'), 'unreviewed');
    fs.symlinkSync(path.join(temporary, 'outside.js'), path.join(root, 'bin.js'));
    assert.throws(() => digestTree(root), /contains a link/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
