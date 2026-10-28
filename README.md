# 健檢趨勢觀察

個人健檢報告的趨勢觀察頁。PDF 在瀏覽器本機解析，資料存於受登入保護的 Firestore。

**本 repo 為公開，不得放入任何真實健檢資料（PDF、CSV、截圖、含數值的 JSON）。**
測試請用合成資料。`.gitignore` 已擋住常見資料檔，但提交前仍請自行確認。

## 結構

- `index.html`、`js/` — 前端（GitHub Pages）
- `firestore.rules` — 安全規則（在 Firebase Console 手動發布）

## 里程碑

- M0 資料模型與項目字典（完成）
- M1 登入、Firestore 與安全規則（本版）
- M2 PDF 解析與確認畫面
- M3 儀表板
- M4 隱私模式與去識別匯出
- M5 AI（複製去識別摘要）
