import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeSVG } from 'qrcode.react';
import { supabase, isSupabaseReady } from './lib/supabase';
import type { User } from '@supabase/supabase-js';
import type { Board, BoardItem } from './types';
import './styles.css';

const BUCKET = 'board-images';
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

async function uploadBlob(boardId: string, blob: Blob, ext: string) {
  if (!supabase) return URL.createObjectURL(blob);
  const path = `${boardId}/${Date.now()}-${uid()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { cacheControl: '3600', upsert: false, contentType: blob.type });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function printBoard() { window.print(); }

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

// ── 발표자 추첨 훅 ────────────────────────────────────────
function useRoulette(names: string[]) {
  const [spinning, setSpinning] = useState(false);
  const [current, setCurrent] = useState('');
  const [result, setResult] = useState('');
  const intervalRef = useRef<number>(0);

  function spin() {
    if (names.length === 0) return;
    setResult('');
    setSpinning(true);
    let count = 0;
    const total = 24 + Math.floor(Math.random() * 12);
    clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(() => {
      setCurrent(names[Math.floor(Math.random() * names.length)]);
      count++;
      if (count >= total) {
        clearInterval(intervalRef.current);
        const winner = names[Math.floor(Math.random() * names.length)];
        setCurrent(winner);
        setResult(winner);
        setSpinning(false);
      }
    }, count < total * 0.5 ? 60 : count < total * 0.8 ? 120 : 200);
  }

  useEffect(() => () => clearInterval(intervalRef.current), []);
  return { spinning, current, result, spin };
}

// ── 타이머 훅 ─────────────────────────────────────────────
function useTimer() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<number>(0);

  useEffect(() => {
    if (running && seconds > 0) {
      intervalRef.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s <= 1) { setRunning(false); return 0; }
          return s - 1;
        });
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, seconds]);

  function start(mins: number) {
    setSeconds(mins * 60);
    setRunning(true);
  }
  function pause() { setRunning(false); }
  function resume() { if (seconds > 0) setRunning(true); }
  function reset() { setRunning(false); setSeconds(0); }

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
function BoardScreen({ boardId, user }: { boardId: string; user: User | null }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [items, setItems] = useState<BoardItem[]>([]);
  const [selected, setSelected] = useState<BoardItem | null>(null);
  const [qrExpanded, setQrExpanded] = useState(false);
  const [sortByLikes, setSortByLikes] = useState(false);
  const [presenceCount, setPresenceCount] = useState(0);
  const [raisedHands, setRaisedHands] = useState<{ id: string; name: string }[]>([]);
  const [shakingId, setShakingId] = useState<string | null>(null);
  const [showRoulette, setShowRoulette] = useState(false);
  const [noticeInput, setNoticeInput] = useState('');
  const [noticeEditing, setNoticeEditing] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState('5');
  const [showTimer, setShowTimer] = useState(false);
  const timer = useTimer();
  const uniqueNames = [...new Set(items.map((it) => it.uploader_name).filter(Boolean) as string[])];
  const roulette = useRoulette(uniqueNames);
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
        return;
      }
      const [{ data: b }, { data: loadedItems, error }] = await Promise.all([
        supabase.from('boards').select('*').eq('id', boardId).single(),
        supabase.from('board_items').select('*').eq('board_id', boardId).order('created_at', { ascending: true }),
      ]);
      if (b) { setBoard(b as Board); setNoticeInput((b as any).notice || ''); }
      if (!error && loadedItems) setItems(loadedItems as BoardItem[]);
    }
    load();
  }, [boardId]);

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

    // Presence: 참여자 수 추적
    const presenceChannel = supabase.channel(`presence-${boardId}`, {
      config: { presence: { key: 'facilitator' }, broadcast: { self: true } },
    });
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const participants = Object.entries(state).filter(([k]) => k !== 'facilitator');
        setPresenceCount(participants.length);
        const hands: { id: string; name: string }[] = [];
        participants.forEach(([key, presences]) => {
          const p = (presences as any[])[0];
          if (p?.hand_raised && p?.name) hands.push({ id: key, name: p.name });
        });
        setRaisedHands(hands);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ role: 'facilitator', joined_at: new Date().toISOString() });
        }
      });

    const channel = supabase
      .channel(`board-${boardId}`, { config: { broadcast: { self: true } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'board_items', filter: `board_id=eq.${boardId}` }, (payload) => {
        setItems((prev) => prev.some((it) => it.id === payload.new.id) ? prev : [...prev, payload.new as BoardItem]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'board_items', filter: `board_id=eq.${boardId}` }, (payload) => {
        setItems((prev) => prev.map((it) => it.id === payload.new.id ? { ...it, likes: (payload.new as BoardItem).likes } : it));
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
      .subscribe();

    // 3초 폴링: Realtime 지연·단절 보완
    const pollTimer = window.setInterval(syncAll, 3000);

    return () => {
      window.clearInterval(pollTimer);
      supabase?.removeChannel(channel);
      supabase?.removeChannel(presenceChannel);
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
    show(newLocked ? '보드가 잠겼습니다. 새 제출이 차단됩니다.' : '보드가 열렸습니다.', 'success');
  }

  async function saveNotice() {
    const notice = noticeInput.trim() || null;
    if (supabase) {
      await supabase.from('boards').update({ notice }).eq('id', boardId);
    }
    setBoard((b) => b ? { ...b, notice } : b);
    setNoticeEditing(false);
    show(notice ? '공지를 전송했습니다.' : '공지를 삭제했습니다.', 'success');
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
        <div>
          <div className="brand small">생각보드</div>
          <h1>{board?.title || '생각보드'}</h1>
          <p>참여자는 스마트폰으로 그리고 올립니다. 진행자는 이 화면을 빔프로젝터에 띄우세요.</p>
          {presenceCount > 0 && (
            <div className="presence-badge">👥 현재 {presenceCount}명 접속 중</div>
          )}
        </div>
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

      <section className="board-toolbar">
        <a className="soft-btn" href={joinUrl} target="_blank" rel="noopener noreferrer">참여자 화면 열기</a>
        <button className="soft-btn" onClick={() => document.documentElement.requestFullscreen?.()}>전체화면</button>
        <button className="soft-btn" onClick={() => navigator.clipboard.writeText(joinUrl).then(() => show('링크를 복사했습니다.', 'success'))}>참여 링크 복사</button>
        <div className="toolbar-divider" />

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

        <div className="toolbar-divider" />

        {/* 공지 버튼 */}
        <button className="soft-btn" onClick={() => setNoticeEditing(!noticeEditing)}>
          {noticeEditing ? '✕ 닫기' : '📢 공지'}
        </button>

        <button className="soft-btn export-btn" disabled={items.length === 0} onClick={printBoard}>🖨️ 인쇄 / PDF</button>
        <a className="soft-btn" href="/">← 목록</a>
      </section>

      {/* 공지 입력 패널 */}
      {noticeEditing && (
        <div className="notice-panel">
          <input
            className="notice-input"
            value={noticeInput}
            onChange={(e) => setNoticeInput(e.target.value)}
            placeholder="참여자 화면에 표시할 공지를 입력하세요..."
            onKeyDown={(e) => e.key === 'Enter' && saveNotice()}
            autoFocus
          />
          <button className="primary-btn" style={{ minWidth: 80 }} onClick={saveNotice}>전송</button>
          {board?.notice && (
            <button className="soft-btn" onClick={() => { setNoticeInput(''); saveNotice(); }}>공지 삭제</button>
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
                value={timerMinutes}
                onChange={(e) => setTimerMinutes(e.target.value)}
                min="1"
                max="60"
              />
              <span>분</span>
              <button className="primary-btn" onClick={() => timer.start(Number(timerMinutes) || 5)}>시작</button>
            </div>
          ) : (
            <div className="timer-running">
              <span className={`timer-display ${timer.seconds <= 30 ? 'timer-display--urgent' : ''}`}>
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

      <section className="cork-board">
        {items.length === 0 ? (
          <div className="empty-board">아직 붙은 그림이 없습니다. QR로 접속해서 첫 번째 생각을 붙여보세요.</div>
        ) : (
          sortedItems.map((item) => (
            <article key={item.id} className={`photo-note${shakingId === item.id ? ' card-shaking' : ''}`} style={{ transform: `rotate(${item.rotate}deg)`, '--r': `${item.rotate}deg` } as React.CSSProperties} onClick={() => setSelected(item)}>
              <div className="tape" />
              <img src={item.image_url} alt={item.caption || '보드 이미지'} loading="lazy" crossOrigin="anonymous" />
              <div className="note-footer">
                <strong>{item.uploader_name || '참여자'}</strong>
                <span>{typeLabel(item.type)}</span>
              </div>
              {/* 좋아요 카운트 */}
              {(item.likes || 0) > 0 && (
                <div className="like-badge">❤️ {item.likes}</div>
              )}
              {isOwner && (
                <button className="delete-btn" aria-label="항목 삭제" onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}>×</button>
              )}
            </article>
          ))
        )}
      </section>

      {/* 손든 사람 목록 */}
      {raisedHands.length > 0 && (
        <section className="raised-hands-bar">
          <span className="raised-hands-label">✋ 손든 참여자</span>
          {raisedHands.map((h) => (
            <span key={h.id} className="raised-hand-chip">
              <span className="waving-hand">✋</span> {h.name}
            </span>
          ))}
        </section>
      )}

      {selected && <ImageModal item={selected} onClose={() => setSelected(null)} />}
      {showRoulette && (
        <RouletteModal
          names={uniqueNames}
          roulette={roulette}
          onClose={() => setShowRoulette(false)}
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
  const [handRaised, setHandRaised] = useState(false);
  const broadcastRef = useRef<any>(null);
  const [likedItems, setLikedItems] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`liked-${boardId}`) || '[]')); }
    catch { return new Set(); }
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast, show } = useToast();
  const participantId = useRef(uid()); // 이 세션의 참여자 ID
  const presenceRef = useRef<any>(null);

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

  // Realtime 구독
  useEffect(() => {
    if (!supabase) return;

    // Broadcast 채널 (카드 흔들기 신호용)
    const broadcastChannel = supabase.channel(`board-${boardId}`);
    broadcastRef.current = broadcastChannel;
    broadcastChannel.subscribe();

    // Presence: 이 참여자를 등록
    const presenceChannel = supabase.channel(`presence-${boardId}`, { config: { presence: { key: participantId.current } } });
    presenceRef.current = presenceChannel;
    presenceChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        const storedName = localStorage.getItem('saenggak-name') || '';
        await presenceChannel.track({ joined_at: new Date().toISOString(), name: storedName, hand_raised: false });
      }
    });

    const channel = supabase
      .channel(`join-${boardId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'board_items', filter: `board_id=eq.${boardId}` }, (payload) => {
        setItems((prev) => prev.some((it) => it.id === payload.new.id) ? prev : [...prev, payload.new as BoardItem]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'board_items', filter: `board_id=eq.${boardId}` }, (payload) => {
        setItems((prev) => prev.map((it) => it.id === payload.new.id ? { ...it, likes: (payload.new as BoardItem).likes } : it));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'board_items', filter: `board_id=eq.${boardId}` }, (payload) => {
        setItems((prev) => prev.filter((it) => it.id !== payload.old.id));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'boards', filter: `id=eq.${boardId}` }, (payload) => {
        setBoard((prev) => prev ? { ...prev, ...(payload.new as Board) } : prev);
      })
      .subscribe();

    return () => {
      supabase?.removeChannel(channel);
      supabase?.removeChannel(presenceChannel);
      supabase?.removeChannel(broadcastChannel);
    };
  }, [boardId]);

  async function shakeMyCard(itemId: string) {
    if (!broadcastRef.current) return;
    await broadcastRef.current.send({ type: 'broadcast', event: 'shake-card', payload: { itemId } });
  }

  async function toggleHandRaise() {
    const newState = !handRaised;
    setHandRaised(newState);
    if (presenceRef.current) {
      const currentName = name.trim() || localStorage.getItem('saenggak-name') || '이름 없는 참여자';
      await presenceRef.current.track({ name: currentName, hand_raised: newState, joined_at: new Date().toISOString() });
    }
    show(newState ? '손을 들었습니다! 진행자가 확인할 수 있습니다.' : '손을 내렸습니다.', 'success');
  }

  async function saveItem(type: BoardItem['type'], blob: Blob, ext: string) {
    setBusy(true);
    try {
      localStorage.setItem('saenggak-name', name);
      const imageUrl = await uploadBlob(boardId, blob, ext);
      const item: BoardItem = {
        id: uid(), board_id: boardId, type, image_url: imageUrl,
        uploader_name: name.trim() || '이름 없는 참여자',
        caption: caption.trim() || null, rotate: randomRotate(),
        created_at: new Date().toISOString(),
        likes: 0,
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
      setCaption('');
      show('보드에 붙였습니다. PC 화면을 확인하세요.', 'success');
    } catch (e) {
      show(e instanceof Error ? e.message : '제출에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike(item: BoardItem) {
    const already = likedItems.has(item.id);
    const newCount = already ? Math.max(0, (item.likes || 0) - 1) : (item.likes || 0) + 1;

    // Optimistic UI
    setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, likes: newCount } : it));
    const newLiked = new Set(likedItems);
    if (already) newLiked.delete(item.id); else newLiked.add(item.id);
    setLikedItems(newLiked);
    localStorage.setItem(`liked-${boardId}`, JSON.stringify([...newLiked]));

    if (supabase) {
      await supabase.from('board_items').update({ likes: newCount }).eq('id', item.id);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.[0]) return;
    try { await saveItem('photo', await resizeImage(files[0]), 'jpg'); }
    catch (e) { show(e instanceof Error ? e.message : '이미지 처리에 실패했습니다.', 'error'); }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleTextSave(text: string) {
    await saveItem('text', await textToImageBlob(text, name.trim() || '이름 없는 참여자'), 'png');
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
            <label className="field-label" htmlFor="join-name">이름</label>
            <input id="join-name" className="title-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 또는 별명" />
            <label className="field-label" htmlFor="join-caption">짧은 설명</label>
            <input id="join-caption" className="title-input" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="선택 사항" />
            <div className="join-actions">
              <button className="primary-btn" disabled={busy} onClick={() => fileRef.current?.click()}>사진 올리기</button>
              <button className="secondary-btn" disabled={busy} onClick={() => setDrawOpen(true)}>낙서 올리기</button>
              <button className="secondary-btn" disabled={busy} onClick={() => setTextOpen(true)}>텍스트 올리기</button>
            </div>
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button
                className={`hand-raise-btn ${handRaised ? 'hand-raise-btn--active' : ''}`}
                onClick={toggleHandRaise}
              >
                <span className={handRaised ? 'waving-hand' : ''}>✋</span>
                {handRaised ? ' 손 내리기' : ' 손 들기'}
              </button>
              {handRaised && <p className="hint" style={{ color: '#c89f62' }}>진행자에게 표시됩니다!</p>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => handleFiles(e.target.files)} />
            <p className="hint">스마트폰에서는 손가락으로 바로 그릴 수 있습니다.</p>
          </>
        )}
      </section>

      {/* 보드 현황 — 올려진 아이템 + 좋아요 */}
      {items.length > 0 && (
        <section className="join-gallery-section">
          <div className="join-gallery-title">보드 현황 <span>{items.length}개</span></div>
          <div className="join-gallery">
            {[...items].reverse().map((item) => {
              const isMyCard = item.uploader_name === (name.trim() || localStorage.getItem('saenggak-name'));
              return (
                <div
                  key={item.id}
                  className={`join-thumb${isMyCard ? ' join-thumb--mine' : ''}`}
                  onClick={isMyCard ? () => { shakeMyCard(item.id); show('📢 진행자 화면에서 흔들립니다!', 'success'); } : undefined}
                  style={isMyCard ? { cursor: 'pointer' } : undefined}
                  title={isMyCard ? '클릭하면 진행자 화면에서 흔들립니다!' : undefined}
                >
                  {isMyCard && <div className="my-card-badge">내 것 👆</div>}
                  <img src={item.image_url} alt={item.uploader_name || ''} loading="lazy" />
                  <div className="join-thumb-footer">
                    <span className="join-thumb-name">{item.uploader_name || '참여자'}</span>
                    <button
                      className={`like-btn ${likedItems.has(item.id) ? 'like-btn--active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); toggleLike(item); }}
                      aria-label="좋아요"
                    >
                      {likedItems.has(item.id) ? '❤️' : '🤍'} {item.likes || 0}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <Toast toast={toast} />
      {drawOpen && <DrawingModal onClose={() => setDrawOpen(false)} onSave={(dataUrl) => saveItem('drawing', dataUrlToBlob(dataUrl), 'png')} />}
      {textOpen && <TextModal onClose={() => setTextOpen(false)} onSave={handleTextSave} busy={busy} />}
    </main>
  );
}

// ── RouletteModal ─────────────────────────────────────────
function RouletteModal({ names, roulette, onClose }: {
  names: string[];
  roulette: ReturnType<typeof useRoulette>;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="draw-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="draw-panel roulette-panel">
        <h2>🎲 발표자 추첨</h2>
        <div className={`roulette-display ${roulette.spinning ? 'roulette-spinning' : ''} ${roulette.result ? 'roulette-done' : ''}`}>
          {roulette.result ? (
            <>
              <div className="roulette-result">{roulette.result}</div>
              <div className="roulette-congrats">🎉 발표자로 선정되었습니다!</div>
            </>
          ) : roulette.spinning ? (
            <div className="roulette-current">{roulette.current}</div>
          ) : (
            <div className="roulette-idle">{names.length}명 중 한 명을 추첨합니다</div>
          )}
        </div>
        <div className="draw-actions">
          <button className="secondary-btn" onClick={onClose}>닫기</button>
          <button
            className="primary-btn"
            onClick={roulette.spin}
            disabled={roulette.spinning}
          >
            {roulette.spinning ? '추첨 중...' : roulette.result ? '다시 추첨' : '추첨 시작!'}
          </button>
        </div>
      </section>
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
function ImageModal({ item, onClose }: { item: BoardItem; onClose: () => void }) {
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
          {(item.likes || 0) > 0 && <span style={{ marginLeft: 12 }}>❤️ {item.likes}</span>}
        </p>
        <span>다시 클릭하면 보드로 돌아갑니다.</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
