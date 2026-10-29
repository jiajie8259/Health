// 儀表板模型單元測試（全為虛構資料）：node tests/model.test.mjs
import assert from "node:assert/strict";
import { buildModel, classify, summarize } from "../js/dashboard/model.js";
const dict = { sections: { a: "甲" }, items: [
  { code: "x", nameZh: "X", sectionKey: "a" }, { code: "y", nameZh: "Y", sectionKey: "a" }] };
const o = (code, date, v, flag, hi = 10, src = "report") => ({ id: date + "_" + code, itemCode: code, date, source: src, type: "num", valueText: String(v), valueNum: v, refHigh: hi, computedFlag: flag, reportFlag: src === "report" ? "*" : null });
const data = { observations: [
  o("x", "2020-01-01", 12, "H"), o("x", "2021-01-01", 15, "H"), o("x", "2022-01-01", 9, "N"),
  o("y", "2021-01-01", 5, "N"), o("y", "2022-01-01", 11, "H"), o("y", "2019-01-01", 4, "N", 10, "prev_column_backfill")],
  findings: [], reports: [{ examDate: "2020-01-01" }, { examDate: "2021-01-01" }, { examDate: "2022-01-01" }], recommendations: [] };
const m = buildModel(data, dict);
const c21 = Object.fromEntries(m.compare("2021-01-01").map((r) => [r.code, r.change]));
assert.equal(c21.x, "worse"); assert.equal(c21.y, "normal");
const c22 = Object.fromEntries(m.compare("2022-01-01").map((r) => [r.code, r.change]));
assert.equal(c22.x, "back_normal"); assert.equal(c22.y, "new_abn");
assert.equal(classify({ flag: "H", type: "num", valueNum: 12, refHigh: 10 }, { flag: "H", type: "num", valueNum: 12, refHigh: 10 }), "same_abn");
assert.equal(classify({ flag: "NA" }, null), "unknown");
assert.deepEqual(m.series.get("y").map((p) => p.source), ["prev_column_backfill", "report", "report"]);
assert.equal(summarize(m.compare("2022-01-01")).new_abn, 1);
console.log("model tests ok");
