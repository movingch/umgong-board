import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeSVG } from 'qrcode.react';
import { supabase, isSupabaseReady } from './lib/supabase';
import type { Board, BoardItem } from './types';
import './styles.css';

const BUCKET = 'board-images';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uid() {
  return crypto.randomUUID();
}

function getPathParts() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return { mode: parts[0] || 'home', boardId: parts[1] || '' };
}

function getBaseUrl() {
  return window.location.origin;
}

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
  // revokeObjectURL은 toBlob 완료 후 해제 (타이밍 버그 수정)
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      URL.revokeObjectURL(url);
      resolve(blob || file);
    }, 'image/jpeg', quality);
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
  } catch {
    throw new Error('이미지 변환에 실패했습니다.');
  }
}

function textToImageBlob(text: string, uploaderName: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#fffdf6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 이름 영역
  ctx.fillStyle = '#c89f62';
  ctx.font = 'bold 22px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(uploaderName || '이름 없는 참여자', 40, 52);

  // 구분선
  ctx.strokeStyle = '#e1c7a5';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(40, 70);
  ctx.lineTo(760, 70);
  ctx.stroke();

  // 텍스트 본문 (줄바꿈 처리)
  ctx.fillStyle = '#241914';
  ctx.font = '30px ui-sans-serif, system-ui, sans-serif';
  const maxLineWidth = 720;
  const lineHeight = 46;
  let y = 116;

  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      const test = line + char;
      if (ctx.measureText(test).width > maxLineWidth) {
        ctx.fillText(line, 40, y);
        y += lineHeight;
        line = char;
        if (y > 540) break;
      } else {
        line = test;
      }
    }
    if (line && y <= 540) {
      ctx.fillText(line, 40, y);
      y += lineHeight;
    }
    if (y > 540) break;
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), 'image/png');
  });
}

