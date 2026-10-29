// 匯入計畫的單元測試（全部使用合成資料，不含任何真實健檢內容）
import { planImport } from "../js/import/plan.js";
let fail = 0;
const t = (name, ok) => { if (!ok) { fail++; console.log("FAIL", name); } };

const obs = (date, code, source, v = "1") => ({ id: `${date}_${code}`, itemCode: code, date, source, valueText: v });
const mapped = (D, P, observations, extra = {}) => ({
  report: { examDate: D, prevExamDate: P, parserVersion: "t", dateCheck: true },
  observations, findings: [], diagnoses: [], recommendations: [], unmapped: [], ...extra,
});
const find = (ops, coll, id) => ops.find((o) => o.coll === coll && o.id === id);

// 1) 正式覆蓋回填；回填不覆蓋正式
{
  const m = mapped("2024-01-01", "2023-01-01", [obs("2024-01-01", "a", "report"), obs("2023-01-01", "a", "prev_column_backfill"), obs("2023-01-01", "b", "prev_column_backfill")]);
  const existing = { observations: new Map([["2023-01-01_a", { date: "2023-01-01", source: "report" }]]) };
  const { ops } = planImport(m, existing);
  t("正式資料一律寫入", !!find(ops, "observations", "2024-01-01_a"));
  t("回填不覆蓋已有的正式資料", !find(ops, "observations", "2023-01-01_a"));
  t("回填寫入沒有正式資料的項目", !!find(ops, "observations", "2023-01-01_b"));
}
// 2) 匯入某日正式報告時，刪除該日殘留且已不存在的回填
{
  const m = mapped("2024-01-01", null, [obs("2024-01-01", "a", "report")]);
  const existing = { observations: new Map([["2024-01-01_a", { date: "2024-01-01", source: "prev_column_backfill" }], ["2024-01-01_zzz", { date: "2024-01-01", source: "prev_column_backfill" }]]) };
  const { ops } = planImport(m, existing);
  t("殘留回填被刪除", find(ops, "observations", "2024-01-01_zzz")?.op === "delete");
  t("同 ID 的回填被正式資料覆蓋而非刪除", find(ops, "observations", "2024-01-01_a")?.op === "set");
}
// 3) 建議條文：重新匯入只更新條文，保留處理狀態
{
  const m = mapped("2024-01-01", null, [], { recommendations: [{ no: 1, text: "新文字" }, { no: 2, text: "第二條" }] });
  const existing = { recommendations: new Map([["2024-01-01_01", { myStatus: "已預約" }], ["2024-01-01_09", {}]]) };
  const { ops } = planImport(m, existing);
  const a = find(ops, "recommendations", "2024-01-01_01");
  t("既有條文用 update", a.op === "update" && Object.keys(a.data).join() === "text");
  t("新條文用 set 並帶預設狀態", find(ops, "recommendations", "2024-01-01_02").data.myStatus === "待處理");
  t("已不存在的條文被刪除", find(ops, "recommendations", "2024-01-01_09")?.op === "delete");
}
// 4) 待對應佇列
{
  const m = mapped("2024-01-01", null, [], { unmapped: [{ kind: "row", name: "新項目" }] });
  const existing = { unmapped: new Map([["2024-01-01_u09", { status: "pending" }], ["2024-01-01_u10", { status: "resolved" }]]) };
  const { ops } = planImport(m, existing);
  t("新的待對應項目被寫入", find(ops, "unmapped", "2024-01-01_u01").data.status === "pending");
  t("過期的 pending 被清掉", find(ops, "unmapped", "2024-01-01_u09")?.op === "delete");
  t("已處理的不動", !find(ops, "unmapped", "2024-01-01_u10"));
}
// 5) 報告文件帶計數與時間戳記標記
{
  const { ops } = planImport(mapped("2024-01-01", "2023-01-01", [obs("2024-01-01", "a", "report"), obs("2023-01-01", "a", "prev_column_backfill")]));
  const r = find(ops, "reports", "2024-01-01").data;
  t("計數正確", r.counts.observations === 1 && r.counts.backfilled === 1);
  t("時間戳記為伺服器時間標記", r.importedAt && r.importedAt.__serverTimestamp === true);
}
console.log(fail ? `${fail} 個失敗` : "全部通過");
process.exit(fail ? 1 : 0);
