let ctx: AudioContext | null = null;
let muted = localStorage.getItem('sfx-muted') === '1';

function getCtx(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

type ToneOpts = { at?: number; dur?: number; type?: OscillatorType; gain?: number; to?: number };

function tone(freq: number, { at = 0, dur = 0.15, type = 'sine', gain = 0.18, to }: ToneOpts = {}) {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const buffers: Record<string, AudioBuffer> = {};
const loads: Record<string, Promise<void>> = {};

function load(name: string): Promise<void> {
  const c = getCtx();
  if (!c || buffers[name]) return Promise.resolve();
  loads[name] ??= fetch(`/sfx/${name}.mp3`)
    .then((res) => res.arrayBuffer())
    .then((data) => c.decodeAudioData(data))
    .then((buf) => { buffers[name] = buf; })
    .catch(() => { delete loads[name]; });
  return loads[name];
}

function play(name: string, at = 0, gain = 1) {
  const c = getCtx();
  const buf = buffers[name];
  if (!c || !buf) return false;
  const src = c.createBufferSource();
  const g = c.createGain();
  src.buffer = buf;
  g.gain.value = gain;
  src.connect(g).connect(c.destination);
  src.start(c.currentTime + at);
  return true;
}

function preload() { void load('bravo'); void load('kids-cheer'); void load('kids-wow'); }

let noiseBuf: AudioBuffer | null = null;
function getNoise(c: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function noiseHit(type: BiquadFilterType, freq: number, peak: number, dur: number, toFreq?: number) {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = getNoise(c);
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (toFreq) f.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

// ── 디스코 비트 (핀볼 배경 음악) ──────────────────────────
let discoTimer = 0;
let discoSixteenth = 60 / 124 / 4;
let discoBus: GainNode | null = null;

function stopDisco() {
  clearInterval(discoTimer);
  discoTimer = 0;
  const bus = discoBus;
  discoBus = null;
  if (!bus || !ctx) return;
  const t = ctx.currentTime;
  bus.gain.cancelScheduledValues(t);
  bus.gain.setValueAtTime(bus.gain.value, t);
  bus.gain.linearRampToValueAtTime(0.0001, t + 0.35);
  window.setTimeout(() => bus.disconnect(), 600);
}

function startDisco() {
  stopDisco();
  const c = getCtx();
  if (!c) return;
  const bus = c.createGain();
  bus.gain.value = 0.85;
  const comp = c.createDynamicsCompressor();
  bus.connect(comp).connect(c.destination);
  discoBus = bus;

  const env = (g: GainNode, t: number, peak: number, dur: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  };
  const noise = (t: number, type: BiquadFilterType, freq: number, peak: number, dur: number) => {
    const src = c.createBufferSource();
    src.buffer = getNoise(c);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    env(g, t, peak, dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  };
  const voice = (t: number, type: OscillatorType, freq: number, peak: number, dur: number, cutoff?: number, toFreq?: number) => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur * 0.5);
    const g = c.createGain();
    env(g, t, peak, dur);
    if (cutoff) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(cutoff * 2.2, t);
      f.frequency.exponentialRampToValueAtTime(cutoff, t + dur);
      f.Q.value = 6;
      o.connect(f).connect(g).connect(bus);
    } else {
      o.connect(g).connect(bus);
    }
    o.start(t);
    o.stop(t + dur + 0.02);
  };

  discoSixteenth = 60 / 124 / 4;
  // 한 마디씩 Am – Am – F – G
  const roots = [55, 55, 43.65, 49];
  const thirds = [1.189, 1.189, 1.26, 1.26];
  let step = 0;
  let nextT = c.currentTime + 0.06;

  const playStep = (i: number, t: number) => {
    const s = i % 16;
    const bar = Math.floor(i / 16) % 4;
    const root = roots[bar];
    if (s % 4 === 0) voice(t, 'sine', 160, 1, 0.3, undefined, 44);
    if (s === 4 || s === 12) { noise(t, 'bandpass', 1700, 0.5, 0.16); noise(t + 0.012, 'bandpass', 1500, 0.3, 0.12); }
    if (s % 4 === 2) noise(t, 'highpass', 7000, 0.22, 0.11);
    else if (s % 2 === 1) noise(t, 'highpass', 9000, 0.07, 0.035);
    // 옥타브로 튀는 베이스: 정박은 낮게, 엇박은 한 옥타브 위
    if (s % 2 === 0) {
      const f = s % 4 === 0 ? root : root * 2;
      const lift = s === 14 ? 1.122 : 1;
      voice(t, 'sawtooth', f * lift, 0.55, discoSixteenth * 1.8, 420);
      voice(t, 'sine', f * lift, 0.6, discoSixteenth * 1.8);
    }
    if (s === 6 || s === 14) {
      [1, thirds[bar], 1.498].forEach((r) => voice(t, 'triangle', root * 8 * r, 0.05, 0.14));
    }
  };

  const schedule = () => {
    while (nextT < c.currentTime + 0.25) {
      playStep(step, nextT);
      nextT += discoSixteenth;
      step++;
    }
  };
  schedule();
  discoTimer = window.setInterval(schedule, 60);
}

export const sfx = {
  isMuted: () => muted,
  setMuted(next: boolean) {
    muted = next;
    localStorage.setItem('sfx-muted', next ? '1' : '0');
    if (next) { window.speechSynthesis?.cancel(); stopDisco(); }
    else preload();
  },
  // 브라우저는 사용자 동작 뒤에만 소리를 허용한다
  unlock() { if (getCtx()) preload(); },

  beep(final: boolean) {
    tone(final ? 1320 : 990, { dur: 0.11, type: 'square', gain: 0.1 });
    if (final) tone(1320, { at: 0.16, dur: 0.11, type: 'square', gain: 0.1 });
  },
  // 땡땡땡땡땡 — 다섯 번 연속, 마지막 한 번은 길게 울린다
  ding() {
    for (let i = 0; i < 5; i++) {
      const at = i * 0.3;
      const last = i === 4;
      tone(988, { at, dur: last ? 2.4 : 0.5, gain: 0.32 });
      tone(1976, { at, dur: last ? 1.5 : 0.35, gain: 0.12 });
      tone(2964, { at, dur: last ? 0.8 : 0.2, gain: 0.06 });
      tone(494, { at, dur: 0.3, type: 'triangle', gain: 0.16 });
    }
  },
  tick(progress: number) {
    tone(520 + progress * 560, { dur: 0.055, type: 'triangle', gain: 0.16 });
  },
  // 팡파르 + 거친 "부라보!" 외침 + 아이들의 "와우~" 함성을 같은 순간에 시작한다
  bravo() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { at: i * 0.11, dur: 0.2, type: 'triangle', gain: 0.14 }));
    [1046.5, 1318.5, 1568].forEach((f) => tone(f, { at: 0.5, dur: 1.3, type: 'triangle', gain: 0.08 }));
    if (!play('bravo', 0, 1.1)) {
      if (getCtx()) void load('bravo').then(() => { if (!play('bravo', 0, 1.1)) sfx.say('부라보'); });
      else sfx.say('부라보');
    }
    if (!play('kids-cheer', 0, 1.3)) void load('kids-cheer').then(() => play('kids-cheer', 0, 1.3));
  },
  pop() {
    tone(420, { to: 900, dur: 0.14, gain: 0.14 });
  },
  startDisco,
  stopDisco,
  setDiscoBpm(bpm: number) { discoSixteenth = 60 / bpm / 4; },
  // 핀볼 이벤트 효과음
  lead() {
    [659.25, 880, 1318.5].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.16, type: 'square', gain: 0.09 }));
    play('kids-wow', 0, 0.7);
  },
  thunder() {
    noiseHit('highpass', 3000, 0.7, 0.18);
    noiseHit('lowpass', 900, 0.9, 1.3, 90);
    tone(70, { dur: 1.1, type: 'sine', gain: 0.5, to: 32 });
  },
  boom() {
    noiseHit('lowpass', 1400, 1, 0.9, 70);
    tone(110, { dur: 0.8, type: 'sine', gain: 0.6, to: 30 });
  },
  wind() {
    noiseHit('bandpass', 400, 0.5, 2.4, 1800);
  },
  warp() {
    tone(1200, { dur: 0.45, type: 'sawtooth', gain: 0.1, to: 90 });
  },
  gate() {
    tone(1568, { dur: 0.25, type: 'triangle', gain: 0.16 });
    tone(2093, { at: 0.08, dur: 0.3, type: 'triangle', gain: 0.14 });
  },
  bump() {
    tone(190, { to: 560, dur: 0.11, type: 'square', gain: 0.07 });
  },
  hand() {
    tone(660, { dur: 0.1, gain: 0.15 });
    tone(990, { at: 0.1, dur: 0.2, gain: 0.15 });
  },
  say(text: string) {
    if (muted || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = 1;
    u.pitch = 0.3;
    u.volume = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  },
};
