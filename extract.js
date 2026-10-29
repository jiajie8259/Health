// 國泰健檢報告 PDF → 版面結構（M2a 第一層）
// 輸入：pages = [{ pageNo, items: [{ s, x, y, w }] }]（pdf.js 文字項目的座標）
// 輸出：依章節整理的 rows（有數值欄位的項目）、blocks（文字型發現）、diagnoses、recommendations
// 白名單原則：頁首（健管號碼）、頁尾頁碼、目錄、檢查說明、醫師與院長簽章、飲食／營養品建議一律不讀入結果。

const SECTION_KEYS = new Map([
  ["總結與建議", "summary"], ["一般檢查", "general"], ["理學檢查", "physical"], ["肺部檢查", "lung"],
  ["心血管及代謝系統", "cardio"], ["消化系統", "digestive"], ["腎臟泌尿系統", "kidney"],
  ["血液系統", "blood"], ["腫瘤標記", "tumor"], ["肌肉骨骼系統", "musculo"],
  ["營養素與礦物質", "nutrient"], ["眼科檢查", "eye"], ["耳鼻喉科檢查", "ent"],
]);

const SHIFT_LR = 42.5;        // 奇偶頁版面左右位移
const STAR = "*";

export const isStar = (f) => f.s.trim() === STAR;

export function parenBalance(s) {
  let n = 0;
  for (const ch of s) {
    if (ch === "(" || ch === "（") n++;
    else if (ch === ")" || ch === "）") n--;
  }
  return n;
}

const CJK = /[㐀-鿿＀-￯，。；：、]/;
export function joinWrapped(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x = a.slice(-1), y = b[0];
  if (CJK.test(x) || CJK.test(y)) return a + b;
  if (a.endsWith("-") || a.endsWith("/")) return a + b;
  return a + " " + b;
}

// ---------- 版面：文字項目 → 行 ----------
function toLines(page) {
  const out = { lines: [], cls: null, rocDate: null };
  const items = page.items.filter((i) => i.s.trim() !== "");
  const kept = [];
  for (const it of items) {
    const t = it.s.trim();
    if (t.startsWith("健管號碼")) continue;                       // 丟棄，連內容都不解析
    const m = t.match(/^檢查日期：(\d{2,3})\.(\d{2})\.(\d{2})$/);
    if (m) {
      out.rocDate = `${+m[1] + 1911}-${m[2]}-${m[3]}`;
      out.cls = it.x < 250 ? "L" : "R";
      continue;
    }
    if (/^\d{1,3}$/.test(t) && it.y < 70) continue;               // 頁碼
    kept.push(it);
  }
  kept.sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of kept) {
    const last = out.lines[out.lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= 1.6) last.frags.push({ s: it.s, x: it.x, w: it.w });
    else out.lines.push({ y: it.y, frags: [{ s: it.s, x: it.x, w: it.w }] });
  }
  for (const l of out.lines) {
    l.frags.sort((a, b) => a.x - b.x);
    l.text = l.frags.map((f) => f.s).join(" ").replace(/\s+/g, " ").trim();
  }
  return out;
}

