// 分享分頁（只有擁有者看得到）：管理家人唯讀名單與「是否讓家人看備註」
import { el } from "./views.js";

export const MAX_VIEWERS = 2;
const UID_RE = /^[A-Za-z0-9]{20,40}$/;

export function shareView(ctx) {
  const { adapter, state, nav } = ctx;
  const root = el("div", { class: "card" });
  root.append(el("h3", {}, "家人唯讀分享"),
    el("p", { class: "note" }, `最多 ${MAX_VIEWERS} 位。家人用自己的 Google 帳號登入同一個網址，只能「看」，不能匯入、修改或刪除。`));
  const sh = state.sharing;
  if (!sh) { root.append(el("p", { class: "note" }, "讀取中…")); adapter.loadSharing().then((v) => { state.sharing = v; nav.refresh(); }).catch((e) => { root.append(el("p", { class: "msg err" }, "讀取分享設定失敗：" + (e.code || e.message))); }); return root; }

  const msg = el("p", { class: "msg", role: "status" });
  const persist = async (next, okText) => {
    try { await adapter.saveSharing(next); state.sharing = next; msg.textContent = okText; msg.className = "msg ok"; nav.refresh(); }
    catch (e) { msg.textContent = "儲存失敗：" + (e.code || e.message); msg.className = "msg err"; }
  };

  root.append(el("h4", {}, "目前可檢視的家人"));
  if (!sh.viewers.length) root.append(el("p", { class: "note" }, "（尚未開放給任何人）"));
  for (const v of sh.viewers) {
    root.append(el("div", { class: "row viewer-row" },
      el("span", { class: "strong" }, v.label || "（未命名）"), el("code", { class: "uidcode" }, v.uid),
      el("button", { type: "button", onclick: () => persist({ ...sh, viewers: sh.viewers.filter((x) => x.uid !== v.uid) }, "已停止分享給 " + (v.label || v.uid)) }, "移除")));
  }

  if (sh.viewers.length < MAX_VIEWERS) {
    const label = el("input", { type: "text", id: "sh-label", placeholder: "稱呼（例如：媽媽）", maxlength: 20, "aria-label": "家人稱呼" });
    const uid = el("input", { type: "text", id: "sh-uid", placeholder: "貼上家人的 UID", "aria-label": "家人的 UID", autocomplete: "off" });
    root.append(el("h4", {}, "新增家人"),
      el("p", { class: "note" }, "請家人先用自己的 Google 帳號登入此網址；畫面會顯示「尚未獲得授權」與他的 UID，請他複製後傳給你。"),
      el("div", { class: "row" }, label, uid,
        el("button", { type: "button", class: "primary", onclick: () => {
          const u = uid.value.trim();
          if (!UID_RE.test(u)) { msg.textContent = "UID 格式不對（應為 20–40 個英數字）。"; msg.className = "msg err"; return; }
          if (sh.viewers.some((x) => x.uid === u)) { msg.textContent = "這個 UID 已在名單中。"; msg.className = "msg err"; return; }
          if (u === ctx.ownerUid) { msg.textContent = "這是你自己的 UID，不需要加入。"; msg.className = "msg err"; return; }
          persist({ ...sh, viewers: [...sh.viewers, { uid: u, label: label.value.trim() }] }, "已加入。家人重新整理頁面即可看到。");
        } }, "加入")));
  } else root.append(el("p", { class: "note" }, `已達上限 ${MAX_VIEWERS} 位；要新增請先移除一位。`));

  const nb = el("input", { type: "checkbox", id: "sh-notes", checked: sh.shareNotes });
  nb.addEventListener("change", () => persist({ ...sh, shareNotes: nb.checked }, nb.checked ? "家人現在看得到你的備註。" : "家人看不到備註了。"));
  root.append(el("h4", {}, "備註"),
    el("label", { class: "check", for: "sh-notes" }, nb, " 讓家人看到我在「建議」頁寫的備註（預設關閉）"),
    el("p", { class: "note" }, "備註存在獨立的私人區，這個開關由資料庫規則強制執行，不只是畫面隱藏。"));

  root.append(msg,
    el("h4", {}, "家人能看到什麼"),
    el("ul", { class: "flist" },
      el("li", {}, "能看：所有檢驗數值、趨勢、異常發現、健檢建議與你的處理狀態，也能使用隱私模式、匯出與問 AI。"),
      el("li", {}, "不能：匯入、修改任何資料、看分享設定；備註依上面的開關。"),
      el("li", {}, "要停止分享：按「移除」即可，立即生效（家人重新整理後就讀不到）。")),
    el("p", { class: "note" }, "提醒：家人看得到全部項目，沒辦法只開放部分項目。請他們開啟 Google 兩步驟驗證，帳號安全就是資料安全。"));
  return root;
}
