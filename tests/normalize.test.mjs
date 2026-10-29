import { parseValue, parseRef, computeFlag } from "../js/parser/normalize.js";
let fail = 0;
const t = (name, got, exp) => { const ok = JSON.stringify(got) === JSON.stringify(exp); if (!ok) { fail++; console.log("FAIL", name, JSON.stringify(got), "!=", JSON.stringify(exp)); } };
const F = (v, r, mode) => computeFlag(parseValue(v), parseRef(r), mode);
// 數值型
t("ALT 邊界", F("35", "5-35"), "N");
t("GGT 偏高", F("122", "8-61"), "H");
t("TC 排除上限", F("227", "< 200"), "H");
t("TG 150 邊界(<150)", F("150", "<150"), "H");
t("HDL 低(>40)", F("40", ">40"), "L");
t("腰圍 <=90", F("90", "<=90"), "N");
t("腰圍 91", F("91", "<=90"), "H");
t("eGFR ≧90", F("94", "≧ 90"), "N");
t("維D 低", F("12.5", "≧30"), "L");
t("BMI 區間含空白", F("21.9", "18.50 - 23.99"), "N");
t("尿比重", F("1.021", "1.003-1.035"), "N");
// 帶比較符號
t("尿膽素原 <1.5 / <1.5", F("<1.5", "<1.5"), "N");
t("尿膽素原 <1.5 / 0.1-1.4", F("<1.5", "0.1 - 1.4"), "NA");
// 序位
t("尿蛋白 +/- / (-)-(+/-)", F("+/-", "(-) - (+/-)"), "N");
t("尿蛋白 +/- / ( - ) - ( ± )", F("+/-", "( - ) - ( ± )"), "N");
t("尿蛋白 + 偏高", F("+", "( - ) - ( ± )"), "H");
t("亞硝酸鹽 - / ( - )", F("-", "( - )"), "N");
t("尿糖 + / ( - ) - ( - )", F("+", "( - ) - ( - )"), "H");
t("微生物 - / - - +/-", F("-", "- - +/-"), "N");
t("微生物 1+ / - - 1+", F("1+", "- - 1+"), "N");
t("微生物 2+ / - - 1+", F("2+", "- - 1+"), "H");
t("尿膽紅素 - / -", F("-", "-"), "N");
// 區間值
t("尿紅血球 0-2 / 0-2", F("0-2", "0-2"), "N");
t("尿紅血球 0-3 / 0-2", F("0-3", "0-2"), "H");
// 陰陽性
t("HBsAg", F("Negative 0.30", "<0.9(-)"), "N");
t("anti-HBs 陽性不判定", F("Positive >1000.00", "<10(-)", "none"), "NA");
t("潛血", F("Negative", "Negative"), "N");
// 是／否
t("聽力 N", F("N", "Y"), "A");
t("聽力 Y", F("Y", "Y"), "N");
// 解析結構
t("pnr 結構", parseValue("Positive >1000.00"), { type: "pnr", polarity: "positive", qualifier: ">", valueNum: 1000, valueText: "Positive >1000.00" });
t("ABI 參考", parseRef("1.0≦ABI≦1.4"), { type: "num", refLow: 1, refHigh: 1.4, refText: "1.0≦ABI≦1.4" });
t("空白", parseValue(""), null);
console.log(fail ? `${fail} 個失敗` : "全部通過");
