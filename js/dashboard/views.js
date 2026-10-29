// 儀表板各分頁畫面。資料一律以 textContent 輸出，不使用 innerHTML。
import { CHANGE, DEFAULT_WATCHLIST, isAbnormal, summarize, monthsBetween } from "./model.js";
import { lineChart, sparkline, tableView, FLAG_TEXT } from "./chart.js";

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "checked" || k === "disabled" || k === "open" || k === "selected") n[k] = !!v;
    else if (k === "value") n.value = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
}

const TONE_CLASS = { bad: "bad", warn: "warn", good: "ok", ok: "", mute: "" };
const FLAG_ICON = { H: "▲", L: "▼", A: "◆" };

export function changeChip(change) {
  const c = CHANGE[change];
  return el("span", { class: "chip " + TONE_CLASS[c.tone] }, c.icon ? c.icon + " " : "", c.label);
}
function flagChip(flag) {
  if (!isAbnormal(flag)) return flag === "N" ? el("span", { class: "chip ok" }, "正常") : null;
  return el("span", { class: "chip bad" }, FLAG_ICON[flag] + " " + FLAG_TEXT[flag]);
}
const valueOf = (p) => (p ? p.valueText + (p.unit ? " " + p.unit : "") : "—");
const ORDER = { new_abn: 0, worse: 1, same_abn: 2, better: 3, back_normal: 4 };

// 小工具：項目連結按鈕（點了跳到趨勢分頁）
function itemLink(nav, code, text) {
  return el("button", { type: "button", class: "link itemlink", onclick: () => nav.goTrend(code) }, text);
}

