// 匯出分頁：去識別化預覽、複製、下載
import { el } from "./views.js";
import { buildDeid, toMarkdown, toCsv, piiCheck } from "../export/deid.js";

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = el("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportView(ctx) {
  const { model, state, nav } = ctx;
  const root = el("div", { class: "card" });
  root.append(el("h3", {}, "去識別化匯出"),
    el("p", { class: "note" }, "只輸出項目、數值、單位、參考值、判定與時間，以及報告列出的異常發現原文。不含姓名、身分證、地址、電話、健管號碼、醫師、原檔名，也不含你自己寫的建議備註。"));
  if (!model.allDates.length) { root.append(el("p", { class: "note" }, "還沒有資料。")); return root; }
  const o = state.exp || (state.exp = { dateMode: "month", scope: "abnormal", findings: true });
  const radio = (name, val, text) => el("label", { class: "check" }, el("input", { type: "radio", name, value: val, checked: o[name === "dm" ? "dateMode" : "scope"] === val, onchange: () => { o[name === "dm" ? "dateMode" : "scope"] = val; nav.refresh(); } }), " " + text);
  root.append(
    el("div", { class: "label" }, "時間標示"),
    el("div", { class: "checks" }, radio("dm", "month", "年-月（如 2024-06）"), radio("dm", "relative", "相對月數（第0月、第22月…，不透露實際日期）")),
    el("div", { class: "label" }, "範圍"),
    el("div", { class: "checks" }, radio("sc", "abnormal", "只含曾經異常的項目（較短，適合問 AI）"), radio("sc", "all", "全部有數值的項目")),
    el("div", { class: "label" }, "其他"),
    el("label", { class: "check" }, el("input", { type: "checkbox", checked: o.findings, onchange: (e) => { o.findings = e.target.checked; nav.refresh(); } }), " 包含異常發現（影像、超音波、理學檢查）"));
  const d = buildDeid(model, o);
  const md = toMarkdown(d), csv = toCsv(d);
  const hits = piiCheck(md);
  root.append(el("p", { class: "note", style: "margin-top:12px" }, `共 ${d.meta.itemCount} 個項目、${d.meta.findingCount} 則發現、${md.length} 字。`));
  if (hits.length) root.append(el("p", { class: "msg err", role: "alert" }, "偵測到疑似個資樣式（" + hits.join("、") + "），已停用複製與下載。請回報此問題。"));
  const msg = el("span", { class: "msg", role: "status" });
  const copy = el("button", { type: "button", class: "primary", disabled: hits.length > 0, onclick: async () => {
    try { await navigator.clipboard.writeText(md); msg.textContent = "已複製，可貼到 Claude。"; msg.className = "msg ok"; }
    catch { msg.textContent = "無法自動複製，請在下方預覽中全選複製。"; msg.className = "msg err"; }
  } }, "複製文字");
  root.append(el("div", { class: "row" }, copy,
    el("button", { type: "button", disabled: hits.length > 0, onclick: () => download("health-deidentified.csv", csv, "text/csv;charset=utf-8") }, "下載 CSV"),
    el("button", { type: "button", disabled: hits.length > 0, onclick: () => download("health-deidentified.json", JSON.stringify(d, null, 1), "application/json") }, "下載 JSON"), msg));
  root.append(el("details", { open: true }, el("summary", {}, "預覽（這就是會被複製的內容）"), el("pre", { class: "preview" }, md)));
  return root;
}
