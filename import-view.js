// 匯入畫面：選 PDF → 本機解析 → 整份報告一次確認（強調異常與警告）→ 寫入資料庫
// 資料一律以 textContent 輸出，不使用 innerHTML。
import { openPdf, readPages, renderPage } from "./pdf-loader.js";
import { extractReport } from "../parser/extract.js";
import { mapReport } from "../parser/map.js";
import { planImport } from "./plan.js";

const FLAG_LABEL = { H: "偏高", L: "偏低", A: "異常" };
const SEVERITY = { 1: "極輕度", 2: "輕度", 3: "輕度至中度", 4: "中度", 5: "重度" };

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "checked" || k === "disabled" || k === "open") n[k] = !!v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
}

export function mountImport(root, deps) {
  const { adapter, dict, pdf, onWritten } = { pdf: { openPdf, readPages, renderPage }, ...deps };
  const itemByCode = new Map(dict.items.map((i) => [i.code, i]));
  let entries = [];
  let seq = 0;
  let busy = false;
  let dbReports = [];

  // ---------- 外殼 ----------
  const fileInput = el("input", { type: "file", accept: "application/pdf,.pdf", multiple: true, id: "imp-file", class: "visually-hidden" });
  const pickBtn = el("label", { class: "btn", for: "imp-file" }, "選擇健檢 PDF（可多選）");
  const dbLine = el("div", { class: "chips", "aria-live": "polite" });
  const list = el("div", { class: "imp-list" });
  const status = el("p", { class: "msg", role: "status", "aria-live": "polite" });
  const writeBtn = el("button", { type: "button", class: "primary", disabled: true, onclick: writeAll }, "寫入已確認的報告");
  const dlg = el("dialog", { class: "pagedlg" });
  root.replaceChildren(
    el("p", { class: "note" }, "PDF 只在你的瀏覽器中處理，原檔不會上傳；只有解析後的數值與文字會寫入你的資料庫。姓名、地址、電話、健管號碼與醫師姓名不會被讀取。"),
    el("div", { class: "row" }, fileInput, pickBtn),
    el("div", { class: "label" }, "資料庫目前的報告"), dbLine,
    status, list,
    el("div", { class: "row", style: "margin-top:12px" }, writeBtn),
    dlg,
  );
  fileInput.addEventListener("change", () => { const fs = [...fileInput.files]; fileInput.value = ""; addFiles(fs); });

  function setStatus(t, kind) { status.textContent = t || ""; status.className = "msg" + (kind ? " " + kind : ""); }

  async function refreshDb() {
    try {
      dbReports = await adapter.listReports();
      dbLine.replaceChildren(...(dbReports.length
        ? dbReports.map((r) => el("span", { class: "chip" }, r.examDate, el("small", {}, ` ${r.counts?.observations ?? "?"} 項`)))
        : [el("span", { class: "note" }, "（尚無資料）")]));
    } catch (e) {
      dbLine.replaceChildren(el("span", { class: "note" }, "讀取資料庫失敗：" + (e.code || e.message)));
    }
  }

  // ---------- 讀檔與解析 ----------
  async function addFiles(files) {
    if (busy) return;
    busy = true;
    for (const f of files) {
      const entry = { id: ++seq, fileName: f.name, state: "parsing", confirmed: false };
      entries.push(entry);
      render();
      try {
        setStatus(`解析中：${f.name}`);
        entry.doc = await pdf.openPdf(f);
        const pages = await pdf.readPages(entry.doc);
        const rep = extractReport(pages);
        entry.mapped = mapReport(rep, dict);
        if (!entry.mapped.report?.examDate) throw new Error("看不出這是國泰健檢報告（找不到章節或檢查日期）。");
        entry.existing = await adapter.loadExisting([entry.mapped.report.examDate, entry.mapped.report.prevExamDate]);
        entry.state = "ready";
      } catch (e) {
        entry.state = "error";
        entry.error = e.message || String(e);
      }
      render();
    }
    // 依檢查日排序，並標出重複日期
    entries.sort((a, b) => (a.mapped?.report.examDate || "9").localeCompare(b.mapped?.report.examDate || "9"));
    const seen = new Set();
    for (const e of entries) {
      const d = e.mapped?.report.examDate;
      if (e.state !== "ready" || !d) continue;
      if (seen.has(d)) { e.state = "error"; e.error = "與另一個檔案的檢查日期相同，已略過。"; } else seen.add(d);
    }
    busy = false;
    setStatus(`已解析 ${entries.filter((e) => e.state === "ready").length} 份，請核對後勾選「我已核對」。`);
    render();
  }

  // ---------- 畫面 ----------
  const nameOf = (code) => itemByCode.get(code)?.nameZh || code;

  function attention(e) {
    const m = e.mapped;
    const prevByCode = new Map(m.observations.filter((o) => o.source !== "report").map((o) => [o.itemCode, o]));
    return m.observations
      .filter((o) => o.source === "report" && (o.reportFlag === "*" || ["H", "L", "A"].includes(o.computedFlag)))
      .map((o) => ({ o, prev: prevByCode.get(o.itemCode) }));
  }

  function pageButton(e, page) {
    return el("button", { type: "button", class: "link", onclick: () => showPage(e, page) }, `第 ${page} 頁`);
  }

  function metaOf(f) {
    return [f.severity ? SEVERITY[f.severity] : "", f.segments || "", f.sizeCm ? f.sizeCm + " cm" : "", f.grade ? "第 " + f.grade + " 級" : ""].filter(Boolean).join("、");
  }

  function card(e) {
    if (e.state === "parsing") return el("div", { class: "card" }, `解析中：${e.fileName}…`);
    if (e.state === "error") {
      return el("div", { class: "card err-card" }, el("div", { class: "strong" }, e.fileName), el("p", { class: "msg err" }, e.error),
        el("button", { type: "button", onclick: () => { entries = entries.filter((x) => x !== e); render(); } }, "移除"));
    }
    const m = e.mapped;
    const real = m.observations.filter((o) => o.source === "report");
    const back = m.observations.length - real.length;
    const att = attention(e);
    const abnFindings = m.findings.filter((f) => f.source === "report" && !f.normal && !f.quality);
    const overwrite = e.existing.reports.has(m.report.examDate);
    const blockers = !m.report.dateCheck;

    const chips = el("div", { class: "chips" },
      el("span", { class: "chip" }, `數值 ${real.length}`),
      el("span", { class: "chip" }, `前次欄回填 ${back}`),
      el("span", { class: "chip" }, `發現 ${m.findings.filter((f) => f.source === "report").length}`),
      el("span", { class: "chip" }, `診斷說明 ${m.diagnoses.length}`),
      el("span", { class: "chip" }, `建議 ${m.recommendations.length}`),
      el("span", { class: "chip " + (m.report.dateCheck ? "ok" : "bad") }, m.report.dateCheck ? "日期核對 ✓" : "日期核對不符"),
      el("span", { class: "chip " + (m.unmapped.length ? "bad" : "ok") }, m.unmapped.length ? `無法對應 ${m.unmapped.length}` : "全部項目已對應"),
      m.warnings.length ? el("span", { class: "chip bad" }, `警告 ${m.warnings.length}`) : null,
      m.piiHits.length ? el("span", { class: "chip bad" }, `疑似個資 ${m.piiHits.length}`) : null,
      el("span", { class: "chip " + (overwrite ? "warn" : "") }, overwrite ? "資料庫已有此日期：將覆蓋" : "新增"));

    const attTable = att.length
      ? el("table", { class: "tbl" },
        el("thead", {}, el("tr", {}, ["項目", "數值", "該次參考值", "前次", "判定", "原稿"].map((t) => el("th", {}, t)))),
        el("tbody", {}, att.map(({ o, prev }) => el("tr", {},
          el("td", {}, nameOf(o.itemCode)),
          el("td", {}, `${o.valueText} ${o.unit}`.trim()),
          el("td", {}, o.refText || "—"),
          el("td", {}, prev ? prev.valueText : "—"),
          el("td", {}, (o.reportFlag === "*" ? "★ " : "") + (FLAG_LABEL[o.computedFlag] || "")),
          el("td", {}, pageButton(e, o.page))))))
      : el("p", { class: "note" }, "沒有超出該次參考值的數值。");

    const findingList = abnFindings.length
      ? el("ul", { class: "flist" }, abnFindings.map((f) => el("li", {}, (f.reportStar ? "★ " : "") + f.category + "：" + f.labelZh + (metaOf(f) ? `（${metaOf(f)}）` : ""), " ", pageButton(e, f.page))))
      : el("p", { class: "note" }, "沒有異常發現。");

    const allTable = el("table", { class: "tbl" },
      el("thead", {}, el("tr", {}, ["項目", "數值", "單位", "該次參考值", "旗標", "原稿"].map((t) => el("th", {}, t)))),
      el("tbody", {}, real.map((o) => el("tr", {},
        el("td", {}, nameOf(o.itemCode)),
        el("td", {}, o.valueText.length > 40 ? o.valueText.slice(0, 40) + "…" : o.valueText),
        el("td", {}, o.unit || ""), el("td", {}, o.refText || "—"),
        el("td", {}, (o.reportFlag === "*" ? "★" : "") + (FLAG_LABEL[o.computedFlag] || "")),
        el("td", {}, pageButton(e, o.page))))));

    const issues = [
      ...m.warnings.map((w) => el("li", {}, "警告：" + w)),
      ...m.unmapped.map((u) => el("li", {}, `無法對應（${u.kind === "row" ? "項目" : "發現"}）：${u.name || u.text}${u.cur ? "＝" + u.cur : ""} — 會存入待對應佇列`)),
      ...m.piiHits.map((p) => el("li", {}, `疑似個資（${p.label}）：${p.sample}…`)),
    ];

    const done = e.state === "written";
    return el("div", { class: "card" },
      el("div", { class: "card-head" },
        el("h3", {}, m.report.examDate), el("span", { class: "note" }, `前次 ${m.report.prevExamDate || "—"}　${e.fileName}`)),
      chips,
      issues.length ? el("ul", { class: "issues" }, issues) : null,
      el("h4", {}, "需要留意的數值"), attTable,
      el("h4", {}, "需要留意的發現"), findingList,
      el("details", {}, el("summary", {}, `診斷說明（${m.diagnoses.length}）`), el("ul", {}, m.diagnoses.map((d) => el("li", {}, d.text)))),
      el("details", {}, el("summary", {}, `報告建議（${m.recommendations.length}）`), m.recommendations.map((r) => el("p", { class: "rec" }, `${r.no}. ${r.text}`))),
      el("details", {}, el("summary", {}, `全部 ${real.length} 項數值`), el("div", { class: "scroll" }, allTable)),
      done
        ? el("p", { class: "msg ok" }, "✔ 已寫入資料庫")
        : el("label", { class: "confirm" },
          el("input", { type: "checkbox", checked: e.confirmed, disabled: blockers || busy, onchange: (ev) => { e.confirmed = ev.target.checked; updateWriteBtn(); } }),
          blockers ? " 日期核對不符，無法寫入" : " 我已核對以上內容（異常數值與發現已對照原稿）"));
  }

  function render() {
    list.replaceChildren(...entries.map(card));
    updateWriteBtn();
  }

  function updateWriteBtn() {
    const n = entries.filter((e) => e.state === "ready" && e.confirmed).length;
    writeBtn.disabled = busy || n === 0;
    writeBtn.textContent = n ? `寫入已確認的報告（${n} 份）` : "寫入已確認的報告";
  }

  // ---------- 原稿檢視 ----------
  async function showPage(e, pageNo) {
    const canvas = el("canvas", { class: "pagecv", "aria-label": `原稿第 ${pageNo} 頁` });
    dlg.replaceChildren(
      el("div", { class: "row", style: "justify-content:space-between" }, el("strong", {}, `${e.mapped.report.examDate} 原稿第 ${pageNo} 頁`),
        el("button", { type: "button", onclick: () => dlg.close() }, "關閉")),
      el("div", { class: "scroll" }, canvas));
    dlg.showModal();
    try { await pdf.renderPage(e.doc, pageNo, canvas); } catch (err) { dlg.append(el("p", { class: "msg err" }, "無法顯示原稿：" + err.message)); }
  }

  // ---------- 寫入 ----------
  async function writeAll() {
    const todo = entries.filter((e) => e.state === "ready" && e.confirmed);
    if (!todo.length || busy) return;
    busy = true; render();
    let okCount = 0;
    try {
      for (const e of todo) {
        setStatus(`寫入 ${e.mapped.report.examDate}…`);
        const existing = await adapter.loadExisting([e.mapped.report.examDate, e.mapped.report.prevExamDate]);
        const { ops } = planImport(e.mapped, existing);
        await adapter.commit(ops, (d, t) => setStatus(`寫入 ${e.mapped.report.examDate}：${d}/${t}`));
        e.state = "written";
        okCount++;
        try { e.doc?.destroy?.(); } catch { /* 忽略 */ }
      }
      setStatus(`已寫入 ${okCount} 份報告。`, "ok");
      if (okCount && onWritten) { try { onWritten(); } catch { /* 不影響匯入 */ } }
    } catch (err) {
      setStatus(`寫入失敗（已寫入 ${okCount} 份）：${err.code || err.message}。可再按一次重試，重複寫入是安全的。`, "err");
    } finally {
      busy = false; render(); refreshDb();
    }
  }

  refreshDb();
  render();
  return { refreshDb, get entries() { return entries; } };
}
