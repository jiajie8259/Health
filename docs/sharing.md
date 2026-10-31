# 家人唯讀分享（M6）設定與驗證

## 運作方式
- 家人用**自己的 Google 帳號**登入同一個網址；網頁認出「登入者不是擁有者」就進入唯讀檢視（沒有匯入、分享頁，也不能修改）。
- 誰能看，由資料庫裡 `users/<你的UID>/settings/sharing` 的名單決定（`viewerUids`）。你在網頁「分享」頁新增／移除，立即生效，不必再改規則。
- 真正的把關在 `firestore.rules`：家人只有讀取權、沒有寫入權；看不到 `notes`（備註）與 `settings/sharing`。
- 備註存在獨立集合 `notes`；「讓家人看備註」開關寫入 `shareNotes`，由規則讀取判斷（不是只有畫面隱藏）。

## 一次性設定（只做一次）
1. 把 `js/config.js` 裡的 `YOUR_UID` 換成你本人的 UID。
2. 把 `firestore.rules` 裡**兩處** `YOUR_UID` 都換成同一個 UID，到 Firebase 主控台 → Firestore → 規則 → 發布。
3. 重新部署網頁，用你的帳號登入一次。舊版放在建議裡的備註會自動搬到私人區。
4. 到「分享」頁新增家人（需要對方的 UID，見下）。

## 家人怎麼拿到 UID
家人用自己的 Google 帳號開啟網頁並登入，會看到「尚未獲得授權」與他的 UID，按「複製」傳給你。你貼到「分享」頁加入後，他重新整理就能看。

## 在 Rules Playground 驗證（發布規則後建議做）
Firebase 主控台 → Firestore → 規則 → 「規則遊樂場」。路徑格式 `/users/<你的UID>/...`；「驗證者」選已驗證並填 UID。
| 情境 | 路徑 | 動作 | 預期 |
|---|---|---|---|
| 你本人 | `/users/<你的UID>/observations/x` | 讀、寫 | 允許 |
| 名單內家人 | `/users/<你的UID>/observations/x` | 讀 | 允許（需先有 settings/sharing 文件並含其 UID） |
| 名單內家人 | `/users/<你的UID>/observations/x` | 寫 | **拒絕** |
| 名單內家人 | `/users/<你的UID>/settings/sharing` | 讀 | **拒絕** |
| 名單內家人 | `/users/<你的UID>/notes/x` | 讀 | 預設**拒絕**；`shareNotes` 為 true 才允許 |
| 不在名單的帳號 | 任何 `/users/<你的UID>/...` | 讀、寫 | **拒絕** |
