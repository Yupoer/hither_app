import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const { inventoryEntries, scenarioEntries, exclusions } = require('../../test/headless/actions.cjs');
const { audit, auditScenarios } = require('../../test/headless/inventory.cjs');
const { scan, compare } = require('../../test/headless/source-inventory.cjs');

describe('headless operation completeness', () => {
  it('maps reviewed operation families to existing production entries', () => {
    const result = audit(inventoryEntries(), exclusions());
    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it('links each feasible family to observable scenarios on both platforms', () => {
    const result = auditScenarios(scenarioEntries(), exclusions());
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
    require('../../test/headless/scenario-coverage.test.cjs');
  });

  it('keeps domain backend fixtures strict and validates observable state transitions', () => {
    const result = spawnSync(process.execPath, ['--test', 'test/headless/backend-contracts.test.cjs'], {
      cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
  });

  it('enforces host guards, explicit completion and navigation ownership', () => {
    const root = path.resolve(__dirname, '../..');
    const result = spawnSync(process.execPath, ['--test', 'test/headless/host-contracts.test.cjs'], {
      cwd: root, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
  });
});
