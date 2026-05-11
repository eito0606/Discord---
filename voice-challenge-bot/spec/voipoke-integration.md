# Bot 側：VoiPoke 連携 実装仕様書

**作成日**：2026-04-25
**対象 Claude Code**：voice-challenge-bot（Node.js + discord.js v14）
**実装範囲**：既存 voice-challenge-bot に VoiPoke 連携機能を追加

---

## 関連ドキュメント

| ドキュメント | パス | 役割 |
|---|---|---|
| 共通設定 | `/Users/hidehisa/VoiPoke/spec/discord-shared-config.md` | Discord IDs、環境変数管理 |
| VoiPoke 側 Spec | `/Users/hidehisa/VoiPoke/spec/voipoke-discord-integration.md` | iOS + Supabase 側のタスク |
| 既存 Bot コード | `/Users/hidehisa/Discord練習会/voice-challenge-bot/` | 既存の voice-challenge-bot |

---

## 既存 Bot との統合方針

### ⚠️ 既存 voice-challenge-bot に機能追加（マージ方式）

既存 Bot を活かし、VoiPoke 連携機能を **追加実装** する。
- Bot Token は既存のものを流用
- ディレクトリ構造：`handlers/voipoke/` 配下に新規ファイル群を配置
- 既存機能（声劇等）に影響を与えない

### 追加するディレクトリ・ファイル

```
voice-challenge-bot/
├── index.js                       (既存、軽微な修正)
├── handlers/
│   ├── (既存ハンドラ)
│   └── voipoke/                   ★新規
│       ├── webhook-server.js      ★新規：Express サーバー、VoiPoke からの Webhook 受信
│       ├── role-sync.js           ★新規：ロール同期処理
│       ├── new-voice-poster.js    ★新規：新作通知投稿処理
│       ├── master-events.js       ★新規：マスター限定イベント（クーポン・コイン配布）
│       └── webhook-auth.js        ★新規：Webhook 署名検証
└── spec/
    └── voipoke-integration.md     (このファイル)
```

---

## 全体スケジュール（Bot 側）

| Phase | 内容 | 優先度 | 工数目安 |
|---|---|---|---|
| Phase A | Discord ロール作成（手動 + 文書化） | P0 | 30分 |
| Phase B | チャンネル作成（手動 + 文書化） | P0 | 30分 |
| Phase C | Webhook サーバー実装（Express） | P0 | 2日 |
| Phase D | ロール同期エンドポイント | P0 | 2日 |
| Phase E | 新作通知投稿エンドポイント | P0 | 2日 |
| Phase F | マスター限定イベント機能 | P1 | 3日 |

---

## Phase A：Discord ロール作成（手動）

### 新ロール設計（4個）

| ロール名 | 色 | 表示優先度 | 専用チャンネル | 備考 |
|---|---|---|---|---|
| プレミアリスナー | プラチナ系（#E5E4E2） | 高 | なし | サブスク特典の可視化 |
| クリエイターズプロ | オレンジ系（#FF8C42） | 高 | なし | サブスク特典の可視化 |
| マスター | 金（#FFD700） | 最高 | あり（マスター交流部屋） | 限定イベント参加権 |
| クリエイター | 青（#3B82F6） | 中 | なし | クリエイター登録者の識別 |

### 作成手順

1. ぼいラボ Discord サーバー設定 > ロール
2. 上記4ロールを作成
3. **ロール権限はデフォルト**（特別な権限は付与しない）
4. 各ロール ID を取得し、共通設定 spec の以下に記入：
   - `DISCORD_ROLE_PREMIUM_LISTENER`
   - `DISCORD_ROLE_CREATORS_PRO`
   - `DISCORD_ROLE_MASTER`
   - `DISCORD_ROLE_CREATOR`

### 廃止ロール

既存に以下があれば、メンバーへの事前告知後に削除：
- 常連リスナー
- ベテランクリエイター

---

## Phase B：チャンネル作成（手動）

### 新規作成チャンネル

#### 全員アクセス可能（Bot のみ投稿可）

| チャンネル名 | カテゴリ | 用途 | 投稿権限 |
|---|---|---|---|
| `#voipoke-新作` | VoiPoke | 全カテゴリの新作通知 | Bot のみ |
| `#voipoke-シチュボ` | VoiPoke | シチュエーションボイス専用 | Bot のみ |
| `#voipoke-asmr` | VoiPoke | ASMR系専用 | Bot のみ |

