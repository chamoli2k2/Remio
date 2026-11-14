import { useEffect, useRef, useState } from 'react';

/** A number that counts up once, the first time it is seen. Reads as its final value without scripting. */
export default function CountUp({ to, suffix = '', duration = 1400 }) {
  const ref = useRef(null);
  const [value, setValue] = useState(to);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    setValue(0);
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        setValue(Math.round(to * (1 - (1 - t) ** 3)));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to, duration]);
  return <span ref={ref}>{value.toLocaleString('en-US')}{suffix}</span>;
}
