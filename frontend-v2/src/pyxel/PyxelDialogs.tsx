import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useApp } from '../app/AppContext';
import { api } from '../api/client';
import { AvatarPicker } from '../phone/AvatarPicker';
import { Feedback } from '../phone/Feedback';
import { InAppNotice } from '../phone/InAppNotice';
import { deviceLabel, MacGuide } from '../phone/MacGuide';
import { Onboarding } from '../phone/Onboarding';
import './pyxel-dialogs.css';

/** Text entry, photo selection, and registration stay native for IME and accessibility. */
export type PyxelDialog =
  | { kind: 'name' }
  | { kind: 'mac'; id: number | 'new' }
  | { kind: 'delete-mac'; id: number }
  | { kind: 'block'; userId: string }
  | { kind: 'avatar' }
  | { kind: 'feedback' }
  | { kind: 'onboarding' }
  | { kind: 'in-app' };

const titles: Record<PyxelDialog['kind'], string> = {
  name: '表示名を変更',
  mac: '端末の登録',
  'delete-mac': '端末を削除',
  block: 'ブロックの確認',
  avatar: 'アイコンを変更',
  feedback: 'ご意見・問い合わせ',
  onboarding: 'はじめての登録',
  'in-app': 'ブラウザで開く',
};
const normalizeMac = (value: string) => value.trim().toLowerCase().replace(/-/g, ':');
const validMac = (value: string) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(value) && value !== '02:00:00:00:00:00';
const focusableSelector = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])';
const visibleControls = (element: HTMLElement) => Array.from(element.querySelectorAll<HTMLElement>(focusableSelector))
  .filter((control) => control.getClientRects().length > 0 && control.getAttribute('aria-hidden') !== 'true');

export function PyxelDialogs({ dialog, onClose }: { dialog: PyxelDialog | null; onClose: () => void }) {
  const { view } = useApp();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Registration fetches the profile before showing its final step. Only finishing
  // that step switches AppContext to app, so the completion choice stays visible.
  useEffect(() => {
    if (dialog?.kind === 'onboarding' && view === 'app') closeRef.current();
  }, [dialog?.kind, view]);

  if (!dialog) return null;
  const key = dialog.kind === 'mac' || dialog.kind === 'delete-mac' ? `${dialog.kind}:${dialog.id}`
    : dialog.kind === 'block' ? `${dialog.kind}:${dialog.userId}` : dialog.kind;
  return <NativeDialog key={key} dialog={dialog} onClose={onClose} />;
}

