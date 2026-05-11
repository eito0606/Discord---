// webhook-server.js — VoiPoke から Webhook を受信する Express サーバー
// Bot 起動時に Discord クライアントとは別に HTTP サーバーを立ち上げ、
// VoiPoke iOS or Supabase Edge Function からの POST リクエストを受け付ける。
//
// エンドポイント：
//   POST /sync-roles    … サブスク登録/解約時のロール付与・剥奪
//   POST /new-voice     … 新作ボイス公開時の Discord 通知
//   GET  /healthz       … 死活監視（認証不要）
//
// 全エンドポイントで X-Webhook-Secret ヘッダによる署名検証を行う。

const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { verifyWebhookSignature } = require('./webhook-auth');
const { handleRoleSync } = require('./role-sync');
const { handleNewVoice } = require('./new-voice-poster');
// Reverb ニュース受信ハンドラ（独立モジュール、VoiPoke 機能には触れない）
const { handleReverbUpdate } = require('../reverb/webhook-handler');
// VoiLog ブリッジ（双方向グループ同期、追加機能・既存挙動には影響なし）
const { registerVoilogBridgeRoutes } = require('../group/voilog-bridge-api');

/**
 * Reverb 専用の署名検証
 * VoiPoke とは別の REVERB_WEBHOOK_SECRET を使う（漏洩時の影響範囲を分離）
 */
function verifyReverbSignature(signature) {
  if (!signature || !process.env.REVERB_WEBHOOK_SECRET) return false;
  const expected = process.env.REVERB_WEBHOOK_SECRET;
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

/**
 * Express サーバーを起動する
 *
 * @param {Client} client - discord.js の Client インスタンス（ready 後に渡される）
 */
function startWebhookServer(client) {
  const app = express();

  // JSONボディパーサ（ペイロードの上限は念のため指定）
  app.use(bodyParser.json({ limit: '1mb' }));

  // ヘルスチェック（外部からの監視用、認証不要）
  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok', service: 'voipoke-bridge' });
  });

  // 署名検証ミドルウェア（VoiPoke 系のみ）
  // /healthz と /reverb/* は別の認証経路なのでスキップする
  app.use((req, res, next) => {
    if (req.path === '/healthz') return next();
    if (req.path.startsWith('/reverb/')) return next(); // Reverb は専用ミドルウェアで認証
    if (req.path.startsWith('/voilog/')) return next(); // VoiLog ブリッジは専用ミドルウェアで認証
    const signature = req.headers['x-webhook-secret'];
    if (!verifyWebhookSignature(signature)) {
      console.warn(`[VoiPoke] Rejected request from ${req.ip} to ${req.path} (invalid signature)`);
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
    next();
  });

  // Reverb 専用の認証ミドルウェア
  // ヘッダ X-Reverb-Secret を優先、なければ X-Webhook-Secret も受け付ける（運用の柔軟性）
  function reverbAuth(req, res, next) {
    if (!process.env.REVERB_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'Reverb webhook is disabled (REVERB_WEBHOOK_SECRET not set)' });
    }
    const signature = req.headers['x-reverb-secret'] || req.headers['x-webhook-secret'];
    if (!verifyReverbSignature(signature)) {
      console.warn(`[Reverb] Rejected request from ${req.ip} to ${req.path} (invalid signature)`);
      return res.status(401).json({ error: 'Invalid Reverb webhook signature' });
    }
    next();
  }

  // ----- POST /sync-roles -----
  // ぼいラボのロール付与・剥奪を実行
  // body: { discord_user_id: string, roles_to_add: string[], roles_to_remove: string[] }
  app.post('/sync-roles', async (req, res) => {
    try {
      const { discord_user_id, roles_to_add, roles_to_remove } = req.body || {};
      if (!discord_user_id) {
        return res.status(400).json({ error: 'discord_user_id is required' });
      }
      await handleRoleSync(
        client,
        discord_user_id,
        roles_to_add || [],
        roles_to_remove || []
      );
      res.json({ success: true });
    } catch (err) {
      console.error('[VoiPoke] sync-roles error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ----- POST /new-voice -----
  // 新作ボイスを Discord に Embed として投稿
  // body: { voice_id, title, creator_name, creator_avatar_url?, category, cover_art_url?, voice_url? }
  app.post('/new-voice', async (req, res) => {
    try {
      const payload = req.body || {};
      if (!payload.title || !payload.creator_name) {
        return res.status(400).json({ error: 'title and creator_name are required' });
      }
      await handleNewVoice(client, payload);
      res.json({ success: true });
    } catch (err) {
      console.error('[VoiPoke] new-voice error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ----- POST /reverb/update -----
  // 開発ツールのアップデート通知をぼいラボの「Reverb ニュース」へ配信
  // body: { tool, type, title, body?, link?, thumbnail? }
  //   tool : 'VoiPoke' | 'VoiLog' | 'ぼいラボ' | 'ぼいフォリオ' | 'キャラビジュ'
  //   type : 'feature' | 'fix' | 'release' | 'campaign'
  app.post('/reverb/update', reverbAuth, async (req, res) => {
    try {
      const result = await handleReverbUpdate(client, req.body || {});
      if (result.success) {
        return res.json({ success: true, message_id: result.messageId });
      }
      return res.status(400).json({ error: result.error });
    } catch (err) {
      console.error('[Reverb] /reverb/update error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ----- VoiLog ブリッジルート -----
  // POST /voilog/group-create, /group-join, /group-leave, /group-dissolve
  // 認証は X-Voilab-Bridge-Secret (registerVoilogBridgeRoutes 内で検証)
  registerVoilogBridgeRoutes(app);

  // ----- 共通エラーハンドラ -----
  // 想定外の例外を握り潰さず JSON で返す
  app.use((err, req, res, next) => {
    console.error('[VoiPoke] Unhandled webhook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const port = parseInt(process.env.VOIPOKE_WEBHOOK_PORT, 10) || 3000;
  app.listen(port, () => {
    console.log(`[VoiPoke] Webhook server listening on port ${port}`);
  });
}

module.exports = { startWebhookServer };
