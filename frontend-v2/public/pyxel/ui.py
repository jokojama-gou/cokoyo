"""COKOYO's interface drawn by Pyxel; account and API actions stay in the host."""
import json
import pyxel
from js import window

BG, INK, WHITE, LINE, ORANGE, TINT, GREEN, GREEN_TINT = range(8)
PURPLE, PURPLE_TINT, MUTED, BLUE, BLUE_TINT, RED, SAND, YELLOW = range(8, 16)
PALETTE = [0xF0EDE8, 0x1C1917, 0xFFFFFF, 0xDDD6CE, 0xEA580C, 0xFFF0E4,
           0x26855A, 0xE6F2E8, 0x7C3AED, 0xF3EEFF, 0x78716C, 0x4089AC,
           0xD6EBF1, 0xB6413A, 0xC9B99E, 0xE7BE54]
BUILDINGS = [("kappa", "κ館"), ("epsilon", "ε館"), ("iota", "ι館"),
             ("omicron", "ο館"), ("delta", "δ館"), ("tau", "τ館"),
             ("mu", "μ館"), ("omega", "ω館"), ("alpha", "α館"),
             ("theta", "θ館"), ("lambda", "λ館"), ("pe-buildings", "体育施設"),
             ("sigma", "σ館"), ("lounge", "鴨池ラウンジ")]
WORDMARK = {"C": [14, 17, 16, 16, 16, 17, 14], "O": [14, 17, 17, 17, 17, 17, 14],
            "K": [17, 18, 20, 24, 20, 18, 17], "Y": [17, 17, 10, 4, 4, 4, 4]}


