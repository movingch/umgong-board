import React, { useEffect, useRef, useState } from 'react';
import { sfx } from './sfx';
import { Confetti } from './Confetti';

const W = 600;
const GOAL_Y = 4600;
const FINAL_Y = 4360;
const R = 11;
const GRAVITY = 950;
const MAX_SPEED = 1300;
const STEP = 1 / 240;
const BUCKET = 120;
const GATE_CYCLE = 2.6;
const GATE_OPEN = 1.0;

type Seg = { ax: number; ay: number; bx: number; by: number; kind?: 'gate' | 'timed' };
type Peg = { x: number; y: number; r: number; bumper: boolean; flash: number };
type Spinner = { cx: number; cy: number; half: number; omega: number; angle: number };
type Pendulum = { px: number; py: number; len: number; amp: number; speed: number; r: number; x: number; y: number; vx: number; vy: number };
type Zone = { x: number; y: number; w: number; h: number; kind: 'boost' | 'mud'; ax: number; ay: number };
type Hole = { x: number; y: number; r: number; ex: number; ey: number };
type Marble = {
  id: number; name: string; hue: number;
  x: number; y: number; vx: number; vy: number;
  rank: number; checkX: number; checkY: number;
  warpCd: number; trail: number[];
};
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number };
type Ring = { x: number; y: number; t: number };
type Mode = 'first' | 'last';
type Phase = 'ready' | 'countdown' | 'racing' | 'done';
type RankRow = { id: number; name: string; hue: number; done: boolean; move: number };
type Banner = { id: number; text: string; kind: 'lead' | 'event' | 'warn' };

const SECTION_LABELS: [number, string][] = [
  [330, '핀 숲'], [925, '지그재그'], [1385, '회전 막대'], [1868, '범퍼 전쟁터'], [2330, '철퇴 구간'],
  [2740, '풍차'], [3178, '세 갈래 길'], [3594, '바늘밭'], [4160, '최후의 관문'],
];

