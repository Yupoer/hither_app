import { useEffect, useRef } from 'react';

// 1. JS FPS Logger
export function useJSFPSLogger() {
  useEffect(() => {
    let frameCount = 0;
    let lastTime = Date.now();
    let animationFrameId: number;

    const tick = () => {
      frameCount++;
      const now = Date.now();
      if (now - lastTime >= 1000) {
        console.log(`[Metrics] JS FPS: ${frameCount}`);
        frameCount = 0;
        lastTime = now;
      }
      animationFrameId = requestAnimationFrame(tick);
    };
    animationFrameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animationFrameId);
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
  console.log(`[Metrics] Profiler [${id}] - phase: ${phase}, duration: ${actualDuration.toFixed(2)}ms (base: ${baseDuration.toFixed(2)}ms)`);
};

// 3. Unnecessary Re-render Tracker
export function useRenderTrace(componentName: string, props: any) {
  const prevProps = useRef(props);

  useEffect(() => {
    const changedProps = Object.keys(props).filter(k => props[k] !== prevProps.current[k]);
    if (changedProps.length > 0) {
      console.log(`[Metrics] RenderTrace [${componentName}] re-rendered due to changed props:`, changedProps.join(', '));
    }
    prevProps.current = props;
  });
}
