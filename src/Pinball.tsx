import React, { useEffect, useRef, useState } from 'react';
import { sfx } from './sfx';
import { Confetti } from './Confetti';

const W = 600;
const GOAL_Y = 3600;
const R = 11;
const GRAVITY = 950;
const MAX_SPEED = 1300;
const STEP = 1 / 240;
const BUCKET = 120;

type Seg = { ax: number; ay: number; bx: number; by: number; gate?: boolean };
type Peg = { x: number; y: number; r: number; bumper: boolean; flash: number };
type Spinner = { cx: number; cy: number; half: number; omega: number; angle: number };
type Marble = {
  name: string; hue: number;
  x: number; y: number; vx: number; vy: number;
  rank: number; checkX: number; checkY: number;
};
type Mode = 'first' | 'last';
type Phase = 'ready' | 'countdown' | 'racing' | 'done';

function buildCourse() {
  const segs: Seg[] = [];
  const pegs: Peg[] = [];
  const spinners: Spinner[] = [];
  const seg = (ax: number, ay: number, bx: number, by: number, gate = false) => segs.push({ ax, ay, bx, by, gate });
  const peg = (x: number, y: number, r = 6, bumper = false) => pegs.push({ x, y, r, bumper, flash: 0 });
  const spin = (cx: number, cy: number, half: number, omega: number) => spinners.push({ cx, cy, half, omega, angle: Math.random() * Math.PI });

  // 출발 깔때기 + 문
  seg(0, 220, 240, 300);
  seg(W, 220, 360, 300);
  seg(240, 300, 360, 300, true);

  // 1구간: 핀 숲
  for (let row = 0; row < 10; row++) {
    const off = row % 2 ? 60 : 30;
    for (let x = off; x <= W - 30; x += 60) peg(x, 360 + row * 56);
  }

  // 2구간: 지그재그 경사로
  seg(0, 960, 420, 1040);
  seg(W, 1100, 180, 1180);
  seg(0, 1240, 420, 1320);

  // 3구간: 회전 막대
  spin(150, 1480, 95, 2.4);
  spin(450, 1480, 95, -2.4);
  spin(300, 1680, 120, 1.8);
  peg(90, 1690, 20, true);
  peg(510, 1690, 20, true);
  peg(300, 1400, 8);

  // 4구간: 범퍼 밭
  [1900, 2020, 2140, 2260].forEach((y, i) => {
    (i % 2 ? [210, 390] : [120, 300, 480]).forEach((x) => peg(x, y, 26, true));
    (i % 2 ? [60, 300, 540] : [210, 390]).forEach((x) => peg(x, y + 6, 7));
  });

  // 5구간: 깔때기 + 풍차
  seg(0, 2440, 230, 2580);
  seg(W, 2440, 370, 2580);
  spin(300, 2710, 105, 3);

  // 6구간: 촘촘한 핀
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? 50 : 25;
    for (let x = off; x <= W - 25; x += 50) peg(x, 2880 + row * 52, 5);
  }
  seg(0, 3300, 190, 3370);
  seg(W, 3300, 410, 3370);

  // 결승 깔때기
  seg(0, 3430, 258, 3560);
  seg(W, 3430, 342, 3560);

  const buckets = new Map<number, Peg[]>();
  for (const p of pegs) {
    for (let b = Math.floor((p.y - p.r - R) / BUCKET); b <= Math.floor((p.y + p.r + R) / BUCKET); b++) {
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b)!.push(p);
    }
  }
  return { segs, pegs, spinners, buckets };
}

function spawnMarbles(names: string[]): Marble[] {
  const slots: { x: number; y: number }[] = [];
  for (let row = 0; slots.length < names.length; row++) {
    for (let col = 0; col < 13 && slots.length < names.length; col++) {
      slots.push({ x: 60 + col * 40 + (row % 2 ? 12 : 0), y: 188 - row * 25 });
    }
  }
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return names.map((name, i) => ({
    name,
    hue: Math.round((i * 137.508) % 360),
    x: slots[i].x + (Math.random() - 0.5) * 4,
    y: slots[i].y,
    vx: 0, vy: 0, rank: 0,
    checkX: slots[i].x, checkY: slots[i].y,
  }));
}

