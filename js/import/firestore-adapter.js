// Firestore 存取層：讀取資料庫現況、批次寫入。
// sdk 以參數傳入（正式環境傳 Firebase 模組化 SDK 的函式，測試時傳假的實作）。
import { TS } from "./plan.js";

const BATCH_LIMIT = 400;

// Firestore 不接受 undefined；也把 TS 標記換成伺服器時間
function sanitize(data, sdk) {
  if (data === TS) return sdk.serverTimestamp();
  if (Array.isArray(data)) return data.map((x) => sanitize(x, sdk));
  if (data && typeof data === "object") {
    const out = {};
    for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = sanitize(v, sdk);
    return out;
  }
  return data;
}

export function createAdapter(sdk, db, uid) {
  const col = (name) => sdk.collection(db, "users", uid, name);
  const ref = (name, id) => sdk.doc(db, "users", uid, name, id);

  async function byField(name, field, value) {
    const snap = await sdk.getDocs(sdk.query(col(name), sdk.where(field, "==", value)));
    const out = new Map();
    snap.forEach((d) => out.set(d.id, d.data()));
    return out;
  }

  return {
    // 讀取與這份報告相關的現有資料（檢查日與前次日）
    async loadExisting(dates) {
      const ex = { reports: new Set(), observations: new Map(), findings: new Map(), recommendations: new Map(), unmapped: new Map() };
      for (const d of dates.filter(Boolean)) {
        const r = await sdk.getDoc(ref("reports", d));
        if (r.exists()) ex.reports.add(d);
        for (const [name, field] of [["observations", "date"], ["findings", "date"], ["recommendations", "examDate"], ["unmapped", "examDate"]]) {
          for (const [id, data] of await byField(name, field, d)) ex[name].set(id, data);
        }
      }
      return ex;
    },

    async listReports() {
      const snap = await sdk.getDocs(col("reports"));
      const out = [];
      snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
      return out.sort((a, b) => a.examDate.localeCompare(b.examDate));
    },

    // 分批寫入；onProgress(done, total)
    async commit(ops, onProgress) {
      let done = 0;
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const batch = sdk.writeBatch(db);
        for (const o of ops.slice(i, i + BATCH_LIMIT)) {
          const r = ref(o.coll, o.id);
          if (o.op === "set") batch.set(r, sanitize(o.data, sdk));
          else if (o.op === "update") batch.update(r, sanitize(o.data, sdk));
          else if (o.op === "delete") batch.delete(r);
        }
        await batch.commit();
        done = Math.min(i + BATCH_LIMIT, ops.length);
        if (onProgress) onProgress(done, ops.length);
      }
    },
  };
}
