import path from 'node:path';
import fs from 'node:fs';

const { inventoryEntries, exclusions } = require('../../test/headless/actions.cjs');
const { audit } = require('../../test/headless/inventory.cjs');
const { scan, compare } = require('../../test/headless/source-inventory.cjs');

describe('headless operation completeness', () => {
  it('maps reviewed operation families to existing production entries', () => {
    const result = audit(inventoryEntries(), exclusions());
    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it('requires source review when callbacks, lifecycle owners or exported operations change', () => {
    const root = path.resolve(__dirname, '../..');
    const expected = JSON.parse(fs.readFileSync(path.join(root, 'test/headless/source-inventory.json'), 'utf8'));
    expect(compare(expected, scan(root))).toEqual({ added: [], removed: [] });
  });

  it('rejects missing operations, stale source anchors and unreviewed source changes', () => {
    require('../../test/headless/inventory-contract.test.cjs');
    require('../../test/headless/source-inventory-contract.test.cjs');
  });

  it('keeps domain backend fixtures strict and validates observable state transitions', () => {
    require('../../test/headless/backend-contracts.test.cjs');
  });
});
