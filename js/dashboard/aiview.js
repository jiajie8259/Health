// AI 分頁：組出「去識別化資料＋問題」的文字，複製後貼到 Claude（資料不會傳到任何伺服器）
import { el } from "./views.js";
import { buildPrompt, TEMPLATES } from "../export/ai-prompt.js";

export function aiView(ctx) {
  const { model, state, nav } = ctx;
  const root = el("div", { class: "card" });
  root.append(el("h3", {}, "問 Claude（複製去識別化摘要）"),
    el("p", { class: "note" }, "這裡不會連線到任何 AI 服務：只是把去識別化的資料與你的問題組成一段文字，你複製後自行貼到 Claude 對話中。"));
  if (!model.realDates.length) { root.append(el("p", { class: "note" }, "還沒有資料。")); return root; }
  const o = state.ai || (state.ai = { template: "summary", dateMode: "month", scope: "abnormal", question: "", itemCode: null, cur: null });
  if (!o.cur || !model.realDates.includes(o.cur)) o.cur = model.realDates[model.realDates.length - 1];
  const tpl = TEMPLATES.find((t) => t.key === o.template);

  const tsel = el("select", { id: "ai-tpl", "aria-label": "問題範本" }, TEMPLATES.map((t) => el("option", { value: t.key, selected: t.key === o.template }, t.label)));
  tsel.addEventListener("change", () => { o.template = tsel.value; nav.refresh(); });
  root.append(el("div", { class: "row" }, el("label", { for: "ai-tpl", class: "strong" }, "想問什麼"), tsel));

  if (tpl.needsCur) {
    const d = el("select", { id: "ai-cur", "aria-label": "本次檢查日" }, [...model.realDates].reverse().map((x) => el("option", { value: x, selected: x === o.cur }, x)));
    d.addEventListener("change", () => { o.cur = d.value; nav.refresh(); });
    root.append(el("div", { class: "row" }, el("label", { for: "ai-cur", class: "strong" }, "以哪一次為「本次」"), d));
  }
  if (tpl.needsItem) {
    const items = model.dict.items.filter((i) => model.numeric(i.code).length);
    if (!o.itemCode) o.itemCode = items[0]?.code;
    const s = el("select", { id: "ai-item", "aria-label": "項目" }, items.map((i) => el("option", { value: i.code, selected: i.code === o.itemCode }, i.nameZh)));
    s.addEventListener("change", () => { o.itemCode = s.value; nav.refresh(); });
    root.append(el("div", { class: "row" }, el("label", { for: "ai-item", class: "strong" }, "項目"), s));
  }
  const radio = (key, val, text) => el("label", { class: "check" }, el("input", { type: "radio", name: "ai-" + key, value: val, checked: o[key] === val, onchange: () => { o[key] = val; nav.refresh(); } }), " " + text);
  root.append(
    el("div", { class: "label" }, "時間標示"),
    el("div", { class: "checks" }, radio("dateMode", "month", "年-月"), radio("dateMode", "relative", "相對月數（不透露實際日期）")),
    el("div", { class: "label" }, "附上的歷年數據"),
    el("div", { class: "checks" }, radio("scope", "abnormal", "只含曾經異常的項目"), radio("scope", "all", "全部有數值的項目")));

  const q = el("textarea", { id: "ai-q", rows: 3, "aria-label": "補充或自訂問題", placeholder: tpl.key === "custom" ? "寫下你的問題…（請勿輸入姓名、電話等個資）" : "補充說明（選填，例如：最近有在調整飲食）" });
  q.value = o.question;
  q.addEventListener("change", () => { o.question = q.value; nav.refresh(); });
  root.append(el("div", { class: "label" }, tpl.key === "custom" ? "你的問題" : "補充（選填）"), q);

  const res = buildPrompt(model, o);
  if (res.piiHits.length) root.append(el("p", { class: "msg err", role: "alert" }, "偵測到疑似個資樣式（" + res.piiHits.join("、") + "），已停用複製。請移除補充文字中的個資。"));
  const msg = el("span", { class: "msg", role: "status" });
  const copy = el("button", { type: "button", class: "primary", disabled: res.piiHits.length > 0, onclick: async () => {
    try { await navigator.clipboard.writeText(res.text); msg.textContent = "已複製，請到 Claude 貼上送出。"; msg.className = "msg ok"; }
    catch { msg.textContent = "無法自動複製，請在預覽中全選複製。"; msg.className = "msg err"; }
  } }, "複製給 Claude");
  root.append(el("div", { class: "row", style: "margin-top:12px" }, copy, el("span", { class: "note" }, `約 ${res.chars} 字`), msg));
  root.append(el("details", { open: true }, el("summary", {}, "預覽（這就是會被複製的內容）"), el("pre", { class: "preview" }, res.text)));
  root.append(el("p", { class: "note" }, "提醒：貼到雲端 AI 後，內容就在該服務的對話紀錄中。AI 的說明僅供理解參考，不能取代醫師判斷。"));
  return root;
}
