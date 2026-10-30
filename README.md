# 健檢趨勢觀察

個人健檢報告的趨勢觀察頁。PDF 在瀏覽器本機解析，資料存於受登入保護的 Firestore。

**本 repo 為公開，不得放入任何真實健檢資料（PDF、CSV、截圖、含數值的 JSON）。**
測試請用合成資料。`.gitignore` 已擋住常見資料檔，但提交前仍請自行確認。

## 結構

- `index.html`、`js/app.js`、`js/firebase-init.js` — 前端（GitHub Pages）
- `js/parser/extract.js` — 版面層：以座標把 PDF 文字整理成表格列與文字區塊
- `js/parser/normalize.js` — 數值與參考值正規化、旗標計算
- `js/import/pdf-loader.js` — 瀏覽器端以 pdf.js 讀取 PDF（固定版本 4.10.38，自 jsDelivr 載入）
- `js/import/plan.js` — 匯入計畫（回填與正式資料的合併規則、保留建議處理狀態）
- `js/import/firestore-adapter.js` — Firestore 讀取現況與分批寫入
- `js/import/import-view.js` — 匯入畫面（選檔、確認、檢視原稿頁、寫入）
- `js/parser/map.js` — 對應項目字典、產生 observations／findings、去重與回填合併規則、個資掃描
- `item-dictionary.json` — 項目字典與發現規則（`docs/item-dictionary.md` 為可讀版）
- `tests/*.test.mjs` — 單元測試（全為合成資料），執行：`node tests/normalize.test.mjs`、`node tests/plan.test.mjs`
- `firestore.rules` — 安全規則（在 Firebase Console 手動發布）

## 里程碑

- M0 資料模型與項目字典（完成）
- M1 登入、Firestore 與安全規則（完成）
- M2a 解析核心（完成）
- M2b 瀏覽器 PDF 讀取、確認畫面、寫入 Firestore（完成）
- M3 儀表板（完成）：總覽（這次 vs 前次＋關注指標）、趨勢、發現、建議、匯入分頁
- M4 隱私模式（一鍵遮蔽數值，記住設定）與去識別化匯出（完成）：匯出分頁可複製文字／下載 CSV、JSON
- M5 AI（完成）：「問 AI」分頁，依範本組出去識別化資料＋問題，複製後貼到 Claude（不連線任何 AI 服務）
