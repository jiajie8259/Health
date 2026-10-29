// 數值與參考值的正規化、旗標計算（M2a 第二層）
// 原則：保留原始文字（valueText / refText），另外存結構化欄位；旗標由數值與「該筆」參考值重新計算。

const ORD_LEVEL = new Map([["-", 0], ["+/-", 0.5], ["±", 0.5], ["+", 1], ["1+", 1], ["2+", 2], ["3+", 3], ["4+", 4]]);

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
const num = (s) => (s === "" || s == null ? null : Number(s));

// 數值欄位（今年／前次）
export function parseValue(raw) {
  const text = clean(raw);
  if (!text) return null;
  let m;
  if ((m = text.match(/^(Negative|Positive)\s*([<>]=?)?\s*(-?\d+(?:\.\d+)?)?$/i))) {
    return { type: "pnr", polarity: m[1].toLowerCase(), qualifier: m[2] || null, valueNum: num(m[3]), valueText: text };
  }
  if ((m = text.match(/^-?\d+(?:\.\d+)?$/))) return { type: "num", qualifier: null, valueNum: Number(text), valueText: text };
  if ((m = text.match(/^([<>]=?|≧|≦|≥|≤)\s*(-?\d+(?:\.\d+)?)$/))) {
    const q = { "≧": ">=", "≥": ">=", "≦": "<=", "≤": "<=" }[m[1]] || m[1];
    return { type: "num", qualifier: q, valueNum: Number(m[2]), valueText: text };
  }
  if ((m = text.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/))) {
    return { type: "range", valueLow: Number(m[1]), valueHigh: Number(m[2]), valueText: text };
  }
  const o = text.replace(/\s+/g, "");
  if (ORD_LEVEL.has(o)) return { type: "ord", level: ORD_LEVEL.get(o), valueText: o === "±" ? "+/-" : o };
  if (/^[YN]$/.test(text)) return { type: "yn", valueText: text };
  return { type: "text", valueText: text };
}

// 參考值欄位
export function parseRef(raw) {
  const text = clean(raw);
  if (!text) return null;
  const t = text.replace(/\s+/g, "");
  let m;
  // 序位型：(-)-(+/-)、(-)、-、- - +/-、- - 1+
  if (/^[-+±()\/\d]+$/.test(t) && /[-+±]/.test(t) && !/^\(?\d/.test(t) && !/^[<>]/.test(t) || /^\(?[-±+]/.test(t)) {
    const groups = [...text.matchAll(/\(\s*([^)]*?)\s*\)/g)].map((g) => g[1].replace(/\s+/g, ""));
    let lo, hi;
    if (groups.length) { lo = groups[0]; hi = groups[groups.length - 1]; }
    else {
      const parts = text.split(/\s+/);
      if (parts.length === 3 && parts[1] === "-") { lo = parts[0]; hi = parts[2]; }
      else { lo = hi = parts[0]; }
    }
    if (ORD_LEVEL.has(lo) && ORD_LEVEL.has(hi)) {
      return { type: "ord", refLevelLow: ORD_LEVEL.get(lo), refLevelHigh: ORD_LEVEL.get(hi), refText: text };
    }
  }
  if ((m = t.match(/^<(\d+(?:\.\d+)?)\(-\)$/))) return { type: "pnr", refHigh: Number(m[1]), refHighEx: true, refText: text, negIfBelow: true };
  if (/^Negative$/i.test(t)) return { type: "pnr", refText: text, expect: "negative" };
  if (/^Y$/i.test(t)) return { type: "yn", expect: "Y", refText: text };
  if ((m = t.match(/^(\d+(?:\.\d+)?)<=?ABI<=?(\d+(?:\.\d+)?)$/i)) || (m = t.match(/^(\d+(?:\.\d+)?)≦ABI≦(\d+(?:\.\d+)?)$/))) {
    return { type: "num", refLow: Number(m[1]), refHigh: Number(m[2]), refText: text };
  }
  if ((m = t.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/))) return { type: "num", refLow: Number(m[1]), refHigh: Number(m[2]), refText: text };
  if ((m = t.match(/^(<=|≦|≤)(\d+(?:\.\d+)?)$/))) return { type: "num", refHigh: Number(m[2]), refHighEx: false, refText: text };
  if ((m = t.match(/^(<)(\d+(?:\.\d+)?)$/))) return { type: "num", refHigh: Number(m[2]), refHighEx: true, refText: text };
  if ((m = t.match(/^(>=|≧|≥)(\d+(?:\.\d+)?)$/))) return { type: "num", refLow: Number(m[2]), refLowEx: false, refText: text };
  if ((m = t.match(/^(>)(\d+(?:\.\d+)?)$/))) return { type: "num", refLow: Number(m[2]), refLowEx: true, refText: text };
  return { type: "text", refText: text };
}

// 旗標：H 偏高、L 偏低、N 正常、A 異常（類別型）、NA 無法判定
export function computeFlag(val, ref, flagMode = "range") {
  if (!val || flagMode === "none") return "NA";
  if (!ref || ref.type === "text") return "NA";
  if (val.type === "num" && ref.type === "num") {
    let v = val.valueNum;
    if (val.qualifier === "<" || val.qualifier === "<=") {
      // 值落在「小於 v」：只有在 v 不超過參考上限時才能確定正常
      if (ref.refHigh != null && v <= ref.refHigh) return "N";
      return "NA";
    }
    if (val.qualifier === ">" || val.qualifier === ">=") {
      if (ref.refLow != null && v >= ref.refLow) return "N";
      return "NA";
    }
    if (ref.refHigh != null && (ref.refHighEx ? v >= ref.refHigh : v > ref.refHigh)) return "H";
    if (ref.refLow != null && (ref.refLowEx ? v <= ref.refLow : v < ref.refLow)) return "L";
    return "N";
  }
  if (val.type === "ord" && ref.type === "ord") {
    if (val.level > ref.refLevelHigh) return "H";
    if (val.level < ref.refLevelLow) return "L";
    return "N";
  }
  if (val.type === "range" && ref.type === "num") {
    if (ref.refHigh != null && val.valueHigh > ref.refHigh) return "H";
    if (ref.refLow != null && val.valueLow < ref.refLow) return "L";
    return "N";
  }
  if (val.type === "pnr" && ref.type === "pnr") {
    if (ref.expect === "negative" || ref.negIfBelow) return val.polarity === "negative" ? "N" : "A";
    return "NA";
  }
  if (val.type === "yn" && ref.type === "yn") return val.valueText === ref.expect ? "N" : "A";
  if (val.type === "range" && ref.type === "range") return "NA";
  return "NA";
}