#### マスター限定（マスターロールのみアクセス可）

| チャンネル名 | カテゴリ | 用途 | アクセス |
|---|---|---|---|
| `#マスター交流部屋` | VoiPoke Master | マスター限定の雑談・交流 | マスターロールのみ |
| `#マスター限定イベント` | VoiPoke Master | クーポン配布、コイン配布告知 | マスターロールのみ閲覧、Bot のみ投稿 |

### 設定手順

1. カテゴリ「VoiPoke」「VoiPoke Master」を作成
2. 各チャンネルを作成
3. マスター限定チャンネルは権限設定：
   - `@everyone`：チャンネルを見る ❌
   - `マスター` ロール：チャンネルを見る ✅、メッセージ送信 ✅
4. Bot にチャンネルへの投稿権限付与
5. 各チャンネル ID を取得し、共通設定 spec に記入：
   - `VOIPOKE_NEW_CHANNEL_ID`
   - `VOIPOKE_NEW_SITUATION_CHANNEL_ID`
   - `VOIPOKE_NEW_ASMR_CHANNEL_ID`
   - `MASTER_LOUNGE_CHANNEL_ID`
   - `MASTER_EVENT_CHANNEL_ID`

---

## Phase C：Webhook サーバー実装（Express）

### 目的
VoiPoke の Supabase Edge Function から Bot に対して安全に通信できるようにする。

### 依存パッケージ追加
```bash
cd /Users/hidehisa/Discord練習会/voice-challenge-bot
npm install express body-parser
```

### `package.json` 更新
```json
{
  "dependencies": {
    "@google/generative-ai": "^0.24.1",
    "better-sqlite3": "^12.6.2",
    "discord.js": "^14.25.1",
    "dotenv": "^17.3.1",
    "fluent-ffmpeg": "^2.1.3",
    "node-cron": "^4.2.1",
    "rss-parser": "^3.13.0",
    "express": "^4.21.2",
    "body-parser": "^1.20.3"
  }
}
```

### `handlers/voipoke/webhook-server.js`
```javascript
// Express サーバーで VoiPoke からの Webhook を受信
const express = require('express');
const bodyParser = require('body-parser');
const { verifyWebhookSignature } = require('./webhook-auth');
const { handleRoleSync } = require('./role-sync');
const { handleNewVoice } = require('./new-voice-poster');

function startWebhookServer(client) {
  const app = express();
  app.use(bodyParser.json());

  // 全エンドポイントで署名検証
  app.use((req, res, next) => {
    const signature = req.headers['x-webhook-secret'];
    if (!verifyWebhookSignature(signature)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
    next();
  });

  // ロール同期エンドポイント
  app.post('/sync-roles', async (req, res) => {
    try {
      const { discord_user_id, roles_to_add, roles_to_remove } = req.body;
      await handleRoleSync(client, discord_user_id, roles_to_add, roles_to_remove);
      res.json({ success: true });
    } catch (err) {
      console.error('[VoiPoke] sync-roles error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 新作通知エンドポイント
  app.post('/new-voice', async (req, res) => {
    try {
      const payload = req.body;
      await handleNewVoice(client, payload);
      res.json({ success: true });
    } catch (err) {
      console.error('[VoiPoke] new-voice error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  const port = process.env.VOIPOKE_WEBHOOK_PORT || 3000;
  app.listen(port, () => {
    console.log(`[VoiPoke] Webhook server listening on port ${port}`);
  });
}

module.exports = { startWebhookServer };
```

### `handlers/voipoke/webhook-auth.js`
```javascript
const crypto = require('crypto');

function verifyWebhookSignature(signature) {
  if (!signature || !process.env.VOIPOKE_WEBHOOK_SECRET) {
    return false;
  }
  // 単純な共有秘密の比較（タイミング攻撃対策で crypto.timingSafeEqual 使用）
  const expected = process.env.VOIPOKE_WEBHOOK_SECRET;
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  
  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

module.exports = { verifyWebhookSignature };
```

### `index.js` への組み込み
```javascript
// 既存の require 群の後に追加
const { startWebhookServer } = require('./handlers/voipoke/webhook-server');

// 既存の client.once('ready', ...) の中、または client.login() 後に追加
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  startWebhookServer(client);  // ★追加
});
```

