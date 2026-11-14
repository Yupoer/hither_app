import { createElement, useState } from 'react';
import { useMountEffect } from '../hooks/useMountEffect';
import { useVisibleUi } from './foregroundUi';

const MEETING_WINDOW_MS = 15 * 60_000;
const MAX_TIMER_MS = 2_147_483_647;

function nearMeetingAt(meetAt: string | null | undefined, now: number) {
  const meeting = meetAt ? Date.parse(meetAt) : NaN;
  return Number.isFinite(meeting) && meeting >= now && meeting - now <= MEETING_WINDOW_MS;
}

export function useNearMeeting(meetAt: string | null | undefined, enabled: boolean) {
  const visible = useVisibleUi();
  const active = enabled && visible;
  const [window, setWindow] = useState(() => ({ meetAt, nearMeeting: nearMeetingAt(meetAt, Date.now()) }));
  if (window.meetAt !== meetAt) setWindow({ meetAt, nearMeeting: false });
  const update = (nearMeeting: boolean) => setWindow(current =>
    current.meetAt !== meetAt || current.nearMeeting === nearMeeting ? current : { meetAt, nearMeeting });
  return {
    nearMeeting: window.nearMeeting,
    lifecycle: createElement(MeetingWindowSchedule, { key: `${meetAt}:${active}`, meetAt, active, update }),
  };
}

function MeetingWindowSchedule({ meetAt, active, update }: {
  meetAt: string | null | undefined;
  active: boolean;
  update: (nearMeeting: boolean) => void;
}) {
  useMountEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const now = Date.now();
      const meeting = meetAt ? Date.parse(meetAt) : NaN;
      update(nearMeetingAt(meetAt, now));
      if (!Number.isFinite(meeting) || now > meeting) return;
      const next = now < meeting - MEETING_WINDOW_MS ? meeting - MEETING_WINDOW_MS : meeting + 1;
      timer = setTimeout(tick, Math.min(MAX_TIMER_MS, Math.max(1, next - now)));
    };
    tick();
    return () => clearTimeout(timer);
  });
  return null;
}
