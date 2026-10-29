import { auth, db } from "./firebase-init.js";
import {
  GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { createAdapter } from "./import/firestore-adapter.js";
import { mountImport } from "./import/import-view.js";
import { mountDashboard } from "./dashboard/dashboard.js";

const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };

function setMsg(el, text, kind) {
  el.textContent = text || "";
  el.className = "msg" + (kind ? " " + kind : "");
}

$("btn-login").addEventListener("click", async () => {
  setMsg($("login-msg"), "");
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    const map = {
      "auth/popup-closed-by-user": "登入視窗被關閉，請再試一次。",
      "auth/popup-blocked": "瀏覽器擋住了登入視窗，請允許此網站的彈出視窗後再試。",
      "auth/unauthorized-domain": "此網域尚未加入 Firebase 的授權網域（Authentication → 設定 → 授權網域）。"
    };
    setMsg($("login-msg"), map[e.code] || ("登入失敗：" + e.code), "err");
  }
});

$("btn-logout").addEventListener("click", () => signOut(auth));

$("btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("uid").textContent);
    setMsg($("copy-msg"), "已複製", "ok");
  } catch {
    setMsg($("copy-msg"), "無法自動複製，請手動選取。", "err");
  }
});

// 讀寫測試：只動 users/{uid}/_system/ping，測完即刪除，不留資料
$("btn-test").addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;
  const out = $("test-msg");
  setMsg(out, "測試中…");
  const ref = doc(db, "users", user.uid, "_system", "ping");
  try {
    await setDoc(ref, { note: "connectivity test", at: serverTimestamp() });
    const snap = await getDoc(ref);
    await deleteDoc(ref);
    if (snap.exists()) {
      setMsg(out, "✔ 寫入、讀取、刪除皆成功：資料庫與安全規則運作正常。", "ok");
    } else {
      setMsg(out, "寫入成功但讀不到資料，請檢查規則。", "err");
    }
  } catch (e) {
    if (e.code === "permission-denied") {
      setMsg(out, "✘ 被安全規則拒絕。若你尚未發布 firestore.rules，這是正常的；請先發布規則再測。", "err");
    } else {
      setMsg(out, "✘ 測試失敗：" + (e.code || e.message), "err");
    }
  }
});

// ---- 儀表板與匯入畫面（登入後才載入）----
let mountedFor = null;
async function mountAppFor(user) {
  if (mountedFor === user.uid) return;
  mountedFor = user.uid;
  const root = $("dash-root");
  try {
    const dict = await (await fetch("./item-dictionary.json", { cache: "no-cache" })).json();
    const sdk = { collection, doc, getDoc, getDocs, setDoc, query, where, writeBatch, serverTimestamp };
    const adapter = createAdapter(sdk, db, user.uid);
    await mountDashboard(root, {
      adapter, dict,
      renderImport: (panel, onWritten) => mountImport(panel, { adapter, dict, onWritten }),
    });
  } catch (e) {
    mountedFor = null;
    root.textContent = "畫面載入失敗：" + (e.message || e);
  }
}

onAuthStateChanged(auth, (user) => {
  show($("view-out"), !user);
  show($("view-in"), !!user);
  if (user) {
    $("uname").textContent = user.displayName || "（未設定名稱）";
    $("uemail").textContent = user.email || "";
    $("uid").textContent = user.uid;
    setMsg($("copy-msg"), "");
    setMsg($("test-msg"), "");
    mountAppFor(user);
  } else {
    mountedFor = null;
    $("dash-root").replaceChildren();
  }
});
