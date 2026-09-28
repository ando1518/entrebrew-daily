# EntreBrew Daily

EntreBrew 社員向けの情報共有アプリ。<https://ando1518.github.io/entrebrew-daily/>

- 画面：`index.html`（GitHub Pages で公開）
- ログインとデータ：Firebase（Authentication / Firestore）
- 毎朝の通知：Firebase Cloud Messaging ＋ GitHub Actions（`.github/workflows/morning-notify.yml`）

## 毎朝の通知の仕組み
1. 社員がアプリ右上のベル →「毎朝の通知」でオンにし、時刻（6〜9時）を選ぶ
2. 端末の通知先が Firestore の `pushTokens` に保存される
3. GitHub Actions が毎朝 5:50〜8:50 に起動し、その時刻を選んだ人へ、その日のタスク・予定・未確認の連絡・TODO・誕生日をまとめて送る

### 初回設定（管理者）
1. Firestore のルールに `firestore-pushTokens.rules` の内容を追加して公開
2. Firebase コンソール →「プロジェクトの設定」→「サービス アカウント」→「新しい秘密鍵を生成」で JSON をダウンロード
3. GitHub のこのリポジトリ →「Settings」→「Secrets and variables」→「Actions」→「New repository secret」
   - Name：`FIREBASE_SERVICE_ACCOUNT`
   - Secret：ダウンロードした JSON の中身をすべて貼り付け
4. ダウンロードした JSON ファイルはパソコンから削除する（他の人に渡さない）

### テスト送信
GitHub の「Actions」→「毎朝の通知」→「Run workflow」で、`email` に自分のメールアドレスを入れて実行すると、その人にだけ今すぐ届きます。

### 注意
- iPhone は、Safari で「ホーム画面に追加」したアイコンから開いたときだけ通知をオンにできます（iOS 16.4 以降）
- GitHub の混雑状況により、届く時刻が数分〜数十分ずれることがあります