function buildCourse() {
  const segs: Seg[] = [];
  const pegs: Peg[] = [];
  const spinners: Spinner[] = [];
  const pendulums: Pendulum[] = [];
  const zones: Zone[] = [];
  const holes: Hole[] = [
    { x: 210, y: 1830, r: 16, ex: 300, ey: 930 },
    { x: 150, y: 3828, r: 16, ex: 300, ey: 3150 },
  ];
  const seg = (ax: number, ay: number, bx: number, by: number, kind?: Seg['kind']) => segs.push({ ax, ay, bx, by, kind });
  const peg = (x: number, y: number, r = 6, bumper = false) => {
    if (holes.some((h) => Math.hypot(h.x - x, h.y - y) < h.r + r + 16)) return;
    pegs.push({ x, y, r, bumper, flash: 0 });
  };
  const spin = (cx: number, cy: number, half: number, omega: number) => spinners.push({ cx, cy, half, omega, angle: Math.random() * Math.PI });

  // 출발 깔때기 + 문
  seg(0, 220, 240, 300);
  seg(W, 220, 360, 300);
  seg(240, 300, 360, 300, 'gate');

  // 1구간: 핀 숲
  for (let row = 0; row < 10; row++) {
    const off = row % 2 ? 60 : 30;
    for (let x = off; x <= W - 30; x += 60) peg(x, 360 + row * 56);
  }

  // 2구간: 지그재그 경사로 (둘째 경사로는 가속 구간)
  seg(0, 960, 420, 1040);
  seg(W, 1100, 180, 1180);
  seg(0, 1240, 420, 1320);
  zones.push({ x: 200, y: 1080, w: 390, h: 100, kind: 'boost', ax: -900, ay: 170 });

  // 3구간: 회전 막대
  spin(150, 1480, 95, 2.4);
  spin(450, 1480, 95, -2.4);
  spin(300, 1680, 120, 1.8);
  peg(90, 1690, 20, true);
  peg(510, 1690, 20, true);
  peg(300, 1400, 8);

  // 4구간: 범퍼 전쟁터 (입구에 블랙홀)
  [1900, 2020, 2140, 2260].forEach((y, i) => {
    (i % 2 ? [210, 390] : [120, 300, 480]).forEach((x) => peg(x, y, 26, true));
    (i % 2 ? [60, 300, 540] : [210, 390]).forEach((x) => peg(x, y + 6, 7));
  });

  // 5구간: 철퇴 — 큰 쇠공 두 개가 좌우로 휩쓴다
  [190, 410].forEach((px) => pendulums.push({ px, py: 2370, len: 190, amp: 1, speed: 2.3, r: 30, x: px, y: 2560, vx: 0, vy: 0 }));
  for (let x = 60; x <= 540; x += 80) peg(x, 2665);

  // 6구간: 깔때기 + 풍차
  seg(0, 2760, 230, 2900);
  seg(W, 2760, 370, 2900);
  spin(300, 3015, 105, 3);

  // 7구간: 세 갈래 길 — 왼쪽 지름길(가속), 가운데 핀, 오른쪽 늪(감속)
  peg(200, 3192, 8);
  peg(400, 3192, 8);
  seg(200, 3200, 200, 3520);
  seg(400, 3200, 400, 3520);
  zones.push({ x: 0, y: 3215, w: 200, h: 290, kind: 'boost', ax: 0, ay: 1300 });
  zones.push({ x: 400, y: 3215, w: 200, h: 290, kind: 'mud', ax: 0, ay: 0 });
  for (let row = 0; row < 5; row++) (row % 2 ? [300] : [250, 350]).forEach((x) => peg(x, 3250 + row * 60));

  // 8구간: 바늘밭 (블랙홀 하나)
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? 50 : 25;
    for (let x = off; x <= W - 25; x += 50) peg(x, 3620 + row * 52, 5);
  }
  seg(0, 4040, 190, 4110);
  seg(W, 4040, 410, 4110);

  // 9구간: 최후의 관문 — 주기적으로 열리는 문 + 마지막 회전 막대
  seg(0, 4180, 240, 4320);
  seg(W, 4180, 360, 4320);
  seg(240, 4336, 360, 4336, 'timed');
  spin(300, 4450, 90, -3.5);
  seg(0, 4470, 255, 4570);
  seg(W, 4470, 345, 4570);

  const buckets = new Map<number, Peg[]>();
  for (const p of pegs) {
    for (let b = Math.floor((p.y - p.r - R) / BUCKET); b <= Math.floor((p.y + p.r + R) / BUCKET); b++) {
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b)!.push(p);
    }
  }
  return { segs, pegs, spinners, pendulums, zones, holes, buckets };
}

