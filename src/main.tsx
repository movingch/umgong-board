import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeSVG } from 'qrcode.react';
import { supabase, isSupabaseReady } from './lib/supabase';
import type { User } from '@supabase/supabase-js';
import type { Board, BoardItem } from './types';
import { sfx } from './sfx';
import { Confetti } from './Confetti';
import { PinballModal } from './Pinball';
import { ensureBoardOgImage } from './ogImage';
import './styles.css';

const BUCKET = 'board-images';

// 카드에 붙이는 이모티콘 반응
const REACTIONS = [
  { kind: 'like', emoji: '❤️', label: '좋아요' },
  { kind: 'cool', emoji: '😎', label: '멋져요' },
  { kind: 'thanks', emoji: '🙏', label: '감사해요' },
  { kind: 'fun', emoji: '😂', label: '재미있어요' },
  { kind: 'best', emoji: '🏆', label: '최고예요' },
] as const;
const totalReactions = (r: Record<string, number> | null | undefined) =>
  REACTIONS.reduce((n, x) => n + (r?.[x.kind] || 0), 0);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── 내 보드 히스토리 (데모 모드용 localStorage) ───────────
type SavedBoard = { id: string; title: string; savedAt: string };

function getLocalHistory(): SavedBoard[] {
  return JSON.parse(localStorage.getItem('board-history') || '[]');
}
function saveToLocalHistory(id: string, title: string) {
  const history = getLocalHistory().filter((b) => b.id !== id);
  localStorage.setItem('board-history', JSON.stringify(
    [{ id, title, savedAt: new Date().toISOString() }, ...history].slice(0, 20)
  ));
}
function removeFromLocalHistory(id: string) {
  localStorage.setItem('board-history', JSON.stringify(getLocalHistory().filter((b) => b.id !== id)));
}

// ── 유틸 ─────────────────────────────────────────────────
function uid() { return crypto.randomUUID(); }

function getPathParts() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return { mode: parts[0] || 'home', boardId: parts[1] || '' };
}

function getBaseUrl() { return window.location.origin; }

function randomRotate() {
  return [-5, -4, -3, -2, 2, 3, 4, 5][Math.floor(Math.random() * 8)];
}

async function resizeImage(file: File, maxWidth = 1600, quality = 0.82): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
  const scale = Math.min(1, maxWidth / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지 처리에 실패했습니다.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => { URL.revokeObjectURL(url); resolve(blob || file); }, 'image/jpeg', quality);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
  try {
    const binary = atob(base64);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch { throw new Error('이미지 변환에 실패했습니다.'); }
}

function textToImageBlob(text: string, uploaderName: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 800; canvas.height = 600;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fffdf6'; ctx.fillRect(0, 0, 800, 600);
  ctx.fillStyle = '#c89f62'; ctx.font = 'bold 22px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(uploaderName || '이름 없는 참여자', 40, 52);
  ctx.strokeStyle = '#e1c7a5'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(40, 70); ctx.lineTo(760, 70); ctx.stroke();
  ctx.fillStyle = '#241914'; ctx.font = '30px ui-sans-serif, system-ui, sans-serif';
  let y = 116;
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      const test = line + char;
      if (ctx.measureText(test).width > 720) { ctx.fillText(line, 40, y); y += 46; line = char; if (y > 540) break; }
      else line = test;
    }
    if (line && y <= 540) { ctx.fillText(line, 40, y); y += 46; }
    if (y > 540) break;
  }
  return new Promise((resolve) => { canvas.toBlob((blob) => resolve(blob!), 'image/png'); });
}

// 핀볼 도착 순위를 보드에 붙일 카드 이미지로 만든다
const RANK_CARD_NAME = '🎱 핀볼 순위';
function rankingToImageBlob(title: string, names: string[]): Promise<Blob> {
  const W = 1200, H = 900;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fffdf6'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#241914'; ctx.font = '900 52px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 50, 62);
  ctx.fillStyle = '#9b7a4d'; ctx.font = '600 26px ui-sans-serif, system-ui, sans-serif';
  const stamp = new Date().toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  ctx.textAlign = 'right';
  ctx.fillText(`${names.length}명 · ${stamp}`, W - 50, 66);
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#e1c7a5'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(50, 112); ctx.lineTo(W - 50, 112); ctx.stroke();

  const n = names.length;
  const cols = n <= 10 ? 1 : n <= 24 ? 2 : n <= 45 ? 3 : 4;
  const perCol = Math.ceil(n / cols);
  const top = 140, rowH = Math.min(72, (H - top - 30) / perCol);
  const colW = (W - 100) / cols;
  const size = Math.min(46, rowH * 0.7);
  const medals = ['🥇', '🥈', '🥉'];
  names.forEach((name, i) => {
    const col = Math.floor(i / perCol), row = i % perCol;
    const x = 50 + col * colW, y = top + row * rowH + rowH / 2;
    ctx.font = `900 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = i < 3 ? '#b8751a' : '#9b7a4d';
    const label = i < 3 ? medals[i] : `${i + 1}.`;
    ctx.fillText(label, x, y);
    ctx.fillStyle = '#241914';
    ctx.font = `${i < 3 ? 900 : 700} ${size}px ui-sans-serif, system-ui, sans-serif`;
    const nameX = x + size * 1.9, maxW = colW - size * 1.9 - 16;
    let text = name;
    while (text.length > 1 && ctx.measureText(text).width > maxW) text = `${text.slice(0, -2)}…`;
    ctx.fillText(text, nameX, y);
  });
  return new Promise((resolve) => { canvas.toBlob((blob) => resolve(blob!), 'image/png'); });
}

async function uploadBlob(boardId: string, blob: Blob, ext: string) {
  if (!supabase) return URL.createObjectURL(blob);
  const path = `${boardId}/${Date.now()}-${uid()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { cacheControl: '3600', upsert: false, contentType: blob.type });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// 인쇄 직전에 아래쪽 이미지까지 모두 불러와 빈 칸이 PDF에 남지 않게 한다
function loadAllImages() {
  const imgs = [...document.querySelectorAll<HTMLImageElement>('.cork-board img')];
  imgs.forEach((img) => { img.loading = 'eager'; });
  return Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  }))));
}
async function printBoard() {
  await Promise.race([loadAllImages(), new Promise((r) => setTimeout(r, 8000))]);
  window.print();
}

// ── PWA 설치 버튼 ─────────────────────────────────────────
function useInstallPrompt() {
  const [prompt, setPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent) && !(window.navigator as any).standalone);
    const handler = (e: Event) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function install() {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }

  return { prompt, isIOS, install };
}

function InstallButton() {
  const { prompt, isIOS, install } = useInstallPrompt();
  const [showIOSTip, setShowIOSTip] = useState(false);

  if (isIOS) return (
    <div style={{ position: 'relative' }}>
      <button className="install-btn" onClick={() => setShowIOSTip(!showIOSTip)}>
        홈화면에 추가
      </button>
      {showIOSTip && (
        <div className="ios-tip">
          Safari 하단 <strong>공유 버튼 →</strong><br />
          <strong>홈 화면에 추가</strong> 를 눌러주세요
        </div>
      )}
    </div>
  );
  if (!prompt) return null;
  return <button className="install-btn" onClick={install}>홈화면에 추가</button>;
}

// ── Toast ────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const timer = useRef<number>(0);
  const show = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);
  return { toast, show };
}

function Toast({ toast }: { toast: { msg: string; type: 'success' | 'error' } | null }) {
  if (!toast) return null;
  return <div className={`toast toast-${toast.type}`}>{toast.msg}</div>;
}

// ── 손든 이름 (진행자 화면에 떠다니는 이름표) ─────────────
type FloatingHand = { id: number; name: string; x: number; y: number; fx: number; fy: number; dx: number; dy: number; rot: number; dur: number; count: number };

function makeFloatingHand(seq: number, name: string): FloatingHand {
  // R2 저불일치 수열로 자리를 잡아 인원이 많아도 화면에 고르게 퍼진다
  const frac = (v: number) => v - Math.floor(v);
  const angle = Math.random() * Math.PI * 2;
  const sign = () => (Math.random() < 0.5 ? -1 : 1);
  return {
    id: seq,
    name,
    x: 9 + frac(0.5 + seq * 0.7548776662) * 82,
    y: 12 + frac(0.5 + seq * 0.5698402910) * 66,
    fx: Math.cos(angle) * 80,
    fy: Math.sin(angle) * 80,
    dx: sign() * (2 + Math.random() * 5),
    dy: sign() * (2 + Math.random() * 6),
    rot: sign() * (2 + Math.random() * 6),
    dur: 2.2 + Math.random() * 2.6,
    count: 1,
  };
}