// ======================= 總覽 =======================
export function overviewView(ctx) {
  const { model, nav, state, adapter } = ctx;
  const root = el("div", { class: "ov" });
  if (!model.realDates.length) {
    root.append(el("p", { class: "note" }, "還沒有資料。請到「匯入」分頁匯入第一份健檢報告。"));
    return root;
  }
  const cur = state.curDate && model.realDates.includes(state.curDate) ? state.curDate : model.realDates[model.realDates.length - 1];
  state.curDate = cur;
  const rows = model.compare(cur);
  const prevDate = rows.find((r) => r.prev)?.prev.date || null;
  const sum = summarize(rows);

  // 檢查日選擇
  const sel = el("select", { id: "ov-date", "aria-label": "選擇檢查日" },
    [...model.realDates].reverse().map((d) => el("option", { value: d, selected: d === cur }, d)));
  sel.addEventListener("change", () => { state.curDate = sel.value; nav.refresh(); });
  root.append(el("div", { class: "row ov-head" },
    el("label", { for: "ov-date", class: "strong" }, "檢查日"), sel,
    el("span", { class: "note" }, prevDate ? `對照前次 ${prevDate}（相隔約 ${monthsBetween(prevDate, cur)} 個月）` : "沒有更早的資料可對照")));

  // ---- A：這次 vs 前次 ----
  const a = el("section", { class: "card" });
  a.append(el("h3", {}, "這次與前次比較"));
  a.append(el("div", { class: "chips" },
    el("span", { class: "chip" }, `共 ${sum.total} 項有資料`),
    el("span", { class: "chip bad" }, `▲ 異常 ${sum.abnormal} 項`),
    el("span", { class: "chip bad" }, `新增異常 ${sum.new_abn}`),
    el("span", { class: "chip bad" }, `惡化 ${sum.worse}`),
    el("span", { class: "chip ok" }, `改善 ${sum.better}`),
    el("span", { class: "chip ok" }, `✔ 回到正常 ${sum.back_normal}`)));
  const changed = rows.filter((r) => r.change in ORDER)
    .sort((x, y) => ORDER[x.change] - ORDER[y.change]);
  if (!changed.length) a.append(el("p", { class: "note" }, "這次沒有異常或需要特別留意的變化。"));
  else a.append(el("div", { class: "scroll" }, el("table", { class: "tbl" },
    el("thead", {}, el("tr", {}, ["項目", "本次", "前次", "變化", "本次參考值"].map((c) => el("th", {}, c)))),
    el("tbody", {}, changed.map((r) => el("tr", {},
      el("td", {}, itemLink(nav, r.code, r.item.nameZh)),
      el("td", { class: "val" }, valueOf(r.cur), " ", flagChip(r.cur.flag)),
      el("td", { class: "val" }, r.prev ? `${valueOf(r.prev)}（${r.prev.date.slice(0, 7)}）` : "—"),
      el("td", {}, changeChip(r.change)),
      el("td", { class: "note" }, r.cur.refText || "—")))))));
  const normalN = rows.filter((r) => r.change === "normal").length;
  a.append(el("p", { class: "note" }, `其餘 ${normalN} 項為正常；僅有文字說明、無法判定的項目（如身高、生活習慣）未列入此表。`));

  // 異常發現
  const fs = model.findingsStatus(cur);
  a.append(el("h4", {}, "報告列出的異常發現"));
  if (!fs.rows.length) a.append(el("p", { class: "note" }, "這次沒有列出異常發現。"));
  else a.append(el("ul", { class: "flist" }, fs.rows.map((f) => el("li", {},
    el("span", { class: "chip " + (f.status === "新增" ? "bad" : f.status === "持續" ? "warn" : "ok") }, f.status), " ",
    el("span", { class: "strong" }, f.meta.labelZh), el("span", { class: "note" }, `（${f.meta.category}）`),
    f.cur ? el("div", { class: "note" }, f.cur.rawText) : el("div", { class: "note" }, `前次（${fs.prevDate}）：${f.prev.rawText}`)))));
  root.append(a);

  // ---- B：關注指標 ----
  const b = el("section", { class: "card" });
  const wl = state.watchlist.filter((c) => model.numeric(c).length);
  const editBtn = el("button", { type: "button", onclick: () => { state.editWatch = !state.editWatch; nav.refresh(); } }, state.editWatch ? "完成" : "編輯關注指標");
  b.append(el("div", { class: "row", style: "justify-content:space-between;margin-top:0" }, el("h3", {}, "關注指標"), editBtn));
  if (state.editWatch) b.append(watchEditor(ctx));
  const cards = el("div", { class: "wcards" });
  for (const code of wl) {
    const item = model.items.get(code);
    const pts = model.numeric(code).filter((p) => p.date <= cur);
    if (!pts.length) continue;
    const last = pts[pts.length - 1], prev = pts.length > 1 ? pts[pts.length - 2] : null;
    const btn = el("button", { type: "button", class: "wcard", "aria-label": `${item.nameZh}，查看完整趨勢`, onclick: () => nav.goTrend(code) },
      el("div", { class: "w-name" }, item.nameZh),
      el("div", { class: "w-val val" }, last.valueText, el("small", {}, " " + (last.unit || ""))),
      el("div", {}, flagChip(last.flag), " ", el("span", { class: "note" }, last.date.slice(0, 7))),
      sparkline(pts),
      el("div", { class: "note" }, prev ? `前次 ${prev.valueText}（${prev.date.slice(0, 7)}）` : "僅此一筆"));
    cards.append(btn);
  }
  if (!cards.children.length) b.append(el("p", { class: "note" }, "關注清單目前沒有可顯示的項目，可按「編輯關注指標」挑選。"));
  else b.append(cards);
  b.append(el("p", { class: "note" }, "淺色帶為各次報告當時的參考範圍；空心標記表示該點取自下一份報告的「前次」欄。點卡片看完整趨勢。"));
  root.append(b);
  return root;
}

