// 圖表（純 SVG，無外部函式庫）
// 設計：單一數列折線 2px、標記 ≥8px 並帶 2px 表面色環；參考範圍以逐次參考值畫成階梯色帶（參考值會逐年變動）；
// 異常以「顏色＋形狀＋文字」三重編碼（▲偏高、▼偏低），不單靠顏色；游標十字線＋提示框；另附表格檢視。
const NS = "http://www.w3.org/2000/svg";
export const FLAG_TEXT = { N: "正常", H: "偏高", L: "偏低", A: "異常", NA: "" };

function s(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}
function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}

const t = (d) => new Date(d + "T00:00:00Z").getTime();
const fmt = (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));

function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const raw = span / Math.max(count - 1, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 1000; v += step) out.push(Math.round(v / step) * step);
  return out;
}

function domain(points) {
  const vals = points.map((p) => p.valueNum);
  for (const p of points) { if (p.refLow != null) vals.push(p.refLow); if (p.refHigh != null) vals.push(p.refHigh); }
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.1;
  const nonNeg = vals.every((v) => v >= 0);          // 全為非負數時，座標軸不往 0 以下延伸
  return [nonNeg ? Math.max(lo - pad, 0) : lo - pad, hi + pad];
}

function markerPath(flag, cx, cy, r) {
  if (flag === "H") return `M${cx},${cy - r - 1} L${cx + r + 1},${cy + r - 1} L${cx - r - 1},${cy + r - 1} Z`;
  if (flag === "L") return `M${cx},${cy + r + 1} L${cx + r + 1},${cy - r + 1} L${cx - r - 1},${cy - r + 1} Z`;
  if (flag === "A") return `M${cx},${cy - r - 1} L${cx + r + 1},${cy} L${cx},${cy + r + 1} L${cx - r - 1},${cy} Z`;
  return null;                                                           // 圓形
}
function marker(p, cx, cy, r = 4.5) {
  const bad = p.flag === "H" || p.flag === "L" || p.flag === "A";
  const color = bad ? "var(--viz-bad)" : "var(--viz-line)";
  const hollow = p.source !== "report";
  const common = { fill: hollow ? "var(--viz-surface)" : color, stroke: hollow ? color : "var(--viz-surface)", "stroke-width": 2 };
  const d = markerPath(p.flag, cx, cy, r);
  return d ? s("path", { d, ...common, "stroke-linejoin": "round" }) : s("circle", { cx, cy, r, ...common });
}

function tipText(p, unit) {
  const lines = [p.date, `${p.valueText}${unit ? " " + unit : ""}${FLAG_TEXT[p.flag] ? "（" + FLAG_TEXT[p.flag] + "）" : ""}`];
  if (p.refText) lines.push("該次參考值 " + p.refText);
  lines.push(p.source === "report" ? "取自該次報告" : "取自下一份報告的「前次」欄");
  return lines;
}

