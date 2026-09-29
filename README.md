# EntreBrew Daily

EntreBrew 社員向けの情報共有アプリ。<https://ando1518.github.io/entrebrew-daily/>

- 画面：`index.html`（GitHub Pages で公開）
- ログインとデータ：Firebase（Authentication / Firestore）
- 通知：Firebase Cloud Messaging ＋ GitHub Actions（`.github/workflows/notify.yml`）
- 資料フォルダ：ファイルを軽く変換して Firestore の `folders` / `files`（本体は `files/{id}/chunks` に約700KBずつ）に保存。ルールは非公開の受け取り箱リポジトリで管理

## 通知の仕組み
- 実行：GitHub Actions「通知」（`.github/workflows/notify.yml`）が5分ごとに `scripts/notify.mjs` を実行
- メンション通知：新しい報告・連絡で、本人・所属部署・@全員 がメンションされたら送る（取締役会にはメンションのある報告すべて）
- 朝と夜のまとめ：各端末で選んだ時刻（朝6〜9時・夜17〜22時、オフも可）に、新しい報告・未確認の連絡・タスクなどがあるときだけ送る
- 端末ごとの設定は Firestore の `pushTokens`、処理済みの位置は `system/notify` に保存
- 必要なもの：このリポジトリの Secrets に `FIREBASE_SERVICE_ACCOUNT`（Firebase のサービスアカウント鍵 JSON）、Firestore のルール（完全版は非公開の受け取り箱リポジトリで管理）
- テスト：「Actions」→「通知」→「Run workflow」で email に自分のアドレスを入れる（slot に morning / evening を入れるとまとめも送る）

## 資料フォルダ
- 「資料」タブでフォルダを作成し、ファイルを追加する（だれでも作成可。編集・削除は作った本人か取締役会）
- 報告にファイルを添付できる。本文に「〇〇フォルダに保存」と書くと、そのフォルダが保存先に自動で選ばれる（なければ新しく作る）
- 報告・連絡に貼ったリンク（Googleドライブなど）も、自動でフォルダにリンクとして登録する（指定がなければ「報告・連絡の資料」）
- 添付もリンクもなく「〇〇フォルダに保存」と書いた場合は、報告の本文をテキストファイルとして保存する
- フォルダ画面の「資料を追加」から、ファイルかリンクを追加できる
- 軽くする方法：写真・画像は長い辺2000pxのWebP（使えない端末はJPEG）、テキストやPDFなどは縮む場合だけgzip圧縮。1ファイル15MBまで