async function uploadBlob(boardId: string, blob: Blob, ext: string) {
  if (!supabase) return URL.createObjectURL(blob);
  const path = `${boardId}/${Date.now()}-${uid()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    cacheControl: '3600',
    upsert: false,
    contentType: blob.type,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
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

// ── App router ───────────────────────────────────────────
function App() {
  const route = getPathParts();
  if (route.mode === 'board' && route.boardId) {
    if (!UUID_RE.test(route.boardId)) return <div className="error-page">잘못된 보드 주소입니다.</div>;
    return <BoardScreen boardId={route.boardId} />;
  }
  if (route.mode === 'join' && route.boardId) {
    if (!UUID_RE.test(route.boardId)) return <div className="error-page">잘못된 보드 주소입니다.</div>;
    return <JoinScreen boardId={route.boardId} />;
  }
  return <Home />;
}

// ── Home ─────────────────────────────────────────────────
function Home() {
  const [title, setTitle] = useState('오늘의 생각보드');
  const [busy, setBusy] = useState(false);
  const { toast, show } = useToast();

  async function createBoard() {
    setBusy(true);
    try {
      if (!supabase) {
        const id = uid();
        localStorage.setItem(`demo-board-${id}`, JSON.stringify({ id, title }));
        window.location.href = `/board/${id}`;
        return;
      }
      const { data, error } = await supabase.from('boards').insert({ title }).select().single();
      if (error) throw error;
      window.location.href = `/board/${data.id}`;
    } catch (e) {
      show(e instanceof Error ? e.message : '보드 생성에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="home">
      <section className="hero-card">
        <div className="brand">생각보드</div>
        <h1>스마트폰으로 그리고, PC 화면에 함께 전시합니다.</h1>
        <p>
          회의 참석자는 QR로 들어와 사진이나 낙서를 올리고, 진행자는 큰 화면에서 보드판처럼
          보여주며 설명할 수 있습니다.
        </p>
        {!isSupabaseReady && (
          <div className="warning">
            현재 Supabase 환경변수가 없어 데모 모드로 실행됩니다. 배포 전 README의 설정을
            적용하세요.
          </div>
        )}
        <label className="field-label" htmlFor="board-title">보드 제목</label>
        <input
          id="board-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="title-input"
        />
        <button onClick={createBoard} disabled={busy} className="primary-btn">
          {busy ? '만드는 중...' : '새 보드 만들기'}
        </button>
      </section>
      <Toast toast={toast} />
    </main>
  );
}

// ── BoardScreen (진행자) ──────────────────────────────────
function BoardScreen({ boardId }: { boardId: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [items, setItems] = useState<BoardItem[]>([]);
  const [selected, setSelected] = useState<BoardItem | null>(null);
  const joinUrl = `${getBaseUrl()}/join/${boardId}`;

  // 초기 로드
  useEffect(() => {
    async function load() {
      if (!supabase) {
        const storedBoard = localStorage.getItem(`demo-board-${boardId}`);
        setBoard(storedBoard ? JSON.parse(storedBoard) : { id: boardId, title: '데모 생각보드' });
        setItems(JSON.parse(localStorage.getItem(`demo-items-${boardId}`) || '[]'));
        return;
      }
      const [{ data: b }, { data: loadedItems, error }] = await Promise.all([
        supabase.from('boards').select('*').eq('id', boardId).single(),
        supabase
          .from('board_items')
          .select('*')
          .eq('board_id', boardId)
          .order('created_at', { ascending: true }),
      ]);
      if (b) setBoard(b);
      if (!error && loadedItems) setItems(loadedItems as BoardItem[]);
    }
    load();
  }, [boardId]);

  // 실시간 구독 (자동 새로고침)
  useEffect(() => {
    if (!supabase) {
      // 데모 모드: localStorage 폴링
      const timer = window.setInterval(() => {
        setItems(JSON.parse(localStorage.getItem(`demo-items-${boardId}`) || '[]'));
      }, 1000);
      return () => window.clearInterval(timer);
    }

    const channel = supabase
      .channel(`board-${boardId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'board_items',
          filter: `board_id=eq.${boardId}`,
        },
        (payload) => {
          setItems((prev) =>
            prev.some((it) => it.id === payload.new.id)
              ? prev
              : [...prev, payload.new as BoardItem],
          );
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'board_items',
          filter: `board_id=eq.${boardId}`,
        },
        (payload) => {
          setItems((prev) => prev.filter((it) => it.id !== payload.old.id));
        },
      )
      .subscribe();

    return () => {
      supabase?.removeChannel(channel);
    };
  }, [boardId]);

  // 낙관적 삭제 + 실패 시 롤백
  async function removeItem(id: string) {
    if (!confirm('이 항목을 삭제할까요?')) return;
    const prev = items;
    setItems((cur) => cur.filter((it) => it.id !== id));
    if (!supabase) {
      const next = prev.filter((it) => it.id !== id);
      localStorage.setItem(`demo-items-${boardId}`, JSON.stringify(next));
      return;
    }
    const { error } = await supabase.from('board_items').delete().eq('id', id);
    if (error) setItems(prev); // 실패 시 롤백
  }

  function typeLabel(type: BoardItem['type']) {
    if (type === 'drawing') return '낙서';
    if (type === 'text') return '텍스트';
    return '사진';
  }

  return (
    <main className="board-page">
      <header className="board-header">
        <div>
          <div className="brand small">생각보드</div>
          <h1>{board?.title || '생각보드'}</h1>
          <p>참여자는 스마트폰으로 그리고 올립니다. 진행자는 이 화면을 빔프로젝터에 띄우세요.</p>
        </div>
        <div className="qr-box">
          <QRCodeSVG value={joinUrl} size={110} />
          <span>스마트폰 참여 QR</span>
        </div>
      </header>

      <section className="board-toolbar">
        <a className="soft-btn" href={joinUrl} target="_blank" rel="noopener noreferrer">
          참여자 화면 열기
        </a>
        <button className="soft-btn" onClick={() => document.documentElement.requestFullscreen?.()}>
          전체화면
        </button>
        <button className="soft-btn" onClick={() => navigator.clipboard.writeText(joinUrl)}>
          참여 링크 복사
        </button>
      </section>

      <section className="cork-board">
        {items.length === 0 ? (
          <div className="empty-board">
            아직 붙은 그림이 없습니다. QR로 접속해서 첫 번째 생각을 붙여보세요.
          </div>
        ) : (
          items.map((item) => (
            <article
              key={item.id}
              className="photo-note"
              style={{ transform: `rotate(${item.rotate}deg)` }}
              onClick={() => setSelected(item)}
            >
              <div className="tape" />
              <img src={item.image_url} alt={item.caption || '보드 이미지'} loading="lazy" />
              <div className="note-footer">
                <strong>{item.uploader_name || '참여자'}</strong>
                <span>{typeLabel(item.type)}</span>
              </div>
              <button
                className="delete-btn"
                aria-label="항목 삭제"
                onClick={(e) => {
                  e.stopPropagation();
                  removeItem(item.id);
                }}
              >
                ×
              </button>
            </article>
          ))
        )}
      </section>

      {selected && <ImageModal item={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

// ── JoinScreen (참여자) ───────────────────────────────────
function JoinScreen({ boardId }: { boardId: string }) {
  const [name, setName] = useState(localStorage.getItem('saenggak-name') || '');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast, show } = useToast();

  async function saveItem(type: BoardItem['type'], blob: Blob, ext: string) {
    setBusy(true);
    try {
      localStorage.setItem('saenggak-name', name);
      const imageUrl = await uploadBlob(boardId, blob, ext);
      const item: BoardItem = {
        id: uid(),
        board_id: boardId,
        type,
        image_url: imageUrl,
        uploader_name: name.trim() || '이름 없는 참여자',
        caption: caption.trim() || null,
        rotate: randomRotate(),
        created_at: new Date().toISOString(),
      };
      if (!supabase) {
        const list = JSON.parse(localStorage.getItem(`demo-items-${boardId}`) || '[]');
        localStorage.setItem(`demo-items-${boardId}`, JSON.stringify([...list, item]));
      } else {
        const { error } = await supabase.from('board_items').insert(item);
        if (error) throw error;
      }
      setCaption('');
      show('보드에 붙였습니다. PC 화면을 확인하세요.', 'success');
    } catch (e) {
      show(e instanceof Error ? e.message : '제출에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.[0]) return;
    try {
      const blob = await resizeImage(files[0]);
      await saveItem('photo', blob, 'jpg');
    } catch (e) {
      show(e instanceof Error ? e.message : '이미지 처리에 실패했습니다.', 'error');
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleTextSave(text: string) {
    const uploaderName = name.trim() || '이름 없는 참여자';
    const blob = await textToImageBlob(text, uploaderName);
    await saveItem('text', blob, 'png');
  }

  return (
    <main className="join-page">
      <section className="join-card">
        <div className="brand">생각보드 참여</div>
        <h1>사진이나 낙서를 보드에 붙이세요.</h1>
        {!isSupabaseReady && (
          <div className="warning">데모 모드입니다. 같은 브라우저 안에서만 확인됩니다.</div>
        )}
        <label className="field-label" htmlFor="join-name">이름</label>
        <input
          id="join-name"
          className="title-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="이름 또는 별명"
        />
        <label className="field-label" htmlFor="join-caption">짧은 설명</label>
        <input
          id="join-caption"
          className="title-input"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="선택 사항"
        />
        <div className="join-actions">
          <button className="primary-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            사진 올리기
          </button>
          <button className="secondary-btn" disabled={busy} onClick={() => setDrawOpen(true)}>
            낙서 올리기
          </button>
          <button className="secondary-btn" disabled={busy} onClick={() => setTextOpen(true)}>
            텍스트 올리기
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        <p className="hint">스마트폰에서는 손가락으로 바로 그릴 수 있습니다.</p>
      </section>
      <Toast toast={toast} />
      {drawOpen && (
        <DrawingModal
          onClose={() => setDrawOpen(false)}
          onSave={(dataUrl) => saveItem('drawing', dataUrlToBlob(dataUrl), 'png')}
        />
      )}
      {textOpen && (
        <TextModal onClose={() => setTextOpen(false)} onSave={handleTextSave} busy={busy} />
      )}
    </main>
  );
}

// ── TextModal ─────────────────────────────────────────────
function TextModal({
  onClose,
  onSave,
  busy,
}: {
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
  busy: boolean;
}) {
  const [text, setText] = useState('');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleSave() {
    if (!text.trim()) return;
    await onSave(text.trim());
    onClose();
  }

  return (
    <div className="draw-backdrop">
      <section className="draw-panel">
        <h2>텍스트 작성</h2>
        <textarea
          className="text-input-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="생각을 자유롭게 적어보세요..."
          rows={8}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <div className="draw-actions">
          <button className="secondary-btn" onClick={onClose}>
            취소
          </button>
          <button
            className="primary-btn"
            disabled={busy || !text.trim()}
            onClick={handleSave}
          >
            {busy ? '올리는 중...' : '보드에 붙이기'}
          </button>
        </div>
      </section>
    </div>
  );
}

// ── DrawingModal ──────────────────────────────────────────
function DrawingModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}) {
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
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    drawing.current = true;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = eraser ? '#fffdf6' : color;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function up() {
    drawing.current = false;
    canvasRef.current?.getContext('2d')?.closePath();
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#fffdf6';
    ctx.fillRect(0, 0, rect.width, rect.height);
  }

  return (
    <div className="draw-backdrop">
      <section className="draw-panel">
        <h2>낙서장</h2>
        <div className="draw-tools">
          <input
            type="color"
            value={color}
            onChange={(e) => {
              setColor(e.target.value);
              setEraser(false);
            }}
          />
          <label>
            굵기{' '}
            <input
              type="range"
              min="2"
              max="28"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </label>
          <button onClick={() => setEraser(!eraser)} className={eraser ? 'active-tool' : ''}>
            {eraser ? '지우개 사용 중' : '지우개'}
          </button>
          <button onClick={clear}>전체 지우기</button>
        </div>
        <canvas
          ref={canvasRef}
          className="draw-canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
        />
        <div className="draw-actions">
          <button className="secondary-btn" onClick={onClose}>
            취소
          </button>
          <button
            className="primary-btn"
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              onSave(canvas.toDataURL('image/png'));
              onClose();
            }}
          >
            보드에 붙이기
          </button>
        </div>
      </section>
    </div>
  );
}

// ── ImageModal ────────────────────────────────────────────
function ImageModal({ item, onClose }: { item: BoardItem; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
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
        </p>
        <span>다시 클릭하면 보드로 돌아갑니다.</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
