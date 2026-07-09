// Mock the supabase singleton so importing activityLog does not pull in
// react-native-url-polyfill / AsyncStorage (native-only) or require env vars.
jest.mock('../api/supabase', () => ({
  supabase: { from: jest.fn(), auth: { getSession: jest.fn() } },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

import { enqueue } from '../utils/activityLog';

describe('enqueue', () => {
  it('appends an entry to the queue', () => {
    const queue = [{ event: 'a', ts: '1' }];
    const next = enqueue(queue, { event: 'b', ts: '2' });
    expect(next).toEqual([
      { event: 'a', ts: '1' },
      { event: 'b', ts: '2' },
    ]);
  });

  it('drops the oldest entries once the queue exceeds 100', () => {
    const queue = Array.from({ length: 100 }, (_, i) => ({ event: `e${i}`, ts: String(i) }));
    const next = enqueue(queue, { event: 'newest', ts: '100' });
    expect(next).toHaveLength(100);
    expect(next[0]).toEqual({ event: 'e1', ts: '1' });
    expect(next[next.length - 1]).toEqual({ event: 'newest', ts: '100' });
  });
});