### `.env` に追加
```bash
# 既存変数
DISCORD_TOKEN=...

# VoiPoke 連携（共通設定 spec の値をコピー）
VOIPOKE_WEBHOOK_PORT=3000
VOIPOKE_WEBHOOK_SECRET=...
VOIPOKE_GUILD_ID=...
VOIPOKE_ROLE_PREMIUM_LISTENER=...
VOIPOKE_ROLE_CREATORS_PRO=...
VOIPOKE_ROLE_MASTER=...
VOIPOKE_ROLE_CREATOR=...
VOIPOKE_NEW_CHANNEL_ID=...
VOIPOKE_NEW_SITUATION_CHANNEL_ID=...
VOIPOKE_NEW_ASMR_CHANNEL_ID=...
MASTER_LOUNGE_CHANNEL_ID=...
MASTER_EVENT_CHANNEL_ID=...
```

### テスト観点
- [ ] Bot 起動時に Express サーバーも立ち上がる
- [ ] X-Webhook-Secret なしのリクエストが 401 で拒否される
- [ ] X-Webhook-Secret 不一致のリクエストが 401 で拒否される
- [ ] 既存の voice-challenge-bot 機能が壊れていない

---

## Phase D：ロール同期エンドポイント

### `handlers/voipoke/role-sync.js`
```javascript
async function handleRoleSync(client, discordUserId, rolesToAdd, rolesToRemove) {
  const guildId = process.env.VOIPOKE_GUILD_ID;
  const guild = await client.guilds.fetch(guildId);
  
  let member;
  try {
    member = await guild.members.fetch(discordUserId);
  } catch (err) {
    if (err.code === 10007) {
      console.warn(`[VoiPoke] User ${discordUserId} not in guild`);
      return; // ユーザーがサーバーにいない場合はスキップ
    }
    throw err;
  }
  
  // ロール付与
  for (const roleId of rolesToAdd) {
    try {
      await member.roles.add(roleId);
      console.log(`[VoiPoke] Added role ${roleId} to ${discordUserId}`);
    } catch (err) {
      console.error(`[VoiPoke] Failed to add role ${roleId}:`, err);
    }
  }
  
  // ロール剥奪
  for (const roleId of rolesToRemove) {
    try {
      await member.roles.remove(roleId);
      console.log(`[VoiPoke] Removed role ${roleId} from ${discordUserId}`);
    } catch (err) {
      console.error(`[VoiPoke] Failed to remove role ${roleId}:`, err);
    }
  }
}

module.exports = { handleRoleSync };
```

### テスト観点
- [ ] サブスク登録 → 該当ロール付与
- [ ] サブスク解約 → 該当ロール剥奪
- [ ] ぼいラボに未参加ユーザー → エラーにならず警告ログのみ
- [ ] 既に持っているロールを再付与してもエラーにならない

---

## Phase E：新作通知投稿エンドポイント

### `handlers/voipoke/new-voice-poster.js`
```javascript
const { EmbedBuilder } = require('discord.js');

async function handleNewVoice(client, payload) {
  const {
    voice_id,
    title,
    creator_name,
    creator_avatar_url,
    category,
    cover_art_url,
    voice_url
  } = payload;
  
  // Embed 作成
  const embed = new EmbedBuilder()
    .setTitle(`🎙 新作：${title}`)
    .setDescription(`クリエイター：**${creator_name}**`)
    .setColor(0x1A4D2E)  // VoiPoke ブランドダークグリーン
    .setURL(voice_url)
    .setThumbnail(cover_art_url)
    .setAuthor({
      name: creator_name,
      iconURL: creator_avatar_url
    })
    .addFields(
      { name: 'カテゴリ', value: getCategoryDisplayName(category), inline: true }
    )
    .setFooter({
      text: 'VoiPoke で再生',
      iconURL: 'https://voipoke.com/icon.png'
    })
    .setTimestamp();
  
  // メインチャンネル投稿
  const mainChannel = await client.channels.fetch(process.env.VOIPOKE_NEW_CHANNEL_ID);
  await mainChannel.send({ embeds: [embed] });
  
  // カテゴリ別チャンネル投稿
  const categoryChannelId = getCategoryChannelId(category);
  if (categoryChannelId) {
    const categoryChannel = await client.channels.fetch(categoryChannelId);
    await categoryChannel.send({ embeds: [embed] });
  }
}

function getCategoryDisplayName(category) {
  const map = {
    'situation': 'シチュエーションボイス',
    'asmr': 'ASMR',
    'narration': 'ナレーション',
    'character': 'キャラクターボイス'
  };
  return map[category] || category;
}

function getCategoryChannelId(category) {
  const map = {
    'situation': process.env.VOIPOKE_NEW_SITUATION_CHANNEL_ID,
    'asmr': process.env.VOIPOKE_NEW_ASMR_CHANNEL_ID
  };
  return map[category] || null;
}

module.exports = { handleNewVoice };
```