// ── 발표자 추첨 훅 ────────────────────────────────────────
function useRoulette(names: string[]) {
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'done'>('idle');
  const [current, setCurrent] = useState('');
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<number>(0);
  const namesRef = useRef(names);
  namesRef.current = names;

  function reset() {
    clearTimeout(timerRef.current);
    setPhase('idle');
    setCurrent('');
    setProgress(0);
  }

  function spin() {
    const pool = namesRef.current;
    if (pool.length === 0) return;
    clearTimeout(timerRef.current);
    const rand = () => pool[Math.floor(Math.random() * pool.length)];
    // 당첨자는 암호학적 난수로 뽑는다
    const pick = new Uint32Array(1);
    crypto.getRandomValues(pick);
    const winner = pool[pick[0] % pool.length];
    const total = 34 + Math.floor(Math.random() * 8);
    let i = 0;
    let last = '';
    setPhase('spinning');

    const next = () => {
      i++;
      const p = i / total;
      let pick = winner;
      if (i < total && pool.length > 1) {
        // 마지막 직전에는 당첨자가 아닌 이름을 보여줘 최종 공개가 눈에 보이게 한다
        const avoid = i === total - 1 ? winner : last;
        do { pick = rand(); } while (pick === avoid);
      }
      last = pick;
      setCurrent(pick);
      setStep(i);
      setProgress(p);
      sfx.tick(p);
      if (i >= total) {
        timerRef.current = window.setTimeout(() => {
          setPhase('done');
          sfx.bravo();
        }, 700);
        return;
      }
      timerRef.current = window.setTimeout(next, 50 + 420 * p * p * p);
    };
    next();
  }

  useEffect(() => () => clearTimeout(timerRef.current), []);
  return { phase, current, step, progress, spin, reset };
}

// ── 타이머 훅 ─────────────────────────────────────────────
function useTimer(onTick: (left: number) => void, onDone: () => void) {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const endRef = useRef(0);
  const lastRef = useRef(0);
  const cbRef = useRef({ onTick, onDone });
  cbRef.current = { onTick, onDone };

  useEffect(() => {
    if (!running) return;
    // 종료 시각 기준으로 계산해 탭이 느려져도 시간이 밀리지 않는다
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((endRef.current - Date.now()) / 1000));
      if (left === lastRef.current) return;
      lastRef.current = left;
      setSeconds(left);
      if (left === 0) { setRunning(false); cbRef.current.onDone(); }
      else cbRef.current.onTick(left);
    }, 100);
    return () => clearInterval(id);
  }, [running]);

  function start(total: number) {
    endRef.current = Date.now() + total * 1000;
    lastRef.current = total;
    setSeconds(total);
    setRunning(true);
    cbRef.current.onTick(total);
  }
  function pause() { setRunning(false); }
  function resume() {
    if (seconds <= 0) return;
    endRef.current = Date.now() + seconds * 1000;
    setRunning(true);
  }
  function reset() { setRunning(false); setSeconds(0); lastRef.current = 0; }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return { seconds, running, start, pause, resume, reset, display: `${mm}:${ss}` };
}

// ── App (인증 상태 관리) ──────────────────────────────────
function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [guest, setGuest] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const route = getPathParts();

  if (!authReady) {
    return <div className="loading-screen"><div className="loading-spinner" />잠시만요...</div>;
  }

  if (route.mode === 'board' && route.boardId) {
    if (!UUID_RE.test(route.boardId)) return <div className="error-page">잘못된 보드 주소입니다.</div>;
    return <BoardScreen boardId={route.boardId} user={user} />;
  }
  if (route.mode === 'view' && route.boardId) {
    if (!UUID_RE.test(route.boardId)) return <div className="error-page">잘못된 보드 주소입니다.</div>;
    return <BoardScreen boardId={route.boardId} user={user} readOnly />;
  }
  if (route.mode === 'join' && route.boardId) {
    if (!UUID_RE.test(route.boardId)) return <div className="error-page">잘못된 보드 주소입니다.</div>;
    return <JoinScreen boardId={route.boardId} />;
  }
  return <Home user={user} guest={guest} onGuest={() => setGuest(true)} />;
}

