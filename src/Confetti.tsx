import React, { useEffect, useRef } from 'react';

// ── 꽃가루 ────────────────────────────────────────────────
export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext('2d');
    if (!cv || !g || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = (cv.width = window.innerWidth * dpr);
    const H = (cv.height = window.innerHeight * dpr);
    const colors = ['#f5c542', '#ff6b6b', '#4dabf7', '#51cf66', '#ffffff', '#c8974e', '#f783ac'];
    const ps = Array.from({ length: 200 }, (_, i) => {
      const fromLeft = i % 2 === 0;
      return {
        x: fromLeft ? 0 : W,
        y: H * (0.55 + Math.random() * 0.4),
        vx: (fromLeft ? 1 : -1) * (5 + Math.random() * 16) * dpr,
        vy: -(9 + Math.random() * 20) * dpr,
        w: (6 + Math.random() * 8) * dpr,
        h: (4 + Math.random() * 6) * dpr,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        color: colors[i % colors.length],
      };
    });
    const started = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = now - started;
      g.clearRect(0, 0, W, H);
      g.globalAlpha = t > 3600 ? Math.max(0, 1 - (t - 3600) / 900) : 1;
      for (const p of ps) {
        p.vy += 0.26 * dpr;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.color;
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)) + 1);
        g.restore();
      }
      if (t < 4500) raf = requestAnimationFrame(frame);
      else g.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="confetti-canvas" aria-hidden="true" />;
}
