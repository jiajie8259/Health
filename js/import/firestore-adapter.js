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

    // 讀取儀表板需要的全部資料。備註放在私人區 notes；家人讀不到時（權限不足或未開放）notesVisible 為 false。
    async loadAll() {
      const read = async (name) => {
        const snap = await sdk.getDocs(col(name));
        const out = [];
        snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
        return out;
      };
      const [observations, findings, reports, recommendations] = await Promise.all(
        ["observations", "findings", "reports", "recommendations"].map(read));
      let notes = [], notesVisible = true;
      try { notes = await read("notes"); } catch (e) { if (e.code === "permission-denied") notesVisible = false; else throw e; }
      const byId = new Map(notes.map((n) => [n.id, n.text || ""]));
      for (const r of recommendations) {
        if ("myNote" in r) { r.legacyField = true; if (typeof r.myNote === "string" && r.myNote) r.legacyNote = r.myNote; }   // 舊版欄位，待搬移
        r.hasPrivateNote = byId.has(r.id);
        if (byId.has(r.id)) r.myNote = byId.get(r.id);
        else if (!notesVisible) r.myNote = "";
      }
      return { observations, findings, reports, recommendations, notesVisible };
    },

    // 舊版把備註放在 recommendations 文件裡（家人讀得到）；擁有者載入時一次搬到私人區。回傳搬了幾筆。
    async migrateLegacyNotes(recs) {
      const legacy = recs.filter((r) => r.legacyField);
      if (!legacy.length) return 0;
      const batch = sdk.writeBatch(db);
      for (const r of legacy) {
        if (r.legacyNote && !r.hasPrivateNote) batch.set(ref("notes", r.id), { text: r.legacyNote });
        batch.update(ref("recommendations", r.id), { myNote: sdk.deleteField() });
      }
      await batch.commit();
      for (const r of legacy) { delete r.legacyNote; delete r.legacyField; r.hasPrivateNote = r.hasPrivateNote || !!r.myNote; }
      return legacy.length;
    },

    // 建議的「我的處理狀態」存在 recommendations；「備註」存在私人區 notes
    async updateRecommendation(id, patch) {
      if (patch.myStatus !== undefined) await sdk.setDoc(ref("recommendations", id), { myStatus: patch.myStatus }, { merge: true });
      if (patch.myNote !== undefined) await sdk.setDoc(ref("notes", id), { text: patch.myNote });
    },

    // 分享設定（只有擁有者能讀寫）
    async loadSharing() {
      const d = await sdk.getDoc(ref("settings", "sharing"));
      const v = d.exists() ? d.data() : {};
      return { viewers: Array.isArray(v.viewers) ? v.viewers : [], shareNotes: v.shareNotes === true };
    },
    async saveSharing({ viewers, shareNotes }) {
      const clean = viewers.map((x) => ({ uid: String(x.uid).trim(), label: String(x.label || "").trim() }));
      await sdk.setDoc(ref("settings", "sharing"), { viewerUids: clean.map((x) => x.uid), viewers: clean, shareNotes: !!shareNotes });
    },

    // 個人設定（關注指標清單）
    async loadWatchlist() {
      const d = await sdk.getDoc(ref("settings", "watchlist"));
      return d.exists() && Array.isArray(d.data().codes) ? d.data().codes : null;
    },
    async saveWatchlist(codes) {
      await sdk.setDoc(ref("settings", "watchlist"), { codes: [...codes] });
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
