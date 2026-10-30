// 去識別化匯出單元測試（虛構資料）：node tests/deid.test.mjs
import assert from "node:assert/strict";
import { buildModel } from "../js/dashboard/model.js";
import { buildDeid, toMarkdown, toCsv, piiCheck } from "../js/export/deid.js";
const dict = { sections: { a: "甲" }, items: [{ code: "x", nameZh: "X項", sectionKey: "a", unit: "u" }, { code: "n", nameZh: "正常項", sectionKey: "a" }] };
const o = (code, date, v, flag) => ({ id: date + code, itemCode: code, date, source: "report", type: "num", valueText: String(v), valueNum: v, refHigh: 10, refText: "<10", computedFlag: flag, reportFlag: "" });
const m = buildModel({ observations: [o("x", "2020-03-05", 12, "H"), o("x", "2022-07-09", 8, "N"), o("n", "2020-03-05", 1, "N")],
  findings: [{ id: "f", key: "k", date: "2020-03-05", category: "腹部超音波", labelZh: "脂肪肝", normal: false, quality: false, rawText: "輕度脂肪肝", reportStar: true }],
  reports: [{ examDate: "2020-03-05" }, { examDate: "2022-07-09" }], recommendations: [{ id: "r", examDate: "2020-03-05", no: 1, text: "私人建議", myNote: "我的備註ABC", myStatus: "待處理" }] }, dict);
let d = buildDeid(m, { scope: "abnormal", dateMode: "relative" });
assert.deepEqual(d.items.map((i) => i.code), ["x"]);                 // 從未異常的項目不輸出
assert.deepEqual(d.items[0].points.map((p) => p.when), ["第0月", "第28月"]);
let md = toMarkdown(d);
assert.ok(!md.includes("2020") && !md.includes("2022"));             // 相對模式不出現實際日期
assert.ok(md.includes("12▲") && md.includes("脂肪肝"));
assert.ok(!md.includes("我的備註ABC") && !md.includes("私人建議"));   // 不輸出備註與建議
d = buildDeid(m, { scope: "all", dateMode: "month" });
assert.equal(d.items.length, 2);
assert.ok(toMarkdown(d).includes("2020-03"));
assert.ok(toCsv(d).startsWith("﻿分類,項目"));
assert.ok(piiCheck("姓名：王小明\n身分證 A123456789").length > 0);
assert.equal(piiCheck(md).length, 0);
console.log("deid tests ok");
