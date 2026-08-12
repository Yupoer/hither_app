import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  gatherRequestPageIndex,
  resolveGatherRequestSelection,
  sortGatherRequestsFifo,
} from '../utils/gatherRequestInbox';

const map = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');

describe('gather request inbox FIFO (#173)', () => {
  it('sorts by created_at then id', () => {
    const sorted = sortGatherRequestsFifo([
      { id: 'b', createdAt: '2026-08-01T12:00:00.000Z' },
      { id: 'a', createdAt: '2026-08-01T10:00:00.000Z' },
      { id: 'c', createdAt: '2026-08-01T10:00:00.000Z' },
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps selection by request id after sibling changes', () => {
    expect(
      resolveGatherRequestSelection({
        sortedIds: ['a', 'b', 'c'],
        previousId: 'b',
      }),
    ).toBe('b');
    expect(
      resolveGatherRequestSelection({
        sortedIds: ['a', 'c'],
        previousId: 'b',
        removedId: 'b',
      }),
    ).toBe('a');
  });

  it('maps selected id to paging index', () => {
    expect(gatherRequestPageIndex(['a', 'b', 'c'], 'c')).toBe(2);
    expect(gatherRequestPageIndex(['a', 'b'], 'missing')).toBe(0);
  });

  it('shows requests on Route pane for leader and not in route editor overlay', () => {
    expect(map).toContain('testID="route-gather-request-inbox"');
    expect(map).toContain('sortGatherRequestsFifo');
    // Editor overlay block must not map gatherPointRequests for approval.
    const editorStart = map.indexOf("visible={overlay === 'route'}");
    expect(editorStart).toBeGreaterThan(-1);
    const editorEnd = map.indexOf('DestinationReorderList', editorStart);
    const editorBlock = map.slice(editorStart, editorEnd);
    expect(editorBlock).not.toContain('gatherPointRequests.map');
    expect(editorBlock).not.toContain('handleGatherPointRequest');
  });
});
