// 瀏覽器端 PDF 讀取（pdf.js）。PDF 只在本機記憶體中處理，不會上傳。
// 以固定版本載入；測試時可用 globalThis.__PDFJS_BASE__ 改指到本機。
const DEFAULT_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/";

let libPromise = null;
async function getLib() {
  if (!libPromise) {
    libPromise = (async () => {
      const base = globalThis.__PDFJS_BASE__ || DEFAULT_BASE;
      const lib = await import(/* @vite-ignore */ base + "pdf.min.mjs");
      // 跨來源 Worker 不能直接使用，改用 Blob 網址
      const res = await fetch(base + "pdf.worker.min.mjs");
      if (!res.ok) throw new Error("無法載入 PDF 讀取元件（" + res.status + "）");
      const blob = new Blob([await res.text()], { type: "text/javascript" });
      lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
      return lib;
    })();
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

export async function openPdf(file) {
  const lib = await getLib();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({ data }).promise;
  return doc;
}

// 取出每頁的文字項目與座標，供 extract.js 使用
export async function readPages(doc) {
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push({
      pageNo: p,
      items: tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width })),
    });
  }
  return pages;
}

// 把某一頁畫到 canvas（核對原稿用）
export async function renderPage(doc, pageNo, canvas, maxWidth = 760) {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, maxWidth / base.width);
  const vp = page.getViewport({ scale });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
}
