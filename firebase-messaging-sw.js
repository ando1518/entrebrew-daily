// 毎朝の通知を受け取るためのサービスワーカー（アプリを閉じていても通知を表示する）
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAp7rKbZ6-HquNd31RxhA5E74e7m6CgaeQ",
  authDomain: "entrebrew-daily.firebaseapp.com",
  projectId: "entrebrew-daily",
  storageBucket: "entrebrew-daily.firebasestorage.app",
  messagingSenderId: "230416842077",
  appId: "1:230416842077:web:90944811bc0df38f84bcb4"
});

// 通知の表示とタップ時にアプリを開く動作は、Firebase が自動で行う
firebase.messaging();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
