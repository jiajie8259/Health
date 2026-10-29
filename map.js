// 版面結構 → 可寫入資料庫的文件（M2a 第三層）
// 輸入：extractReport 的結果、項目字典（item-dictionary.json）
// 輸出：observations、findings、diagnoses、recommendations，以及對應不到的項目（unmapped）與警告。
// 不含個資：不產生姓名、出生日期、地址、電話、健管號碼、醫師姓名等欄位。

import { parseValue, parseRef, computeFlag } from "./normalize.js";

export const PARSER_VERSION = "0.1.0";

const nz = (s) => (s || "").replace(/[\s　]+/g, "");
const HAS_CJK = /[㐀-鿿]/;

// ---------- 單位 ----------
function canonUnit(u) {
  let s = (u || "").trim();
  const en = s.match(/\(([^()]*)\)\s*$/);
  if (en && /[㐀-鿿]/.test(s.slice(0, en.index))) s = en[1];   // 「公分(cm)」→ cm
  return s.toLowerCase().replace(/[\s　]/g, "")
    .replace(/㎡/g, "m2").replace(/m\^2|m²/g, "m2").replace(/\^3|³/g, "3").replace(/\^6|⁶/g, "6")
    .replace(/μ/g, "u").replace(/次\/分.*/, "/min").replace(/^\/min$/, "/min");
}

// ---------- 個資掃描 ----------
const PII_PATTERNS = [
  [/[A-Z][12]\d{8}/, "身分證格式"],
  [/09\d{2}[- ]?\d{3}[- ]?\d{3}/, "手機格式"],
  [/\b0\d{1,2}[- ]?\d{6,8}\b/, "電話格式"],
  [/\b00\d{8}\b/, "健管號碼格式"],
  [/醫字第|院長|主治醫師|報告醫師|醫\s*師\s*$/, "醫師或院長資訊"],
];
export function scanPII(str) {
  const hits = [];
  for (const [re, label] of PII_PATTERNS) if (re.test(str || "")) hits.push(label);
  return hits;
}

// ---------- 項目比對 ----------
function buildIndex(dict) {
  const bySec = new Map();
  for (const it of dict.items) {
    if (it.source !== "row") continue;
    const names = new Set([nz(it.match?.name || it.nameZh), ...(it.aliases || []).map(nz)]);
    if (!bySec.has(it.sectionKey)) bySec.set(it.sectionKey, []);
    bySec.get(it.sectionKey).push({ it, names });
  }
  return bySec;
}

function matchRow(index, secKey, row) {
  const cands = (index.get(secKey) || []).filter((c) => c.names.has(nz(row.nameZh)));
  const ok = cands.filter((c) => !c.it.match?.sub || nz(row.sub).includes(nz(c.it.match.sub)));
  if (!ok.length) return null;
  const withSub = ok.filter((c) => c.it.match?.sub);
  return (withSub[0] || ok[0]).it;
}

// ---------- 觀察值 ----------
function makeObs(item, date, valueRaw, refRaw, star, source, srcDate, page, unitRaw, warnings) {
  const val = parseValue(valueRaw);
  if (!val) return null;
  const ref = parseRef(refRaw);
  const flag = computeFlag(val, ref, item.flagMode);
  if (unitRaw && item.unit && canonUnit(unitRaw) !== canonUnit(item.unit)) {
    warnings.push(`單位不同：${item.code} 報告「${unitRaw}」字典「${item.unit}」`);
  }
  const o = {
    id: `${date}_${item.code}`, itemCode: item.code, date, source, sourceReportDate: srcDate, page,
    type: val.type, valueText: val.valueText, unit: item.unit || "",
    reportFlag: source === "report" ? (star ? "*" : "") : null,   // 前次欄無顏色與星號資訊
    computedFlag: flag,
  };
  for (const k of ["valueNum", "qualifier", "valueLow", "valueHigh", "level", "polarity"]) if (val[k] != null) o[k] = val[k];
  if (ref) {
    o.refText = ref.refText;
    for (const k of ["refLow", "refHigh", "refLowEx", "refHighEx", "refLevelLow", "refLevelHigh"]) if (ref[k] != null) o[k] = ref[k];
  }
  return o;
}

// ---------- 發現 ----------
function severityOf(t) {
  if (/極輕|Minimal/i.test(t)) return 1;
  if (/輕度至中度|Mild to Moderate/i.test(t)) return 3;
  if (/輕微|輕度|Mild/i.test(t)) return 2;
  if (/中度|Moderate/i.test(t)) return 4;
  if (/重度|Severe/i.test(t)) return 5;
  return null;
}

