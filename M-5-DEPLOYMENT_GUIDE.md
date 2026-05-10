# M-5 デプロイ手順書（中学生でもできる版）

ぼいラボ Discord 自動招待化 + 週次レポート（Firebase Analytics 統合版）を本番に上げる手順です。所要時間は手作業 **約 2 時間**。

---

## 全体像

エイトに必要なのは「6 つの IDを取得する」だけ。あとは僕がコードに流し込みます。

```
A. Discord OAuth Bot 作成 → 5 個の値
B. Discord ロール 14 個作成 → 14 個の値
C. Discord チャンネル 2 個新設 → 2 個の値
D. GA4 プロパティ 4 個作成 → 4 個の値
E. Firebase サービスアカウント鍵 → 1 個の JSON
```

順番にやっていきましょう。

---

## A. Discord OAuth Bot 作成（所要 10 分）

### A-1. アプリ作成
1. https://discord.com/developers/applications を開く
2. 右上 **「New Application」**
3. 名前: `ぼいラボ招待Bot` → Create

### A-2. OAuth2 設定
1. 左メニュー **「OAuth2」**
2. **CLIENT ID**（数字の長い列）→ コピー：`DISCORD_INVITE_BOT_CLIENT_ID`
3. **CLIENT SECRET** の右の **「Reset Secret」** → 表示された文字列をコピー：`DISCORD_INVITE_BOT_CLIENT_SECRET`
4. **「Redirects」** に追加:
   ```
   https://voilab.reverb-lab.com/api/discord-callback
   ```

### A-3. Bot 作成
1. 左メニュー **「Bot」**
2. **「Reset Token」** → 表示された長い文字列をコピー：`DISCORD_INVITE_BOT_TOKEN`
   ⚠️ Token は1回しか表示されない。出たら即コピー。
3. 同じ画面の下のほう、**Privileged Gateway Intents** で **SERVER MEMBERS INTENT** を ON
4. **「Save Changes」**

### A-4. Bot をぼいラボに参加させる
1. 左メニュー **「OAuth2」** → **URL Generator**
2. SCOPES: `bot` + `applications.commands` をチェック
3. BOT PERMISSIONS: `Create Instant Invite` + `Manage Roles` をチェック
4. 下に出る URL をコピー → ブラウザで開く
5. ぼいラボサーバーを選択 → 認証

### A-5. ぼいラボ Guild ID
1. Discord アプリ → 設定 → 詳細設定 → **「開発者モード」** ON
2. ぼいラボのサーバーアイコンを **右クリック** → **「サーバー ID をコピー」**：`VOILAB_GUILD_ID`

---

## B. Discord ロール 13 個作成（所要 25 分）

ぼいラボのサーバー設定 → **ロール** から 13 個作成。**下から順に作ると並び順が綺麗**。

⚠️「VoiPoke 先行登録済」は **既存の `アーリーアクセス` ロールと統合**しました。新規作成不要。`EARLY_ACCESS_ROLE_ID` をそのまま流用します。

| # | ロール名 | 表示色 | 環境変数名 |
|---|---|---|---|
| 1 | `声活ユーザー` | 緑 `#27AE60` | `DISCORD_ROLE_VOICEUSER` |
| 2 | `声優志望` | 鮮緑 `#2ECC71` | `DISCORD_ROLE_VOISEIYU_KIBOU` |
| 3 | `診断完了` | 青緑 `#16A085` | `DISCORD_ROLE_DIAGNOSED` |
| 4 | `黄金タイプ` | 黄金 `#C9A961` | `DISCORD_ROLE_COLOR_KOGANE` |
| 5 | `常磐タイプ` | 深緑 `#0F4C3A` | `DISCORD_ROLE_COLOR_TOKIWA` |
| 6 | `水タイプ` | 水色 `#7DC4D9` | `DISCORD_ROLE_COLOR_MIZU` |
| 7 | `牡丹タイプ` | 牡丹 `#C25A6E` | `DISCORD_ROLE_COLOR_BOTAN` |
| 8 | `躑躅タイプ` | 躑躅 `#E07AA0` | `DISCORD_ROLE_COLOR_TSUTSUJI` |
| 9 | `菫タイプ` | 菫 `#7960B5` | `DISCORD_ROLE_COLOR_SUMIRE` |
| 10 | `臙脂タイプ` | 臙脂 `#9C2E3F` | `DISCORD_ROLE_COLOR_ENJI` |
| 11 | `浅葱タイプ` | 浅葱 `#3FA9A0` | `DISCORD_ROLE_COLOR_ASAGI` |
| 12 | `潤みタイプ` | 灰青 `#8C8AA1` | `DISCORD_ROLE_COLOR_URUMI` |
| 13 | `銀茶タイプ` | 銀茶 `#A89578` | `DISCORD_ROLE_COLOR_GINCHA` |

