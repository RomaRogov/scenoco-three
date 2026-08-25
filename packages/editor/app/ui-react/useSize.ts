import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Track an element's content size via ResizeObserver — react-arborist needs
 * explicit pixel width/height, so we measure its (flex) container and feed them in.
 */
export function useSize<T extends HTMLElement>(): readonly [React.RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setSize({ width: el.clientWidth, height: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