function makeFinding(rule, entry, block, date, source, srcDate, page) {
  const t = entry.text;
  const f = {
    id: `${date}_${rule.key}`, key: rule.key, date, category: rule.category, labelZh: rule.labelZh, labelEn: rule.labelEn,
    normal: !!rule.normal, quality: !!rule.quality, rawText: t,
    reportStar: source === "report" ? !!entry.star : null,
    source, sourceReportDate: srcDate, page,
  };
  if (rule.severity) f.severity = severityOf(t);
  if (rule.segments || rule.severity) {
    const segs = [...t.matchAll(/\b([CLT]\d{1,2}(?:-\d{1,2})?)\b/g)].map((m) => m[1]);
    if (segs.length) f.segments = [...new Set(segs)].join(",");
  }
  if (rule.size) { const m = t.match(/(\d+(?:\.\d+)?)\s*(?:cm|公分)/i); if (m) f.sizeCm = Number(m[1]); }
  const g = t.match(/grade\s+([IVX]+)/i); if (g) f.grade = g[1].toUpperCase();
  return f;
}

function matchFinding(dict, block, entry) {
  for (const r of dict.findings) {
    if (r.heading && !nz(block.heading).includes(nz(r.heading))) continue;
    if (new RegExp(r.text).test(entry.text)) return r;
  }
  return null;
}

