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
const loading = new Set<string>();

async function load(name: string) {
  const c = getCtx();
  if (!c || buffers[name] || loading.has(name)) return;
  loading.add(name);
  try {
    const res = await fetch(`/sfx/${name}.mp3`);
    buffers[name] = await c.decodeAudioData(await res.arrayBuffer());
  } catch {
    // 음원을 못 받으면 합성음으로 대체된다
  } finally {
    loading.delete(name);
  }
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

function preload() { void load('bravo'); void load('cheer'); }

// ── 디스코 비트 (핀볼 배경 음악) ──────────────────────────
let discoTimer = 0;
let discoBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

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

  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  const env = (g: GainNode, t: number, peak: number, dur: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  };
  const noise = (t: number, type: BiquadFilterType, freq: number, peak: number, dur: number) => {
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
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

  const sixteenth = 60 / 124 / 4;
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
      voice(t, 'sawtooth', f * lift, 0.55, sixteenth * 1.8, 420);
      voice(t, 'sine', f * lift, 0.6, sixteenth * 1.8);
    }
    if (s === 6 || s === 14) {
      [1, thirds[bar], 1.498].forEach((r) => voice(t, 'triangle', root * 8 * r, 0.05, 0.14));
    }
  };

  const schedule = () => {
    while (nextT < c.currentTime + 0.25) {
      playStep(step, nextT);
      nextT += sixteenth;
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
  // 팡파르 + 거친 "부라보!" 외침 + "와~" 함성
  bravo() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { at: i * 0.11, dur: 0.2, type: 'triangle', gain: 0.16 }));
    [1046.5, 1318.5, 1568].forEach((f) => tone(f, { at: 0.5, dur: 1.3, type: 'triangle', gain: 0.1 }));
    if (!play('bravo', 0.05, 1)) sfx.say('부라보');
    play('cheer', 0.2, 0.9);
  },
  pop() {
    tone(420, { to: 900, dur: 0.14, gain: 0.14 });
  },
  startDisco,
  stopDisco,
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