function NativeDialog({ dialog, onClose }: { dialog: PyxelDialog; onClose: () => void }) {
  const { me, friends, run, setMe, reloadFriends, showToast } = useApp();
  const titleId = useId();
  const nameId = useId();
  const labelId = useId();
  const macId = useId();
  const macHelpId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const existingMac = dialog.kind === 'mac' || dialog.kind === 'delete-mac'
    ? me?.macs.find((item) => item.id === dialog.id) : undefined;
  const [name, setName] = useState(me?.displayName ?? '');
  const [label, setLabel] = useState(existingMac?.label ?? '新しい端末');
  // The server returns a masked address; never put that placeholder into an edit.
  const [mac, setMac] = useState('');
  const dismissible = dialog.kind !== 'onboarding';

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrollBefore = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusInitial = window.requestAnimationFrame(() => {
      const preferred = panel.querySelector<HTMLElement>('[data-pyxel-autofocus]');
      (preferred ?? visibleControls(panel)[0] ?? panel).focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (dismissible && !saving.current) closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = visibleControls(panel);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) { event.preventDefault(); panel.focus(); return; }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault(); first.focus();
      }
      event.stopPropagation();
    };
    const focusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target)) {
        (visibleControls(panel)[0] ?? panel).focus();
      }
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusIn);
    return () => {
      window.cancelAnimationFrame(focusInitial);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusIn);
      document.body.style.overflow = scrollBefore;
      if (previous?.isConnected) previous.focus();
    };
  }, [dismissible]);

  const perform = async (operation: string, fn: () => Promise<void>) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const ok = await run(operation, fn);
      if (ok) closeRef.current();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const saveName = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    void perform('表示名を変更', async () => {
      setMe(await api.updateMe({ displayName: name.trim() }));
      showToast('表示名を変更しました');
    });
  };
  const saveMac = (event: FormEvent) => {
    event.preventDefault();
    if (dialog.kind !== 'mac' || !me) return;
    const value = normalizeMac(mac);
    if (dialog.id === 'new' && me.macs.length >= 5) { showToast('登録できる端末は5台までです'); return; }
    if (dialog.id !== 'new' && !existingMac) { showToast('この端末は見つかりませんでした'); return; }
    if ((!value && dialog.id === 'new') || (value && !validMac(value))) {
      showToast('キャンパスのWiFi設定に表示されたMACアドレスを入力してください'); return;
    }
    if (!label.trim()) { showToast('端末の名前は1〜30文字で入力してください'); return; }
    void perform('端末を保存', async () => {
      if (dialog.id === 'new') await api.addMac(value, label.trim());
      else await api.editMac(dialog.id, { mac: value || undefined, label: label.trim() });
      setMe(await api.getMe());
      showToast('端末を保存しました');
    });
  };
  const deleteMac = () => {
    if (dialog.kind !== 'delete-mac' || !me) return;
    if (me.macs.length <= 1) { showToast('在校判定のため、端末は1台以上登録してください'); return; }
    if (!existingMac) { showToast('この端末は見つかりませんでした'); return; }
    void perform('端末を削除', async () => {
      await api.deleteMac(dialog.id);
      setMe(await api.getMe());
      showToast('端末を削除しました');
    });
  };
  const targetFriend = dialog.kind === 'block' ? friends?.friends.find((friend) => friend.userId === dialog.userId) : undefined;
  const blockFriend = () => {
    if (dialog.kind !== 'block' || !targetFriend) return;
    void perform('ブロック', async () => {
      await api.block(dialog.userId);
      await reloadFriends();
      showToast(`${targetFriend.displayName}さんをブロックしました`);
    });
  };
  const cancel = <button type="button" className="pyxel-native-button" disabled={busy} onClick={onClose}>やめる</button>;

  return (
    <div className="pyxel-dialog-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget && dismissible && !saving.current) onClose();
    }}>
      <div ref={panelRef} className="pyxel-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-busy={busy} tabIndex={-1} onKeyDown={(event) => event.stopPropagation()}>
        <div className="pyxel-dialog-heading">
          <h2 id={titleId}>{dialog.kind === 'mac' ? (dialog.id === 'new' ? '端末を追加' : '端末を編集') : titles[dialog.kind]}</h2>
          {dismissible && <button className="pyxel-dialog-close" type="button" disabled={busy} aria-label="閉じる" onClick={onClose}>×</button>}
        </div>
        <div className="pyxel-dialog-body">
          {dialog.kind === 'name' && <form onSubmit={saveName}>
            <p className="row-note">フレンドの画面に表示される名前です。</p>
            <label className="field-label" htmlFor={nameId}>表示名</label>
            <input id={nameId} className="field" value={name} maxLength={20} autoComplete="nickname" required
              data-pyxel-autofocus disabled={busy} onChange={(event) => setName(event.target.value)} />
            <div className="pyxel-native-actions">
              <button type="submit" className="pyxel-native-button primary" disabled={busy || !name.trim()}>{busy ? '保存しています…' : '保存'}</button>{cancel}
            </div>
          </form>}
          {dialog.kind === 'mac' && <>
            {existingMac && <p className="row-note">現在のアドレス：<span className="mono">{existingMac.macMasked}</span></p>}
            <details className="manual pyxel-mac-guide"><summary>MACアドレスの調べ方</summary>
              <MacGuide onOs={(os) => { if (dialog.id === 'new') setLabel(deviceLabel(os)); }} />
            </details>
            <form onSubmit={saveMac}>
            <label className="field-label" htmlFor={labelId}>端末の名前</label>
            <input id={labelId} className="field" maxLength={30} value={label} required data-pyxel-autofocus disabled={busy}
              onChange={(event) => setLabel(event.target.value)} />
            <label className="field-label" htmlFor={macId}>MACアドレス{dialog.id === 'new' ? '' : '（変更する場合のみ）'}</label>
            <input id={macId} className="field mono" maxLength={17} value={mac} placeholder="例）a2:3f:9c:1b:7e:44"
              required={dialog.id === 'new'} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={busy}
              aria-describedby={macHelpId} onChange={(event) => setMac(event.target.value)} />
            <p id={macHelpId} className="row-note">{dialog.id === 'new' ? 'キャンパスのWiFi設定からコピーしてください。' : '空欄のまま保存すると、今のMACアドレスを使います。'}</p>
            <div className="pyxel-native-actions">
              <button type="submit" className="pyxel-native-button primary" disabled={busy || !label.trim() || (dialog.id === 'new' && (!mac.trim() || (me?.macs.length ?? 0) >= 5))}>{busy ? '保存しています…' : '保存'}</button>{cancel}
            </div>
            </form>
          </>}
          {dialog.kind === 'delete-mac' && <>
            <p><b>{existingMac?.label ?? 'この端末'}</b>を削除すると、在校判定に使われなくなります。</p>
            {(me?.macs.length ?? 0) <= 1 && <p className="row-note">在校判定のため、端末は1台以上登録してください。</p>}
            <div className="pyxel-native-actions"><button type="button" className="pyxel-native-button danger" disabled={busy || !existingMac || (me?.macs.length ?? 0) <= 1} onClick={deleteMac}>{busy ? '削除しています…' : '削除する'}</button>{cancel}</div>
          </>}
          {dialog.kind === 'block' && <>
            <p>{targetFriend?.displayName ?? 'このフレンド'}さんをブロックしますか？ お互いの在校が見えなくなります。相手には知らせず、相手からは「いません」に見えます。</p>
            <p className="row-note">ブロックしても、フレンドからは消えません。解除すると元のフレンドに戻ります。</p>
            <div className="pyxel-native-actions"><button type="button" className="pyxel-native-button danger" disabled={busy || !targetFriend} onClick={blockFriend}>{busy ? '処理しています…' : 'ブロックする'}</button>{cancel}</div>
          </>}
          {dialog.kind === 'avatar' && <AvatarPicker />}
          {dialog.kind === 'feedback' && <Feedback />}
          {dialog.kind === 'onboarding' && <Onboarding />}
          {dialog.kind === 'in-app' && <InAppNotice />}
        </div>
      </div>
    </div>
  );
}
