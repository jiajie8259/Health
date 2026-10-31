// 匯入計畫（純函式，無 Firebase 相依，可在 Node 測試）
// 輸入：map.js 的結果 mapped、資料庫現況 existing
// 輸出：要執行的寫入操作清單 ops
//
// 規則
// 1. 文件 ID 為決定性（日期＋項目代碼），重複匯入同一份不會產生重複資料。
// 2. 正式報告的資料覆蓋同 ID 的回填資料；回填資料不覆蓋正式資料。
// 3. 匯入某日的正式報告時，該日殘留、但新報告裡已不存在的回填資料會被刪除。
// 4. 建議條文重新匯入時只更新條文本身，保留你自己填的處理狀態與備註。

export const TS = { __serverTimestamp: true };

const set = (coll, id, data) => ({ op: "set", coll, id, data });
const update = (coll, id, data) => ({ op: "update", coll, id, data });
const del = (coll, id) => ({ op: "delete", coll, id });

export function planImport(mapped, existing = {}) {
  const ex = {
    reports: existing.reports || new Set(),
    observations: existing.observations || new Map(),
    findings: existing.findings || new Map(),
    recommendations: existing.recommendations || new Map(),
    unmapped: existing.unmapped || new Map(),
  };
  const D = mapped.report.examDate;
  const ops = [];

  // 報告本身
  const real = (a) => a.filter((x) => x.source === "report").length;
  ops.push(set("reports", D, {
    examDate: D,
    prevExamDate: mapped.report.prevExamDate || null,
    parserVersion: mapped.report.parserVersion,
    dateCheck: !!mapped.report.dateCheck,
    diagnoses: mapped.diagnoses.map((d) => ({ section: d.section, text: d.text })),
    counts: {
      observations: real(mapped.observations),
      backfilled: mapped.observations.length - real(mapped.observations),
      findings: real(mapped.findings),
      recommendations: mapped.recommendations.length,
    },
    importedAt: TS,
  }));

  // 觀察值與發現（同一套規則）
  for (const [coll, items] of [["observations", mapped.observations], ["findings", mapped.findings]]) {
    const existing = ex[coll];
    const realIds = new Set();
    for (const doc of items) {
      if (doc.source === "report") { ops.push(set(coll, doc.id, doc)); realIds.add(doc.id); }
      else {
        const old = existing.get(doc.id);
        if (!old || old.source !== "report") ops.push(set(coll, doc.id, doc));      // 回填不覆蓋正式
      }
    }
    for (const [id, old] of existing) {
      if (old.date === D && old.source !== "report" && !realIds.has(id)) ops.push(del(coll, id));
    }
  }

  // 建議條文：保留使用者的處理狀態
  const newRecIds = new Set();
  for (const r of mapped.recommendations) {
    const id = `${D}_${String(r.no).padStart(2, "0")}`;
    newRecIds.add(id);
    if (ex.recommendations.has(id)) ops.push(update("recommendations", id, { text: r.text }));
    else ops.push(set("recommendations", id, { examDate: D, no: r.no, text: r.text, myStatus: "待處理" }));
  }
  for (const id of ex.recommendations.keys()) if (id.startsWith(D + "_") && !newRecIds.has(id)) ops.push(del("recommendations", id));

  // 待對應佇列
  const newU = new Set();
  mapped.unmapped.forEach((u, i) => {
    const id = `${D}_u${String(i + 1).padStart(2, "0")}`;
    newU.add(id);
    ops.push(set("unmapped", id, { ...u, examDate: D, status: "pending" }));
  });
  for (const [id, old] of ex.unmapped) if (id.startsWith(D + "_") && old.status === "pending" && !newU.has(id)) ops.push(del("unmapped", id));

  const byColl = {};
  for (const o of ops) { byColl[o.coll] ??= { set: 0, update: 0, delete: 0 }; byColl[o.coll][o.op]++; }
  return { ops, byColl };
}