各ロールを作ったら、**ロール名を右クリック → 「ロール ID をコピー」** で 13 個ID を取得。
さらに既存の **アーリーアクセス** ロールの ID も取得（統合用）→ `EARLY_ACCESS_ROLE_ID`

---

## C. Discord チャンネル 2 個新設（所要 10 分）

### C-1. `voipoke-先行メンバー`
1. ぼいラボで **「+」** チャンネル作成 → 名前: `voipoke-先行メンバー`
2. カテゴリ: ツール系（既存に合わせて）
3. 権限編集 → **@everyone**：「チャンネルを見る」OFF
4. 権限追加 → **アーリーアクセス**ロール（既存）：「チャンネルを見る」「メッセージ送信」ON
5. 同様 → **master**（既存）：「チャンネルを見る」「メッセージ送信」ON
6. チャンネル名を **右クリック → 「チャンネル ID をコピー」**：`VOIPOKE_EARLY_MEMBER_CHANNEL_ID`

### C-2. `運営ログ`
1. **「+」** → 名前: `運営ログ`
2. カテゴリ: 運営系（なければ新規作成）
3. 権限編集 → **@everyone**：すべて OFF
4. 権限追加 → エイト本人 + Bot ロールのみアクセス可
5. **チャンネル ID をコピー**：`OPS_LOG_CHANNEL_ID`

---

## D. Google Analytics 4 プロパティ 4 個作成（所要 30 分）

### D-1. GA4 アカウントを開く
1. https://analytics.google.com を開く
2. 既存アカウントがなければ新規作成（gmail でログインしておく）

### D-2. プロパティを 4 個作成

各サービスごとに繰り返す：

#### ぼいフォリオ用
1. 左下 **「管理」**（歯車アイコン）
2. **「プロパティを作成」** をクリック
3. プロパティ名: `ぼいフォリオ`
4. レポートのタイムゾーン: 日本
5. 通貨: 日本円
6. ビジネスカテゴリ: 「アート、エンターテイメント」
7. ビジネスの規模: 小規模
8. 利用目的: 適当に複数チェック → 作成
9. データストリーム: **「ウェブ」** を選択
10. ウェブサイト URL: `https://voifolio.reverb-lab.com`
11. ストリーム名: `ぼいフォリオ Web`
12. **「ストリームを作成」**
13. 表示される **「測定 ID」**（`G-XXXXXXXXXX`）をコピー → ぼいフォリオ用
14. プロパティ詳細から **プロパティ ID**（`123456789` のような数字）をコピー → `GA4_PROPERTY_ID_VOIFOLIO`

#### voilab-lp 用
- 上と同じ手順で：
- プロパティ名: `voilab-lp`
- ウェブサイト URL: `https://voilab.reverb-lab.com`
- 測定 ID をコピー → voilab-lp 用
- プロパティ ID をコピー → `GA4_PROPERTY_ID_VOILAB_LP`

#### voipoke-lp 用
- プロパティ名: `voipoke-lp`
- ウェブサイト URL: `https://voipoke.reverb-lab.com`
- 測定 ID をコピー → voipoke-lp 用
- プロパティ ID をコピー → `GA4_PROPERTY_ID_VOIPOKE_LP`

#### VoiPoke iOS 用（既に Firebase 連携済み）
1. https://console.firebase.google.com → **voipoke** プロジェクト
2. **プロジェクトの設定** → **統合** → **Google Analytics**
3. **管理画面に移動** → そこで使われているプロパティ ID をコピー
4. → `GA4_PROPERTY_ID_VOIPOKE_IOS`

### D-3. 測定 ID をコードに反映

僕にコピーしてもらった **測定 ID 3 個（G-XXXXXXXXXX 形式）** を貼り付けてもらえば、僕が以下のファイルの `G-VOILAB-LP-PLACEHOLDER` などを実際のIDに置換します：
- `voilab-lp/index.html`
- `voipoke-lp/index.html`
- `声優のため/index.html`
- `声優のため/pricing.html`

---

## E. Firebase サービスアカウント鍵（所要 10 分）

### E-1. JSON 鍵をダウンロード
1. https://console.firebase.google.com → **voipoke** プロジェクト
2. 左下 **歯車** → **「プロジェクトの設定」**
3. 上部タブ **「サービス アカウント」**
4. **「Firebase Admin SDK」** タブが選ばれているか確認
5. **「新しい秘密鍵の生成」**（青いボタン）→ **「鍵を生成」** で確認
6. JSON ファイル（`voipoke-firebase-adminsdk-XXXXX.json`）が自動ダウンロード

