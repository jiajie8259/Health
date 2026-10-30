// 去識別化匯出（純函式，可在 Node 測試）
// 白名單：只輸出「項目名稱、數值、單位、該次參考值、判定、日期（或相對時間）」與異常發現的報告原文。
// 不輸出：姓名、身分證、地址、電話、健管號碼、醫師、報告原檔名、你自己寫的建議備註。
import { scanPII } from "../parser/map.js";
import { isAbnormal } from "../dashboard/model.js";

const FLAG = { H: "偏高", L: "偏低", A: "異常", N: "正常", NA: "" };
const MARK = { H: "▲", L: "▼", A: "◆" };

function monthsBetween(a, b) {
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

export function makeLabel(dates, mode) {
  const base = dates[0];
  return (d) => (mode === "relative" ? (d === base ? "第0月" : `第${monthsBetween(base, d)}月`) : d.slice(0, 7));
}

// opts: dateMode 'month'（年-月）| 'relative'（相對第一次檢查的月數）；scope 'all' | 'abnormal'；findings 是否含發現
export function buildDeid(model, opts = {}) {
  const o = { dateMode: "month", scope: "abnormal", findings: true, ...opts };
  const dates = model.allDates;
  const base = dates[0];
  const label = makeLabel(dates, o.dateMode);

  const items = [];
  for (const it of model.dict.items) {
    const pts = model.series.get(it.code);
    if (!pts || !pts.length) continue;
    if (o.scope === "abnormal" && !pts.some((p) => isAbnormal(p.flag))) continue;
    // 純文字（生活習慣、身高體重等無法判定且無異常）不輸出
    if (pts.every((p) => p.flag === "NA") && o.scope === "abnormal") continue;
    items.push({
      code: it.code, name: it.nameZh, section: model.dict.sections[it.sectionKey] || it.sectionKey, unit: it.unit || pts[0].unit || "",
      points: pts.map((p) => ({ when: label(p.date), value: p.valueText, flag: p.flag, ref: p.refText || "", backfill: p.source !== "report" })),
    });
  }
  const findings = [];
  if (o.findings) {
    const mx = model.matrix().filter((r) => !r.normal && !r.quality);
    for (const r of mx) {
      findings.push({
        category: r.category, name: r.labelZh,
        when: dates.filter((d) => r.byDate.has(d)).map(label),
        text: [...r.byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]))[0][1].rawText,
      });
    }
  }
  const whens = [...new Set(dates.map(label))];
  return { meta: { dateMode: o.dateMode, scope: o.scope, periods: whens, itemCount: items.length, findingCount: findings.length }, items, findings };
}

export function toMarkdown(d) {
  const L = [];
  L.push("# 個人健檢趨勢資料（已去識別化）");
  L.push(`時間標示：${d.meta.dateMode === "relative" ? "相對第一次檢查的月數" : "年-月"}；▲偏高 ▼偏低 ◆異常；(回填)＝取自下一份報告的「前次」欄。`);
  L.push("");
  let sec = null;
  for (const it of d.items) {
    if (it.section !== sec) { L.push(`## ${it.section}`); sec = it.section; }
    const cells = it.points.map((p) => `${p.when} ${p.value}${MARK[p.flag] || ""}${p.backfill ? "(回填)" : ""}`);
    const ref = it.points[it.points.length - 1].ref;
    L.push(`- ${it.name}${it.unit ? `（${it.unit}）` : ""}${ref ? `［最近參考值 ${ref}］` : ""}：${cells.join("、")}`);
  }
  if (d.findings.length) {
    L.push("", "## 報告列出的異常發現");
    for (const f of d.findings) L.push(`- [${f.category}] ${f.name}：出現於 ${f.when.join("、")}｜${f.text}`);
  }
  return L.join("\n") + "\n";
}

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function toCsv(d) {
  const rows = [["分類", "項目", "時間", "數值", "單位", "判定", "該次參考值", "是否回填"]];
  for (const it of d.items) for (const p of it.points) rows.push([it.section, it.name, p.when, p.value, it.unit, FLAG[p.flag] || "", p.ref, p.backfill ? "是" : ""]);
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// 最後一道防線：整份輸出再掃一次個資樣式
export function piiCheck(text) {
  const hits = new Set();
  for (const line of text.split("\n")) for (const h of scanPII(line)) hits.add(h);
  return [...hits];
}