### スパム防止：投稿頻度制御
```javascript
// 1日10件以上の新作はサマリー投稿に切り替え
const recentPostsCount = new Map(); // creator_id => count

function shouldSendSummary(creatorId) {
  const count = recentPostsCount.get(creatorId) || 0;
  return count >= 10;
}
```

### テスト観点
- [ ] 新作投稿 → `#voipoke-新作` に Embed 投稿
- [ ] カテゴリ別チャンネルにも投稿
- [ ] サムネイルに作品カバー画像が表示
- [ ] URL クリックで VoiPoke が開く（Universal Link）
- [ ] 同一クリエイターが10件超投稿時はサマリー化

---

## Phase F：マスター限定イベント機能

### 目的
マスターロール持ちユーザーへの特典イベント（クーポン配布、コイン配布）を実施し、
マスタープランの体感価値を向上させる。

### 機能設計

#### F-1：限定クーポン配布

**ユースケース**：
- 月次イベントで、`#マスター限定イベント` チャンネルに「今月のマスター特典クーポン」を投稿
- 各クーポンには使い捨ての一意コード（例：`MASTER-2026-05-XXXXX`）
- マスター以外がコードを使おうとしても弾く（VoiPoke iOS 側で検証）

**実装**：
```javascript
// handlers/voipoke/master-events.js

const { SlashCommandBuilder } = require('discord.js');

// /master-coupon コマンド（Bot 管理者のみ実行可能）
const masterCouponCommand = {
  data: new SlashCommandBuilder()
    .setName('master-coupon')
    .setDescription('マスター限定クーポンを配布する')
    .addStringOption(option =>
      option.setName('coupon_code')
        .setDescription('クーポンコード')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('discount_percent')
        .setDescription('割引率(%)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('valid_until')
        .setDescription('有効期限（YYYY-MM-DD）')
        .setRequired(true)),
  
  async execute(interaction) {
    // Bot 管理者チェック
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: '管理者のみ実行可能です', ephemeral: true });
    }
    
    const couponCode = interaction.options.getString('coupon_code');
    const discount = interaction.options.getInteger('discount_percent');
    const validUntil = interaction.options.getString('valid_until');
    
    // VoiPoke API にクーポン登録（Supabase Edge Function 呼び出し）
    await registerCouponInVoiPoke(couponCode, discount, validUntil, 'master_only');
    
    // マスター限定チャンネルに告知投稿
    const eventChannel = await interaction.client.channels.fetch(process.env.MASTER_EVENT_CHANNEL_ID);
    await eventChannel.send({
      embeds: [{
        title: '🎁 マスター限定クーポン',
        description: `**コード**：\`${couponCode}\`\n**割引**：${discount}%OFF\n**有効期限**：${validUntil}`,
        color: 0xFFD700,
        footer: { text: 'マスタープラン会員のみ利用可能' }
      }]
    });
    
    await interaction.reply({ content: 'クーポンを配布しました', ephemeral: true });
  }
};
```

#### F-2：ポケ銭配布

**ユースケース**：
- マスター全員に毎月50ポケ銭ボーナス配布（ロイヤリティ施策）
- Bot から VoiPoke の Supabase Edge Function を呼び出し、bonus_grant を一括登録

**実装**：
```javascript
// 月次cron で実行（既存の cron.js に追加）

const cron = require('node-cron');

