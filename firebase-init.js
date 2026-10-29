// Firebase 初始化（共用模組）
// 注意：這份設定本來就是公開資訊，真正的保護是 firestore.rules 的安全規則。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCR25nwoRIWH5nGFZNxebaYc3v0sVHniT4",
  authDomain: "health-821b2.firebaseapp.com",
  projectId: "health-821b2",
  storageBucket: "health-821b2.firebasestorage.app",
  messagingSenderId: "273473756965",
  appId: "1:273473756965:web:4bd449d8e35c1d274484cc"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
