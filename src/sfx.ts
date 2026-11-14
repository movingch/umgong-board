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

export const sfx = {
  isMuted: () => muted,
  setMuted(next: boolean) {
    muted = next;
    localStorage.setItem('sfx-muted', next ? '1' : '0');
    if (next) window.speechSynthesis?.cancel();
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