### E-2. GA4 のアクセス権付与
1. ダウンロードした JSON を開く
2. `client_email` の値（`firebase-adminsdk-XXX@voipoke.iam.gserviceaccount.com`）をコピー
3. https://analytics.google.com → 管理 → **プロパティのアクセス管理**
4. 各プロパティ（4 個）で：右上「+」→ ユーザーを追加 → さっきの client_email を貼り付け → 役割「**閲覧者**」 → 追加

### E-3. JSON を 1 行に圧縮
JSON ファイルの中身を1行にしてください。Mac だと：

```bash
cat ~/Downloads/voipoke-firebase-adminsdk-XXXXX.json | jq -c . | pbcopy
```

これでクリップボードに1行 JSON が入ります。あとで僕に渡してください。

---

## エイトに揃えてもらう値リスト

下記フォーマットでまとめてコピペしてください：

```
# A. Discord OAuth
DISCORD_INVITE_BOT_CLIENT_ID=
DISCORD_INVITE_BOT_CLIENT_SECRET=
DISCORD_INVITE_BOT_TOKEN=
VOILAB_GUILD_ID=

# B. Discord ロール 13 個 + 既存アーリーアクセスID
DISCORD_ROLE_VOICEUSER=
DISCORD_ROLE_VOISEIYU_KIBOU=
DISCORD_ROLE_DIAGNOSED=
EARLY_ACCESS_ROLE_ID=            # 既存「アーリーアクセス」ロールのID（VoiPoke先行と統合）
DISCORD_ROLE_COLOR_KOGANE=
DISCORD_ROLE_COLOR_TOKIWA=
DISCORD_ROLE_COLOR_MIZU=
DISCORD_ROLE_COLOR_BOTAN=
DISCORD_ROLE_COLOR_TSUTSUJI=
DISCORD_ROLE_COLOR_SUMIRE=
DISCORD_ROLE_COLOR_ENJI=
DISCORD_ROLE_COLOR_ASAGI=
DISCORD_ROLE_COLOR_URUMI=
DISCORD_ROLE_COLOR_GINCHA=

# C. Discord チャンネル 2 個
VOIPOKE_EARLY_MEMBER_CHANNEL_ID=
OPS_LOG_CHANNEL_ID=

# D. GA4 プロパティ ID 4 個 + 測定 ID 3 個
GA4_PROPERTY_ID_VOILAB_LP=
GA4_PROPERTY_ID_VOIPOKE_LP=
GA4_PROPERTY_ID_VOIFOLIO=
GA4_PROPERTY_ID_VOIPOKE_IOS=

# 測定 ID（HTML に埋める用）
GA4_MEASUREMENT_ID_VOILAB_LP=G-
GA4_MEASUREMENT_ID_VOIPOKE_LP=G-
GA4_MEASUREMENT_ID_VOIFOLIO=G-

# E. Firebase
GOOGLE_APPLICATION_CREDENTIALS_JSON=  # ここに 1 行 JSON を貼る
```

---

## 揃ったら僕がやること

1. Bot の `.env` に値を流し込み（VPS で `pm2 restart` で反映）
2. Supabase Secrets にも同じ値を流す（Edge Function 用）
3. 3 サイトの `G-XXXXXXXXXX` を実 ID に置換 → Vercel デプロイ
4. Supabase migration を deploy（`discord_invitations` テーブル作成）
5. Edge Function `discord-oauth-callback` を deploy
6. シークレットウィンドウで E2E テスト
7. 翌週月曜 9:00 に週次レポート初投稿の確認

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| Discord OAuth 後にぼいラボに入れない | Bot がサーバーにいない | A-4 でBot招待をやり直す |
| ロールが付与されない | Bot のロール階層が低い | サーバー設定 > ロール で Bot を上に |
| 週次レポートが届かない | OPS_LOG_CHANNEL_ID 未設定 or Bot の閲覧権限なし | C-2 のチャンネル権限を見直し |
| GA4 数字が 0 のまま | サービスアカウントに閲覧権限なし | E-2 のアクセス権付与をやり直す |
| `discord_invite_click` イベントが出ない | GA4 ID が PLACEHOLDER のまま | D-3 で実IDに置換 |

---

## まとめ

```
A. Discord Bot 作成        → 5 値
B. ロール 13 個作成 + 既存アーリーアクセスID → 14 値
C. チャンネル 2 個作成     → 2 値
D. GA4 プロパティ 4 個     → 4 + 3 値
E. Firebase 鍵            → 1 JSON
─────────────────────
合計                       → 28 値 + 1 JSON
```

質問や詰まったら、その画面のスクショを貼って教えてください。
