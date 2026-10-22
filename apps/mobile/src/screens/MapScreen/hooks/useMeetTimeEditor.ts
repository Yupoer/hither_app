import { createElement, Fragment, useCallback, useMemo, useState } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { setDestinationMeetTime } from '../../../api/client';
import type { TranslationKey } from '../../../i18n';
import { notifications } from '../../../native';
import { DEFAULT_MEET_RED_MIN, MEET_RED_OPTIONS } from '../../../state/PreferencesContext';
import type { Destination } from '../../../types';
import { alertBuzz } from '../../../utils/haptics';
import { alignMeetTimeToTripDay, clampDateNotBeforeToday, startOfTodayLocal } from '../../../utils/meetTime';
import { getOperationErrorMessage } from '../../../utils/operationError';

export interface MeetTimeEditorState {
  id: string;
  value: Date;
  redMin: number;
  quickMinutes: number | null;
}

export interface UseMeetTimeEditorInput {
  /** Visible gathering points; the soonest future meet time gets local reminders. */
  destinations: Destination[];
  departureDate: string | null | undefined;
  canEditItinerary: boolean;
  meetRedMin: number;
  setMeetRedMin: (minutes: number) => void;
  refresh: () => Promise<unknown>;
  showOperationFailure: (title: string, message: string) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

/**
 * Meet-time countdown editor (date + time + shared red threshold) and the
 * device-side reminders for the soonest upcoming meet time.
 */
export function useMeetTimeEditor({
  destinations,
  departureDate,
  canEditItinerary,
  meetRedMin,
  setMeetRedMin,
  refresh,
  showOperationFailure,
  t,
}: UseMeetTimeEditorInput) {
  const [meetTimeEditor, setMeetTimeEditor] = useState<MeetTimeEditorState | null>(null);
  // Meet labels / location freshness tick inside small memo children
  // (MeetCountdown, LocationFreshnessText) so MapScreen is not re-rendered on a timer.

  // The soonest gathering point whose meet time is still ahead — schedule local
  // due + red-threshold warning as a device-side backup to server APNs.
  const nextMeet = useMemo(() => {
    const now = Date.now();
    return (
      destinations
        .filter((d) => d.meetAt && new Date(d.meetAt as string).getTime() > now)
        .sort(
          (a, b) =>
            new Date(a.meetAt as string).getTime() -
            new Date(b.meetAt as string).getTime(),
        )[0] ?? null
    );
  }, [destinations]);

  const meetTimeRemindersLifecycle = createElement(MeetTimeReminders, { nextMeet, meetRedMin, t });

  const persistMeetTime = useCallback(
    (destinationId: string, value: Date | null, redMin?: number) => {
      const clamped = value ? clampDateNotBeforeToday(value) : null;
      setDestinationMeetTime(
        destinationId,
        clamped ? clamped.toISOString() : null,
        clamped ? (redMin ?? meetRedMin ?? DEFAULT_MEET_RED_MIN) : null,
      )
        .then(() => {
          if (typeof redMin === 'number') setMeetRedMin(redMin);
          return refresh();
        })
        .catch((cause) => showOperationFailure(t('map.setFailedTitle'), getOperationErrorMessage(cause)));
    },
    [refresh, t, meetRedMin, setMeetRedMin, showOperationFailure],
  );

  const openMeetTimePicker = useCallback(
    (dest: Destination) => {
      if (!canEditItinerary) return;
      const initial = clampDateNotBeforeToday(
        alignMeetTimeToTripDay(
          dest.meetAt ? new Date(dest.meetAt) : new Date(),
          departureDate,
          dest.day || 1,
        ),
      );
      const red =
        dest.meetRedMinutes ??
        ((MEET_RED_OPTIONS as readonly number[]).includes(meetRedMin)
          ? meetRedMin
          : DEFAULT_MEET_RED_MIN);
      setMeetTimeEditor({
        id: dest.id,
        value: initial,
        redMin: red,
        quickMinutes: null,
      });
    },
    [canEditItinerary, departureDate, meetRedMin],
  );

  const openAndroidMeetDate = useCallback(() => {
    if (!meetTimeEditor) return;
    const minDate = startOfTodayLocal();
    DateTimePickerAndroid.open({
      value: meetTimeEditor.value,
      mode: 'date',
      minimumDate: minDate,
      onChange: (event, selected) => {
        if (event.type !== 'set' || !selected) return;
        const next = new Date(meetTimeEditor.value);
        next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
        const clamped = clampDateNotBeforeToday(next);
        setMeetTimeEditor((s) =>
          s ? { ...s, value: clamped, quickMinutes: null } : s,
        );
        // Chain into time picker so date+time is one flow on Android.
        DateTimePickerAndroid.open({
          value: clamped,
          mode: 'time',
          is24Hour: true,
          onChange: (timeEvent, timeSelected) => {
            if (timeEvent.type !== 'set' || !timeSelected) return;
            setMeetTimeEditor((s) => {
              if (!s) return s;
              const merged = new Date(s.value);
              merged.setHours(timeSelected.getHours(), timeSelected.getMinutes(), 0, 0);
              return {
                ...s,
                value: clampDateNotBeforeToday(merged),
                quickMinutes: null,
              };
            });
          },
        });
      },
    });
  }, [meetTimeEditor]);

  return {
    lifecycle: createElement(Fragment, { key: 'meet-time-editor-runtime' }, meetTimeRemindersLifecycle), meetTimeEditor, setMeetTimeEditor, persistMeetTime, openMeetTimePicker, openAndroidMeetDate };
}

function MeetTimeReminders({ nextMeet, meetRedMin, t }: {
  nextMeet: Destination;
  meetRedMin: number;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const [meetTimeRemindersInputs, setMeetTimeRemindersInputs] = useState(() => ({ generation: 0, nextMeet_id: nextMeet?.id, nextMeet_meetAt: nextMeet?.meetAt, nextMeet_meetRedMinutes: nextMeet?.meetRedMinutes, nextMeet_title: nextMeet?.title, meetRedMin, t }));
  if (!(Object.is(meetTimeRemindersInputs.nextMeet_id, nextMeet?.id) && Object.is(meetTimeRemindersInputs.nextMeet_meetAt, nextMeet?.meetAt) && Object.is(meetTimeRemindersInputs.nextMeet_meetRedMinutes, nextMeet?.meetRedMinutes) && Object.is(meetTimeRemindersInputs.nextMeet_title, nextMeet?.title) && Object.is(meetTimeRemindersInputs.meetRedMin, meetRedMin) && Object.is(meetTimeRemindersInputs.t, t))) {
    setMeetTimeRemindersInputs({ generation: meetTimeRemindersInputs.generation + 1, nextMeet_id: nextMeet?.id, nextMeet_meetAt: nextMeet?.meetAt, nextMeet_meetRedMinutes: nextMeet?.meetRedMinutes, nextMeet_title: nextMeet?.title, meetRedMin, t });
  }
  return createElement(MeetTimeRemindersCommit, { key: meetTimeRemindersInputs.generation, nextMeet, meetRedMin, t });
}

function MeetTimeRemindersCommit({ nextMeet, meetRedMin, t }: {
  nextMeet: Destination;
  meetRedMin: number;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  useMountEffect(() => {
    if (!nextMeet?.meetAt) return;
    const meetAt = new Date(nextMeet.meetAt as string);
    const redMin = nextMeet.meetRedMinutes ?? meetRedMin ?? DEFAULT_MEET_RED_MIN;
    const warnAt = new Date(meetAt.getTime() - redMin * 60_000);
    const ids: string[] = [];
    let cancelled = false;

    const track = (nid: string | null) => {
      if (!nid) return;
      if (cancelled) void notifications.cancelScheduledNotification(nid);
      else ids.push(nid);
    };

    // Red-zone warning (e.g. enter 9:59 when threshold is 10 min).
    if (warnAt.getTime() > Date.now()) {
      void notifications
        .scheduleLocalNotificationAt(
          {
            title: t('meetTime.warnTitle'),
            body: t('meetTime.warnBody', { title: nextMeet.title, minutes: redMin }),
            data: { kind: 'meetTimeWarn', destinationId: nextMeet.id },
          },
          warnAt,
        )
        .then(track);
    }

    void notifications
      .scheduleLocalNotificationAt(
        {
          title: t('meetTime.notifyTitle'),
          body: t('meetTime.notifyBody', { title: nextMeet.title }),
          data: { kind: 'meetTime', destinationId: nextMeet.id },
        },
        meetAt,
      )
      .then(track);

    const off = notifications.addForegroundListener((data) => {
      if (data.kind === 'meetTime' || data.kind === 'meetTimeWarn') alertBuzz();
    });
    return () => {
      cancelled = true;
      for (const id of ids) void notifications.cancelScheduledNotification(id);
      off();
    };
  });
  return null;
}
