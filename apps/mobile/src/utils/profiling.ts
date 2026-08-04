import { useEffect, useRef } from 'react';
import { energyObservability } from '../state/energyObservability';

// 1. Legacy hook retained for call-site compatibility. Native performance
// samples provide FPS; a permanent requestAnimationFrame loop would distort
// the very energy baseline this module is meant to observe.
export function useJSFPSLogger() {
  useEffect(() => {
    energyObservability.increment('render');
  }, []);
}

// 2. Render Time Profiler Callback
export const onRenderProfile = (
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number
) => {
  void id;
  void phase;
  void actualDuration;
  void baseDuration;
  void startTime;
  void commitTime;
  energyObservability.increment('render');
};

// 3. Unnecessary Re-render Tracker
export function useRenderTrace(componentName: string, props: any) {
  const prevProps = useRef(props);

  useEffect(() => {
    energyObservability.increment('render');
    const changedProps = Object.keys(props).filter(k => props[k] !== prevProps.current[k]);
    void componentName;
    void changedProps;
    prevProps.current = props;
  });
}