function rocToIso(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function shiftAnchors(a, fromCls, toCls) {
  if (!fromCls || !toCls || fromCls === toCls) return a;
  const d = toCls === "L" ? -SHIFT_LR : SHIFT_LR;
  return { ...a, nameX: a.nameX + d, curVal: a.curVal + d, curRef: a.curRef + d, prevVal: a.prevVal + d, prevRef: a.prevRef + d, unit: a.unit + d };
}

function readTableHeader(line) {
  const f = line.frags;
  const item = f.find((x) => /^檢查項目/.test(x.s));
  if (!item) return null;
  const dates = f.filter((x) => /^\d{8}$/.test(x.s.trim())).sort((a, b) => a.x - b.x);
  if (!dates.length) return null;
  const refs = f.filter((x) => /^參考值/.test(x.s)).sort((a, b) => a.x - b.x);
  const unit = f.find((x) => /^單位/.test(x.s));
  const curVal = dates[0].x;
  const prevVal = dates[1] ? dates[1].x : curVal + 143.8;
  const curRef = refs[0] ? refs[0].x : curVal + 75.7;
  const prevRef = refs[1] ? refs[1].x : prevVal + 75.6;
  return {
    nameX: item.x, curVal, curRef, prevVal, prevRef,
    unit: unit ? unit.x : prevRef + 68.1,
    curDate: rocToIso(dates[0].s.trim()),
    prevDate: dates[1] ? rocToIso(dates[1].s.trim()) : null,
    hasRefCols: refs.length > 0,
  };
}

// ---------- 主流程 ----------
export function extractReport(pages) {
  const rep = { sections: {}, order: [], recommendations: [], headerDates: [], warnings: [] };
  let sec = null;
  let mode = null;                 // 'summary' | 'body' | 'comments' | 'diag' | 'skip'
  let base = null, baseCls = null; // 目前欄位座標與其所屬版面類型
  const summaryLines = [];

  for (const page of pages) {
    const L = toLines(page);
    if (L.rocDate && !rep.headerDates.includes(L.rocDate)) rep.headerDates.push(L.rocDate);
    for (const ln of L.lines) {
      if (/\.{6,}/.test(ln.text)) continue;                      // 目錄

      // 章節標題
      if (ln.frags.length === 1) {
        const m = ln.text.match(/^(\d{1,2})\.\s*([^(（]+?)\s*[(（]/);
        if (m && SECTION_KEYS.has(m[2].trim())) {
          const key = SECTION_KEYS.get(m[2].trim());
          sec = { key, title: m[2].trim(), titleLine: ln.text, atoms: [], diag: [], rows: [], blocks: [], page: page.pageNo, dates: null };
          rep.sections[key] = sec; rep.order.push(key);
          mode = key === "summary" ? "summary" : "body";
          base = null;
          continue;
        }
      }
      if (!sec) continue;                                          // 第一個章節之前的內容一律不讀

      if (mode === "summary") {
        if (/以上綜合診斷建議/.test(ln.text) || /專屬您的|從健檢報告結果分析/.test(ln.text)) { mode = "skip"; continue; }
        summaryLines.push(ln);
        continue;
      }
      if (mode === "skip") continue;

      // 表格標題
      const th = readTableHeader(ln);
      if (th) {
        base = th; baseCls = L.cls;
        if (!sec.dates) sec.dates = { cur: th.curDate, prev: th.prevDate };
        mode = "body";
        continue;
      }
      if (/^檢查說明/.test(ln.text)) { mode = "comments"; continue; }
      if (/^診斷說明/.test(ln.text)) { mode = "diag"; continue; }
      if (mode === "comments") continue;

      if (mode === "diag") {
        const last = sec.diag[sec.diag.length - 1];
        if (last && parenBalance(last.text) > 0) last.text = joinWrapped(last.text, ln.text);
        else sec.diag.push({ text: ln.text, page: page.pageNo });
        continue;
      }

      if (!base) { rep.warnings.push(`p${page.pageNo} ${sec.key}: 無欄位座標，略過「${ln.text.slice(0, 20)}」`); continue; }
      const anchors = shiftAnchors(base, baseCls, L.cls || baseCls);
      sec.atoms.push({ page: page.pageNo, y: ln.y, frags: ln.frags, a: anchors });
    }
  }

  for (const key of rep.order) if (key !== "summary") assemble(rep.sections[key], rep);
  rep.recommendations = parseRecommendations(summaryLines);
  return rep;
}

// ---------- 章節內：atoms → rows / blocks ----------
function assemble(sec, rep) {
  let sub = null;
  let state = null;                 // 'row' | 'block'
  let block = null;
  let row = null;
  const dataFrags = [];
  const rows = [];

  for (const at of sec.atoms) {
    const a = at.a;
    const nonStar = at.frags.filter((f) => !isStar(f));
    if (!nonStar.length) continue;
    const first = nonStar[0];
    const dx = first.x - a.nameX;

    if (state === "block" && dx >= 12) {
      addBlockLine(block, at, a);
      continue;
    }
    if (dx < 12 && first.x < a.curVal - 12) {
      // 名稱區的行：標題／項目名／小節
      const nameFrags = at.frags.filter((f) => f.x < a.curVal - 12);
      const name = nameFrags.map((f) => f.s).join(" ").replace(/\s+/g, " ").trim();
      const dataHere = at.frags.filter((f) => f.x >= a.curVal - 12);

      if (dx < -1) {                                       // 區塊標題
        if (block && parenBalance(block.heading) > 0 && state === "block" && block.lines.length === 0) {
          block.heading = joinWrapped(block.heading, name);
        } else {
          block = { heading: name, sub, cur: [], prev: [], lines: [], page: at.page };
          sec.blocks.push(block); state = "block";
        }
        continue;
      }
      if (dx > 1.5) {                                      // 小節標題（無資料）
        sub = name; state = "row"; continue;
      }
      // 項目名稱（可能折行）
      if (state === "row" && row && parenBalance(row.nameRaw) > 0 && dataHere.length === 0 && Math.abs(row.lastY - at.y) < 20) {
        row.nameRaw = joinWrapped(row.nameRaw, name); row.lastY = at.y; row.yBot = at.y;
      } else {
        row = { nameRaw: name, sub, page: at.page, yTop: at.y, yBot: at.y, lastY: at.y, a, cells: { cur: [], curRef: [], prev: [], prevRef: [], unit: [] }, curStar: false, prevStar: false };
        rows.push(row); state = "row";
      }
      for (const f of dataHere) dataFrags.push({ ...f, y: at.y, page: at.page, a });
      continue;
    }
    // 資料欄位的行
    if (state === "block") { addBlockLine(block, at, a); continue; }
    for (const f of at.frags) dataFrags.push({ ...f, y: at.y, page: at.page, a });
  }

  // 資料欄位歸屬：依垂直距離最近的項目
  for (const f of dataFrags) {
    let best = null, bd = 1e9;
    for (const r of rows) {
      if (r.page !== f.page) continue;
      const d = f.y > r.yTop ? f.y - r.yTop : f.y < r.yBot ? r.yBot - f.y : 0;
      if (d < bd) { bd = d; best = r; }
    }
    if (!best || bd > 12) { rep.warnings.push(`p${f.page} ${sec.key}: 資料「${f.s}」找不到對應項目`); continue; }
    const a = f.a;
    const x = f.x;
    if (isStar(f)) {
      if (x < a.curVal - 2) best.curStar = true; else if (x >= a.prevVal - 12 && x < a.prevVal - 2) best.prevStar = true;
      continue;
    }
    let col;
    if (x < a.curRef - 6) col = "cur";
    else if (x < a.prevVal - 12) col = "curRef";
    else if (x < a.prevRef - 6) col = "prev";
    else if (x < a.unit - 6) col = "prevRef";
    else col = "unit";
    best.cells[col].push({ s: f.s, y: f.y });
  }

  for (const r of rows) {
    const cell = (c) => {
      const arr = r.cells[c].sort((p, q) => q.y - p.y || 0);
      return arr.reduce((acc, p) => joinWrapped(acc, p.s.trim()), "");
    };
    const m = r.nameRaw.match(/^([^(（]*?)\s*[(（](.*)[)）]?\s*$/);
    sec.rows.push({
      nameRaw: r.nameRaw,
      nameZh: (m ? m[1] : r.nameRaw).trim(),
      nameEn: m ? m[2].replace(/[)）]\s*$/, "").trim() : "",
      sub: r.sub, page: r.page,
      cur: cell("cur"), curRef: cell("curRef"), prev: cell("prev"), prevRef: cell("prevRef"), unit: cell("unit"),
      curStar: r.curStar, prevStar: r.prevStar,
    });
  }
  for (const b of sec.blocks) finishBlock(b, sec.key);
  delete sec.atoms;
}

function addBlockLine(block, at, a) {
  const thr = a.prevVal - 50;
  const sides = { cur: [], prev: [] };
  for (const f of at.frags) sides[f.x >= thr ? "prev" : "cur"].push(f);
  for (const side of ["cur", "prev"]) {
    const fr = sides[side];
    if (!fr.length) continue;
    const star = fr.some(isStar);
    const text = fr.filter((f) => !isStar(f)).map((f) => f.s).join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    block.lines.push({ side, y: at.y, star, text });
  }
}

const NEW_ENTRY = /^(\d+\.|[^\s：:]{1,14}[：:]|無)/;
function finishBlock(b, secKey) {
  for (const side of ["cur", "prev"]) {
    const entries = [];
    for (const l of b.lines.filter((x) => x.side === side)) {
      const last = entries[entries.length - 1];
      const cont = last && !l.star && (parenBalance(last.text) > 0 || (secKey === "physical" && !NEW_ENTRY.test(l.text)));
      if (cont) last.text = joinWrapped(last.text, l.text);
      else entries.push({ text: l.text, star: l.star });
    }
    b[side] = entries.filter((e) => !/^主治醫師/.test(e.text));      // 醫師姓名一律丟棄
  }
  delete b.lines;
}

// ---------- 第 1 章：總結與建議 ----------
function parseRecommendations(lines) {
  const recs = [];
  let expected = 1;
  for (const ln of lines) {
    const m = ln.text.match(/^(\d{1,2})\.\s*(.*)$/);
    if (m && +m[1] === expected && ln.frags[0].x < 110) {
      recs.push({ no: expected, text: m[2].trim() });
      expected++;
    } else if (recs.length) {
      const last = recs[recs.length - 1];
      last.text = last.text + "\n" + ln.text;
    }
  }
  return recs;
}