export function PinballModal({ names, title = '🎱 핀볼 추첨', onClose }: {
  names: string[];
  title?: string;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pool] = useState(() => names.slice(0, 100));
  const [phase, setPhaseState] = useState<Phase>('ready');
  const [count, setCount] = useState(0);
  const [winner, setWinner] = useState('');
  const [mode, setMode] = useState<Mode>('first');
  const [round, setRound] = useState(0);
  const ctl = useRef<{ phase: Phase; mode: Mode }>({ phase: 'ready', mode: 'first' });
  const timers = useRef<number[]>([]);
  ctl.current.mode = mode;

  function setPhase(p: Phase) { ctl.current.phase = p; setPhaseState(p); }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  function start() {
    setWinner('');
    setPhase('countdown');
    [3, 2, 1].forEach((n, i) => {
      timers.current.push(window.setTimeout(() => { setCount(n); sfx.beep(false); }, i * 700));
    });
    timers.current.push(window.setTimeout(() => { setCount(0); sfx.beep(true); setPhase('racing'); }, 2100));
  }

  function again() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    setWinner('');
    setPhase('ready');
    setRound((r) => r + 1);
  }

  // 물리 시뮬레이션 + 렌더 루프
  useEffect(() => {
    const cv = canvasRef.current;
    const g = cv?.getContext('2d');
    if (!cv || !g) return;

    const course = buildCourse();
    const marbles = spawnMarbles(pool);
    const total = marbles.length;
    let finished = 0;
    let decided = false;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let raceT = 0;
    let checkT = 0;
    let camY = 240;
    let zoom = 1;
    let lastTick = 0;
    let lastBump = 0;
    let hitPeg = 0;
    let hitBumper = false;
    let decideTimer = 0;

    const decide = (m: Marble) => {
      if (decided) return;
      decided = true;
      decideTimer = window.setTimeout(() => {
        setWinner(m.name);
        setPhase('done');
        sfx.bravo();
      }, 800);
    };

    const collideSeg = (m: Marble, ax: number, ay: number, bx: number, by: number, sp?: Spinner) => {
      const ex = bx - ax, ey = by - ay;
      const len2 = ex * ex + ey * ey;
      let t = ((m.x - ax) * ex + (m.y - ay) * ey) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t, qy = ay + ey * t;
      let nx = m.x - qx, ny = m.y - qy;
      const d2 = nx * nx + ny * ny;
      if (d2 >= R * R) return;
      let d = Math.sqrt(d2);
      if (d < 1e-6) { const l = Math.sqrt(len2); nx = -ey / l; ny = ex / l; d = 1; } else { nx /= d; ny /= d; }
      const pen = R - Math.sqrt(d2);
      m.x += nx * pen;
      m.y += ny * pen;
      // 회전 막대는 닿은 지점의 표면 속도만큼 구슬을 쳐낸다
      const svx = sp ? -sp.omega * (qy - sp.cy) : 0;
      const svy = sp ? sp.omega * (qx - sp.cx) : 0;
      const rvx = m.vx - svx, rvy = m.vy - svy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const e = sp ? 0.7 : 0.35;
        m.vx -= (1 + e) * vn * nx;
        m.vy -= (1 + e) * vn * ny;
        if (-vn > 160) hitPeg = Math.max(hitPeg, -vn);
      }
    };

    const step = (h: number, gateOpen: boolean) => {
      for (const sp of course.spinners) sp.angle += sp.omega * h;
      for (const m of marbles) {
        if (m.rank) continue;
        m.vy += GRAVITY * h;
        m.vx *= 0.9994;
        m.vy *= 0.9994;
        const sp2 = m.vx * m.vx + m.vy * m.vy;
        if (sp2 > MAX_SPEED * MAX_SPEED) { const k = MAX_SPEED / Math.sqrt(sp2); m.vx *= k; m.vy *= k; }
        m.x += m.vx * h;
        m.y += m.vy * h;
        if (m.x < R) { m.x = R; if (m.vx < 0) m.vx = -m.vx * 0.5; }
        if (m.x > W - R) { m.x = W - R; if (m.vx > 0) m.vx = -m.vx * 0.5; }
        if (m.y < R) { m.y = R; if (m.vy < 0) m.vy = -m.vy * 0.4; }

        for (const s of course.segs) {
          if (s.gate && gateOpen) continue;
          if (m.y < Math.min(s.ay, s.by) - R - 2 || m.y > Math.max(s.ay, s.by) + R + 2) continue;
          collideSeg(m, s.ax, s.ay, s.bx, s.by);
        }
        for (const sp of course.spinners) {
          if (Math.abs(m.y - sp.cy) > sp.half + R + 2) continue;
          const cx = Math.cos(sp.angle) * sp.half, cy = Math.sin(sp.angle) * sp.half;
          collideSeg(m, sp.cx - cx, sp.cy - cy, sp.cx + cx, sp.cy + cy, sp);
        }
        const near = course.buckets.get(Math.floor(m.y / BUCKET));
        if (near) {
          for (const p of near) {
            const dx = m.x - p.x, dy = m.y - p.y;
            const rr = R + p.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr || d2 < 1e-9) continue;
            const d = Math.sqrt(d2);
            const nx = dx / d, ny = dy / d;
            m.x = p.x + nx * rr;
            m.y = p.y + ny * rr;
            const vn = m.vx * nx + m.vy * ny;
            if (vn < 0) {
              const e = p.bumper ? 0.9 : 0.5;
              m.vx -= (1 + e) * vn * nx;
              m.vy -= (1 + e) * vn * ny;
              if (p.bumper) {
                m.vx += nx * 260;
                m.vy += ny * 260;
                p.flash = 1;
                hitBumper = true;
              } else if (-vn > 160) {
                hitPeg = Math.max(hitPeg, -vn);
              }
            }
          }
        }
        if (m.y > GOAL_Y + R) {
          m.rank = ++finished;
          if (ctl.current.mode === 'first' && finished === 1) decide(m);
        }
      }
      // 구슬끼리 충돌
      for (let i = 0; i < marbles.length; i++) {
        const a = marbles[i];
        if (a.rank) continue;
        for (let j = i + 1; j < marbles.length; j++) {
          const b = marbles[j];
          if (b.rank) continue;
          const dy = a.y - b.y;
          if (dy > 2 * R || dy < -2 * R) continue;
          const dx = a.x - b.x;
          const d2 = dx * dx + dy * dy;
          if (d2 >= 4 * R * R || d2 < 1e-9) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          const pen = (2 * R - d) / 2;
          a.x += nx * pen; a.y += ny * pen;
          b.x -= nx * pen; b.y -= ny * pen;
          const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (vn < 0) {
            const imp = -(1 + 0.5) * vn / 2;
            a.vx += imp * nx; a.vy += imp * ny;
            b.vx -= imp * nx; b.vy -= imp * ny;
          }
        }
      }
    };

    const draw = (cw: number, ch: number, s: number, focusX: number, active: Marble[], leader: Marble | undefined) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
        cv.width = Math.round(cw * dpr);
        cv.height = Math.round(ch * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = g.createLinearGradient(0, 0, 0, ch);
      bg.addColorStop(0, '#0b0718');
      bg.addColorStop(1, '#1a0f2e');
      g.fillStyle = bg;
      g.fillRect(0, 0, cw, ch);

      const viewH = ch / s;
      let ox = (cw - W * s) / 2;
      if (W * s > cw) ox = Math.min(0, Math.max(cw - W * s, cw / 2 - focusX * s));
      const top = camY - viewH / 2 - 40, bottom = camY + viewH / 2 + 40;

      g.save();
      g.translate(ox, ch / 2 - camY * s);
      g.scale(s, s);

      // 경기장 바닥
      const field = g.createLinearGradient(0, top, 0, bottom);
      field.addColorStop(0, '#1d1440');
      field.addColorStop(1, '#2a1650');
      g.fillStyle = field;
      g.fillRect(0, Math.max(0, top), W, Math.min(GOAL_Y + 140, bottom) - Math.max(0, top));
      g.strokeStyle = 'rgba(255,255,255,.035)';
      g.lineWidth = 1;
      for (let y = Math.ceil(top / 60) * 60; y < bottom; y += 60) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      }

      // 결승선
      if (GOAL_Y < bottom) {
        for (let i = 0; i < W / 20; i++) {
          for (let k = 0; k < 2; k++) {
            g.fillStyle = (i + k) % 2 ? '#fff' : '#111';
            g.fillRect(i * 20, GOAL_Y + k * 20, 20, 20);
          }
        }
        g.fillStyle = '#ffd24a';
        g.font = '900 34px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText('GOAL', W / 2, GOAL_Y + 84);
      }

      // 벽
      g.strokeStyle = '#7c5cff';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(0, Math.max(0, top)); g.lineTo(0, Math.min(GOAL_Y + 140, bottom));
      g.moveTo(W, Math.max(0, top)); g.lineTo(W, Math.min(GOAL_Y + 140, bottom));
      g.stroke();

      // 경사로·문
      g.lineCap = 'round';
      for (const sg of course.segs) {
        if (Math.max(sg.ay, sg.by) < top || Math.min(sg.ay, sg.by) > bottom) continue;
        if (sg.gate && ctl.current.phase !== 'ready' && ctl.current.phase !== 'countdown') continue;
        g.strokeStyle = sg.gate ? '#ff5d73' : '#39d5ff';
        g.shadowColor = g.strokeStyle;
        g.shadowBlur = 12;
        g.lineWidth = 7;
        g.beginPath(); g.moveTo(sg.ax, sg.ay); g.lineTo(sg.bx, sg.by); g.stroke();
      }
      // 회전 막대
      for (const sp of course.spinners) {
        if (sp.cy + sp.half < top || sp.cy - sp.half > bottom) continue;
        const cx = Math.cos(sp.angle) * sp.half, cy = Math.sin(sp.angle) * sp.half;
        g.strokeStyle = '#ffb02e';
        g.shadowColor = '#ffb02e';
        g.shadowBlur = 16;
        g.lineWidth = 9;
        g.beginPath(); g.moveTo(sp.cx - cx, sp.cy - cy); g.lineTo(sp.cx + cx, sp.cy + cy); g.stroke();
        g.shadowBlur = 0;
        g.fillStyle = '#fff3d6';
        g.beginPath(); g.arc(sp.cx, sp.cy, 7, 0, Math.PI * 2); g.fill();
      }
      g.shadowBlur = 0;

      // 핀·범퍼
      for (const p of course.pegs) {
        if (p.y + p.r < top || p.y - p.r > bottom) continue;
        if (p.bumper) {
          const r = p.r * (1 + p.flash * 0.25);
          g.fillStyle = p.flash > 0.05 ? `hsl(${330 - p.flash * 40} 100% ${60 + p.flash * 25}%)` : '#ff3d9a';
          g.shadowColor = '#ff3d9a';
          g.shadowBlur = 10 + p.flash * 30;
          g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
          g.shadowBlur = 0;
          g.strokeStyle = 'rgba(255,255,255,.85)';
          g.lineWidth = 3;
          g.beginPath(); g.arc(p.x, p.y, r * 0.6, 0, Math.PI * 2); g.stroke();
        } else {
          g.fillStyle = '#cfd6ff';
          g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
        }
      }

      // 구슬
      const fontPx = Math.max(13, 11 / s);
      g.font = `800 ${fontPx}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.lineJoin = 'round';
      for (const m of active) {
        if (m.y < top || m.y > bottom) continue;
        g.fillStyle = `hsl(${m.hue} 88% 60%)`;
        g.beginPath(); g.arc(m.x, m.y, R, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,.75)';
        g.beginPath(); g.arc(m.x - R * 0.32, m.y - R * 0.36, R * 0.3, 0, Math.PI * 2); g.fill();
        if (m === leader) {
          g.strokeStyle = '#ffd24a';
          g.lineWidth = 3;
          g.beginPath(); g.arc(m.x, m.y, R + 4, 0, Math.PI * 2); g.stroke();
        }
      }
      for (const m of active) {
        if (m.y < top || m.y > bottom) continue;
        const label = m === leader ? `👑 ${m.name}` : m.name;
        g.lineWidth = fontPx * 0.32;
        g.strokeStyle = 'rgba(8,4,20,.9)';
        g.strokeText(label, m.x, m.y - R - 5);
        g.fillStyle = m === leader ? '#ffe27a' : '#fff';
        g.fillText(label, m.x, m.y - R - 5);
      }
      g.restore();

      // 미니맵
      const mmTop = 70, mmH = ch - 150, mmX = cw - 14;
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.fillRect(mmX - 3, mmTop, 6, mmH);
      g.fillStyle = 'rgba(255,255,255,.22)';
      g.fillRect(mmX - 5, mmTop + ((camY - viewH / 2) / GOAL_Y) * mmH, 10, Math.max(8, (viewH / GOAL_Y) * mmH));
      for (const m of active) {
        g.fillStyle = `hsl(${m.hue} 88% 60%)`;
        g.fillRect(mmX - 4, mmTop + Math.min(1, m.y / GOAL_Y) * mmH - 1.5, 8, 3);
      }

      // 순위표
      const rows = cw < 520 ? 5 : 8;
      const ranked = [...active].sort((a, b) => b.y - a.y).slice(0, rows);
      const px = 14, py = 70, lh = cw < 520 ? 20 : 24;
      g.fillStyle = 'rgba(10,6,24,.62)';
      g.beginPath();
      g.roundRect(px - 6, py - 26, cw < 520 ? 138 : 176, lh * (ranked.length + 1) + 14, 14);
      g.fill();
      g.textAlign = 'left';
      g.font = `800 ${cw < 520 ? 12 : 14}px system-ui, sans-serif`;
      g.fillStyle = '#ffd24a';
      g.fillText(`남은 구슬 ${active.length}/${total}`, px + 4, py - 6);
      ranked.forEach((m, i) => {
        const y = py + lh * (i + 1) - 6;
        g.fillStyle = `hsl(${m.hue} 88% 60%)`;
        g.beginPath(); g.arc(px + 10, y - 5, 5, 0, Math.PI * 2); g.fill();
        g.fillStyle = i === 0 ? '#ffe27a' : '#fff';
        const text = `${i + 1}. ${m.name}`;
        g.fillText(text.length > 13 ? `${text.slice(0, 12)}…` : text, px + 22, y);
      });
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const phase = ctl.current.phase;
      const mode = ctl.current.mode;
      const racing = phase === 'racing' || phase === 'done';
      const active = marbles.filter((m) => !m.rank);

      let leader: Marble | undefined;
      let trailer: Marble | undefined;
      for (const m of active) {
        if (!leader || m.y > leader.y) leader = m;
        if (!trailer || m.y < trailer.y) trailer = m;
      }
      if (phase === 'racing' && !decided) {
        if (mode === 'last' && active.length === 1) decide(active[0]);
        if (raceT > 110) { const pick = mode === 'first' ? leader : trailer; if (pick) decide(pick); }
      }

      const focus = mode === 'last' && active.length <= 3 ? trailer : leader;
      // 결승 직전에는 느린 화면 + 확대
      const closing = phase === 'racing' && !decided && !!leader && leader.y > GOAL_Y - 330
        && (mode === 'first' ? finished === 0 : active.length === 2);
      const timescale = decided && phase === 'racing' ? 0.25 : closing ? 0.38 : 1;
      zoom += ((closing || (decided && phase === 'racing') ? 1.35 : 1) - zoom) * Math.min(1, dt * 3);

      acc += dt * timescale;
      let steps = 0;
      while (acc >= STEP && steps < 24) {
        step(STEP, racing);
        acc -= STEP;
        steps++;
        if (phase === 'racing') { raceT += STEP; checkT += STEP; }
      }
      // 끼인 구슬은 살짝 튕겨 준다
      if (checkT > 2.5) {
        checkT = 0;
        for (const m of active) {
          if (Math.abs(m.x - m.checkX) + Math.abs(m.y - m.checkY) < 8) {
            m.vx += (Math.random() - 0.5) * 520;
            m.vy -= 300;
          }
          m.checkX = m.x;
          m.checkY = m.y;
        }
      }
      for (const p of course.pegs) if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 4);

      if (racing) {
        if (hitBumper && now - lastBump > 110) { sfx.bump(); lastBump = now; }
        else if (hitPeg > 0 && now - lastTick > 65) { sfx.tick(Math.min(1, hitPeg / 900)); lastTick = now; }
      }
      hitPeg = 0;
      hitBumper = false;

      const cw = cv.clientWidth, ch = cv.clientHeight;
      if (cw > 0 && ch > 0) {
        const s = Math.min((cw - 24) / W, ch / 520) * zoom;
        const viewH = ch / s;
        const targetY = Math.min(GOAL_Y + 130 - viewH / 2, Math.max(viewH / 2 - 20, (focus ? focus.y : GOAL_Y) + viewH * 0.12));
        camY += (targetY - camY) * Math.min(1, dt * 5);
        draw(cw, ch, s, focus ? focus.x : W / 2, active, racing ? leader : undefined);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); clearTimeout(decideTimer); };
  }, [pool, round]);

  return (
    <div className="pinball-stage" role="dialog" aria-modal="true" aria-label="핀볼 추첨">
      <canvas ref={canvasRef} className="pinball-canvas" />
      <div className="pinball-top">
        <span className="pinball-title">{title} · {pool.length}명</span>
        <button className="raffle-btn pinball-close" onClick={onClose}>닫기</button>
      </div>

      {phase === 'countdown' && count > 0 && (
        <div className="countdown-overlay countdown-overlay--paused" aria-hidden="true">
          <div className="countdown-number" key={count}>{count}</div>
        </div>
      )}

      {phase === 'done' && (
        <div className="pinball-result">
          <div className="raffle-bravo">부라보!</div>
          <div className="raffle-card raffle-card--winner pinball-winner">{winner}</div>
          <div className="raffle-sub">🎉 {mode === 'first' ? '가장 먼저 도착' : '끝까지 살아남음'} — 발표자로 선정!</div>
          <Confetti />
        </div>
      )}

      <div className="pinball-controls">
        {phase === 'ready' && (
          <>
            <div className="pinball-mode" role="group" aria-label="당첨 방식">
              <button className={mode === 'first' ? 'is-on' : ''} onClick={() => setMode('first')}>1등 당첨</button>
              <button className={mode === 'last' ? 'is-on' : ''} onClick={() => setMode('last')}>꼴찌 당첨</button>
            </div>
            <button className="raffle-btn raffle-btn--go" onClick={start}>구슬 굴리기!</button>
          </>
        )}
        {phase === 'done' && <button className="raffle-btn raffle-btn--go" onClick={again}>다시 굴리기</button>}
      </div>
    </div>
  );
}
