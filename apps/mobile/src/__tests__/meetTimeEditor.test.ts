import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Destination } from '../types';

const mockSetMeetTime = jest.fn(async (..._args: unknown[]) => undefined);
const mockSchedule = jest.fn(async (input: { data: { kind: string } }, _at: Date) => `n-${input.data.kind}`);
const mockCancel = jest.fn(async (_id: string) => undefined);
const mockOff = jest.fn();

jest.mock('@react-native-community/datetimepicker', () => ({ DateTimePickerAndroid: { open: jest.fn() } }));
jest.mock('../api/client', () => ({
  setDestinationMeetTime: (...args: unknown[]) => mockSetMeetTime(...args),
}));
jest.mock('../native', () => ({
  notifications: {
    scheduleLocalNotificationAt: (input: { data: { kind: string } }, at: Date) => mockSchedule(input, at),
    cancelScheduledNotification: (id: string) => mockCancel(id),
    addForegroundListener: () => mockOff,
  },
}));
jest.mock('../state/PreferencesContext', () => ({ DEFAULT_MEET_RED_MIN: 10, MEET_RED_OPTIONS: [5, 10, 15] }));
jest.mock('../utils/haptics', () => ({ alertBuzz: jest.fn() }));

import { useMeetTimeEditor, type UseMeetTimeEditorInput } from '../screens/MapScreen/hooks/useMeetTimeEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stop = (id: string, overrides: Partial<Destination> = {}) =>
  ({ id, title: id, order: 0, day: 1, coordinates: { latitude: 0, longitude: 0 }, ...overrides }) as Destination;

describe('useMeetTimeEditor', () => {
  let editor: ReturnType<typeof useMeetTimeEditor> | undefined;
  let renderer: ReactTestRenderer | undefined;
  const setMeetRedMin = jest.fn();
  const refresh = jest.fn(async () => true);
  const showOperationFailure = jest.fn();

  function input(overrides: Partial<UseMeetTimeEditorInput> = {}): UseMeetTimeEditorInput {
    return {
      destinations: [],
      departureDate: null,
      canEditItinerary: true,
      meetRedMin: 15,
      setMeetRedMin,
      refresh,
      showOperationFailure,
      t: (key) => key,
      ...overrides,
    };
  }
  async function render(props: UseMeetTimeEditorInput) {
    function Harness() {
      editor = useMeetTimeEditor(props);
      return editor.lifecycle;
    }
    await act(async () => {
      if (renderer) renderer.update(React.createElement(Harness));
      else renderer = create(React.createElement(Harness));
    });
  }

  beforeEach(() => jest.clearAllMocks());
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
  });

  it('schedules a red-zone warning and a due reminder for the soonest future meet time only', async () => {
    const soon = new Date(Date.now() + 60 * 60_000).toISOString();
    const later = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    await render(input({ destinations: [
      stop('later', { meetAt: later }), stop('past', { meetAt: past }), stop('soon', { meetAt: soon, meetRedMinutes: 20 }),
    ] }));
    const scheduled = mockSchedule.mock.calls.map(([payload, at]) => [payload.data, at.getTime()]);
    expect(scheduled).toEqual([
      [{ kind: 'meetTimeWarn', destinationId: 'soon' }, Date.parse(soon) - 20 * 60_000],
      [{ kind: 'meetTime', destinationId: 'soon' }, Date.parse(soon)],
    ]);
    await act(async () => renderer?.unmount());
    renderer = undefined;
    expect(mockCancel.mock.calls.map(([id]) => id).sort()).toEqual(['n-meetTime', 'n-meetTimeWarn']);
    expect(mockOff).toHaveBeenCalled();
  });

  it('opens the editor only for itinerary editors, on the stop day with the remembered red threshold', async () => {
    await render(input({ canEditItinerary: false }));
    act(() => editor?.openMeetTimePicker(stop('a')));
    expect(editor?.meetTimeEditor).toBeNull();

    const dayAfterTomorrow = new Date();
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    const departure = dayAfterTomorrow.toISOString().slice(0, 10);
    await render(input({ departureDate: departure }));
    act(() => editor?.openMeetTimePicker(stop('b', { day: 2 })));
    expect(editor?.meetTimeEditor).toMatchObject({ id: 'b', redMin: 15, quickMinutes: null });
    const value = editor!.meetTimeEditor!.value;
    const expectedDay = new Date(`${departure}T12:00:00`);
    expectedDay.setDate(expectedDay.getDate() + 1);
    expect(value.getDate()).toBe(expectedDay.getDate());
  });

  it('saves the meet time with its red threshold, remembers the threshold, and refreshes', async () => {
    await render(input());
    const at = new Date(Date.now() + 2 * 60 * 60_000);
    await act(async () => { editor?.persistMeetTime('a', at, 5); });
    expect(mockSetMeetTime).toHaveBeenCalledWith('a', at.toISOString(), 5);
    expect(setMeetRedMin).toHaveBeenCalledWith(5);
    expect(refresh).toHaveBeenCalled();

    await act(async () => { editor?.persistMeetTime('a', null); });
    expect(mockSetMeetTime).toHaveBeenLastCalledWith('a', null, null);
  });

  it('shows a failure instead of throwing when the save fails', async () => {
    mockSetMeetTime.mockRejectedValueOnce(new Error('offline'));
    await render(input());
    await act(async () => { editor?.persistMeetTime('a', new Date(Date.now() + 60_000)); });
    expect(showOperationFailure).toHaveBeenCalledWith('map.setFailedTitle', expect.any(String));
    expect(refresh).not.toHaveBeenCalled();
  });
  it('cancels a notification whose native scheduling resolves after unmount', async () => {
    let resolve!: (value: string) => void;
    const late = new Promise<string>(done => { resolve = done; });
    mockSchedule.mockImplementationOnce(() => late);
    await render(input({ destinations: [stop('late', { meetAt: new Date(Date.now() + 60_000).toISOString() })] }));
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
    await act(async () => { resolve('late-notification'); });
    expect(mockCancel).toHaveBeenCalledWith('late-notification');
    expect(mockOff).toHaveBeenCalled();
  });

});