// 암호학적 난수로 섞는다 — 자리와 처리 순서가 매 판 완전히 새로 정해진다
function shuffle<T>(list: T[]): T[] {
  const buf = new Uint32Array(1);
  for (let i = list.length - 1; i > 0; i--) {
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function spawnMarbles(names: string[]): Marble[] {
  // 출발 칸 전체(13칸 × 필요한 줄 수)에서 무작위로 자리를 뽑는다
  const rows = Math.max(1, Math.ceil(names.length / 13));
  const slots: { x: number; y: number }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 13; col++) slots.push({ x: 60 + col * 40 + (row % 2 ? 12 : 0), y: 188 - row * 25 });
  }
  shuffle(slots);
  const marbles = names.map((name, i) => ({
    id: i,
    name,
    hue: Math.round((i * 137.508) % 360),
    x: slots[i].x + (Math.random() - 0.5) * 4,
    y: slots[i].y,
    vx: 0, vy: 0, rank: 0,
    checkX: slots[i].x, checkY: slots[i].y,
    warpCd: 0, trail: [] as number[],
  }));
  // 충돌 계산이 명단 순서를 따르지 않도록 구슬 처리 순서도 섞는다
  return shuffle(marbles);
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
  const [ranking, setRanking] = useState<RankRow[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const ctl = useRef<{ phase: Phase; mode: Mode }>({ phase: 'ready', mode: 'first' });
  const timers = useRef<number[]>([]);
  ctl.current.mode = mode;

  function setPhase(p: Phase) { ctl.current.phase = p; setPhaseState(p); }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)); sfx.stopDisco(); }, []);

  function start() {
    setWinner('');
    setBanner(null);
    setPhase('countdown');
    [3, 2, 1].forEach((n, i) => {
      timers.current.push(window.setTimeout(() => { setCount(n); sfx.beep(false); }, i * 700));
    });
    timers.current.push(window.setTimeout(() => { setCount(0); sfx.beep(true); setPhase('racing'); sfx.startDisco(); }, 2100));
  }

  function again() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    sfx.stopDisco();
    setWinner('');
    setBanner(null);
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
    const particles: Particle[] = [];
    const rings: Ring[] = [];
    let finished = 0;
    let decided = false;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let simT = 0;
    let raceT = 0;
    let checkT = 0;
    let camY = 240;
    let zoom = 1;
    let lastTick = 0;
    let lastBump = 0;
    let lastWarpSound = 0;
    let hitPeg = 0;
    let hitBumper = false;
    let decideTimer = 0;
    let lastRank = 0;
    let rankSnapAt = 0;
    let rankSnap = new Map<number, number>();
    let bannerId = 0;
    let lastLeadBanner = -10;
    let leadId = -1;
    let candId = -1;
    let candSince = 0;
    let front = 0;
    let nextCheckpoint = 0;
    let windT = 0;
    let windDir = 1;
    let shake = 0;
    let flash = 0;
    let boltT = 0;
    let boltX = 0;
    let boltY = 0;
    let closeCalled = false;
    let gateWasOpen = false;

    const say = (text: string, kind: Banner['kind']) => setBanner({ id: ++bannerId, text, kind });
    const burst = (x: number, y: number, n: number, hue: number, speed: number) => {
      for (let i = 0; i < n && particles.length < 400; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.3 + Math.random() * 0.7);
        const life = 0.35 + Math.random() * 0.45;
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, hue });
      }
    };
    const gateOpen = () => (raceT % GATE_CYCLE) < GATE_OPEN;
    const placeOf = (m: Marble) => marbles.reduce((n, o) => n + (!o.rank && o.y > m.y ? 1 : 0), 0);

    const decide = (m: Marble) => {
      if (decided) return;
      decided = true;
      decideTimer = window.setTimeout(() => {
        sfx.stopDisco();
        setBanner(null);
        setWinner(m.name);
        setPhase('done');
        sfx.bravo();
      }, 800);
    };

    // ── 전투 이벤트: 선두가 구간을 통과할 때 한 번씩 터진다 ──
    const wind = () => {
      windT = 2.6;
      windDir = Math.random() < 0.5 ? -1 : 1;
      say(`🌪 돌풍! ${windDir > 0 ? '오른쪽' : '왼쪽'}으로 쓸려간다`, 'event');
      sfx.wind();
    };
    const lightning = (leader: Marble) => {
      leader.vy = -1000;
      leader.vx = (Math.random() < 0.5 ? -1 : 1) * (250 + Math.random() * 200);
      boltT = 0.3; boltX = leader.x; boltY = leader.y;
      flash = 1; shake = 16;
      burst(leader.x, leader.y, 40, 55, 520);
      say(`⚡ 번개! 1위 ${leader.name} 날아갔다`, 'warn');
      sfx.thunder();
    };
    const quake = (active: Marble[]) => {
      shake = 22;
      for (const m of active) {
        m.vx += (Math.random() - 0.5) * 700;
        m.vy -= 150 + Math.random() * 350;
      }
      say('🫨 지진! 전원 튕겨 오른다', 'event');
      sfx.boom();
    };
    const boom = (leader: Marble, active: Marble[]) => {
      const cx = leader.x, cy = leader.y;
      for (const m of active) {
        const dx = m.x - cx, dy = m.y - cy;
        const d = Math.hypot(dx, dy);
        if (d > 260) continue;
        const k = 950 * (1 - d / 260);
        if (d < 1) { m.vy -= 800; continue; }
        m.vx += (dx / d) * k;
        m.vy += (dy / d) * k - 250;
      }
      rings.push({ x: cx, y: cy, t: 0 });
      burst(cx, cy, 70, 20, 700);
      flash = 0.8; shake = 24;
      say('💥 대폭발! 선두 그룹 산산조각', 'warn');
      sfx.boom();
    };
    const finalGate = () => {
      say('🚪 최후의 관문! 문이 열릴 때를 노려라', 'event');
      sfx.setDiscoBpm(146);
      sfx.lead();
    };
    const checkpoints: { y: number; fire: (leader: Marble, active: Marble[]) => void }[] = [
      { y: 1340, fire: wind },
      { y: 2290, fire: lightning },
      { y: 3170, fire: (_l, a) => quake(a) },
      { y: 4010, fire: boom },
      { y: 4175, fire: finalGate },
    ];

    const collideSeg = (m: Marble, ax: number, ay: number, bx: number, by: number, sp?: Spinner) => {
      const ex = bx - ax, ey = by - ay;
      const len2 = ex * ex + ey * ey;
      let t = ((m.x - ax) * ex + (m.y - ay) * ey) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t, qy = ay + ey * t;
      let nx = m.x - qx, ny = m.y - qy;
      const d2 = nx * nx + ny * ny;
      if (d2 >= R * R) return;
      const d = Math.sqrt(d2);
      if (d < 1e-6) { const l = Math.sqrt(len2); nx = -ey / l; ny = ex / l; } else { nx /= d; ny /= d; }
      const pen = R - d;
      m.x += nx * pen;
      m.y += ny * pen;
      // 회전 막대는 닿은 지점의 표면 속도만큼 구슬을 쳐낸다
      const svx = sp ? -sp.omega * (qy - sp.cy) : 0;
      const svy = sp ? sp.omega * (qx - sp.cx) : 0;
      const vn = (m.vx - svx) * nx + (m.vy - svy) * ny;
      if (vn < 0) {
        const e = sp ? 0.7 : 0.35;
        m.vx -= (1 + e) * vn * nx;
        m.vy -= (1 + e) * vn * ny;
        if (-vn > 160) hitPeg = Math.max(hitPeg, -vn);
      }
    };

    const step = (h: number, released: boolean) => {
      simT += h;
      for (const sp of course.spinners) sp.angle += sp.omega * h;
      for (const p of course.pendulums) {
        const th = p.amp * Math.sin(p.speed * simT);
        const dth = p.amp * p.speed * Math.cos(p.speed * simT);
        p.x = p.px + p.len * Math.sin(th);
        p.y = p.py + p.len * Math.cos(th);
        p.vx = p.len * dth * Math.cos(th);
        p.vy = -p.len * dth * Math.sin(th);
      }
      const timedOpen = gateOpen();
      for (const m of marbles) {
        if (m.rank) continue;
        m.vy += GRAVITY * h;
        if (windT > 0) m.vx += windDir * 700 * h;
        for (const z of course.zones) {
          if (m.y < z.y || m.y > z.y + z.h || m.x < z.x || m.x > z.x + z.w) continue;
          if (z.kind === 'boost') { m.vx += z.ax * h; m.vy += z.ay * h; }
          else { const k = 1 - 4 * h; m.vx *= k; m.vy *= k; }
        }
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
          if (s.kind === 'gate' && released) continue;
          if (s.kind === 'timed' && timedOpen) continue;
          if (m.y < Math.min(s.ay, s.by) - R - 2 || m.y > Math.max(s.ay, s.by) + R + 2) continue;
          collideSeg(m, s.ax, s.ay, s.bx, s.by);
        }
        for (const sp of course.spinners) {
          if (Math.abs(m.y - sp.cy) > sp.half + R + 2) continue;
          const cx = Math.cos(sp.angle) * sp.half, cy = Math.sin(sp.angle) * sp.half;
          collideSeg(m, sp.cx - cx, sp.cy - cy, sp.cx + cx, sp.cy + cy, sp);
        }
        for (const p of course.pendulums) {
          const dx = m.x - p.x, dy = m.y - p.y;
          const rr = R + p.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 < 1e-9) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          m.x = p.x + nx * rr;
          m.y = p.y + ny * rr;
          const vn = (m.vx - p.vx) * nx + (m.vy - p.vy) * ny;
          if (vn < 0) {
            m.vx -= 1.9 * vn * nx;
            m.vy -= 1.9 * vn * ny;
            m.vx += nx * 140;
            m.vy += ny * 140;
            hitBumper = true;
            burst(m.x - nx * R, m.y - ny * R, 6, 35, 260);
          }
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
                burst(m.x - nx * R, m.y - ny * R, 5, 320, 240);
              } else if (-vn > 160) {
                hitPeg = Math.max(hitPeg, -vn);
              }
            }
          }
        }
        // 블랙홀: 닿으면 위쪽 출구로 순간이동
        if (m.warpCd > 0) m.warpCd -= h;
        else if (released) {
          for (const hole of course.holes) {
            const dx = m.x - hole.x, dy = m.y - hole.y;
            if (dx * dx + dy * dy > (hole.r + 4) * (hole.r + 4)) continue;
            const place = placeOf(m);
            burst(hole.x, hole.y, 18, 275, 300);
            m.x = hole.ex + (Math.random() - 0.5) * 30;
            m.y = hole.ey;
            m.vx = (Math.random() - 0.5) * 300;
            m.vy = -120;
            m.warpCd = 4;
            m.trail.length = 0;
            burst(m.x, m.y, 18, 190, 300);
            if (simT - lastWarpSound > 0.3) { sfx.warp(); lastWarpSound = simT; }
            if (place < 5 && !decided) say(`🌀 ${place + 1}위 ${m.name}, 블랙홀에 빨려갔다`, 'warn');
            break;
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
      const top = camY - viewH / 2 - 60, bottom = camY + viewH / 2 + 60;
      const fieldTop = Math.max(0, top), fieldBottom = Math.min(GOAL_Y + 140, bottom);

      g.save();
      g.translate(ox + (Math.random() - 0.5) * shake, ch / 2 - camY * s + (Math.random() - 0.5) * shake);
      g.scale(s, s);

      // 경기장 바닥
      const field = g.createLinearGradient(0, top, 0, bottom);
      field.addColorStop(0, '#1d1440');
      field.addColorStop(1, '#2a1650');
      g.fillStyle = field;
      g.fillRect(0, fieldTop, W, fieldBottom - fieldTop);
      g.strokeStyle = 'rgba(255,255,255,.035)';
      g.lineWidth = 1;
      for (let y = Math.ceil(top / 60) * 60; y < bottom; y += 60) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      }

      // 구간 이름
      g.textAlign = 'center';
      g.font = '900 46px system-ui, sans-serif';
      g.fillStyle = 'rgba(255,255,255,.1)';
      for (const [y, label] of SECTION_LABELS) if (y > top && y < bottom) g.fillText(label, W / 2, y);

      // 가속·늪 구역
      for (const z of course.zones) {
        if (z.y + z.h < top || z.y > bottom) continue;
        if (z.kind === 'boost') {
          g.fillStyle = 'rgba(60,255,170,.1)';
          g.fillRect(z.x, z.y, z.w, z.h);
          const horizontal = Math.abs(z.ax) > Math.abs(z.ay);
          g.strokeStyle = 'rgba(90,255,180,.75)';
          g.lineWidth = 4;
          const shift = (simT * 140) % 50;
          if (horizontal) {
            for (let x = z.x + z.w - shift; x > z.x + 14; x -= 50) {
              g.beginPath(); g.moveTo(x + 12, z.y + 14); g.lineTo(x, z.y + z.h / 2); g.lineTo(x + 12, z.y + z.h - 14); g.stroke();
            }
          } else {
            for (let y = z.y + shift; y < z.y + z.h - 14; y += 50) {
              g.beginPath(); g.moveTo(z.x + 30, y); g.lineTo(z.x + z.w / 2, y + 14); g.lineTo(z.x + z.w - 30, y); g.stroke();
            }
            g.fillStyle = 'rgba(120,255,200,.9)';
            g.font = '900 20px system-ui, sans-serif';
            g.fillText('⏩ 지름길', z.x + z.w / 2, z.y - 8);
          }
        } else {
          g.fillStyle = 'rgba(150,95,40,.38)';
          g.fillRect(z.x, z.y, z.w, z.h);
          g.fillStyle = 'rgba(90,55,20,.5)';
          for (let i = 0; i < 9; i++) {
            const bx = z.x + 20 + ((i * 53) % (z.w - 40));
            const by = z.y + 20 + ((i * 97 + simT * 12) % (z.h - 40));
            g.beginPath(); g.arc(bx, by, 6 + (i % 3) * 3, 0, Math.PI * 2); g.fill();
          }
          g.fillStyle = 'rgba(255,200,140,.9)';
          g.font = '900 20px system-ui, sans-serif';
          g.fillText('🐌 늪', z.x + z.w / 2, z.y - 8);
        }
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
        g.fillText('GOAL', W / 2, GOAL_Y + 84);
      }

      // 벽
      g.strokeStyle = '#7c5cff';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(0, fieldTop); g.lineTo(0, fieldBottom);
      g.moveTo(W, fieldTop); g.lineTo(W, fieldBottom);
      g.stroke();

      // 경사로·문
      g.lineCap = 'round';
      const released = ctl.current.phase === 'racing' || ctl.current.phase === 'done';
      const timedOpen = gateOpen();
      for (const sg of course.segs) {
        if (Math.max(sg.ay, sg.by) < top || Math.min(sg.ay, sg.by) > bottom) continue;
        if (sg.kind === 'gate' && released) continue;
        if (sg.kind === 'timed') {
          const left = GATE_CYCLE - (raceT % GATE_CYCLE);
          g.strokeStyle = timedOpen ? 'rgba(80,255,150,.35)' : left < 0.5 ? '#ffd24a' : '#ff3b4e';
          g.shadowColor = g.strokeStyle;
          g.shadowBlur = 18;
          g.lineWidth = timedOpen ? 3 : 10;
          g.setLineDash(timedOpen ? [6, 10] : []);
          g.beginPath(); g.moveTo(sg.ax, sg.ay); g.lineTo(sg.bx, sg.by); g.stroke();
          g.setLineDash([]);
          continue;
        }
        g.strokeStyle = sg.kind === 'gate' ? '#ff5d73' : '#39d5ff';
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

      // 철퇴
      for (const p of course.pendulums) {
        if (p.py > bottom || p.py + p.len + p.r < top) continue;
        g.strokeStyle = 'rgba(210,215,235,.7)';
        g.lineWidth = 4;
        g.beginPath(); g.moveTo(p.px, p.py); g.lineTo(p.x, p.y); g.stroke();
        g.fillStyle = '#cfd6ff';
        g.beginPath(); g.arc(p.px, p.py, 7, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#5b6076';
        g.shadowColor = '#ff7a3d';
        g.shadowBlur = 18;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
        g.fillStyle = '#9aa0b8';
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + simT * 2;
          g.beginPath();
          g.moveTo(p.x + Math.cos(a - 0.2) * p.r, p.y + Math.sin(a - 0.2) * p.r);
          g.lineTo(p.x + Math.cos(a) * (p.r + 9), p.y + Math.sin(a) * (p.r + 9));
          g.lineTo(p.x + Math.cos(a + 0.2) * p.r, p.y + Math.sin(a + 0.2) * p.r);
          g.fill();
        }
      }

      // 블랙홀과 출구
      for (const hole of course.holes) {
        if (hole.y + 40 > top && hole.y - 40 < bottom) {
          const grad = g.createRadialGradient(hole.x, hole.y, 2, hole.x, hole.y, hole.r + 14);
          grad.addColorStop(0, '#000');
          grad.addColorStop(0.55, '#1a0033');
          grad.addColorStop(1, 'rgba(170,80,255,0)');
          g.fillStyle = grad;
          g.beginPath(); g.arc(hole.x, hole.y, hole.r + 14, 0, Math.PI * 2); g.fill();
          g.strokeStyle = '#c77dff';
          g.lineWidth = 3;
          for (let k = 0; k < 3; k++) {
            const a = simT * 5 + (k * Math.PI * 2) / 3;
            g.beginPath(); g.arc(hole.x, hole.y, hole.r + 3, a, a + 1.2); g.stroke();
          }
        }
        if (hole.ey + 30 > top && hole.ey - 30 < bottom) {
          g.strokeStyle = 'rgba(120,230,255,.7)';
          g.lineWidth = 2;
          g.setLineDash([5, 6]);
          g.beginPath(); g.arc(hole.ex, hole.ey, 18 + Math.sin(simT * 4) * 3, 0, Math.PI * 2); g.stroke();
          g.setLineDash([]);
        }
      }

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

      // 돌풍 줄무늬
      if (windT > 0) {
        g.strokeStyle = `rgba(255,255,255,${Math.min(0.35, windT * 0.3)})`;
        g.lineWidth = 2;
        for (let i = 0; i < 26; i++) {
          const y = top + ((i * 173) % (bottom - top));
          const x = ((i * 97 + simT * 900 * windDir) % (W + 200) + W + 200) % (W + 200) - 100;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - windDir * 70, y); g.stroke();
        }
      }

      // 구슬 꼬리
      g.lineCap = 'round';
      for (const m of active) {
        if (m.y < top || m.y > bottom || m.trail.length < 4) continue;
        g.strokeStyle = `hsla(${m.hue} 90% 65% / .35)`;
        g.lineWidth = R * 1.1;
        g.beginPath();
        g.moveTo(m.trail[0], m.trail[1]);
        for (let i = 2; i < m.trail.length; i += 2) g.lineTo(m.trail[i], m.trail[i + 1]);
        g.lineTo(m.x, m.y);
        g.stroke();
      }

      // 구슬
      const fontPx = Math.max(13, 11 / s);
      g.font = `800 ${fontPx}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.lineJoin = 'round';
      for (const m of active) {
        if (m.y < top || m.y > bottom) continue;
        if (m === leader) {
          g.shadowColor = '#ffd24a';
          g.shadowBlur = 26;
        }
        g.fillStyle = `hsl(${m.hue} 88% 60%)`;
        g.beginPath(); g.arc(m.x, m.y, R, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
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

      // 불꽃·폭발 고리·번개
      for (const p of particles) {
        g.fillStyle = `hsla(${p.hue} 100% 70% / ${Math.max(0, p.life / p.max)})`;
        g.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      for (const ring of rings) {
        g.strokeStyle = `rgba(255,170,60,${Math.max(0, 1 - ring.t / 0.6)})`;
        g.lineWidth = 10 * (1 - ring.t / 0.6) + 2;
        g.beginPath(); g.arc(ring.x, ring.y, 30 + ring.t * 520, 0, Math.PI * 2); g.stroke();
      }
      if (boltT > 0) {
        g.strokeStyle = '#fff8c4';
        g.shadowColor = '#ffe14a';
        g.shadowBlur = 30;
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(boltX + 40, top);
        const n = 9;
        for (let i = 1; i < n; i++) g.lineTo(boltX + (Math.random() - 0.5) * 70, top + ((boltY - top) * i) / n);
        g.lineTo(boltX, boltY);
        g.stroke();
        g.shadowBlur = 0;
      }
      g.restore();

      if (flash > 0) {
        g.fillStyle = `rgba(255,255,255,${flash * 0.55})`;
        g.fillRect(0, 0, cw, ch);
      }

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
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const phase = ctl.current.phase;
      const mode = ctl.current.mode;
      const released = phase === 'racing' || phase === 'done';
      const live = phase === 'racing' && !decided;
      const active = marbles.filter((m) => !m.rank);

      let leader: Marble | undefined;
      let second: Marble | undefined;
      let trailer: Marble | undefined;
      for (const m of active) {
        if (!leader || m.y > leader.y) { second = leader; leader = m; }
        else if (!second || m.y > second.y) second = m;
        if (!trailer || m.y < trailer.y) trailer = m;
      }

      if (live) {
        if (mode === 'last' && active.length === 1) decide(active[0]);
        if (raceT > 150) { const pick = mode === 'first' ? leader : trailer; if (pick) decide(pick); }
      }
      if (live && leader) {
        // 구간 이벤트
        front = Math.max(front, leader.y);
        while (nextCheckpoint < checkpoints.length && front >= checkpoints[nextCheckpoint].y) {
          checkpoints[nextCheckpoint++].fire(leader, active);
        }
        // 역전 중계: 새 선두가 잠깐 유지되면 알린다
        if (leader.id !== candId) { candId = leader.id; candSince = raceT; }
        if (raceT > 3 && candId !== leadId && raceT - candSince > 0.35) {
          const first = leadId === -1;
          leadId = candId;
          if (!first && finished === 0 && raceT - lastLeadBanner > 1.8 && active.length > 1) {
            lastLeadBanner = raceT;
            say(`🔥 역전! ${leader.name} 선두`, 'lead');
            sfx.lead();
          }
        }
        if (!closeCalled && second && leader.y > FINAL_Y && leader.y - second.y < 70) {
          closeCalled = true;
          say(`😱 초접전! ${leader.name} vs ${second.name}`, 'warn');
        }
        const open = gateOpen();
        if (open && !gateWasOpen && front > 4100) sfx.gate();
        gateWasOpen = open;
      }

      const focus = mode === 'last' && active.length <= 3 ? trailer : leader;
      // 결승 직전에는 느린 화면 + 확대
      const closing = live && !!leader && leader.y > FINAL_Y && (mode === 'first' ? finished === 0 : active.length === 2);
      const slow = decided && phase === 'racing';
      const timescale = slow ? 0.25 : closing ? 0.38 : 1;
      zoom += ((closing || slow ? 1.35 : 1) - zoom) * Math.min(1, dt * 3);

      // 공정성 검증용: 콘솔에서 window.__pinballSpeed 를 주면 그 배수로 빨리 돌린다
      const speed = Math.max(1, Number((window as any).__pinballSpeed) || 1);
      acc += dt * timescale * speed;
      let steps = 0;
      while (acc >= STEP && steps < 24 * speed) {
        step(STEP, released);
        acc -= STEP;
        steps++;
        if (phase === 'racing') { raceT += STEP; checkT += STEP; }
      }
      const simDt = steps * STEP;
      if (windT > 0) windT -= simDt;

      // 끼인 구슬은 살짝 튕겨 준다
      if (checkT > 2.5) {
        checkT = 0;
        for (const m of active) {
          if (Math.abs(m.x - m.checkX) + Math.abs(m.y - m.checkY) < 8 && m.y < FINAL_Y - 60) {
            m.vx += (Math.random() - 0.5) * 520;
            m.vy -= 300;
          }
          m.checkX = m.x;
          m.checkY = m.y;
        }
      }
      for (const m of active) {
        m.trail.push(m.x, m.y);
        if (m.trail.length > 12) m.trail.splice(0, 2);
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        p.vy += 500 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > 0.6) rings.splice(i, 1); }
      for (const p of course.pegs) if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 4);
      shake *= Math.exp(-dt * 5);
      if (shake < 0.3) shake = 0;
      flash = Math.max(0, flash - dt * 3);
      boltT = Math.max(0, boltT - dt);

      if (released) {
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
        draw(cw, ch, s, focus ? focus.x : W / 2, active, released ? leader : undefined);
      }

      // 순위표: 도착한 구슬은 도착 순서대로 위에 남고, 나머지는 현재 위치 순
      if (now - lastRank > 250) {
        lastRank = now;
        const ordered = [...marbles].sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9) || b.y - a.y);
        setRanking(ordered.map((m, i) => ({
          id: m.id, name: m.name, hue: m.hue, done: m.rank > 0,
          move: released && !m.rank ? (rankSnap.get(m.id) ?? i) - i : 0,
        })));
        if (now - rankSnapAt > 1200) {
          rankSnapAt = now;
          rankSnap = new Map(ordered.map((m, i) => [m.id, i]));
        }
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

      <ol className="pinball-rank" aria-label="순위">
        <li className="pinball-rank-head">순위 · 도착 {ranking.filter((r) => r.done).length}/{pool.length}</li>
        {ranking.map((r, i) => (
          <li key={r.id} className={`${r.done ? 'is-done' : ''}${phase === 'done' && r.name === winner ? ' is-winner' : ''}`}>
            <span className="pinball-rank-dot" style={{ background: `hsl(${r.hue} 88% 60%)` }} />
            <span className="pinball-rank-name">{i + 1}. {r.name}</span>
            {r.done && <span aria-label="도착">🏁</span>}
            {!r.done && r.move >= 2 && <span className="pinball-rank-up">▲{r.move}</span>}
            {!r.done && r.move <= -2 && <span className="pinball-rank-down">▼{-r.move}</span>}
          </li>
        ))}
      </ol>

      {banner && phase === 'racing' && (
        <div key={banner.id} className={`pinball-banner pinball-banner--${banner.kind}`} role="status">{banner.text}</div>
      )}

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