class CokoyoUI:
    def __init__(self):
        viewport_width = max(240, float(window.innerWidth))
        self.w = max(240, min(960, round(viewport_width / 2)))
        self.h = max(160, min(1440, round(float(window.innerHeight) * self.w / viewport_width)))
        pyxel.init(self.w, self.h, title="COKOYO / PYXEL UI", fps=30)
        pyxel.colors.from_list(PALETTE)
        pyxel.mouse(False)
        self.font = pyxel.Font("fonts/umplus_j10r.bdf")
        self.state = {"view": "loading"}
        self.controls, self.last_frame = [], None
        self.drawing_body = False
        self.scroll, self.total, self.last_page = 0, 0, None
        self.scroll_total = None
        self.wide = self.w >= 520
        self.left = 104 if self.wide else 0
        self.top, self.bottom = 44, self.h if self.wide else self.h - 36
        self.emit("ready", {"width": self.w, "height": self.h})
        pyxel.run(self.update, self.draw)

    def emit(self, action, args=None):
        try:
            payload = args or {}
            event_type = action
            if action not in ("ready", "frame", "error"):
                event_type, payload = "action", {"action": action, "args": payload}
            window.cokoyoBridge.emit(event_type, json.dumps(payload, ensure_ascii=False))
        except Exception:
            pass

    def update(self):
        try:
            snapshot = json.loads(str(window.cokoyoBridge.readState()))
            if isinstance(snapshot, dict):
                self.state = {"view": "loading", **snapshot}
        except Exception:
            pass
        page = (self.state.get("view"), self.state.get("tab"), self.state.get("mapOpen"))
        page_changed = self.last_page != page
        if self.last_page != page:
            self.scroll, self.last_page = 0, page
        incoming_scroll = float(self.state.get("scrollTotal") or 0)
        host_delta = 0 if self.scroll_total is None or page_changed else incoming_scroll - self.scroll_total
        # Consume cumulative input even while a native dialog owns the interface.
        self.scroll_total = incoming_scroll
        if not self.state.get("overlay"):
            delta = -getattr(pyxel, "mouse_wheel", 0) * 24
            delta += host_delta
            if pyxel.btnp(pyxel.KEY_PAGEDOWN):
                delta += self.bottom - self.top - 24
            if pyxel.btnp(pyxel.KEY_PAGEUP):
                delta -= self.bottom - self.top - 24
            if pyxel.btnp(pyxel.KEY_DOWN, 10, 2):
                delta += 15
            if pyxel.btnp(pyxel.KEY_UP, 10, 2):
                delta -= 15
            self.scroll = max(0, min(self.scroll + delta, max(0, self.total - self.bottom + 12)))
            if pyxel.btnp(pyxel.MOUSE_BUTTON_LEFT):
                for control in reversed(self.controls):
                    if (not control["disabled"] and control["x"] <= pyxel.mouse_x < control["x"] + control["width"]
                            and control["y"] <= pyxel.mouse_y < control["y"] + control["height"]):
                        self.emit(control["action"], control["args"])
                        break

    def width(self, value):
        return self.font.text_width(str(value))

    def shorten(self, value, width):
        value = str(value or "")
        while value and self.width(value) > width:
            value = value[:-1]
        return value

    def text(self, x, y, value, color=INK, width=None, max_lines=None):
        lines, line = [], ""
        for char in str(value or ""):
            if char == "\n" or (width and self.width(line + char) > width):
                lines.append(line)
                line = "" if char == "\n" else char
            else:
                line += char
        lines.append(line)
        if max_lines:
            lines = lines[:max_lines]
        for n, line in enumerate(lines):
            pyxel.text(int(x), int(y + n * 15), line, color, self.font)
        return len(lines) * 15

    def control(self, label, action, args, x, y, w, h, disabled=False):
        if self.state.get("overlay"):
            return
        # Keep host buttons entirely within the same visible clip as the pixels.
        in_body = self.top <= y and y + h <= self.bottom
        in_chrome = not self.drawing_body
        if y >= 0 and y + h <= self.h and (in_body or in_chrome):
            instance = str(int(x)) + "," + str(round(y + self.scroll if self.drawing_body else y))
            self.controls.append({"id": action + ":" + json.dumps(args, sort_keys=True) + ":" + label + ":" + instance,
                                  "label": label, "action": action, "args": args,
                                  "x": int(x), "y": int(y), "width": int(w), "height": int(h),
                                  "disabled": bool(disabled)})

    def button(self, x, y, w, label, action, args=None, tone="quiet", disabled=False, h=28):
        color, foreground = (ORANGE, WHITE) if tone == "primary" else (WHITE, INK)
        if tone == "purple":
            color, foreground = PURPLE, WHITE
        if tone == "danger":
            foreground = RED
        if disabled:
            color, foreground = BG, MUTED
        pyxel.rect(int(x), int(y + 2), int(w), h, LINE)
        pyxel.rect(int(x), int(y), int(w), h, color)
        pyxel.rectb(int(x), int(y), int(w), h, color if tone in ("primary", "purple") else LINE)
        label_width = self.width(label)
        self.text(x + max(6, (w - label_width) // 2), y + (h - 10) // 2,
                  self.shorten(label, w - 12), foreground)
        self.control(label, action, args or {}, x, y, w, h, disabled)
        return y + h + 10

    def card(self, x, y, w, h, tint=WHITE):
        pyxel.rect(int(x + 2), int(y + 2), int(w), int(h), LINE)
        pyxel.rect(int(x), int(y), int(w), int(h), tint)
        pyxel.rectb(int(x), int(y), int(w), int(h), LINE)

    def heading(self, x, y, title, detail="", w=300):
        self.text(x, y, title)
        if detail:
            self.text(x + max(self.width(title) + 10, w - self.width(detail)), y, detail, MUTED)
        return y + 23

    def avatar(self, x, y, key="", present=False, size=22):
        color = [ORANGE, PURPLE, GREEN, BLUE, RED, YELLOW][sum(ord(c) for c in str(key)) % 6]
        pyxel.rect(int(x), int(y), size, size, GREEN_TINT if present else BG)
        for row, pixels in enumerate(["00111100", "01111110", "11111111", "11111111", "11111111", "01111110"]):
            for col, pixel in enumerate(pixels):
                if pixel == "1":
                    pyxel.rect(int(x + 3 + col * 2), int(y + 6 + row * 2), 2, 2, color)
        pyxel.rect(int(x + 7), int(y + 10), 2, 2, INK)
        pyxel.rect(int(x + 13), int(y + 10), 2, 2, INK)
        pyxel.rect(int(x + 9), int(y + 14), 4, 1, INK)
        if present:
            pyxel.rect(int(x + size - 3), int(y - 1), 5, 5, GREEN)

    def campus(self, x, y, w, h=62):
        pyxel.rect(int(x), int(y), int(w), h, GREEN_TINT)
        pyxel.rect(int(x), int(y + h - 13), int(w), 13, SAND)
        pyxel.rect(int(x + w * .58), int(y + h - 13), int(w * .3), 3, WHITE)
        pyxel.rect(int(x + 12), int(y + h - 28), 18, 15, GREEN)
        pyxel.rect(int(x + 19), int(y + h - 14), 4, 6, SAND)
        bx, by = int(x + w * .29), int(y + 15)
        pyxel.rect(bx, by + 3, int(w * .34), h - 28, SAND)
        pyxel.rect(bx - 3, by, int(w * .34) + 6, 5, INK)
        for col in range(max(1, int(w * .34) // 14)):
            pyxel.rect(bx + 6 + col * 14, by + 11, 7, 8, BLUE_TINT)
        self.avatar(x + w - 39, y + h - 28, "cokoyo")
        pyxel.rect(int(x + w - 56), int(y + 11), 10, 3, WHITE)
        pyxel.rect(int(x + w - 62), int(y + 14), 22, 3, WHITE)

    def hide_card(self, x, y, w):
        hidden = bool((self.state.get("me") or {}).get("hidden"))
        self.card(x, y, w, 105, PURPLE_TINT if hidden else WHITE)
        self.text(x + 12, y + 12, "かくれんぼ", PURPLE)
        self.text(x + 12, y + 31, "在校をフレンドに見せない" if hidden else "在校をフレンドに見せています", MUTED, w - 24, 2)
        self.button(x + 12, y + 68, w - 24, "かくれんぼをやめる" if hidden else "かくれんぼする",
                    "toggle-hide", tone="purple" if hidden else "quiet")
        return y + 119

    def presence_card(self, x, y, w):
        lc, checking = self.state.get("lastCheck") or {}, self.state.get("checking")
        mine = lc.get("me") or {}
        status = mine.get("presence")
        title = {"present": "キャンパスにいます", "absent": "キャンパス外です", "unknown": "在校を判定できません"}.get(status, "キャンパスにいる？")
        subtitle = mine.get("building") if status == "present" else "キャンパスのWiFiで確認します"
        if status == "unknown":
            subtitle = "大学側の通信を確認できません"
        self.card(x, y, w, 170)
        pyxel.rect(int(x), int(y), int(w), 3, GREEN if status == "present" else ORANGE)
        self.text(x + 12, y + 14, "CAMPUS STATUS", MUTED)
        self.text(x + 12, y + 34, title, GREEN if status == "present" else INK, w - 24, 2)
        self.text(x + 12, y + 67, subtitle or "建物は確認できません", MUTED, w - 24, 2)
        self.button(x + 12, y + 101, w - 24, "確認しています…" if checking else "ポイント獲得（在校確認）",
                    "check", tone="primary", disabled=checking)
        checked = str(lc.get("checkedAt") or "")
        if checked:
            stamp = self.state.get("lastCheckLabel") or checked.replace("T", " ")[:16]
            self.text(x + 12, y + 146, stamp + " に確認", MUTED)
        else:
            self.text(x + 12, y + 146, "まだ確認していません", MUTED)
        return y + 184

    def points_card(self, x, y, w):
        points = self.state.get("points") or {}
        today = points.get("today") or {}
        items = today.get("items") or []
        h = 84 + max(1, len(items)) * 22
        self.card(x, y, w, h)
        self.text(x + 12, y + 13, "今日の獲得", MUTED)
        self.text(x + w - 12 - self.width(str(today.get("total", 0)) + " pt"), y + 13,
                  str(today.get("total", 0)) + " pt", ORANGE)
        yy = y + 38
        for item in items:
            self.text(x + 12, yy, self.shorten(item.get("label"), w - 75), MUTED)
            self.text(x + w - 48, yy, "+" + str(item.get("pts", 0)), ORANGE)
            yy += 22
        if not items:
            self.text(x + 12, yy, "キャンパスで獲得できます", MUTED, w - 24, 2)
        pyxel.line(int(x + 12), int(y + h - 30), int(x + w - 12), int(y + h - 30), LINE)
        self.text(x + 12, y + h - 20, "累計", MUTED)
        total = str(points.get("total", 0)) + " pt"
        self.text(x + w - 12 - self.width(total), y + h - 20, total)
        return y + h + 14

    def home_friends(self, x, y, w):
        friends = ((self.state.get("friends") or {}).get("friends") or [])
        results = {f.get("userId"): f for f in ((self.state.get("lastCheck") or {}).get("friends") or [])}
        friends = sorted(friends, key=lambda f: 0 if results.get(f.get("userId"), {}).get("present") else 1)
        count = sum(bool(results.get(f.get("userId"), {}).get("present")) for f in friends)
        y = self.heading(x, y, "フレンド", str(count) + "人在校", w)
        h = max(78, len(friends) * 49 + 18)
        self.card(x, y, w, h)
        if not friends:
            self.text(x + 12, y + 13, "まだフレンドがいません", MUTED)
            self.button(x + 12, y + 34, w - 24, "フレンドを追加", "friends.add")
        for n, friend in enumerate(friends):
            yy, uid = y + 13 + n * 49, friend.get("userId")
            result = results.get(uid)
            present = bool(result and result.get("present"))
            self.avatar(x + 12, yy + 1, uid, present)
            name = friend.get("displayName", "")
            if present:
                self.control(name + "に「つんつん」を送る", "friend.react", {"userId": uid}, x + 12, yy + 1, 22, 22)
            self.text(x + 44, yy, self.shorten(name, w - 58))
            status = "未確認" if not result else result.get("building") or ("キャンパスにいます" if present else "いません")
            self.text(x + 44, yy + 17, self.shorten(status, w - 58), GREEN if present else MUTED)
            if n + 1 < len(friends):
                pyxel.line(int(x + 12), int(yy + 38), int(x + w - 12), int(yy + 38), BG)
        return y + h + 14

    def home(self, x, y, w):
        me = self.state.get("me") or {}
        self.text(x, y, "おつかれさま、" + self.shorten(me.get("displayName"), w - 90))
        y += 25
        gap, cw = 14, (w - 14) // 2 if self.wide else w
        right = x + cw + gap
        a = self.presence_card(x, y, cw)
        self.campus(x, a, cw)
        a += 76
        a = self.button(x, a, cw, "キャンパス・マップ", "map.open") + 8
        a = self.home_friends(x, a, cw)
        b = y if self.wide else a
        b = self.points_card(right if self.wide else x, b, cw)
        b = self.hide_card(right if self.wide else x, b, cw)
        self.text(right if self.wide else x, b, "位置情報は使いません。\nキャンパスのWiFiで在校を確認。", MUTED, cw, 3)
        return max(a, b + 52)

    def request_rows(self, x, y, w, title, requests, outgoing=False, best=False):
        if not requests:
            return y
        y = self.heading(x, y, title, str(len(requests)) + "件", w)
        for request in requests:
            self.card(x, y, w, 83)
            self.avatar(x + 12, y + 11, request.get("userId"))
            self.text(x + 44, y + 11, self.shorten(request.get("displayName"), w - 55))
            self.text(x + 44, y + 27, "ベストフレンド申請" if best else "承認待ち" if outgoing else "フレンド申請", MUTED)
            args = {"userId": request.get("userId")} if best else {"requestId": request.get("requestId")}
            if outgoing:
                self.button(x + 12, y + 47, w - 24, "申請を取り消す", "request.decline", args)
            else:
                bw = (w - 32) // 2
                self.button(x + 12, y + 47, bw, "承認", "friend.best.request" if best else "request.accept", args, "purple" if best else "primary")
                self.button(x + 20 + bw, y + 47, bw, "断る", "friend.best.end" if best else "request.decline", args)
            y += 97
        return y

    def friend_rows(self, x, y, w, friends):
        y = self.heading(x, y, "フレンド", str(len(friends)) + "人", w)
        if not friends:
            self.card(x, y, w, 56)
            self.text(x + 12, y + 19, "フレンドを追加して始めましょう", MUTED, w - 24, 2)
            return y + 70
        for friend in friends:
            uid, best = friend.get("userId"), friend.get("best", "none")
            expanded = self.state.get("expandedFriend") == uid
            h = 155 if expanded else 59
            self.card(x, y, w, h)
            self.avatar(x + 12, y + 12, uid)
            self.text(x + 44, y + 12, self.shorten(friend.get("displayName"), w - 68))
            meta = {"best": "★ ベストフレンド", "incoming": "ベスト申請が届いています", "outgoing": "ベスト申請中"}.get(best, "フレンド")
            self.text(x + 44, y + 29, self.shorten(meta, w - 57), PURPLE if best != "none" else MUTED)
            self.text(x + w - 20, y + 16, "-" if expanded else "+", MUTED)
            self.control(friend.get("displayName", "") + "の詳細", "friend.expand", {"userId": uid}, x, y, w, 54)
            if expanded:
                label = {"best": "ベストフレンドをやめる", "incoming": "ベスト申請を承認", "outgoing": "ベスト申請を取り消す"}.get(best, "ベストフレンドを申請")
                self.button(x + 12, y + 58, w - 24, label,
                            "friend.best.end" if best in ("best", "outgoing") else "friend.best.request", {"userId": uid})
                self.text(x + 12, y + 94, "ベストになると建物まで共有", MUTED, w - 24, 1)
                self.button(x + 12, y + 115, w - 24, "ブロック", "friend.block", {"userId": uid}, "danger")
            y += h + 12
        return y

    def suggestions(self, x, y, w):
        suggestions = self.state.get("suggestions") or []
        if not suggestions:
            return y
        y = self.heading(x, y, "知り合いかも", str(len(suggestions)) + "人", w)
        for person in suggestions:
            mutual_names = [str(friend.get("displayName") or "") for friend in (person.get("mutual") or [])[:3]]
            mutual_names = [name for name in mutual_names if name]
            h, action_y = 81 + len(mutual_names) * 17, y + 39 + len(mutual_names) * 17
            self.card(x, y, w, h)
            self.avatar(x + 12, y + 11, person.get("userId"))
            self.text(x + 44, y + 11, self.shorten(person.get("displayName"), w - 56))
            for n, name in enumerate(mutual_names):
                self.text(x + 12, y + 34 + n * 17, self.shorten(name, w - 24), MUTED)
            args, bw = {"userId": person.get("userId")}, (w - 32) // 2
            self.button(x + 12, action_y, bw, "申請", "suggestion.request", args, "primary")
            self.button(x + 20 + bw, action_y, bw, "非表示", "suggestion.dismiss", args)
            y += h + 14
        return y

    def friends(self, x, y, w):
        data = self.state.get("friends") or {}
        friends, requests = data.get("friends") or [], data.get("requests") or {}
        cw = (w - 14) // 2 if self.wide else w
        right = x + cw + 14 if self.wide else x
        a = self.button(x, y, cw, "＋ フレンドを追加", "friends.add", tone="primary") + 8
        a = self.request_rows(x, a, cw, "届いている申請", requests.get("incoming") or [])
        a = self.request_rows(x, a, cw, "ベストフレンド申請", [f for f in friends if f.get("best") == "incoming"], best=True)
        a = self.friend_rows(x, a, cw, friends)
        b = y if self.wide else a
        b = self.hide_card(right, b, cw)
        b = self.suggestions(right, b, cw)
        b = self.request_rows(right, b, cw, "承認待ち", requests.get("outgoing") or [], outgoing=True)
        blocked = data.get("blocked") or []
        if blocked:
            b = self.heading(right, b, "ブロック中", str(len(blocked)) + "人", cw)
            for person in blocked:
                self.card(right, b, cw, 71)
                self.text(right + 12, b + 12, self.shorten(person.get("displayName"), cw - 24))
                self.button(right + 12, b + 33, cw - 24, "ブロックを解除", "friend.unblock", {"userId": person.get("userId")})
                b += 85
        return max(a, b)

    def settings(self, x, y, w):
        me = self.state.get("me") or {}
        cw = (w - 14) // 2 if self.wide else w
        right = x + cw + 14 if self.wide else x
        a = self.heading(x, y, "プロフィール", w=cw)
        self.card(x, a, cw, 125)
        self.avatar(x + 12, a + 11, me.get("userId"))
        self.text(x + 44, a + 14, self.shorten(me.get("displayName"), cw - 56))
        self.button(x + 12, a + 47, cw - 24, "表示名を変更", "profile.name")
        self.button(x + 12, a + 85, cw - 24, "写真を変更", "profile.photo")
        a += 139
        macs = me.get("macs") or []
        a = self.heading(x, a, "キャンパスの検知", str(len(macs)) + " / 5台", cw)
        self.text(x, a, "登録端末のWiFi接続で在校を確認", MUTED, cw, 2)
        a += 37
        for device in macs:
            self.card(x, a, cw, 97)
            self.text(x + 12, a + 12, self.shorten(device.get("label"), cw - 24))
            self.text(x + 12, a + 32, device.get("macMasked"), MUTED)
            bw, args = (cw - 32) // 2, {"id": device.get("id")}
            self.button(x + 12, a + 57, bw, "編集", "device.edit", args)
            self.button(x + 20 + bw, a + 57, bw, "削除", "device.delete", args, "danger", len(macs) <= 1)
            a += 111
        a = self.button(x, a, cw, "端末を追加", "device.add", disabled=len(macs) >= 5) + 10
        b = y if self.wide else a
        b = self.heading(right, b, "アカウント", w=cw)
        self.card(right, b, cw, 148)
        self.text(right + 12, b + 12, "Googleアカウント", MUTED)
        self.text(right + 12, b + 32, me.get("email"), INK, cw - 24, 2)
        self.button(right + 12, b + 70, cw - 24, "ログアウト", "logout", {"all": False})
        self.button(right + 12, b + 108, cw - 24, "全端末からログアウト", "logout", {"all": True})
        b += 162
        self.card(right, b, cw, 119)
        self.text(right + 12, b + 12, "知り合いかも", INK)
        self.text(right + 12, b + 33, "フレンドのフレンドに表示", MUTED, cw - 24, 2)
        self.button(right + 12, b + 79, cw - 24, "表示する：オン" if me.get("discoverable") else "表示する：オフ", "discoverability")
        b += 133
        b = self.button(right, b, cw, "ご意見・問い合わせ", "feedback") + 8
        for label, path in [("COKOYOについて", "about/"), ("利用規約", "terms/"), ("プライバシーポリシー", "privacy/")]:
            b = self.button(right, b, cw, label, "legal", {"path": path})
        return max(a, b + 10)

    def campus_map(self, x, y, w):
        y = self.button(x, y, min(w, 170), "← ホームに戻る", "map.close") + 8
        self.text(x, y, "キャンパス・マップ")
        y += 22
        y += self.text(x, y, "確認した建物ごとに表示。フレンドの建物はベストフレンドだけが見られます。", MUTED, w)
        y += 12
        results = (self.state.get("lastCheck") or {}).get("friends") or []
        names = {f.get("userId"): f.get("displayName") for f in (self.state.get("friends") or {}).get("friends", [])}
        occupants = {}
        unknown = []
        mine = (self.state.get("lastCheck") or {}).get("me") or {}
        if mine.get("presence") == "present":
            if mine.get("buildingKey"):
                occupants.setdefault(mine["buildingKey"], []).append("あなた")
            else:
                unknown.append("あなた（建物は不明）")
        for person in results:
            if person.get("present"):
                name = names.get(person.get("userId"), "フレンド")
                if person.get("buildingKey"):
                    occupants.setdefault(person["buildingKey"], []).append(name)
                else:
                    unknown.append(name)
        cols = 3 if self.wide else 2
        cw = (w - 12 * (cols - 1)) // cols
        for offset in range(0, len(BUILDINGS), cols):
            row = BUILDINGS[offset:offset + cols]
            h = max(66, 45 + max(len(occupants.get(key, [])) for key, _ in row) * 17)
            for n, (key, label) in enumerate(row):
                xx, people = x + n * (cw + 12), occupants.get(key, [])
                self.card(xx, y, cw, h, GREEN_TINT if people else WHITE)
                self.text(xx + 10, y + 11, label, GREEN if people else INK)
                pyxel.rect(int(xx + cw - 15), int(y + 11), 4, 4, GREEN if people else LINE)
                if people:
                    for p, name in enumerate(people):
                        self.text(xx + 10, y + 34 + p * 17, self.shorten(name, cw - 20), GREEN)
                else:
                    self.text(xx + 10, y + 35, "表示なし", MUTED)
            y += h + 12
        if unknown:
            y = self.heading(x, y + 8, "在校中・建物は非公開", w=w)
            self.card(x, y, w, 22 + len(unknown) * 19)
            for n, name in enumerate(unknown):
                self.text(x + 12, y + 11 + n * 19, name, MUTED)
            y += 36 + len(unknown) * 19
        return self.button(x, y, w, "在校を更新", "check", disabled=self.state.get("checking"))

    def welcome(self, x, y, w):
        view = self.state.get("view")
        w = min(340, w)
        x = (self.w - w) // 2
        y += 10
        if view == "loading":
            self.campus(x, y, w, 74)
            self.text(x + 14, y + 94, "COKOYOを準備しています…", MUTED)
            return y + 136
        if view == "error":
            self.card(x, y, w, 162)
            self.text(x + 14, y + 15, "接続を確認できません", RED)
            self.text(x + 14, y + 42, self.state.get("error") or "もう一度お試しください", MUTED, w - 28, 4)
            self.button(x + 14, y + 118, w - 28, "もう一度試す", "retry", tone="primary")
            return y + 176
        self.campus(x, y, w, 74)
        y += 94
        self.text(x + 12, y, "友達が、SFCにいる。")
        y += 29
        y += self.text(x + 12, y, "キャンパスのWiFiで、あなたとフレンドの在校を確認。", MUTED, w - 24)
        y += 16
        self.card(x, y, w, 94)
        self.text(x + 12, y + 13, "■ 位置情報は使いません", INK)
        self.text(x + 12, y + 38, "■ 見せる範囲は自分で選ぶ", INK)
        self.text(x + 12, y + 64, "■ 建物はベストフレンドだけ", INK)
        y += 110
        if view == "onboarding":
            self.text(x, y, "はじめに、表示名と端末を登録。", MUTED, w)
            y += 32
            y = self.button(x, y, w, "プロフィールと端末を登録", "onboarding", tone="primary")
        else:
            y = self.button(x, y, w, "Googleでログイン", "login", tone="primary")
        for label, path in [("利用規約", "terms/"), ("プライバシーポリシー", "privacy/")]:
            y = self.button(x, y + 3, w, label, "legal", {"path": path})
        return y + 12

    def chrome(self):
        pyxel.rect(0, 0, self.w, self.top, WHITE)
        pyxel.line(0, self.top - 1, self.w, self.top - 1, LINE)
        for n, letter in enumerate("COKOYO"):
            for row, value in enumerate(WORDMARK[letter]):
                for col in range(5):
                    if value & (1 << (4 - col)):
                        pyxel.rect(14 + n * 12 + col * 2, 14 + row * 2, 2, 2, INK)
        self.text(94, 16, "PYXEL", ORANGE)
        if self.state.get("view") != "app":
            return
        total = str((self.state.get("points") or {}).get("total", 0)) + " pt"
        self.text(self.w - 14 - self.width(total), 16, total, ORANGE)
        tab = self.state.get("tab", "home")
        labels = [("home", "ホーム"), ("friends", "フレンド"), ("settings", "設定")]
        if self.wide:
            pyxel.rect(0, self.top, self.left, self.h - self.top, WHITE)
            pyxel.line(self.left - 1, self.top, self.left - 1, self.h, LINE)
            for n, (key, label) in enumerate(labels):
                yy = 62 + n * 42
                pyxel.rect(10, yy, self.left - 20, 32, TINT if tab == key else WHITE)
                if tab == key:
                    pyxel.rect(10, yy, 3, 32, ORANGE)
                self.text(23, yy + 11, label, ORANGE if tab == key else MUTED)
                self.control(label, "tab", {"tab": key}, 10, yy, self.left - 20, 32)
            self.text(14, self.h - 35, "SFC CAMPUS", MUTED)
        else:
            pyxel.rect(0, self.bottom, self.w, 36, WHITE)
            pyxel.line(0, self.bottom, self.w, self.bottom, LINE)
            for n, (key, label) in enumerate(labels):
                xx, ww = n * self.w // 3, self.w // 3
                if tab == key:
                    pyxel.rect(xx + 14, self.bottom, ww - 28, 2, ORANGE)
                self.text(xx + (ww - self.width(label)) // 2, self.bottom + 14, label, ORANGE if tab == key else MUTED)
                self.control(label, "tab", {"tab": key}, xx, self.bottom + 1, ww, 35)

    def draw(self):
        pyxel.cls(BG)
        self.controls = []
        view = self.state.get("view", "loading")
        left = self.left if view == "app" else 0
        x, y, w = left + 14, self.top + 16 - self.scroll, self.w - left - 32
        self.drawing_body = True
        pyxel.clip(left, self.top, self.w - left, self.bottom - self.top)
        if view != "app":
            end = self.welcome(x, y, w)
        elif self.state.get("mapOpen"):
            end = self.campus_map(x, y, w)
        else:
            end = {"home": self.home, "friends": self.friends, "settings": self.settings}.get(self.state.get("tab"), self.home)(x, y, w)
        pyxel.clip()
        self.drawing_body = False
        self.total = end + self.scroll
        if self.total > self.bottom and view == "app":
            track = self.bottom - self.top - 16
            thumb = max(15, int(track * (self.bottom - self.top) / (self.total - self.top)))
            offset = int((track - thumb) * self.scroll / max(1, self.total - self.bottom + 12))
            pyxel.rect(self.w - 5, self.top + 8, 2, track, LINE)
            pyxel.rect(self.w - 5, self.top + 8 + offset, 2, thumb, MUTED)
        self.chrome()
        toast = self.state.get("toast")
        message = toast.get("message") if isinstance(toast, dict) else toast
        if message:
            tw = min(300, self.w - left - 28)
            tx, ty = left + (self.w - left - tw) // 2, self.bottom - 48
            self.card(tx, ty, tw, 36, INK)
            self.text(tx + 10, ty + 9, message, WHITE, tw - 20, 2)
        frame = {"width": self.w, "height": self.h, "controls": self.controls}
        signature = json.dumps(frame, ensure_ascii=False, sort_keys=True)
        if signature != self.last_frame:
            self.last_frame = signature
            self.emit("frame", frame)


CokoyoUI()