// ---------- 主流程 ----------
export function mapReport(rep, dict) {
  const out = { report: null, observations: [], findings: [], diagnoses: [], recommendations: [], unmapped: [], warnings: [], piiHits: [] };
  const W = out.warnings;
  const secs = rep.order.filter((k) => k !== "summary").map((k) => rep.sections[k]);

  // 日期：表格標題的日期與頁首民國日期交叉驗證
  const curDates = new Set(secs.map((s) => s.dates?.cur).filter(Boolean));
  const prevDates = new Set(secs.map((s) => s.dates?.prev).filter(Boolean));
  if (curDates.size !== 1) W.push(`各章節的檢查日期不一致：${[...curDates].join(",")}`);
  const examDate = [...curDates][0];
  const prevDate = prevDates.size ? [...prevDates][0] : null;
  if (prevDates.size > 1) W.push(`各章節的前次日期不一致：${[...prevDates].join(",")}`);
  const headerOk = rep.headerDates.length === 1 && rep.headerDates[0] === examDate;
  if (!headerOk) W.push(`頁首日期 ${rep.headerDates.join(",")} 與表格日期 ${examDate} 不符`);
  out.report = { examDate, prevExamDate: prevDate, dateCheck: headerOk, parserVersion: PARSER_VERSION };
  if (!examDate) return out;

  const index = buildIndex(dict);
  const blockItems = dict.items.filter((i) => i.source === "block");
  const consumed = new Set();
  const push = (arr, x) => { if (x) arr.push(x); };

  for (const sec of secs) {
    // 1) 表格列 → observations
    for (const row of sec.rows) {
      const item = matchRow(index, sec.key, row);
      if (!item) { out.unmapped.push({ kind: "row", section: sec.key, name: row.nameRaw, cur: row.cur, prev: row.prev, page: row.page }); continue; }
      push(out.observations, makeObs(item, examDate, row.cur, row.curRef, row.curStar, "report", examDate, row.page, row.unit, W));
      if (prevDate) push(out.observations, makeObs(item, prevDate, row.prev, row.prevRef, false, "prev_column_backfill", examDate, row.page, row.unit, W));
    }

    // 2) 文字區塊
    for (const block of sec.blocks) {
      const entries = { cur: block.cur, prev: block.prev };
      const allEnglish = [...block.cur, ...block.prev].every((e) => !HAS_CJK.test(e.text));

      // 2a) 區塊型項目（生活習慣、脈搏節律、眼科方法、十年風險…）
      const bi = blockItems.find((i) => i.block.section === sec.key && nz(block.heading).includes(nz(i.block.heading)));
      if (bi) {
        consumed.add(block);
        for (const side of ["cur", "prev"]) {
          const date = side === "cur" ? examDate : prevDate;
          if (!date || !entries[side].length) continue;
          const src = side === "cur" ? "report" : "prev_column_backfill";
          const b = bi.block;
          let text;
          if (b.regexNum) {
            const joined = entries[side].map((e) => e.text).join("");
            const m = joined.match(new RegExp(b.regexNum));
            if (!m) continue;                                  // 例如「健康調查表未填寫完整無法計算」
            push(out.observations, makeObs(bi, date, m[1], "", false, src, examDate, block.page, "%", W));
            continue;
          }
          if (b.join) text = entries[side].map((e) => e.text).join("；");
          else text = entries[side].map((e) => e.text).join("；");
          if (b.cut === "paren") text = text.replace(/\s*[(（].*$/, "");
          if (b.strip) text = text.replace(new RegExp(b.strip), "");
          text = text.trim();
          if (!text) continue;
          out.observations.push({
            id: `${date}_${bi.code}`, itemCode: bi.code, date, source: src, sourceReportDate: examDate, page: block.page,
            type: "text", valueText: text, unit: "", reportFlag: null, computedFlag: "NA",
          });
        }
        continue;
      }

      // 2b) 理學檢查：只存異常與非「無」的病史（家族史不存）
      if (sec.key === "physical") {
        consumed.add(block);
        const h = block.heading;
        if (/家族病史/.test(h)) continue;
        const slug = (h.match(/\(([^)]*)\)/)?.[1] || h).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
        for (const side of ["cur", "prev"]) {
          const date = side === "cur" ? examDate : prevDate;
          if (!date) continue;
          const src = side === "cur" ? "report" : "prev_column_backfill";
          if (/既往病史/.test(h)) {
            const abn = entries[side].filter((e) => !/[：:]\s*無\s*$/.test(e.text) && !/^無$/.test(e.text.trim()));
            if (abn.length) out.findings.push({ id: `${date}_history.past_medical`, key: "history.past_medical", date, category: "病史", labelZh: "既往病史", labelEn: "Past Medical History", normal: false, quality: false, rawText: abn.map((e) => e.text).join("；"), reportStar: null, source: src, sourceReportDate: examDate, page: block.page });
          } else {
            let abn = entries[side].filter((e) => !/無異狀/.test(e.text) && !/[：:]\s*無\s*$/.test(e.text));
            const rest = [];
            for (const e of abn) {
              const rule = matchFinding(dict, block, e);
              if (rule) { const f = makeFinding(rule, e, block, date, src, examDate, block.page); if (!out.findings.some((x) => x.id === f.id)) out.findings.push(f); }
              else rest.push(e);
            }
            abn = rest;
            if (abn.length) out.findings.push({ id: `${date}_pe.${slug}`, key: `pe.${slug}`, date, category: "理學檢查", labelZh: h.replace(/\s*[(（].*$/, ""), labelEn: h, normal: false, quality: false, rawText: abn.map((e) => e.text).join("；"), reportStar: null, source: src, sourceReportDate: examDate, page: block.page });
          }
        }
        continue;
      }

      // 2c) 影像、超音波、心電圖等發現（英文清單與中英對照並存時，只採用有中文的那份）
      if (allEnglish) continue;
      for (const side of ["cur", "prev"]) {
        const date = side === "cur" ? examDate : prevDate;
        if (!date) continue;
        const src = side === "cur" ? "report" : "prev_column_backfill";
        for (const e of entries[side]) {
          const rule = matchFinding(dict, block, e);
          if (!rule) { out.unmapped.push({ kind: "finding", section: sec.key, heading: block.heading, text: e.text, side, page: block.page }); continue; }
          const f = makeFinding(rule, e, block, date, src, examDate, block.page);
          const dup = out.findings.find((x) => x.id === f.id);
          if (dup) { dup.rawText += "；" + f.rawText; dup.reportStar = dup.reportStar || f.reportStar; }
          else out.findings.push(f);
        }
      }
    }

    // 3) 診斷說明（僅屬於本次報告）
    for (const d of sec.diag) out.diagnoses.push({ section: sec.key, text: d.text });
  }

  // 4) 總結與建議（不含飲食方向、營養品建議、醫師簽章）
  out.recommendations = rep.recommendations.map((r) => ({ no: r.no, text: r.text }));

  // 5) 個資掃描
  const strings = [
    ...out.findings.map((f) => f.rawText), ...out.diagnoses.map((d) => d.text), ...out.recommendations.map((r) => r.text),
    ...out.observations.map((o) => o.valueText),
  ];
  for (const s of strings) for (const h of scanPII(s)) out.piiHits.push({ label: h, sample: s.slice(0, 30) });
  return out;
}

// ---------- 合併規則（模擬資料庫寫入；M2b 會用同一套規則寫 Firestore） ----------
export function mergeIntoStore(store, mapped) {
  const put = (coll, doc) => {
    const old = store[coll].get(doc.id);
    if (!old) { store[coll].set(doc.id, doc); return; }
    const oldReal = old.source === "report", newReal = doc.source === "report";
    if (newReal) { store[coll].set(doc.id, doc); return; }                      // 正式報告覆蓋回填
    if (oldReal) return;                                                         // 回填不覆蓋正式
    const a = JSON.stringify([old.valueText, old.refText, old.rawText]);
    const b = JSON.stringify([doc.valueText, doc.refText, doc.rawText]);
    if (a !== b) store.conflicts.push({ coll, id: doc.id, a, b });               // 兩份回填不一致
  };
  for (const o of mapped.observations) put("observations", o);
  for (const f of mapped.findings) put("findings", f);
  store.reports.set(mapped.report.examDate, mapped.report);
}
export const newStore = () => ({ observations: new Map(), findings: new Map(), reports: new Map(), conflicts: [] });