function watchEditor(ctx) {
  const { model, nav, state, adapter } = ctx;
  const wrap = el("div", { class: "watch-edit" });
  const chosen = new Set(state.watchlist);
  const msg = el("p", { class: "msg", role: "status" });
  const bySec = new Map();
  for (const it of model.dict.items) if (model.numeric(it.code).length) {
    if (!bySec.has(it.sectionKey)) bySec.set(it.sectionKey, []);
    bySec.get(it.sectionKey).push(it);
  }
  for (const [sec, its] of bySec) {
    wrap.append(el("div", { class: "label" }, model.dict.sections[sec] || sec));
    wrap.append(el("div", { class: "checks" }, its.map((it) => {
      const id = "wl-" + it.code;
      const cb = el("input", { type: "checkbox", id, checked: chosen.has(it.code) });
      cb.addEventListener("change", () => { cb.checked ? chosen.add(it.code) : chosen.delete(it.code); });
      return el("label", { class: "check", for: id }, cb, " " + it.nameZh);
    })));
  }
  const save = el("button", { type: "button", class: "primary", onclick: async () => {
    const codes = model.dict.items.map((i) => i.code).filter((c) => chosen.has(c));
    state.watchlist = codes;
    try { await adapter.saveWatchlist(codes); msg.textContent = "已儲存。"; msg.className = "msg ok"; nav.refresh(); }
    catch (e) { msg.textContent = "儲存失敗：" + (e.code || e.message); msg.className = "msg err"; }
  } }, "儲存關注清單");
  const reset = el("button", { type: "button", onclick: () => { state.watchlist = [...DEFAULT_WATCHLIST]; nav.refresh(); } }, "改回預設（尚未儲存）");
  wrap.append(el("div", { class: "row" }, save, reset), msg);
  return wrap;
}

// ======================= 趨勢 =======================
export function trendsView(ctx) {
  const { model, nav, state } = ctx;
  const root = el("div", { class: "card" });
  const withData = model.dict.items.filter((i) => model.series.has(i.code) && i.chartable !== false);
  if (!withData.length) { root.append(el("p", { class: "note" }, "還沒有資料。")); return root; }
  if (!state.trendCode || !model.series.has(state.trendCode)) state.trendCode = withData.find((i) => model.numeric(i.code).length)?.code || withData[0].code;
  const sel = el("select", { id: "tr-item", "aria-label": "選擇項目" });
  const bySec = new Map();
  for (const it of withData) { if (!bySec.has(it.sectionKey)) bySec.set(it.sectionKey, []); bySec.get(it.sectionKey).push(it); }
  for (const [sec, its] of bySec) sel.append(el("optgroup", { label: model.dict.sections[sec] || sec },
    its.map((it) => el("option", { value: it.code, selected: it.code === state.trendCode }, it.nameZh))));
  sel.addEventListener("change", () => { state.trendCode = sel.value; nav.refresh(); });
  const item = model.items.get(state.trendCode);
  root.append(el("div", { class: "row" }, el("label", { for: "tr-item", class: "strong" }, "項目"), sel,
    el("span", { class: "note" }, item.nameEn || "")));
  const all = model.series.get(item.code);
  const nums = model.numeric(item.code);
  const last = all[all.length - 1];
  root.append(el("h3", { style: "margin-top:14px" }, item.nameZh,
    el("span", { class: "note" }, `　最新 ${last.date}：`), el("span", { class: "val" }, valueOf(last)), " ", flagChip(last.flag)));
  if (nums.length >= 1 && nums.length === all.length) root.append(lineChart(nums, { unit: item.unit || "", name: item.nameZh }));
  else if (nums.length >= 1) {
    root.append(lineChart(nums, { unit: item.unit || "", name: item.nameZh }));
    root.append(el("p", { class: "note" }, "部分日期的結果為非數值（例如「<0.5」），圖中未繪出，請見下表。"));
    root.append(tableView(all, item.unit || ""));
  } else {
    root.append(el("p", { class: "note" }, "這個項目是文字或分級結果，沒有折線圖，以下為歷次結果。"));
    root.append(el("div", { class: "scroll" }, el("table", { class: "tbl" },
      el("thead", {}, el("tr", {}, ["日期", "結果", "該次參考值", "判定"].map((c) => el("th", {}, c)))),
      el("tbody", {}, [...all].reverse().map((p) => el("tr", {},
        el("td", {}, p.date), el("td", { class: "val" }, valueOf(p)), el("td", {}, p.refText || "—"), el("td", {}, flagChip(p.flag) || "—")))))));
  }
  return root;
}

