// 儀表板資料模型（純函式，無 DOM／Firebase 相依，可在 Node 測試）
// 輸入：資料庫讀出的 observations、findings、reports、recommendations 與項目字典
// 輸出：各項目的時間序列、與前次的比較、發現時間軸矩陣

export const DEFAULT_WATCHLIST = [
  "ldl_c", "tc", "fbg", "hba1c", "ggt", "alt", "sbp", "bmi", "vitd", "uric_acid",
];

export const CHANGE = {
  new_abn: { label: "新增異常", tone: "bad", icon: "▲" },
  worse: { label: "惡化", tone: "bad", icon: "▲" },
  same_abn: { label: "持平（仍異常）", tone: "warn", icon: "＝" },
  better: { label: "改善（仍異常）", tone: "good", icon: "▼" },
  back_normal: { label: "回到正常", tone: "good", icon: "✔" },
  normal: { label: "正常", tone: "ok", icon: "" },
  unknown: { label: "無法判定", tone: "mute", icon: "" },
};

export const isAbnormal = (flag) => flag === "H" || flag === "L" || flag === "A";

// 這筆數值偏離參考範圍的程度（0＝在範圍內；越大越偏離）
export function excess(p) {
  if (!isAbnormal(p.flag)) return 0;
  if (p.type === "num" && p.valueNum != null) {
    if (p.flag === "H" && p.refHigh != null) return (p.valueNum - p.refHigh) / (Math.abs(p.refHigh) || 1);
    if (p.flag === "L" && p.refLow != null) return (p.refLow - p.valueNum) / (Math.abs(p.refLow) || 1);
  }
  if (p.type === "ord" && p.level != null && p.refLevelHigh != null) return Math.max(p.level - p.refLevelHigh, 0.01);
  return 1;
}

export function classify(cur, prev) {
  if (cur.flag === "NA" || cur.flag == null) return "unknown";
  const ca = isAbnormal(cur.flag);
  if (!prev || prev.flag === "NA" || prev.flag == null) return ca ? "new_abn" : "normal";
  const pa = isAbnormal(prev.flag);
  if (!ca) return pa ? "back_normal" : "normal";
  if (!pa) return "new_abn";
  const d = excess(cur) - excess(prev);
  if (Math.abs(d) < 0.02) return "same_abn";
  return d > 0 ? "worse" : "better";
}

function toPoint(o) {
  return {
    id: o.id, date: o.date, source: o.source, type: o.type, valueText: o.valueText,
    valueNum: o.valueNum ?? null, qualifier: o.qualifier ?? null, level: o.level ?? null,
    unit: o.unit || "", refText: o.refText || "", refLow: o.refLow ?? null, refHigh: o.refHigh ?? null,
    refLevelHigh: o.refLevelHigh ?? null,
    flag: o.computedFlag || "NA", star: o.reportFlag === "*", page: o.page ?? null,
  };
}

export function buildModel({ observations = [], findings = [], reports = [], recommendations = [] }, dict) {
  const items = new Map(dict.items.map((i) => [i.code, i]));
  const series = new Map();                       // code -> points（依日期排序）
  for (const o of observations) {
    if (!items.has(o.itemCode)) continue;
    if (!series.has(o.itemCode)) series.set(o.itemCode, []);
    series.get(o.itemCode).push(toPoint(o));
  }
  for (const pts of series.values()) pts.sort((a, b) => a.date.localeCompare(b.date));

  const realDates = reports.map((r) => r.examDate).sort();
  const allDates = [...new Set([...observations.map((o) => o.date), ...findings.map((f) => f.date)])].sort();

  const numeric = (code) => (series.get(code) || []).filter((p) => p.type === "num" && p.valueNum != null && !p.qualifier);

  // 與前次比較：前次＝該項目在本次之前、最近一筆有資料的日期
  function compare(curDate) {
    const rows = [];
    for (const [code, pts] of series) {
      const i = pts.findIndex((p) => p.date === curDate);
      if (i < 0) continue;
      const cur = pts[i];
      const prev = i > 0 ? pts[i - 1] : null;
      rows.push({ code, item: items.get(code), cur, prev, change: classify(cur, prev) });
    }
    const order = Object.keys(dict.sections);
    rows.sort((a, b) => order.indexOf(a.item.sectionKey) - order.indexOf(b.item.sectionKey) || dict.items.indexOf(a.item) - dict.items.indexOf(b.item));
    return rows;
  }

  // 發現：每個 key 在各日期的狀態，並與前一份報告比較
  const fByKey = new Map();
  for (const f of findings) {
    if (!fByKey.has(f.key)) fByKey.set(f.key, new Map());
    fByKey.get(f.key).set(f.date, f);
  }
  const labelOf = (key) => [...fByKey.get(key).values()][0];
  function findingsStatus(curDate) {
    const dates = allDates;
    const idx = dates.indexOf(curDate);
    const prevDate = idx > 0 ? dates[idx - 1] : null;
    const out = [];
    for (const [key, byDate] of fByKey) {
      const cur = byDate.get(curDate);
      const prev = prevDate ? byDate.get(prevDate) : null;
      const meta = labelOf(key);
      if (meta.normal || meta.quality) continue;
      if (cur) out.push({ key, meta, cur, prev, status: prev ? "持續" : "新增" });
      else if (prev) out.push({ key, meta, cur: null, prev, status: "本次未列出" });
    }
    return { prevDate, rows: out.sort((a, b) => a.meta.category.localeCompare(b.meta.category)) };
  }
  function matrix() {
    const rows = [];
    for (const [key, byDate] of fByKey) {
      const m = labelOf(key);
      rows.push({ key, category: m.category, labelZh: m.labelZh, normal: m.normal, quality: m.quality, byDate });
    }
    rows.sort((a, b) => a.category.localeCompare(b.category) || a.labelZh.localeCompare(b.labelZh));
    return rows;
  }

  const recs = recommendations.slice().sort((a, b) => b.examDate.localeCompare(a.examDate) || a.no - b.no);
  return { items, series, numeric, compare, findingsStatus, matrix, allDates, realDates, recs, reports, dict };
}

export function summarize(rows) {
  const n = { total: rows.length, abnormal: 0, new_abn: 0, worse: 0, better: 0, back_normal: 0 };
  for (const r of rows) {
    if (isAbnormal(r.cur.flag)) n.abnormal++;
    if (r.change === "new_abn") n.new_abn++;
    if (r.change === "worse") n.worse++;
    if (r.change === "better") n.better++;
    if (r.change === "back_normal") n.back_normal++;
  }
  return n;
}

// 兩個日期相距的月數（顯示用）
export function monthsBetween(a, b) {
  const da = new Date(a), db = new Date(b);
  return Math.round((db - da) / (30.44 * 86400000));
}