// ---------- 完整折線圖 ----------
export function lineChart(points, { unit = "", name = "" } = {}) {
  const W = 680, H = 300, L = 48, R = 64, T = 18, B = 34;
  const pw = W - L - R, ph = H - T - B;
  const wrap = h("div", { class: "viz" });
  if (!points.length) { wrap.append(h("p", { class: "note" }, "沒有可繪製的數值。")); return wrap; }

  const t0 = t(points[0].date), t1 = t(points[points.length - 1].date);
  const x = (d) => (t1 === t0 ? L + pw / 2 : L + ((t(d) - t0) / (t1 - t0)) * pw);
  const [dmin, dmax] = domain(points);
  const ticks = niceTicks(dmin, dmax, 6);
  const ymin = Math.min(dmin, ticks[0]), ymax = Math.max(dmax, ticks[ticks.length - 1]);
  const y = (v) => T + ph - ((v - ymin) / (ymax - ymin)) * ph;

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": `${name}趨勢圖`, class: "viz-svg" });
  // 格線與 y 軸刻度
  for (const v of ticks) {
    svg.append(s("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "viz-grid" }));
    svg.append(s("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", class: "viz-tick" }, fmt(v)));
  }
  // 參考範圍色帶（逐次參考值，階梯式）
  points.forEach((p, i) => {
    if (p.refLow == null && p.refHigh == null) return;
    const x0 = i === 0 ? L : (x(points[i - 1].date) + x(p.date)) / 2;
    const x1 = i === points.length - 1 ? W - R : (x(p.date) + x(points[i + 1].date)) / 2;
    const top = p.refHigh != null ? y(Math.min(p.refHigh, ymax)) : T;
    const bot = p.refLow != null ? y(Math.max(p.refLow, ymin)) : T + ph;
    if (bot > top) svg.append(s("rect", { x: x0, y: top, width: Math.max(x1 - x0, 0), height: bot - top, class: "viz-band" }));
  });
  const last = points[points.length - 1];
  if (last.refText) svg.append(s("text", { x: L + 6, y: T + 12, class: "viz-bandlabel" }, "淺色帶＝該次參考範圍 " + last.refText));
  // x 軸（各次檢查日）
  svg.append(s("line", { x1: L, x2: W - R, y1: T + ph, y2: T + ph, class: "viz-axis" }));
  points.forEach((p) => svg.append(s("text", { x: x(p.date), y: H - 10, "text-anchor": "middle", class: "viz-tick" }, p.date.slice(0, 7))));
  // 折線
  if (points.length > 1) svg.append(s("path", { d: points.map((p, i) => `${i ? "L" : "M"}${x(p.date)},${y(p.valueNum)}`).join(" "), class: "viz-path" }));
  // 十字線
  const cross = s("line", { y1: T, y2: T + ph, class: "viz-cross", visibility: "hidden" });
  svg.append(cross);
  // 標記
  points.forEach((p) => svg.append(marker(p, x(p.date), y(p.valueNum))));
  // 末端直接標示（只標最新一筆）
  svg.append(s("text", { x: x(last.date) + 11, y: y(last.valueNum) + 4, class: "viz-end" }, fmt(last.valueNum)));
  // 命中區（≥24px）與鍵盤焦點
  const tip = h("div", { class: "viz-tip", role: "status", hidden: true });
  const showAt = (p) => {
    const cx = x(p.date), cy = y(p.valueNum);
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    tip.replaceChildren(...tipText(p, unit).map((l, i) => h("div", { class: i === 1 ? "tip-val" : "tip-line" }, l)));
    tip.hidden = false;
    const box = wrap.getBoundingClientRect();
    const scale = box.width / W;
    const left = Math.min(Math.max(cx * scale + 12, 4), Math.max(box.width - 190, 4));
    tip.style.left = left + "px"; tip.style.top = Math.max(cy * scale - 70, 4) + "px";
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
  points.forEach((p) => {
    const hit = s("circle", { cx: x(p.date), cy: y(p.valueNum), r: 16, fill: "transparent", tabindex: 0, "aria-label": tipText(p, unit).join("，"), class: "viz-hit" });
    hit.addEventListener("pointerenter", () => showAt(p));
    hit.addEventListener("focus", () => showAt(p));
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("blur", hide);
    svg.append(hit);
  });
  wrap.append(svg, tip);
  wrap.append(h("div", { class: "viz-key" },
    h("span", {}, "● 正常"), h("span", {}, "▲ 偏高"), h("span", {}, "▼ 偏低"), h("span", {}, "○ 空心＝取自下一份報告的前次欄")));
  wrap.append(tableView(points, unit));
  return wrap;
}

// ---------- 迷你趨勢圖 ----------
export function sparkline(points, { w = 140, h: hh = 40 } = {}) {
  const svg = s("svg", { viewBox: `0 0 ${w} ${hh}`, class: "viz-spark", role: "img", "aria-label": "多年趨勢" });
  if (!points.length) return svg;
  const pad = 6;
  const t0 = t(points[0].date), t1 = t(points[points.length - 1].date);
  const x = (d) => (t1 === t0 ? w / 2 : pad + ((t(d) - t0) / (t1 - t0)) * (w - 2 * pad - 4));
  const [lo, hi] = domain(points);
  const y = (v) => hh - pad - ((v - lo) / (hi - lo || 1)) * (hh - 2 * pad);
  points.forEach((p, i) => {
    if (p.refLow == null && p.refHigh == null) return;
    const x0 = i === 0 ? 0 : (x(points[i - 1].date) + x(p.date)) / 2;
    const x1 = i === points.length - 1 ? w : (x(p.date) + x(points[i + 1].date)) / 2;
    const top = p.refHigh != null ? y(Math.min(p.refHigh, hi)) : 0;
    const bot = p.refLow != null ? y(Math.max(p.refLow, lo)) : hh;
    if (bot > top) svg.append(s("rect", { x: x0, y: top, width: x1 - x0, height: bot - top, class: "viz-band" }));
  });
  if (points.length > 1) svg.append(s("path", { d: points.map((p, i) => `${i ? "L" : "M"}${x(p.date)},${y(p.valueNum)}`).join(" "), class: "viz-spark-path" }));
  const last = points[points.length - 1];
  svg.append(marker(last, x(last.date), y(last.valueNum), 3.5));
  return svg;
}

// ---------- 表格檢視（圖表的等價文字版） ----------
export function tableView(points, unit = "") {
  return h("details", { class: "viz-table" },
    h("summary", {}, "表格檢視"),
    h("div", { class: "scroll" }, h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, ["日期", "數值", "該次參考值", "判定", "來源"].map((c) => h("th", {}, c)))),
      h("tbody", {}, [...points].reverse().map((p) => h("tr", {},
        h("td", {}, p.date), h("td", {}, p.valueText + (unit ? " " + unit : "")), h("td", {}, p.refText || "—"),
        h("td", {}, (p.star ? "★ " : "") + (FLAG_TEXT[p.flag] || "—")), h("td", {}, p.source === "report" ? "該次報告" : "下一份報告的前次欄")))))));
}