// ======================= 發現 =======================
export function findingsView(ctx) {
  const { model, state, nav } = ctx;
  const root = el("div", { class: "card" });
  const dates = model.realDates;
  if (!dates.length) { root.append(el("p", { class: "note" }, "還沒有資料。")); return root; }
  const showNormal = !!state.showNormalFindings;
  const toggle = el("label", { class: "check" }, el("input", { type: "checkbox", checked: showNormal, onchange: (e) => { state.showNormalFindings = e.target.checked; nav.refresh(); } }), " 同時顯示「正常／品質備註」類項目");
  root.append(el("h3", {}, "歷年發現時間軸"), el("p", { class: "note" }, "每列是一項影像、超音波、理學檢查等文字發現；● 表示該次報告有列出，— 表示沒有。游標移到 ● 可看原文。"), toggle);
  const mx = model.matrix().filter((r) => showNormal || (!r.normal && !r.quality));
  if (!mx.length) { root.append(el("p", { class: "note" }, "沒有異常發現。")); return root; }
  const t = el("table", { class: "tbl matrix" },
    el("thead", {}, el("tr", {}, el("th", {}, "發現"), dates.map((d) => el("th", {}, d.slice(0, 7))))));
  const tb = el("tbody");
  let lastCat = null;
  for (const r of mx) {
    if (r.category !== lastCat) { tb.append(el("tr", { class: "cat" }, el("th", { colspan: dates.length + 1 }, r.category))); lastCat = r.category; }
    tb.append(el("tr", {}, el("th", { scope: "row" }, r.labelZh),
      dates.map((d) => { const f = r.byDate.get(d); return f
        ? el("td", { class: "hit", title: f.rawText }, "● ", el("span", { class: "visually-hidden" }, "有：" + f.rawText), f.reportStar ? "★" : "")
        : el("td", { class: "miss" }, "—"); })));
  }
  t.append(tb);
  root.append(el("div", { class: "scroll tall" }, t));
  return root;
}

// ======================= 建議 =======================
const STATUSES = ["待處理", "追蹤中", "已完成", "不處理"];
export function recsView(ctx) {
  const { model, state, adapter, nav } = ctx;
  const root = el("div", { class: "card" });
  const dates = [...new Set(model.recs.map((r) => r.examDate))];
  if (!dates.length) { root.append(el("p", { class: "note" }, "還沒有健檢建議資料。")); return root; }
  if (!state.recDate || !dates.includes(state.recDate)) state.recDate = dates[0];
  const sel = el("select", { id: "rec-date", "aria-label": "選擇報告" }, dates.map((d) => el("option", { value: d, selected: d === state.recDate }, d)));
  sel.addEventListener("change", () => { state.recDate = sel.value; nav.refresh(); });
  root.append(el("h3", {}, "健檢建議"), el("div", { class: "row" }, el("label", { for: "rec-date", class: "strong" }, "報告"), sel,
    el("span", { class: "note" }, "「處理狀態」與「備註」是你自己的紀錄，會存進資料庫；重新匯入同一份報告不會蓋掉它們。")));
  const list = model.recs.filter((r) => r.examDate === state.recDate);
  const counts = {}; for (const r of list) counts[r.myStatus || "待處理"] = (counts[r.myStatus || "待處理"] || 0) + 1;
  root.append(el("div", { class: "chips" }, STATUSES.map((s) => el("span", { class: "chip " + (s === "待處理" && counts[s] ? "warn" : "") }, `${s} ${counts[s] || 0}`))));
  for (const r of list) {
    const msg = el("span", { class: "note", role: "status" });
    const save = async (patch) => {
      Object.assign(r, patch);
      msg.textContent = "儲存中…";
      try { await adapter.updateRecommendation(r.id, patch); msg.textContent = "已儲存"; }
      catch (e) { msg.textContent = "儲存失敗：" + (e.code || e.message); }
    };
    const st = el("select", { "aria-label": `第 ${r.no} 項處理狀態` }, STATUSES.map((s) => el("option", { value: s, selected: s === (r.myStatus || "待處理") }, s)));
    st.addEventListener("change", () => save({ myStatus: st.value }));
    const note = el("textarea", { rows: 2, "aria-label": `第 ${r.no} 項備註`, placeholder: "備註（例如：已預約複診）", value: r.myNote || "" });
    note.addEventListener("change", () => save({ myNote: note.value }));
    root.append(el("div", { class: "rec-item" },
      el("div", { class: "rec" }, el("span", { class: "strong" }, r.no + ". "), r.text),
      el("div", { class: "row" }, el("label", { class: "note" }, "狀態 ", st), msg), note));
  }
  return root;
}
