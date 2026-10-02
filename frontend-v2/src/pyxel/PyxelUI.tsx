import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, type Tab } from '../app/AppContext';
import { api } from '../api/client';
import { BUILDING_LABELS, type Suggestion } from '../api/types';
import { inAppBrowser } from '../app/browser';
import { AddFriendSheet } from '../phone/AddFriendSheet';
import { InviteConfirm } from '../phone/InviteConfirm';
import { when } from '../phone/ui';
import { PyxelDialogs, type PyxelDialog } from './PyxelDialogs';
import './pyxel.css';

interface Control {
  id: string; label: string; action: string; args?: Record<string, unknown>;
  x: number; y: number; width: number; height: number; disabled?: boolean;
}
interface Frame { width: number; height: number; controls: Control[] }
const hiddenSuggestionsKey = 'cokoyo-suggest-hidden:v1';
function readHidden(): string[] {
  try { return JSON.parse(localStorage.getItem(hiddenSuggestionsKey) ?? '[]'); } catch { return []; }
}

/** PyxelがUIを描き、同じAppContext/APIで操作する。HTMLは入力と支援技術を受け持つ。 */
export function PyxelUI() {
  const app = useApp();
  const iframe = useRef<HTMLIFrameElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');
  const [frame, setFrame] = useState<Frame | null>(null);
  const [viewport, setViewport] = useState('initial');
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<PyxelDialog | null>(null);
  const [expandedFriend, setExpandedFriend] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [hiddenSuggestions, setHiddenSuggestions] = useState(readHidden);
  const [scroll, setScroll] = useState({ scrollTotal: 0 });
  const touch = useRef<{ y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const reloadSuggestions = useCallback(() => {
    if (app.view !== 'app') return;
    void api.getSuggestions(true).then((result) => setSuggestions(result.suggestions)).catch(() => setSuggestions([]));
  }, [app.view]);
  useEffect(reloadSuggestions, [reloadSuggestions, app.friends?.friends.length]);
  useEffect(() => { setExpandedFriend(null); }, [app.tab]);
  useEffect(() => { if (app.view !== 'app') setDialog(null); }, [app.view]);

  // Pyxelの論理解像度は起動時に決める。向きや幅が変わってもデータはReact側に残る。
  useEffect(() => {
    const element = screen.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setViewport(`${Math.round(entry.contentRect.width / 2)}x${Math.round(entry.contentRect.height / 2)}`);
      }, 180);
    });
    observer.observe(element);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, []);
  useEffect(() => { setReady(false); setFrame(null); setFailure(''); }, [viewport, attempt]);

  const overlay = dialog?.kind ?? (app.sheet.open ? 'friend-share' : app.invite ? 'invite' : null);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const lastCheck = useMemo(() => {
    if (!app.lastCheck) return null;
    const friends = new Map(app.friends?.friends.map((friend) => [friend.userId, friend]) ?? []);
    return { ...app.lastCheck, friends: app.lastCheck.friends.filter((presence) => friends.has(presence.userId))
      .map((presence) => friends.get(presence.userId)?.best === 'best' ? presence : { ...presence, building: undefined, buildingKey: undefined }) };
  }, [app.lastCheck, app.friends]);
  const snapshot = useMemo(() => ({
    view: app.view, tab: app.tab, buildingLabels: BUILDING_LABELS, me: app.me && {
      userId: app.me.userId, displayName: app.me.displayName, email: app.me.email, hidden: app.me.hidden,
      discoverable: app.me.discoverable, macs: app.me.macs,
    },
    friends: app.friends && {
      friends: app.friends.friends.map(({ avatar: _avatar, ...friend }) => friend),
      requests: {
        incoming: app.friends.requests.incoming.map(({ avatar: _avatar, ...request }) => request),
        outgoing: app.friends.requests.outgoing.map(({ avatar: _avatar, ...request }) => request),
      },
      blocked: app.friends.blocked.map(({ avatar: _avatar, ...friend }) => friend),
    },
    points: app.points, lastCheck, lastCheckLabel: lastCheck ? when(lastCheck.checkedAt) : '', checking: app.checking,
    displayTotal: app.displayTotal, toast: app.toast, mapOpen: app.mapOpen,
    expandedFriend, overlay, error: app.error, initialDisplayName: app.initialDisplayName,
    suggestions: suggestions.filter((item) => !hiddenSuggestions.includes(item.userId))
      .map(({ avatar: _avatar, mutual, ...item }) => ({ ...item, mutual: mutual.slice(0, 3).map(({ userId, displayName }) => ({ userId, displayName })) })), ...scroll,
  }), [app, lastCheck, expandedFriend, overlay, suggestions, hiddenSuggestions, scroll]);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const sendState = useCallback(() => {
    iframe.current?.contentWindow?.postMessage({ source: 'cokoyo-host', type: 'state', payload: snapshotRef.current }, location.origin);
  }, []);
  useEffect(sendState, [snapshot, ready, sendState]);

  const act = async (action: string, args: Record<string, unknown> = {}) => {
    if (overlay) return;
    const userId = typeof args.userId === 'string' ? args.userId : '';
    const requestId = typeof args.requestId === 'string' ? args.requestId : '';
    const macId = Number(args.id);
    const friend = app.friends?.friends.find((item) => item.userId === userId);
    const perform = (name: string, operation: () => Promise<unknown>, message: string) => app.run(name, async () => {
      await operation(); await app.reloadFriends(); reloadSuggestions(); app.showToast(message);
    });
    switch (action) {
      case 'tab':
        if (['home', 'friends', 'settings'].includes(String(args.tab))) app.setTab(args.tab as Tab);
        break;
      case 'check': await app.check(); break;
      case 'toggle-hide': await app.toggleHide(); break;
      case 'map.open': app.openMap(); break;
      case 'map.close': app.closeMap(); break;
      case 'friends.add': app.openAddSheet(); break;
      case 'friend.expand': if (friend) setExpandedFriend((previous) => previous === userId ? null : userId); break;
      case 'friend.react':
        if (friend && lastCheck?.friends.some((presence) => presence.userId === userId && presence.present))
          await app.run('つんつんを送る', async () => { await api.react(userId, 1); app.showToast(`${friend.displayName}さんに つんつん を送りました`); });
        break;
      case 'request.accept':
        if (app.friends?.requests.incoming.some((item) => item.requestId === requestId))
          await perform('申請を承認', () => api.acceptRequest(requestId), 'フレンドになりました');
        break;
      case 'request.decline':
        if ([...(app.friends?.requests.incoming ?? []), ...(app.friends?.requests.outgoing ?? [])].some((item) => item.requestId === requestId))
          await perform('申請を取り消す・断る', () => api.declineRequest(requestId), '申請を取り消しました');
        break;
      case 'friend.best.request': if (friend) await perform('ベストフレンドを申請・承認', () => api.requestBest(userId), friend.best === 'incoming' ? 'ベストフレンドになりました' : 'ベストフレンドを申請しました'); break;
      case 'friend.best.end': if (friend) await perform('ベストフレンドを取り消す', () => api.endBest(userId), 'ベストフレンドの設定を変更しました'); break;
      case 'friend.block': if (friend) setDialog({ kind: 'block', userId }); break;
      case 'friend.unblock': if (app.friends?.blocked.some((item) => item.userId === userId)) await perform('ブロックを解除', () => api.unblock(userId), 'ブロックを解除しました'); break;
      case 'suggestion.request':
        if (suggestions.some((item) => item.userId === userId)) await perform('知り合いかもから申請', () => api.addFriendById(userId), 'フレンドを申請しました');
        break;
      case 'suggestion.dismiss': {
        const ids = [...new Set([...hiddenSuggestions, userId])].slice(-200);
        try { localStorage.setItem(hiddenSuggestionsKey, JSON.stringify(ids)); } catch { /* 保存できない環境 */ }
        setHiddenSuggestions(ids); break;
      }
      case 'profile.name': setDialog({ kind: 'name' }); break;
      case 'profile.photo': setDialog({ kind: 'avatar' }); break;
      case 'device.add': if ((app.me?.macs.length ?? 5) < 5) setDialog({ kind: 'mac', id: 'new' }); break;
      case 'device.edit': if (app.me?.macs.some((item) => item.id === macId)) setDialog({ kind: 'mac', id: macId }); break;
      case 'device.delete': if ((app.me?.macs.length ?? 0) > 1 && app.me?.macs.some((item) => item.id === macId)) setDialog({ kind: 'delete-mac', id: macId }); break;
      case 'discoverability':
        if (app.me) await app.run('知り合いかもの設定', async () => { app.setMe(await api.updateMe({ discoverable: !app.me!.discoverable })); app.showToast('公開設定を変更しました'); });
        break;
      case 'logout':
        await app.run('ログアウト', async () => {
          if (args.all === true) await api.logoutAll(); else await api.logout();
          try { Object.keys(localStorage).filter((key) => key.startsWith('cokoyo-lastcheck:')).forEach((key) => localStorage.removeItem(key)); } catch { /* 保存できない環境 */ }
          await app.restart();
        }); break;
      case 'feedback': setDialog({ kind: 'feedback' }); break;
      case 'legal': if (['about/', 'terms/', 'privacy/'].includes(String(args.path))) window.location.assign(new URL(String(args.path), window.location.href)); break;
      case 'login': if (inAppBrowser()) setDialog({ kind: 'in-app' }); else api.beginLogin(); break;
      case 'onboarding': setDialog({ kind: 'onboarding' }); break;
      case 'retry': await app.restart(); break;
    }
  };
  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== iframe.current?.contentWindow || event.data?.source !== 'cokoyo-pyxel') return;
      const { type, payload } = event.data;
      if (type === 'ready') { setReady(true); setFailure(''); sendState(); }
      if (type === 'error') setFailure(typeof payload?.message === 'string' ? payload.message : 'Pyxelの画面を読み込めませんでした');
      if (type === 'frame' && Number.isFinite(payload?.width) && Number.isFinite(payload?.height) && payload.width > 0 && payload.height > 0 && Array.isArray(payload.controls)) {
        // モーダル中も元のボタンを保持して、閉じたときにキーボードのフォーカスを戻す。
        if (overlayRef.current) return;
        const controls = payload.controls.filter((item: Control) => typeof item.id === 'string' && typeof item.label === 'string' && typeof item.action === 'string'
          && [item.x, item.y, item.width, item.height].every(Number.isFinite) && item.width > 0 && item.height > 0
          && item.x >= 0 && item.y >= 0 && item.x + item.width <= payload.width + 1 && item.y + item.height <= payload.height + 1);
        setFrame({ width: payload.width, height: payload.height, controls });
      }
      if (type === 'action' && typeof payload?.action === 'string') void actRef.current(payload.action, payload.args);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [sendState]);

  const scrollBy = (delta: number) => setScroll((previous) => ({ scrollTotal: previous.scrollTotal + delta }));
  return (
    <div className="pyxel-screen screen" ref={(element) => { screen.current = element; app.screenRef.current = element; }}>
      <h1 className="pyxel-sr-only">COKOYO — Pyxel版</h1>
      {app.view === 'app' && <section className="pyxel-sr-only" aria-label="COKOYOの表示内容">
        <p>{app.me?.displayName}さん。{lastCheck?.me.presence === 'present' ? 'キャンパスにいます' : lastCheck?.me.presence === 'absent' ? 'キャンパス外です' : '在校は未確認です'}。
          {lastCheck && `${when(lastCheck.checkedAt)}に確認。`}今日の獲得 {app.points?.today.total ?? 0}ポイント、累計 {app.points?.total ?? 0}ポイント。</p>
        <p>かくれんぼは{app.me?.hidden ? 'オン' : 'オフ'}。知り合いかもへの表示は{app.me?.discoverable ? 'オン' : 'オフ'}。</p>
        <ul>{app.friends?.friends.map((friend) => {
          const presence = lastCheck?.friends.find((item) => item.userId === friend.userId);
          return <li key={friend.userId}>{friend.displayName}：{presence ? presence.present ? presence.building ?? 'キャンパスにいます' : 'キャンパス外です' : '未確認'}</li>;
        })}</ul>
      </section>}
      {viewport !== 'initial' && <iframe key={`${viewport}:${attempt}`} ref={iframe} src={`${import.meta.env.BASE_URL}pyxel/runtime.html`}
        title="COKOYOのPyxel画面" allow="autoplay" onLoad={sendState} tabIndex={-1} />}
      {!ready && !failure && <div className="pyxel-loading" role="status">Pyxel版を読み込んでいます…</div>}
      {failure && <div className="pyxel-loading" role="alert"><p>Pyxelの画面を読み込めませんでした</p><p>{failure}</p><button onClick={() => setAttempt((value) => value + 1)}>もう一度読み込む</button></div>}
      {ready && frame && <div className="pyxel-controls" inert={!!overlay || !!failure} aria-label="COKOYOの操作"
        onWheel={(event) => { event.preventDefault(); scrollBy(event.deltaY * frame.height / (screen.current?.clientHeight || 1)); }}
        onKeyDown={(event) => {
          if (event.key === 'PageDown' || event.key === 'PageUp') { event.preventDefault(); scrollBy(frame.height * (event.key === 'PageDown' ? .65 : -.65)); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); scrollBy(event.key === 'ArrowDown' ? 24 : -24); }
        }}
        onPointerDown={(event) => { suppressClick.current = false; if (event.pointerType === 'touch') touch.current = { y: event.clientY, moved: false }; }}
        onPointerMove={(event) => {
          const previous = touch.current;
          if (!previous || event.pointerType !== 'touch') return;
          const delta = previous.y - event.clientY;
          if (Math.abs(delta) > 3 || previous.moved) { previous.moved = true; suppressClick.current = true; scrollBy(delta * frame.height / (screen.current?.clientHeight || 1)); previous.y = event.clientY; }
        }}
        onPointerUp={() => { touch.current = null; }} onPointerCancel={() => { touch.current = null; }}>
        {frame.controls.map((control) => <button key={control.id} aria-label={control.label} disabled={control.disabled}
          aria-current={control.action === 'tab' && control.args?.tab === app.tab ? 'page' : undefined}
          data-action={control.action} style={{ left: `${control.x / frame.width * 100}%`, top: `${control.y / frame.height * 100}%`, width: `${control.width / frame.width * 100}%`, height: `${control.height / frame.height * 100}%` }}
          onClick={() => { if (!suppressClick.current) void actRef.current(control.action, control.args); }}>
          <span className="pyxel-sr-only">{control.label}</span>
        </button>)}
      </div>}
      <AddFriendSheet />
      <InviteConfirm />
      <PyxelDialogs dialog={dialog} onClose={() => setDialog(null)} />
      {app.toast && <p className="pyxel-sr-only" role="status">{app.toast.message}</p>}
    </div>
  );
}