// ── Home ─────────────────────────────────────────────────
function Home({ user, guest, onGuest }: { user: User | null; guest: boolean; onGuest: () => void }) {
  const [title, setTitle] = useState('오늘의 생각보드');
  const [busy, setBusy] = useState(false);
  const [myBoards, setMyBoards] = useState<Board[]>([]);
  const [localHistory, setLocalHistory] = useState<SavedBoard[]>(getLocalHistory);
  const { toast, show } = useToast();

  useEffect(() => {
    if (!user || !supabase) return;
    supabase
      .from('boards')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setMyBoards(data as Board[]); });
  }, [user]);

  async function createBoard() {
    setBusy(true);
    try {
      if (!supabase) {
        const id = uid();
        localStorage.setItem(`demo-board-${id}`, JSON.stringify({ id, title, locked: false }));
        saveToLocalHistory(id, title);
        window.location.href = `/board/${id}`;
        return;
      }
      const { data, error } = await supabase
        .from('boards')
        .insert(user ? { title, owner_id: user.id } : { title })
        .select()
        .single();
      if (error) throw error;
      window.location.href = `/board/${data.id}`;
    } catch (e: any) {
      show(e?.message || e?.error_description || JSON.stringify(e) || '보드 생성에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteBoard(id: string) {
    if (!confirm('이 보드를 삭제할까요? 보드 안의 모든 이미지도 함께 삭제됩니다.')) return;
    if (user && supabase) {
      const { error } = await supabase.from('boards').delete().eq('id', id);
      if (error) { show('삭제에 실패했습니다.', 'error'); return; }
      setMyBoards((prev) => prev.filter((b) => b.id !== id));
    } else {
      removeFromLocalHistory(id);
      setLocalHistory(getLocalHistory());
    }
  }

  async function logout() {
    await supabase?.auth.signOut();
  }

  if (supabase && !user && !guest) {
    return <LoginScreen onGuest={onGuest} />;
  }

  return (
    <main className="home">
      <section className="hero-card">
        <div className="home-top-bar">
          <div className="brand">생각보드</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <InstallButton />
            {user && (
              <div className="user-info">
                <span className="user-email">{user.email}</span>
                <button className="logout-btn" onClick={logout}>로그아웃</button>
              </div>
            )}
          </div>
        </div>

        <h1>스마트폰으로 그리고, PC 화면에 함께 전시합니다.</h1>
        <p>회의 참석자는 QR로 들어와 사진이나 낙서를 올리고, 진행자는 큰 화면에서 보드판처럼 보여주며 설명할 수 있습니다.</p>

        {!isSupabaseReady && (
          <div className="warning">현재 Supabase 환경변수가 없어 데모 모드로 실행됩니다.</div>
        )}

        <label className="field-label" htmlFor="board-title">보드 제목</label>
        <input
          id="board-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="title-input"
          onKeyDown={(e) => e.key === 'Enter' && !busy && createBoard()}
        />
        <button onClick={createBoard} disabled={busy} className="primary-btn">
          {busy ? '만드는 중...' : '새 보드 만들기'}
        </button>

        {(user ? myBoards.length > 0 : localHistory.length > 0) && (
          <div className="history-section">
            <div className="history-title">
              {user ? '☁️ 내 보드 목록' : '최근 보드'}
            </div>
            <ul className="history-list">
              {(user ? myBoards.map(b => ({ id: b.id, title: b.title, savedAt: b.created_at || '' })) : localHistory).map((b) => (
                <li key={b.id} className="history-item">
                  <a href={`/board/${b.id}`} className="history-link">
                    <span className="history-name">{b.title}</span>
                    <span className="history-date">
                      {b.savedAt ? new Date(b.savedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : ''}
                    </span>
                  </a>
                  <button
                    className="history-del"
                    aria-label="보드 삭제"
                    onClick={() => deleteBoard(b.id)}
                  >×</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <Toast toast={toast} />
    </main>
  );
}

// ── 로그인 화면 ───────────────────────────────────────────
function LoginScreen({ onGuest }: { onGuest: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast, show } = useToast();

  async function sendCode() {
    if (!email.trim() || !supabase) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
      if (error) throw error;
      setSent(true);
    } catch (e: any) {
      show(e?.message || '오류가 발생했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!code.trim() || !supabase) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
      if (error) throw error;
    } catch (e: any) {
      show(e?.message || '코드가 올바르지 않습니다.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="home">
      <section className="hero-card">
        <div className="home-top-bar" style={{ marginBottom: 8 }}>
          <div className="brand">생각보드</div>
          <InstallButton />
        </div>
        <h1>스마트폰으로 그리고, PC 화면에 함께 전시합니다.</h1>
        <p>내 보드를 저장하고 어느 기기에서든 불러오려면 이메일로 로그인하세요.</p>

        {!sent ? (
          <>
            <label className="field-label" htmlFor="login-email">이메일 주소</label>
            <input
              id="login-email"
              type="email"
              className="title-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              onKeyDown={(e) => e.key === 'Enter' && sendCode()}
              autoFocus
            />
            <button className="primary-btn" disabled={busy || !email.trim()} onClick={sendCode}>
              {busy ? '전송 중...' : '인증 코드 받기'}
            </button>
            <p className="hint">이메일로 6자리 코드를 보내드립니다.</p>
          </>
        ) : (
          <>
            <div className="magic-sent">
              <div className="magic-icon">📧</div>
              <p className="magic-email">{email}</p>
              <p className="magic-desc">로 6자리 코드를 보냈습니다.<br />이메일을 확인하고 아래에 입력하세요.</p>
            </div>
            <label className="field-label" htmlFor="login-code">인증 코드 6자리</label>
            <input
              id="login-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="title-input otp-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              onKeyDown={(e) => e.key === 'Enter' && verifyCode()}
              autoFocus
            />
            <button className="primary-btn" disabled={busy || code.length < 6} onClick={verifyCode}>
              {busy ? '확인 중...' : '로그인'}
            </button>
            <p className="hint">
              <button className="link-btn" onClick={() => { setSent(false); setCode(''); }}>← 이메일 다시 입력</button>
              {' · '}
              <button className="link-btn" onClick={sendCode}>코드 재전송</button>
            </p>
          </>
        )}

        <div className="guest-divider"><span>또는</span></div>
        <button className="guest-btn" onClick={onGuest}>
          즉시 사용 <small>단, 저장되지 않습니다</small>
        </button>
      </section>
      <Toast toast={toast} />
    </main>
  );
}

// ── BoardScreen (진행자) ──────────────────────────────────
function BoardScreen({ boardId, user, readOnly = false }: { boardId: string; user: User | null; readOnly?: boolean }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [items, setItems] = useState<BoardItem[]>([]);
  const [selected, setSelected] = useState<BoardItem | null>(null);
  const [qrExpanded, setQrExpanded] = useState(false);
  const [sortByLikes, setSortByLikes] = useState(false);
  const [shakingId, setShakingId] = useState<string | null>(null);
  const [hands, setHands] = useState<FloatingHand[]>([]);
  const handSeq = useRef(0);
  const handClearTimer = useRef<number>(0);
  const lastHandSound = useRef(0);
  const [handPickOpen, setHandPickOpen] = useState(false);
  const [emojiBursts, setEmojiBursts] = useState<{ id: number; itemId: string; emoji: string; dx: number }[]>([]);
  const prevReacts = useRef<Map<string, Record<string, number>> | null>(null);
  const burstSeq = useRef(0);
  const [cheerCooling, setCheerCooling] = useState(false);
  const [pinball, setPinball] = useState<{ names: string[]; title: string; fromHands: boolean } | null>(null);
  const [showRoulette, setShowRoulette] = useState(false);
  const [noticeInput, setNoticeInput] = useState('');
  const [noticeEditing, setNoticeEditing] = useState(false);
  const [timerMin, setTimerMin] = useState('1');
  const [timerSec, setTimerSec] = useState('0');
  const [showTimer, setShowTimer] = useState(false);
  const [ddaeng, setDdaeng] = useState(0);
  const [muted, setMuted] = useState(sfx.isMuted());
  const [loaded, setLoaded] = useState(false);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const knownIds = useRef<Set<string> | null>(null);
  const channelRef = useRef<any>(null);
  const timer = useTimer(
    (left) => { if (left <= 10) sfx.beep(left <= 3); },
    () => {
      sfx.ding();
      setDdaeng(Date.now());
      window.setTimeout(() => setDdaeng(0), 2800);
    },
  );
  const uniqueNames = [...new Set(items.map((it) => it.uploader_name).filter((n) => n && n !== RANK_CARD_NAME) as string[])];
  const roulette = useRoulette(uniqueNames);
  const handNames = hands.map((h) => h.name);
  // 연타한 만큼 이름표가 커진다. 인원이 많을 때는 서로 겹치지 않게 많이 누른 사람만 상대적으로 키운다
  const handMax = Math.max(1, ...hands.map((h) => h.count));
  const handMin = Math.min(...hands.map((h) => h.count), handMax);
  const handScale = (count: number) => hands.length >= 6
    ? 1 + 0.4 * (handMax > handMin ? (count - handMin) / (handMax - handMin) : 0)
    : Math.min(1.7, 1 + (count - 1) * 0.03);
  const handRoulette = useRoulette(handNames);
  const { toast, show } = useToast();
  const joinUrl = `${getBaseUrl()}/join/${boardId}`;

  useEffect(() => {
    async function load() {
      if (!supabase) {
        const storedBoard = localStorage.getItem(`demo-board-${boardId}`);
        const b = storedBoard ? JSON.parse(storedBoard) : { id: boardId, title: '데모 생각보드', locked: false };
        setBoard(b);
        setNoticeInput(b.notice || '');
        saveToLocalHistory(boardId, b.title);
        setItems(JSON.parse(localStorage.getItem(`demo-items-${boardId}`) || '[]'));
        setLoaded(true);
        return;
      }
      const [{ data: b }, { data: loadedItems, error }] = await Promise.all([
        supabase.from('boards').select('*').eq('id', boardId).single(),
        supabase.from('board_items').select('*').eq('board_id', boardId).order('created_at', { ascending: true }),
      ]);
      if (b) { setBoard(b as Board); setNoticeInput((b as any).notice || ''); }
      if (!error && loadedItems) setItems(loadedItems as BoardItem[]);
      setLoaded(true);
    }
    load();
  }, [boardId]);

  // 참여 링크 미리보기용 이미지(보드 제목 포함)를 보드마다 한 번 만들어 둔다
  const boardTitle = board?.title;
  useEffect(() => {
    if (supabase && boardTitle && board?.created_at) void ensureBoardOgImage(supabase, BUCKET, boardId, boardTitle);
  }, [boardId, boardTitle, board?.created_at]);

  // 새로 붙은 카드 강조 (처음 불러온 카드는 제외)
  useEffect(() => {
    if (!loaded) return;
    if (!knownIds.current) { knownIds.current = new Set(items.map((it) => it.id)); return; }
    const added = items.filter((it) => !knownIds.current!.has(it.id)).map((it) => it.id);
    if (added.length === 0) return;
    added.forEach((id) => knownIds.current!.add(id));
    sfx.pop();
    setFreshIds((prev) => new Set([...prev, ...added]));
    window.setTimeout(() => {
      setFreshIds((prev) => { const n = new Set(prev); added.forEach((id) => n.delete(id)); return n; });
    }, 2400);
  }, [items, loaded]);

  // 반응이 늘어난 카드에서 이모티콘이 떠오른다
  useEffect(() => {
    if (!loaded) return;
    const current = new Map(items.map((it) => [it.id, it.reactions || {}]));
    const before = prevReacts.current;
    prevReacts.current = current;
    if (!before) return;
    const added: { id: number; itemId: string; emoji: string; dx: number }[] = [];
    for (const [itemId, r] of current) {
      const old = before.get(itemId);
      if (!old) continue;
      for (const x of REACTIONS) {
        const diff = Math.min(3, (r[x.kind] || 0) - (old[x.kind] || 0));
        for (let i = 0; i < diff; i++) added.push({ id: ++burstSeq.current, itemId, emoji: x.emoji, dx: Math.round((Math.random() - 0.5) * 120) });
      }
    }
    if (added.length === 0) return;
    sfx.pop();
    setEmojiBursts((prev) => [...prev, ...added].slice(-60));
    const ids = new Set(added.map((a) => a.id));
    window.setTimeout(() => setEmojiBursts((prev) => prev.filter((b) => !ids.has(b.id))), 1900);
  }, [items, loaded]);

  useEffect(() => {
    const unlock = () => sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    if (!supabase) {
      const t = window.setInterval(() => {
        setItems(JSON.parse(localStorage.getItem(`demo-items-${boardId}`) || '[]'));
      }, 1000);
      return () => window.clearInterval(t);
    }

    // 최신 아이템 전체 동기화 함수
    async function syncAll() {
      const [{ data: latestItems }, { data: latestBoard }] = await Promise.all([
        supabase.from('board_items').select('*').eq('board_id', boardId).order('created_at', { ascending: true }),
        supabase.from('boards').select('*').eq('id', boardId).single(),
      ]);
      if (latestItems) setItems(latestItems as BoardItem[]);
      if (latestBoard) setBoard((prev) => prev ? { ...prev, ...(latestBoard as Board) } : latestBoard as Board);
    }

    const channel = supabase
      .channel(`board-${boardId}`, { config: { broadcast: { self: true } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'board_items', filter: `board_id=eq.${boardId}` }, (payload) => {
        setItems((prev) => prev.some((it) => it.id === payload.new.id) ? prev : [...prev, payload.new as BoardItem]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'board_items', filter: `board_id=eq.${boardId}` }, (payload) => {
        const next = payload.new as BoardItem;
        setItems((prev) => prev.map((it) => it.id === next.id ? { ...it, likes: next.likes, reactions: next.reactions } : it));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'board_items', filter: `board_id=eq.${boardId}` }, (payload) => {
        setItems((prev) => prev.filter((it) => it.id !== payload.old.id));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'boards', filter: `id=eq.${boardId}` }, (payload) => {
        setBoard((prev) => prev ? { ...prev, ...(payload.new as Board) } : prev);
      })
      .on('broadcast', { event: 'shake-card' }, ({ payload }: any) => {
        if (!payload?.itemId) return;
        setShakingId(payload.itemId);
        setTimeout(() => setShakingId(null), 900);
      })
      .on('broadcast', { event: 'item-uploaded' }, () => {
        syncAll();
      })
      .on('broadcast', { event: 'hand-raised' }, ({ payload }: any) => {
        const names: string[] = (Array.isArray(payload?.names) ? payload.names : [payload?.name])
          .filter(Boolean).slice(0, 10).map((n: unknown) => String(n).slice(0, 30));
        if (names.length === 0) return;
        const n = Math.min(30, Math.max(1, Number(payload?.n) || 1));
        const now = performance.now();
        if (now - lastHandSound.current > 90) { sfx.hand(); lastHandSound.current = now; }
        const fresh = names.map((name) => ({ ...makeFloatingHand(++handSeq.current, name), count: n }));
        // 이미 떠 있는 이름은 자리를 지키고 횟수만 올라간다 (연타할수록 커진다)
        setHands((prev) => {
          let next = prev;
          names.forEach((name, i) => {
            const existing = next.find((h) => h.name === name);
            next = existing
              ? next.map((h) => h === existing ? { ...h, count: h.count + n } : h)
              : [...next, fresh[i]];
          });
          return next.slice(-100);
        });
        window.clearTimeout(handClearTimer.current);
        handClearTimer.current = window.setTimeout(() => setHands([]), readOnly ? 8000 : 90000);
      })
      .subscribe();
    channelRef.current = channel;

    // 3초 폴링: Realtime 지연·단절 보완
    const pollTimer = window.setInterval(syncAll, 3000);

    return () => {
      window.clearInterval(pollTimer);
      channelRef.current = null;
      supabase?.removeChannel(channel);
    };
  }, [boardId]);

  async function removeItem(id: string) {
    if (!confirm('이 항목을 삭제할까요?')) return;
    const prev = items;
    setItems((cur) => cur.filter((it) => it.id !== id));
    if (!supabase) {
      localStorage.setItem(`demo-items-${boardId}`, JSON.stringify(prev.filter((it) => it.id !== id)));
      return;
    }
    const { error } = await supabase.from('board_items').delete().eq('id', id);
    if (error) { setItems(prev); show('삭제에 실패했습니다.', 'error'); }
  }

  async function toggleLock() {
    if (!supabase || !board) return;
    const newLocked = !board.locked;
    setBoard({ ...board, locked: newLocked });
    await supabase.from('boards').update({ locked: newLocked }).eq('id', boardId);
    channelRef.current?.send({ type: 'broadcast', event: 'board-updated', payload: { locked: newLocked } });
    show(newLocked ? '보드가 잠겼습니다. 새 제출이 차단됩니다.' : '보드가 열렸습니다.', 'success');
  }

  async function saveNotice(value = noticeInput) {
    const notice = value.trim() || null;
    setBoard((b) => b ? { ...b, notice } : b);
    setNoticeInput(notice || '');
    setNoticeEditing(false);
    if (supabase) {
      const { error } = await supabase.from('boards').update({ notice }).eq('id', boardId);
      if (error) { show('공지 저장에 실패했습니다.', 'error'); return; }
      channelRef.current?.send({ type: 'broadcast', event: 'board-updated', payload: { notice } });
    } else {
      const stored = JSON.parse(localStorage.getItem(`demo-board-${boardId}`) || 'null') || { id: boardId, title: '데모 생각보드', locked: false };
      localStorage.setItem(`demo-board-${boardId}`, JSON.stringify({ ...stored, notice }));
    }
    show(notice ? '공지를 전송했습니다.' : '공지를 삭제했습니다.', 'success');
  }

  // 핀볼 도착 순위를 카드로 만들어 보드에 붙인다
  async function postRanking(order: string[], title: string): Promise<boolean> {
    try {
      const blob = await rankingToImageBlob('🎱 핀볼 추첨 순위', order);
      const imageUrl = await uploadBlob(boardId, blob, 'png');
      const item: BoardItem = {
        id: uid(), board_id: boardId, type: 'text', image_url: imageUrl,
        uploader_name: RANK_CARD_NAME,
        caption: `${title} · ${order.slice(0, 3).join(' → ')}${order.length > 3 ? ' …' : ''}`,
        rotate: randomRotate(), created_at: new Date().toISOString(), likes: 0, reactions: {},
      };
      if (!supabase) {
        const list = JSON.parse(localStorage.getItem(`demo-items-${boardId}`) || '[]');
        localStorage.setItem(`demo-items-${boardId}`, JSON.stringify([...list, item]));
      } else {
        const { error } = await supabase.from('board_items').insert(item);
        if (error) throw error;
        channelRef.current?.send({ type: 'broadcast', event: 'item-uploaded', payload: { itemId: item.id } });
      }
      setItems((prev) => prev.some((it) => it.id === item.id) ? prev : [...prev, item]);
      show('📌 핀볼 순위를 보드에 붙였습니다.', 'success');
      return true;
    } catch (e) {
      show(e instanceof Error ? e.message : '순위를 붙이지 못했습니다.', 'error');
      return false;
    }
  }

  // 카드 주인(참여자)의 화면에 신호를 보낸다
  async function pokeItem(item: BoardItem) {
    const target = item.uploader_name || '참여자';
    setShakingId(item.id);
    window.setTimeout(() => setShakingId(null), 900);
    if (!channelRef.current) { show('데모 모드에서는 신호가 전송되지 않습니다.', 'error'); return; }
    const res = await channelRef.current.send({ type: 'broadcast', event: 'poke', payload: { itemId: item.id, name: target } });
    show(res === 'ok' ? `👏 ${target}님에게 칭찬을 보냈습니다.` : '신호 전송에 실패했습니다. 다시 눌러 주세요.', res === 'ok' ? 'success' : 'error');
  }

  // 접속해 있는 참여자 전원에게 응원을 보낸다
  async function cheerAll() {
    if (cheerCooling) return;
    if (!channelRef.current) { show('데모 모드에서는 응원이 전송되지 않습니다.', 'error'); return; }
    setCheerCooling(true);
    window.setTimeout(() => setCheerCooling(false), 3000);
    const res = await channelRef.current.send({ type: 'broadcast', event: 'cheer-all', payload: { text: '자! 힘을 내세요!' } });
    show(res === 'ok' ? '💪 참여자 전원에게 응원을 보냈습니다.' : '응원 전송에 실패했습니다. 다시 눌러 주세요.', res === 'ok' ? 'success' : 'error');
  }

  async function reloadParticipants() {
    if (!channelRef.current) { show('데모 모드에서는 사용할 수 없습니다.', 'error'); return; }
    if (!confirm('열려 있는 참여자 화면을 모두 새로고침할까요?\n(그리는 중이거나 글을 쓰는 중인 사람은 끝낸 뒤에 새로고침됩니다)')) return;
    const res = await channelRef.current.send({ type: 'broadcast', event: 'force-reload', payload: {} });
    show(res === 'ok' ? '🔄 참여자 화면에 새로고침 신호를 보냈습니다.' : '전송에 실패했습니다. 다시 눌러 주세요.', res === 'ok' ? 'success' : 'error');
  }

  function startTimer(total: number) {
    if (total <= 0) { show('시간을 1초 이상으로 설정해 주세요.', 'error'); return; }
    timer.start(Math.min(total, 180 * 60));
  }

  function typeLabel(type: BoardItem['type']) {
    if (type === 'drawing') return '낙서';
    if (type === 'text') return '텍스트';
    return '사진';
  }

  const isOwner = !supabase || (user && board && (board as any).owner_id === user.id);
  const sortedItems = sortByLikes ? [...items].sort((a, b) => (b.likes || 0) - (a.likes || 0)) : items;

  return (
    <main className="board-page">
      <header className="board-header">
        <div className="board-heading">
          <div className="brand small">생각보드</div>
          <h1>{board?.title || '생각보드'}</h1>
          <p>{readOnly ? '보기 전용 화면입니다. 참여하려면 QR을 스캔하세요.' : '참여자는 스마트폰으로 그리고 올립니다. 진행자는 이 화면을 빔프로젝터에 띄우세요.'}</p>
        </div>
        {readOnly ? (
          <nav className="header-menu header-menu--view" aria-label="보드 메뉴">
            <button className="soft-btn" onClick={() => document.documentElement.requestFullscreen?.()}>전체화면</button>
          </nav>
        ) : (
        <nav className="header-menu" aria-label="보드 메뉴">
          <a className="soft-btn" href={joinUrl} target="_blank" rel="noopener noreferrer">참여자 화면 열기</a>
          <button className="soft-btn" onClick={() => document.documentElement.requestFullscreen?.()}>전체화면</button>
          <button className="soft-btn" onClick={() => navigator.clipboard.writeText(`${joinUrl}?s=2`).then(() => show('링크를 복사했습니다.', 'success'))}>참여 링크 복사</button>
          <button className={`soft-btn ${noticeEditing ? 'soft-btn--active' : ''}`} onClick={() => setNoticeEditing(!noticeEditing)}>
            {noticeEditing ? '✕ 공지 닫기' : '📢 공지'}
          </button>
          <button className="soft-btn export-btn" disabled={items.length === 0} onClick={printBoard}>🖨️ 인쇄 / PDF</button>
          <button className="soft-btn" onClick={() => navigator.clipboard.writeText(`${getBaseUrl()}/view/${boardId}`).then(() => show('보기 전용 링크를 복사했습니다.', 'success'))}>👀 보기 링크 복사</button>
          <a className="soft-btn" href="/">← 목록</a>
        </nav>
        )}
        <div className={`qr-box ${qrExpanded ? 'qr-box--expanded' : ''}`} onClick={() => setQrExpanded(!qrExpanded)} style={{ cursor: qrExpanded ? 'zoom-out' : 'zoom-in' }} title={qrExpanded ? '클릭하면 작아집니다' : '클릭하면 크게 보입니다'}>
          <QRCodeSVG value={joinUrl} size={qrExpanded ? 220 : 90} />
          <span>{qrExpanded ? '스마트폰으로 QR 스캔' : 'QR 참여'}</span>
        </div>
      </header>

      {/* 공지 배너 (진행자 화면) */}
      {board?.notice && (
        <div className="notice-banner notice-banner--facilitator">
          📢 {board.notice}
        </div>
      )}

      {!readOnly && (
      <section className="board-toolbar">
        {/* 잠금 버튼 */}
        <button
          className={`soft-btn ${board?.locked ? 'soft-btn--danger' : ''}`}
          onClick={toggleLock}
          title={board?.locked ? '클릭하면 접수를 다시 열 수 있습니다' : '클릭하면 새 제출을 차단합니다'}
        >
          {board?.locked ? '🔒 접수 마감 중' : '🔓 접수 중'}
        </button>

        {/* 타이머 버튼 */}
        <button className="soft-btn" onClick={() => setShowTimer(!showTimer)}>⏱️ 타이머</button>

        {/* 정렬 토글 */}
        <button
          className={`soft-btn ${sortByLikes ? 'soft-btn--active' : ''}`}
          onClick={() => setSortByLikes(!sortByLikes)}
          title="좋아요 많은 순으로 정렬"
        >
          {sortByLikes ? '❤️ 좋아요 순' : '🕐 시간 순'}
        </button>

        {/* 발표자 추첨 */}
        {uniqueNames.length > 0 && (
          <button className="soft-btn" onClick={() => setShowRoulette(true)}>🎲 발표자 추첨</button>
        )}
        {uniqueNames.length > 0 && (
          <button className="soft-btn" onClick={() => setPinball({ names: uniqueNames, title: '🎱 핀볼 추첨', fromHands: false })}>🎱 핀볼 추첨</button>
        )}

        <button
          className="soft-btn"
          onClick={() => { sfx.setMuted(!muted); setMuted(!muted); }}
          title={muted ? '효과음 켜기' : '효과음 끄기'}
        >
          {muted ? '🔇 효과음 꺼짐' : '🔊 효과음'}
        </button>

        <button className="soft-btn" onClick={reloadParticipants} title="열려 있는 참여자 화면을 최신 버전으로 다시 불러옵니다">
          🔄 참여자 새로고침
        </button>

        <button className="soft-btn soft-btn--cheer" onClick={cheerAll} disabled={cheerCooling} title="접속한 참여자 전원의 화면에 응원을 보냅니다">
          💪 전체 응원
        </button>
      </section>
      )}

      {/* 공지 입력 패널 */}
      {noticeEditing && (
        <div className="notice-panel">
          <input
            className="notice-input"
            value={noticeInput}
            onChange={(e) => setNoticeInput(e.target.value)}
            placeholder="참여자 화면에 표시할 공지를 입력하세요..."
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveNotice(); }}
            autoFocus
          />
          <button className="notice-btn notice-btn--send" onClick={() => saveNotice()}>전송</button>
          {board?.notice && (
            <button className="notice-btn" onClick={() => saveNotice('')}>공지 삭제</button>
          )}
        </div>
      )}

      {/* 타이머 패널 */}
      {showTimer && (
        <div className="timer-panel">
          {timer.seconds === 0 && !timer.running ? (
            <div className="timer-setup">
              <input
                type="number"
                className="timer-input"
                aria-label="분"
                value={timerMin}
                onChange={(e) => setTimerMin(e.target.value)}
                min="0"
                max="180"
              />
              <span>분</span>
              <input
                type="number"
                className="timer-input"
                aria-label="초"
                value={timerSec}
                onChange={(e) => setTimerSec(e.target.value)}
                min="0"
                max="59"
              />
              <span>초</span>
              <button
                className="notice-btn notice-btn--send"
                onClick={() => startTimer((Math.max(0, Math.floor(Number(timerMin))) || 0) * 60 + (Math.max(0, Math.floor(Number(timerSec))) || 0))}
              >
                시작
              </button>
              <div className="timer-presets">
                {[[10, '10초'], [30, '30초'], [60, '1분'], [180, '3분'], [300, '5분']].map(([sec, label]) => (
                  <button key={sec} className="timer-preset" onClick={() => startTimer(sec as number)}>{label}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="timer-running">
              <span className={`timer-display ${timer.seconds <= 10 ? 'timer-display--urgent' : ''}`}>
                {timer.display}
              </span>
              <button className="soft-btn" onClick={timer.running ? timer.pause : timer.resume}>
                {timer.running ? '⏸ 일시정지' : '▶ 계속'}
              </button>
              <button className="soft-btn" onClick={timer.reset}>↺ 초기화</button>
            </div>
          )}
        </div>
      )}

      <h1 className="print-title">{board?.title || '생각보드'}</h1>
      <section className="cork-board">
        {items.length === 0 ? (
          <div className="empty-board">아직 붙은 그림이 없습니다. QR로 접속해서 첫 번째 생각을 붙여보세요.</div>
        ) : (
          sortedItems.map((item) => (
            <article key={item.id} className={`photo-note${shakingId === item.id ? ' card-shaking' : ''}${freshIds.has(item.id) ? ' photo-note--new' : ''}`} style={{ transform: `rotate(${item.rotate}deg)`, '--r': `${item.rotate}deg` } as React.CSSProperties} onClick={() => setSelected(item)}>
              <div className="tape" />
              <img src={item.image_url} alt={item.caption || '보드 이미지'} loading="lazy" crossOrigin="anonymous" />
              <div className="note-footer">
                <strong>{item.uploader_name || '참여자'}</strong>
                <span>{typeLabel(item.type)}</span>
              </div>
              {totalReactions(item.reactions) > 0 && (
                <div className="react-badges" key={totalReactions(item.reactions)}>
                  {REACTIONS.filter((x) => (item.reactions?.[x.kind] || 0) > 0).map((x) => (
                    <span key={x.kind} title={x.label}>{x.emoji}{item.reactions![x.kind]}</span>
                  ))}
                </div>
              )}
              {emojiBursts.filter((b) => b.itemId === item.id).map((b) => (
                <span key={b.id} className="emoji-burst" style={{ '--dx': `${b.dx}px` } as React.CSSProperties} aria-hidden="true">{b.emoji}</span>
              ))}
              {!readOnly && (
                <button
                  className="poke-btn"
                  aria-label={`${item.uploader_name || '참여자'}님에게 칭찬 보내기`}
                  title="이 참여자에게 칭찬 보내기"
                  onClick={(e) => { e.stopPropagation(); pokeItem(item); }}
                >👏</button>
              )}
              {isOwner && !readOnly && (
                <button className="delete-btn" aria-label="항목 삭제" onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}>×</button>
              )}
            </article>
          ))
        )}
      </section>

      {/* 손든 이름들 — 사방에서 날아와 떠다닌다 */}
      {hands.length > 0 && !handPickOpen && !showRoulette && !pinball && (
        <div
          className="hand-field"
          style={{ '--hand-size': `clamp(1.05rem, ${Math.max(1.9, 8 / Math.sqrt(hands.length)).toFixed(2)}vw, 7rem)` } as React.CSSProperties}
        >
          {hands.map((h) => (
            <div
              key={h.id}
              className="hand-float"
              style={{ left: `${h.x}%`, top: `${h.y}%`, '--fx': `${h.fx}vw`, '--fy': `${h.fy}vh` } as React.CSSProperties}
            >
              <div
                className="hand-float-inner"
                style={{ '--dx': `${h.dx}vw`, '--dy': `${h.dy}vh`, '--rot': `${h.rot}deg`, animationDuration: `${h.dur}s` } as React.CSSProperties}
              >
                <span key={h.count} className="hand-pulse" style={{ fontSize: `${handScale(h.count).toFixed(2)}em` }}>
                  <span className="hand-name-emoji">✋</span>
                  <span className="hand-name-text">{h.name}</span>
                  {h.count > 1 && <b className="hand-count">×{h.count}</b>}
                </span>
              </div>
            </div>
          ))}
          {!readOnly && <div className="hand-bar">
            <strong aria-live="polite">✋ 손든 사람 {hands.length}명</strong>
            <button className="hand-bar-btn hand-bar-btn--go" onClick={() => { setHandPickOpen(true); handRoulette.spin(); }}>🎯 한 명 뽑기</button>
            <button className="hand-bar-btn" onClick={() => setPinball({ names: handNames, title: '✋ 손든 사람 핀볼 추첨', fromHands: true })}>🎱 핀볼로 뽑기</button>
            <button className="hand-bar-btn" onClick={() => setHands([])}>지우기</button>
          </div>}
        </div>
      )}

      {/* 마지막 10초 카운트다운 */}
      {timer.seconds > 0 && timer.seconds <= 10 && (
        <div className={`countdown-overlay${timer.running ? '' : ' countdown-overlay--paused'}`} aria-hidden="true">
          <div className="countdown-number" key={timer.seconds}>{timer.seconds}</div>
        </div>
      )}
      {ddaeng > 0 && (
        <div className="ddaeng-overlay" key={ddaeng} role="status">
          <span>땡!</span>
        </div>
      )}

      {selected && <ImageModal item={selected} onClose={() => setSelected(null)} action={readOnly ? undefined : { label: `👏 ${selected.uploader_name || '참여자'}님에게 칭찬 보내기`, onClick: () => pokeItem(selected) }} />}
      {showRoulette && (
        <RouletteModal
          names={uniqueNames}
          roulette={roulette}
          onClose={() => { roulette.reset(); setShowRoulette(false); }}
        />
      )}
      {pinball && (
        <PinballModal
          names={pinball.names}
          title={pinball.title}
          onPostRanking={(order) => postRanking(order, pinball.title)}
          onClose={() => { if (pinball.fromHands) setHands([]); setPinball(null); }}
        />
      )}
      {handPickOpen && (
        <RouletteModal
          title="✋ 손든 사람 중 발표자 뽑기"
          names={handNames}
          roulette={handRoulette}
          onClose={() => { handRoulette.reset(); setHandPickOpen(false); setHands([]); }}
        />
      )}
      <Toast toast={toast} />
    </main>
  );
}

// ── JoinScreen (참여자 — 로그인 불필요) ──────────────────
function JoinScreen({ boardId }: { boardId: string }) {
  const [name, setName] = useState(localStorage.getItem('saenggak-name') || '');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [items, setItems] = useState<BoardItem[]>([]);
  const broadcastRef = useRef<any>(null);
  const [handCount, setHandCount] = useState(0);
  const handQueue = useRef(0);
  const handTimer = useRef<number>(0);
  const handNamesRef = useRef<string[]>([]);
  // 이 기기에서 직접 제출한 카드만 '내 것'으로 다룬다 (남의 이름을 골라 조작할 수 없게)
  const [own, setOwn] = useState<{ ids: string[]; legacyName: string; since: string }>(() => {
    try {
      const saved = localStorage.getItem(`own-${boardId}`);
      if (saved) return JSON.parse(saved);
    } catch { /* 새로 만든다 */ }
    // 이 기능 이전에 올린 카드는 그때 저장된 이름으로만 인정한다
    const fresh = { ids: [], legacyName: localStorage.getItem('saenggak-name') || '', since: new Date().toISOString() };
    localStorage.setItem(`own-${boardId}`, JSON.stringify(fresh));
    return fresh;
  });
  const [handOff, setHandOff] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`hand-off-${boardId}`) || '[]'); }
    catch { return []; }
  });
  const isMine = (item: BoardItem) =>
    own.ids.includes(item.id)
    || (!!own.legacyName && item.uploader_name === own.legacyName && item.created_at < own.since);
  // 내가 누른 반응: 카드 id → 반응 종류들 (예전 좋아요 기록은 '좋아요'로 옮긴다)
  const [myReacts, setMyReacts] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem(`reacts-${boardId}`);
      if (saved) return JSON.parse(saved);
      const liked: string[] = JSON.parse(localStorage.getItem(`liked-${boardId}`) || '[]');
      return Object.fromEntries(liked.map((id) => [id, ['like']]));
    } catch { return {}; }
  });
  const pendingReacts = useRef(new Map<string, number>());
  const [reloadPending, setReloadPending] = useState(false);
  const [zoomItem, setZoomItem] = useState<BoardItem | null>(null);

  // 새 버전이 배포되면 스스로 알아채고 다시 불러온다 (1분마다, 화면을 다시 켤 때)
  useEffect(() => {
    const current = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src');
    if (!current) return;
    let alive = true;
    async function check() {
      try {
        const html = await fetch('/index.html', { cache: 'no-store' }).then((r) => r.text());
        const latest = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
        if (alive && latest && latest !== current) setReloadPending(true);
      } catch { /* 다음 주기에 다시 확인한다 */ }
    }
    const t = window.setInterval(() => { if (!document.hidden) check(); }, 60000);
    const onVisible = () => { if (!document.hidden) check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  // 작성 중인 내용을 날리지 않도록, 그리기·글쓰기·제출이 끝난 뒤에 새로고침한다
  useEffect(() => {
    if (!reloadPending || busy || drawOpen || textOpen) return;
    if (name.trim()) localStorage.setItem('saenggak-name', name.trim());
    window.location.reload();
  }, [reloadPending, busy, drawOpen, textOpen]);
  const [poke, setPoke] = useState<{ id: number; emoji: string; title: string; text: string } | null>(null);
  const mineRef = useRef(new Set<string>());
  mineRef.current = new Set([...items.filter(isMine).map((it) => it.uploader_name || ''), name.trim()].filter(Boolean));
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const { toast, show } = useToast();

  // 보드 정보 + 아이템 로드
  useEffect(() => {
    async function load() {
      if (!supabase) {
        const b = JSON.parse(localStorage.getItem(`demo-board-${boardId}`) || 'null') || { id: boardId, title: '데모', locked: false };
        setBoard(b);
        setItems(JSON.parse(localStorage.getItem(`demo-items-${boardId}`) || '[]'));
        return;
      }
      const [{ data: b }, { data: its }] = await Promise.all([
        supabase.from('boards').select('*').eq('id', boardId).single(),
        supabase.from('board_items').select('*').eq('board_id', boardId).order('created_at', { ascending: true }),
      ]);
      if (b) setBoard(b as Board);
      if (its) setItems(its as BoardItem[]);
    }
    load();
  }, [boardId]);

  // Realtime 구독 + 2초 폴링 (Realtime 지연·단절 보완)
  useEffect(() => {
    if (!supabase) {
      const t = window.setInterval(() => {
        const b = JSON.parse(localStorage.getItem(`demo-board-${boardId}`) || 'null');
        if (b) setBoard(b);
        setItems(JSON.parse(localStorage.getItem(`demo-items-${boardId}`) || '[]'));
      }, 1000);
      return () => window.clearInterval(t);
    }

    let alive = true;
    async function syncAll() {
      const [{ data: latestBoard }, { data: latestItems }] = await Promise.all([
        supabase!.from('boards').select('*').eq('id', boardId).single(),
        supabase!.from('board_items').select('*').eq('board_id', boardId).order('created_at', { ascending: true }),
      ]);
      if (!alive) return;
      if (latestBoard) setBoard(latestBoard as Board);
      if (latestItems) {
        // 저장 중인 반응은 서버 값으로 덮어쓰지 않는다
        setItems((prev) => {
          const local = new Map(prev.map((it) => [it.id, it]));
          return (latestItems as BoardItem[]).map((it) => {
            const mine = pendingReacts.current.has(it.id) ? local.get(it.id) : undefined;
            return mine ? { ...it, reactions: mine.reactions, likes: mine.likes } : it;
          });
        });
      }
    }

    // Broadcast 채널 (카드 흔들기·손들기 송신 + 진행자 변경 즉시 수신)
    const broadcastChannel = supabase
      .channel(`board-${boardId}`)
      .on('broadcast', { event: 'board-updated' }, ({ payload }: any) => {
        if (payload) setBoard((prev) => prev ? { ...prev, ...payload } : prev);
      })
      .on('broadcast', { event: 'item-uploaded' }, () => { syncAll(); })
      .on('broadcast', { event: 'poke' }, ({ payload }: any) => {
        if (!payload?.name || !mineRef.current.has(String(payload.name))) return;
        setPoke({ id: Date.now(), emoji: '👏', title: `${String(payload.name)}님!`, text: '너무 좋아요! 잘했어요!' });
        navigator.vibrate?.([250, 120, 250, 120, 450]);
        sfx.gate();
        sfx.beep(true);
      })
      .on('broadcast', { event: 'force-reload' }, () => setReloadPending(true))
      .on('broadcast', { event: 'cheer-all' }, ({ payload }: any) => {
        setPoke({ id: Date.now(), emoji: '💪', title: String(payload?.text || '자! 힘을 내세요!').slice(0, 40), text: '진행자가 모두에게 보내는 응원' });
        navigator.vibrate?.([250, 120, 250, 120, 450]);
        sfx.gate();
        sfx.beep(true);
      });
    broadcastRef.current = broadcastChannel;
    broadcastChannel.subscribe();

    const channel = supabase
      .channel(`join-${boardId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'board_items', filter: `board_id=eq.${boardId}` }, (payload) => {
        setItems((prev) => prev.some((it) => it.id === payload.new.id) ? prev : [...prev, payload.new as BoardItem]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'board_items', filter: `board_id=eq.${boardId}` }, (payload) => {
        const next = payload.new as BoardItem;
        if (pendingReacts.current.has(next.id)) return;
        setItems((prev) => prev.map((it) => it.id === next.id ? { ...it, likes: next.likes, reactions: next.reactions } : it));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'board_items', filter: `board_id=eq.${boardId}` }, (payload) => {
        setItems((prev) => prev.filter((it) => it.id !== payload.old.id));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'boards', filter: `id=eq.${boardId}` }, (payload) => {
        setBoard((prev) => prev ? { ...prev, ...(payload.new as Board) } : prev);
      })
      .subscribe();

    const pollTimer = window.setInterval(() => { if (!document.hidden) syncAll(); }, 2000);
    const onVisible = () => { if (!document.hidden) syncAll(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      window.clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisible);
      broadcastRef.current = null;
      supabase?.removeChannel(channel);
      supabase?.removeChannel(broadcastChannel);
    };
  }, [boardId]);

  const ownNames = [...new Set(items.filter(isMine).map((it) => it.uploader_name).filter(Boolean) as string[])];
  const checkedNames = ownNames.filter((n) => !handOff.includes(n));
  const handNames = checkedNames.length > 0 ? checkedNames : name.trim() ? [name.trim()] : [];
  handNamesRef.current = handNames;

  async function shakeMyCard(itemId: string) {
    if (!broadcastRef.current) return;
    await broadcastRef.current.send({ type: 'broadcast', event: 'shake-card', payload: { itemId } });
  }

  // 연타 가능: 버튼은 누를 때마다 바로 반응하고, 전송은 0.7초 단위로 횟수를 묶어 보낸다
  function raiseHand() {
    if (handNames.length === 0) { show('먼저 이름 또는 별명을 선택하거나 입력해 주세요.', 'error'); return; }
    const ch = broadcastRef.current;
    if (!ch) { show('데모 모드에서는 손들기가 전송되지 않습니다.', 'error'); return; }
    setHandCount((c) => c + 1);
    navigator.vibrate?.(12);
    handQueue.current++;
    if (handTimer.current) return;
    const flush = () => {
      const n = handQueue.current;
      handQueue.current = 0;
      if (n === 0) { handTimer.current = 0; return; }
      const names = handNamesRef.current;
      void ch.send({ type: 'broadcast', event: 'hand-raised', payload: { names, name: names[0], n } })
        .then((res: string) => { if (res !== 'ok') show('손들기 전송에 실패했습니다. 다시 눌러 주세요.', 'error'); });
      handTimer.current = window.setTimeout(flush, 700);
    };
    flush();
  }

  function requireName() {
    if (name.trim()) return true;
    show('이름 또는 별명을 먼저 입력해 주세요.', 'error');
    nameRef.current?.focus();
    return false;
  }

  async function saveItem(type: BoardItem['type'], blob: Blob, ext: string) {
    if (!requireName()) return;
    setBusy(true);
    try {
      const submittedName = name.trim();
      localStorage.setItem('saenggak-name', submittedName);
      const imageUrl = await uploadBlob(boardId, blob, ext);
      const item: BoardItem = {
        id: uid(), board_id: boardId, type, image_url: imageUrl,
        uploader_name: submittedName,
        caption: caption.trim() || null, rotate: randomRotate(),
        created_at: new Date().toISOString(),
        likes: 0,
        reactions: {},
      };
      if (!supabase) {
        const list = JSON.parse(localStorage.getItem(`demo-items-${boardId}`) || '[]');
        localStorage.setItem(`demo-items-${boardId}`, JSON.stringify([...list, item]));
      } else {
        const { error } = await supabase.from('board_items').insert(item);
        if (error) throw error;
        // 진행자 화면에 즉시 알림 broadcast
        if (broadcastRef.current) {
          await broadcastRef.current.send({ type: 'broadcast', event: 'item-uploaded', payload: { itemId: item.id } });
        }
      }
      setOwn((prev) => {
        const next = { ...prev, ids: [...prev.ids, item.id] };
        localStorage.setItem(`own-${boardId}`, JSON.stringify(next));
        return next;
      });
      setCaption('');
      show('보드에 붙였습니다. PC 화면을 확인하세요.', 'success');
    } catch (e) {
      show(e instanceof Error ? e.message : '제출에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteMyItem(item: BoardItem) {
    if (!isMine(item)) return;
    if (!confirm('내 카드를 보드에서 삭제할까요?')) return;
    setItems((prev) => prev.filter((it) => it.id !== item.id));
    if (!supabase) {
      const list = JSON.parse(localStorage.getItem(`demo-items-${boardId}`) || '[]');
      localStorage.setItem(`demo-items-${boardId}`, JSON.stringify(list.filter((it: BoardItem) => it.id !== item.id)));
      return;
    }
    const { error } = await supabase.from('board_items').delete().eq('id', item.id);
    if (error) {
      setItems((prev) => [...prev, item]);
      show('삭제에 실패했습니다.', 'error');
    } else {
      show('카드를 삭제했습니다.', 'success');
    }
  }

  async function toggleReaction(item: BoardItem, kind: string) {
    const mine = myReacts[item.id] || [];
    const on = mine.includes(kind);
    const delta = on ? -1 : 1;
    const apply = (it: BoardItem, d: number): BoardItem => {
      const reactions = { ...(it.reactions || {}), [kind]: Math.max(0, (it.reactions?.[kind] || 0) + d) };
      return { ...it, reactions, likes: totalReactions(reactions) };
    };
    const saveMine = (list: string[]) => {
      setMyReacts((prev) => {
        const next = { ...prev, [item.id]: list };
        localStorage.setItem(`reacts-${boardId}`, JSON.stringify(next));
        return next;
      });
    };

    setItems((prev) => prev.map((it) => it.id === item.id ? apply(it, delta) : it));
    saveMine(on ? mine.filter((k) => k !== kind) : [...mine, kind]);

    if (!supabase) {
      const list: BoardItem[] = JSON.parse(localStorage.getItem(`demo-items-${boardId}`) || '[]');
      localStorage.setItem(`demo-items-${boardId}`, JSON.stringify(list.map((it) => it.id === item.id ? apply(it, delta) : it)));
      return;
    }
    const pending = pendingReacts.current;
    pending.set(item.id, (pending.get(item.id) || 0) + 1);
    const { data, error } = await supabase.rpc('react_to_item', { p_item: item.id, p_kind: kind, p_delta: delta });
    const left = (pending.get(item.id) || 1) - 1;
    if (left > 0) pending.set(item.id, left); else pending.delete(item.id);
    if (error) {
      setItems((prev) => prev.map((it) => it.id === item.id ? apply(it, -delta) : it));
      saveMine(mine);
      show('반응 저장에 실패했습니다. 다시 눌러 주세요.', 'error');
    } else if (data && left <= 0) {
      const reactions = data as Record<string, number>;
      setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, reactions, likes: totalReactions(reactions) } : it));
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.[0]) return;
    try { await saveItem('photo', await resizeImage(files[0]), 'jpg'); }
    catch (e) { show(e instanceof Error ? e.message : '이미지 처리에 실패했습니다.', 'error'); }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleTextSave(text: string) {
    await saveItem('text', await textToImageBlob(text, name.trim()), 'png');
  }

  const isLocked = board?.locked;

  return (
    <main className="join-page">
      <section className="join-card">
        <div className="brand">생각보드 참여</div>

        {/* 공지 배너 */}
        {board?.notice && (
          <div className="notice-banner">
            📢 {board.notice}
          </div>
        )}

        {isLocked ? (
          <div className="locked-state">
            <div className="locked-icon">🔒</div>
            <h2>현재 접수가 마감되었습니다</h2>
            <p>진행자가 보드를 닫았습니다. 잠시 후 다시 시도해 보세요.</p>
          </div>
        ) : (
          <>
            <h1>사진이나 낙서를 보드에 붙이세요.</h1>
            {!isSupabaseReady && <div className="warning">데모 모드입니다. 같은 브라우저 안에서만 확인됩니다.</div>}
            <label className="field-label" htmlFor="join-name">이름 또는 별명 <span className="field-required">(필수)</span></label>
            <input id="join-name" ref={nameRef} required aria-required="true" maxLength={20} className="title-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 또는 별명" />
            <label className="field-label" htmlFor="join-caption">짧은 설명</label>
            <input id="join-caption" className="title-input" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="선택 사항" />
            <div className="join-actions">
              <button className="primary-btn" disabled={busy} onClick={() => { if (requireName()) fileRef.current?.click(); }}>사진 올리기</button>
              <button className="secondary-btn" disabled={busy} onClick={() => { if (requireName()) setDrawOpen(true); }}>낙서 올리기</button>
              <button className="secondary-btn" disabled={busy} onClick={() => { if (requireName()) setTextOpen(true); }}>텍스트 올리기</button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => handleFiles(e.target.files)} />
            <p className="hint">스마트폰에서는 손가락으로 바로 그릴 수 있습니다.</p>
          </>
        )}
      </section>

      {/* 내 이름 선택·손들기 + 보드 현황 */}
      <section className="join-gallery-section">
        <div className="my-names-panel">
          <div className="my-names-title">내 이름/별명 <span className="my-names-hint">내가 올린 이름만 나옵니다. 체크한 이름으로 손을 듭니다</span></div>
          {ownNames.length > 0 ? (
            <div className="my-names-list">
              {ownNames.map((n) => {
                const on = !handOff.includes(n);
                return (
                  <label key={n} className={`my-names-chip ${on ? 'my-names-chip--active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => {
                        const updated = e.target.checked ? handOff.filter((x) => x !== n) : [...handOff, n];
                        setHandOff(updated);
                        localStorage.setItem(`hand-off-${boardId}`, JSON.stringify(updated));
                      }}
                      style={{ display: 'none' }}
                    />
                    {on ? '✓ ' : ''}{n}
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="my-names-empty">아직 이 기기에서 올린 카드가 없습니다. 위에 입력한 이름으로 손을 듭니다.</p>
          )}
          <button className="hand-raise-btn hand-raise-btn--wide" onClick={raiseHand}>
            <span key={handCount} className={handCount > 0 ? 'hand-tap' : ''}>✋</span> {handNames.length > 0 ? `${handNames.join(', ')} 손 들기` : '손 들기'}
            {handCount > 0 && <b className="hand-tap-count">×{handCount}</b>}
          </button>
        </div>
        {items.length > 0 && (<>
          <div className="join-gallery-title">보드 현황 <span>{items.length}개</span></div>
          <div className="join-gallery">
            {[...items].reverse().map((item) => {
              const isMyCard = isMine(item);
              return (
                <div
                  key={item.id}
                  className={`join-thumb${isMyCard ? ' join-thumb--mine' : ''}`}
                  onClick={() => setZoomItem(item)}
                  style={{ cursor: 'zoom-in' }}
                  title="누르면 크게 볼 수 있습니다"
                >
                  {isMyCard && <div className="my-card-badge">내 것 👆</div>}
                  {isMyCard && (
                    <button
                      className="my-card-delete-btn"
                      aria-label="내 카드 삭제"
                      onClick={(e) => { e.stopPropagation(); deleteMyItem(item); }}
                    >×</button>
                  )}
                  <img src={item.image_url} alt={item.uploader_name || ''} loading="lazy" />
                  <div className="join-thumb-footer">
                    <span className="join-thumb-name">{item.uploader_name || '참여자'}</span>
                  </div>
                  <div className="react-bar" role="group" aria-label="반응 남기기">
                    {REACTIONS.map((x) => {
                      const on = (myReacts[item.id] || []).includes(x.kind);
                      const n = item.reactions?.[x.kind] || 0;
                      return (
                        <button
                          key={x.kind}
                          className={`react-btn${on ? ' is-on' : ''}`}
                          aria-label={x.label}
                          aria-pressed={on}
                          title={x.label}
                          onClick={(e) => { e.stopPropagation(); toggleReaction(item, x.kind); }}
                        >
                          <span>{x.emoji}</span>
                          {n > 0 && <b>{n}</b>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>)}
      </section>

      {poke && (
        <button key={poke.id} className="poke-overlay" onClick={() => setPoke(null)}>
          <span className="poke-bell">{poke.emoji}</span>
          <strong>{poke.title}</strong>
          <span>{poke.text}</span>
          <small>화면을 누르면 닫힙니다</small>
        </button>
      )}
      {zoomItem && (
        <ImageModal
          item={items.find((it) => it.id === zoomItem.id) || zoomItem}
          onClose={() => setZoomItem(null)}
          action={isMine(zoomItem) ? {
            label: '📢 진행자 화면에서 내 카드 흔들기',
            onClick: () => { shakeMyCard(zoomItem.id); show('📢 진행자 화면에서 흔들립니다!', 'success'); },
          } : undefined}
        />
      )}
      <Toast toast={toast} />
      {drawOpen && <DrawingModal onClose={() => setDrawOpen(false)} onSave={(dataUrl) => saveItem('drawing', dataUrlToBlob(dataUrl), 'png')} />}
      {textOpen && <TextModal onClose={() => setTextOpen(false)} onSave={handleTextSave} busy={busy} />}
    </main>
  );
}

// ── RouletteModal (전체 화면 추첨 무대) ───────────────────
function RouletteModal({ names, roulette, onClose, title = '🎲 발표자 추첨' }: {
  title?: string;
  names: string[];
  roulette: ReturnType<typeof useRoulette>;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const { phase, current, step, progress } = roulette;

  return (
    <div className={`raffle-stage raffle-stage--${phase}`} role="dialog" aria-modal="true" aria-label="발표자 추첨">
      <div className="raffle-spot" style={{ '--p': progress } as React.CSSProperties} />
      <div className="raffle-title">{title}</div>

      {phase === 'done' && <div className="raffle-bravo">부라보!</div>}

      <div className="raffle-card-wrap">
        {phase === 'idle' ? (
          <div className="raffle-card raffle-card--idle">
            <span className="raffle-idle-count">{names.length}명</span>
            <span className="raffle-idle-text">중 한 명을 뽑습니다</span>
          </div>
        ) : (
          <div
            key={phase === 'done' ? 'winner' : step}
            className={`raffle-card ${phase === 'done' ? 'raffle-card--winner' : 'raffle-card--tick'}`}
            style={{ '--p': progress } as React.CSSProperties}
          >
            {current}
          </div>
        )}
      </div>

      <div className="raffle-sub" aria-live="polite">
        {phase === 'done' ? '🎉 발표자로 선정되었습니다!' : phase === 'spinning' ? '두구두구두구…' : ' '}
      </div>

      <div className="raffle-actions">
        <button className="raffle-btn" onClick={onClose}>닫기</button>
        <button className="raffle-btn raffle-btn--go" onClick={roulette.spin} disabled={phase === 'spinning'}>
          {phase === 'spinning' ? '추첨 중…' : phase === 'done' ? '다시 추첨' : '추첨 시작!'}
        </button>
      </div>

      {phase === 'done' && <Confetti />}
    </div>
  );
}

// ── TextModal ─────────────────────────────────────────────
function TextModal({ onClose, onSave, busy }: { onClose: () => void; onSave: (text: string) => Promise<void>; busy: boolean }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="draw-backdrop">
      <section className="draw-panel">
        <h2>텍스트 작성</h2>
        <textarea className="text-input-area" value={text} onChange={(e) => setText(e.target.value)} placeholder="생각을 자유롭게 적어보세요..." rows={8} autoFocus />
        <div className="draw-actions">
          <button className="secondary-btn" onClick={onClose}>취소</button>
          <button className="primary-btn" disabled={busy || !text.trim()} onClick={async () => { if (!text.trim()) return; await onSave(text.trim()); onClose(); }}>
            {busy ? '올리는 중...' : '보드에 붙이기'}
          </button>
        </div>
      </section>
    </div>
  );
}

// ── DrawingModal ──────────────────────────────────────────
function DrawingModal({ onClose, onSave }: { onClose: () => void; onSave: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState('#17120d');
  const [size, setSize] = useState(7);
  const [eraser, setEraser] = useState(false);
  const drawing = useRef(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#fffdf6';
      ctx.fillRect(0, 0, rect.width, rect.height);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const p = point(e); drawing.current = true;
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const p = point(e);
    ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = eraser ? '#fffdf6' : color;
    ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  function up() { drawing.current = false; canvasRef.current?.getContext('2d')?.closePath(); }
  function clear() {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#fffdf6'; ctx.fillRect(0, 0, rect.width, rect.height);
  }

  return (
    <div className="draw-backdrop">
      <section className="draw-panel">
        <h2>낙서장</h2>
        <div className="draw-tools">
          <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setEraser(false); }} />
          <label>굵기 <input type="range" min="2" max="28" value={size} onChange={(e) => setSize(Number(e.target.value))} /></label>
          <button onClick={() => setEraser(!eraser)} className={eraser ? 'active-tool' : ''}>{eraser ? '지우개 사용 중' : '지우개'}</button>
          <button onClick={clear}>전체 지우기</button>
        </div>
        <canvas ref={canvasRef} className="draw-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
        <div className="draw-actions">
          <button className="secondary-btn" onClick={onClose}>취소</button>
          <button className="primary-btn" onClick={() => { const c = canvasRef.current; if (c) { onSave(c.toDataURL('image/png')); onClose(); } }}>보드에 붙이기</button>
        </div>
      </section>
    </div>
  );
}

// ── ImageModal ────────────────────────────────────────────
function ImageModal({ item, onClose, action }: { item: BoardItem; onClose: () => void; action?: { label: string; onClick: () => void } }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="image-modal" onClick={onClose}>
      <div className="image-stage">
        <img src={item.image_url} alt={item.caption || '확대 이미지'} />
        <p>
          <strong>{item.uploader_name || '참여자'}</strong>
          {item.caption ? ` · ${item.caption}` : ''}
          {REACTIONS.filter((x) => (item.reactions?.[x.kind] || 0) > 0).map((x) => (
            <span key={x.kind} style={{ marginLeft: 12 }}>{x.emoji} {item.reactions![x.kind]}</span>
          ))}
        </p>
        {action && (
          <button className="raffle-btn image-poke-btn" onClick={(e) => { e.stopPropagation(); action.onClick(); }}>
            {action.label}
          </button>
        )}
        <span>화면을 누르면 닫힙니다.</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
