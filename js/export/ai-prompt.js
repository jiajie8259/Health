// 「複製給 Claude」的提示文字組合（純函式）。資料部分一律來自去識別化輸出。
import { buildDeid, toMarkdown, makeLabel, piiCheck } from "./deid.js";
import { CHANGE } from "../dashboard/model.js";

export const TEMPLATES = [
  { key: "summary", label: "這次重點與優先順序", needsCur: true,
    ask: "請根據「本次與前次比較」與歷年資料：\n1. 用白話列出這次最值得優先留意的 3–5 件事，並說明為什麼。\n2. 區分「持續多年的問題」與「這次新出現的變化」。\n3. 哪些項目其實已改善或回到正常，可以放心。\n4. 建議我下次回診前先整理哪些問題。" },
  { key: "doctor", label: "回診前要問醫師的問題", needsCur: true,
    ask: "請幫我整理一份回診提問清單：依優先順序列出我該問醫師的問題（每題一行，並附一句為什麼要問），以及可能需要醫師評估是否追加的檢查。" },
  { key: "item", label: "解讀單一項目的趨勢", needsItem: true,
    ask: "請針對上面標示的項目，解讀多年趨勢（上升、下降、波動），說明可能的常見影響因素（生活型態、其他檢驗值的關聯），以及追蹤的建議頻率。" },
  { key: "lifestyle", label: "生活調整方向", needsCur: true,
    ask: "請依異常項目的關聯性（例如血脂、血糖、肝指數、尿酸、體脂肪彼此的關係），整理出 3–5 個最有效率的生活調整方向（飲食、運動、睡眠等），先做哪個最划算。" },
  { key: "custom", label: "自己寫問題", ask: "" },
];

// 你自己輸入的補充文字另外多掃：姓名自述、電子郵件、地址
const FREE_TEXT = [
  [/(姓名|名字|我叫|本人是?)[：:\s]*[\u4e00-\u9fff]{2,4}/, "姓名自述"],
  [/[\w.+-]+@[\w-]+\.[\w.]+/, "電子郵件"],
  [/[\u4e00-\u9fff]{1,4}[縣市].{0,8}[路街段巷弄].{0,8}號/, "地址"],
];
const INSTRUCTIONS = [
  "你是協助我理解自己健檢數據的助理。以下資料已去除姓名、地址、電話、身分證與醫師資訊；請不要要求我提供這些。",
  "請用繁體中文、白話回答。",
  "你不是醫師，請不要做診斷，也不要建議藥物或劑量；可以說明常見的可能原因與值得追問醫師的方向。",
  "資料中的參考值是「該次報告當時」的標準，各年可能不同；標記「回填」的點是取自下一份報告的「前次」欄。",
  "若資料不足以判斷，請明說，不要猜測。需要就醫評估的情況請直接提醒。",
];

function comparisonSection(model, cur, mode) {
  const label = makeLabel(model.allDates, mode);
  const rows = model.compare(cur).filter((r) => ["new_abn", "worse", "same_abn", "better", "back_normal"].includes(r.change));
  const order = { new_abn: 0, worse: 1, same_abn: 2, better: 3, back_normal: 4 };
  rows.sort((a, b) => order[a.change] - order[b.change]);
  const L = [`## 本次（${label(cur)}）與前次${rows[0]?.prev ? `（${label(rows[0].prev.date)}）` : ""}比較`];
  if (!rows.length) L.push("- 沒有異常或需留意的變化。");
  for (const r of rows) {
    const u = r.item.unit ? ` ${r.item.unit}` : "";
    L.push(`- ${r.item.nameZh}：${r.prev ? r.prev.valueText + u : "（無前次）"} → ${r.cur.valueText}${u}｜${CHANGE[r.change].label}｜本次參考值 ${r.cur.refText || "—"}`);
  }
  const fs = model.findingsStatus(cur).rows;
  if (fs.length) { L.push("", "### 異常發現狀態"); for (const f of fs) L.push(`- ${f.meta.labelZh}（${f.meta.category}）：${f.status}`); }
  return L.join("\n");
}

// opts: template, cur, itemCode, question, dateMode, scope
export function buildPrompt(model, opts = {}) {
  const o = { template: "summary", dateMode: "month", scope: "abnormal", question: "", ...opts };
  const tpl = TEMPLATES.find((t) => t.key === o.template) || TEMPLATES[0];
  const cur = o.cur || model.realDates[model.realDates.length - 1];
  const parts = ["# 角色與規則", INSTRUCTIONS.map((x) => "- " + x).join("\n"), ""];
  let data = o.scope;
  if (tpl.needsItem && o.itemCode) data = "all";
  const deid = buildDeid(model, { dateMode: o.dateMode, scope: data, findings: true });
  if (tpl.needsItem && o.itemCode) {
    const it = model.items.get(o.itemCode);
    parts.push("# 我想了解的項目", `${it?.nameZh || o.itemCode}（請特別針對這項）`, "");
    deid.items.sort((a, b) => (a.code === o.itemCode ? -1 : b.code === o.itemCode ? 1 : 0));
  }
  if (tpl.needsCur) parts.push("# 資料", comparisonSection(model, cur, o.dateMode), "");
  parts.push(tpl.needsCur ? "# 歷年數據" : "# 資料", toMarkdown(deid).replace(/^# .*\n/, ""), "");
  const ask = tpl.key === "custom" ? o.question.trim() : tpl.ask + (o.question.trim() ? "\n補充：" + o.question.trim() : "");
  parts.push("# 我的問題", ask || "（請在此寫下你的問題）");
  const text = parts.join("\n");
  const hits = new Set(piiCheck(text));
  for (const [re, lab] of FREE_TEXT) if (re.test(o.question || "")) hits.add(lab);
  return { text, piiHits: [...hits], chars: text.length };
}