// 毎月1日 9:00 に実行
cron.schedule('0 9 1 * *', async () => {
  console.log('[VoiPoke] Monthly master bonus distribution started');
  
  // VoiPoke の Supabase Edge Function を呼ぶ
  const response = await fetch(`${process.env.VOIPOKE_SUPABASE_URL}/functions/v1/grant-master-monthly-bonus`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': process.env.VOIPOKE_WEBHOOK_SECRET
    },
    body: JSON.stringify({
      bonus_amount: 50,
      reason: 'master_monthly_bonus',
      month: new Date().toISOString().slice(0, 7)  // YYYY-MM
    })
  });
  
  const result = await response.json();
  
  // 配布完了をマスターチャンネルに通知
  const guild = await client.guilds.fetch(process.env.VOIPOKE_GUILD_ID);
  const channel = await guild.channels.fetch(process.env.MASTER_EVENT_CHANNEL_ID);
  await channel.send({
    embeds: [{
      title: '🎁 月次ボーナス配布完了',
      description: `マスター会員${result.recipient_count}名に **50ポケ銭** を配布しました！`,
      color: 0xFFD700
    }]
  });
});
```

### Phase F の VoiPoke 側依存

VoiPoke 側に以下の Edge Function を追加実装する必要あり：
- `grant-master-monthly-bonus`：マスター全員にボーナス付与
- `register-coupon`：クーポン登録（master_only フラグ付き）
- `validate-coupon`：クーポン使用時の検証（master_only ならマスター会員チェック）

→ VoiPoke 側 spec への追加タスクとして計画する（Phase F 実装前に追加すること）

### テスト観点
- [ ] `/master-coupon` コマンドで Bot 管理者のみ実行可能
- [ ] クーポン投稿が `#マスター限定イベント` のみに表示される
- [ ] 月次ボーナス cron が毎月1日に発動
- [ ] マスター以外には配布されない
- [ ] 配布完了通知が投稿される

---

## リリース前チェックリスト（Bot 側）

### Phase A-B（手動セットアップ）
- [ ] 4ロール作成完了、各 ID 取得
- [ ] 5チャンネル作成完了、各 ID 取得
- [ ] 廃止ロールの削除完了
- [ ] マスター限定チャンネルの権限設定完了

### Phase C（Webhook サーバー）
- [ ] Express サーバー起動
- [ ] 署名検証が機能
- [ ] 既存 Bot 機能が壊れていない

### Phase D（ロール同期）
- [ ] VoiPoke からのリクエストでロール付与/剥奪
- [ ] 未参加ユーザーへの対応
- [ ] エラーハンドリング

### Phase E（新作通知）
- [ ] `#voipoke-新作` への自動投稿
- [ ] カテゴリ別チャンネルへの振り分け
- [ ] Embed 表示（カバー画像含む）

### Phase F（マスター限定）
- [ ] クーポン配布コマンド動作
- [ ] 月次ポケ銭配布 cron 動作
- [ ] マスター以外への配布されない検証

---

## デプロイ・運用

### 既存 Bot サーバーへのデプロイ

既存の voice-challenge-bot がどこで動いているかを確認：
- ローカル：`node index.js` で起動
- VPS：systemd or pm2 で常駐
- ホスティング：Railway, Render, Fly.io 等

→ 既存運用方式に乗せる。Express ポート（デフォルト 3000）を外部公開する必要あり：
- ローカル開発：`ngrok` でトンネル
- VPS：ファイアウォール開放 + Reverse Proxy（nginx）
- ホスティング：プラットフォームの公開URL を VoiPoke の `BOT_WEBHOOK_URL` に設定

### Bot Token の取扱い
既存の `.env` の `DISCORD_TOKEN` を流用。VoiPoke 用に新規 Bot を作る場合のみ別 Token。

---

## VoiPoke 側との連携確認

### このスペックで実装する Bot 側 → VoiPoke 側に渡す情報

| トリガー | 送信先 | 送信内容 |
|---|---|---|
| マスター月次ボーナス cron | VoiPoke `/grant-master-monthly-bonus` | bonus_amount, reason, month |
| クーポン配布コマンド | VoiPoke `/register-coupon` | coupon_code, discount, valid_until, master_only |

### VoiPoke 側が実装すべきこと（Phase F 連動）
- `/grant-master-monthly-bonus` Edge Function
- `/register-coupon` Edge Function
- `/validate-coupon` Edge Function

→ VoiPoke 側 Spec に追加タスクとして連携：
**`/Users/hidehisa/VoiPoke/spec/voipoke-discord-integration.md`**

---

## 改定履歴
- 2026-04-25：v0.1 初版（Claude Code 作成、共通spec/VoiPoke side specに分割）
