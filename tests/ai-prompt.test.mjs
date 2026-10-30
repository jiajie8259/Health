// AI 提示組合單元測試（虛構資料）：node tests/ai-prompt.test.mjs
import assert from "node:assert/strict";
import { buildModel } from "../js/dashboard/model.js";
import { buildPrompt } from "../js/export/ai-prompt.js";
const dict = { sections: { a: "甲" }, items: [{ code: "x", nameZh: "X項", sectionKey: "a", unit: "u" }] };
const o = (date, v, flag) => ({ id: date + "x", itemCode: "x", date, source: "report", type: "num", valueText: String(v), valueNum: v, refHigh: 10, refText: "<10", computedFlag: flag, reportFlag: "" });
const m = buildModel({ observations: [o("2020-03-05", 8, "N"), o("2022-07-09", 12, "H")], findings: [], reports: [{ examDate: "2020-03-05" }, { examDate: "2022-07-09" }], recommendations: [] }, dict);
let r = buildPrompt(m, { template: "summary", dateMode: "relative" });
assert.ok(r.text.includes("8 u → 12 u｜新增異常"));
assert.ok(!/20\d\d/.test(r.text) && r.piiHits.length === 0);
assert.ok(r.text.includes("# 我的問題"));
r = buildPrompt(m, { template: "item", itemCode: "x" });
assert.ok(r.text.includes("# 我想了解的項目"));
r = buildPrompt(m, { template: "custom", question: "我叫王小明，姓名：王小明" });
assert.ok(r.piiHits.length > 0);
console.log("ai-prompt tests ok");
