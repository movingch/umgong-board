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

export const sfx = {
  isMuted: () => muted,
  setMuted(next: boolean) {
    muted = next;
    localStorage.setItem('sfx-muted', next ? '1' : '0');
    if (next) window.speechSynthesis?.cancel();
  },
  // 브라우저는 사용자 동작 뒤에만 소리를 허용한다
  unlock() { getCtx(); },

  beep(final: boolean) {
    tone(final ? 1320 : 990, { dur: 0.11, type: 'square', gain: 0.1 });
    if (final) tone(1320, { at: 0.16, dur: 0.11, type: 'square', gain: 0.1 });
  },
  ding() {
    tone(988, { dur: 2.4, gain: 0.32 });
    tone(1976, { dur: 1.5, gain: 0.12 });
    tone(2964, { dur: 0.8, gain: 0.06 });
    tone(494, { dur: 0.5, type: 'triangle', gain: 0.16 });
  },
  tick(progress: number) {
    tone(520 + progress * 560, { dur: 0.055, type: 'triangle', gain: 0.16 });
  },
  bravo() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { at: i * 0.11, dur: 0.2, type: 'triangle', gain: 0.2 }));
    [1046.5, 1318.5, 1568].forEach((f) => tone(f, { at: 0.5, dur: 1.3, type: 'triangle', gain: 0.14 }));
    tone(261.63, { at: 0.5, dur: 1.3, type: 'sawtooth', gain: 0.06 });
  },
  pop() {
    tone(420, { to: 900, dur: 0.14, gain: 0.14 });
  },
  hand() {
    tone(660, { dur: 0.1, gain: 0.15 });
    tone(990, { at: 0.1, dur: 0.2, gain: 0.15 });
  },
  say(text: string) {
    if (muted || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = 0.9;
    u.pitch = 1.3;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  },
};
