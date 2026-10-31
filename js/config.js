// 擁有者的 UID（與 firestore.rules 裡的 YOUR_UID 相同）。
// 家人登入時，網頁會改成「唯讀檢視擁有者的資料」。UID 不是密碼，真正的保護在 firestore.rules。
// 尚未填寫（維持 YOUR_UID）時，網頁一律視為本人使用，不啟用家人檢視。
export const OWNER_UID = "Zn6PqtPuUoh5zaz3ynDNMcyKm7N2";
