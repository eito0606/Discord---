// webhook-auth.js — VoiPoke からのWebhookリクエストの「合言葉」をチェックする門番
// VoiPoke iOS と Supabase Edge Function から送られてくるリクエストが
// 本物かどうかを判定するための仕組みです。
//
// 仕組み：
//   1. VoiPoke 側もBot側も同じ秘密の文字列（VOIPOKE_WEBHOOK_SECRET）を持つ
//   2. リクエストヘッダ X-Webhook-Secret に秘密の文字列を付けて送ってくる
//   3. Bot側で「同じ文字列か？」を比較し、一致したら本物と認める
//
// 注意：単純な == 比較ではなく crypto.timingSafeEqual を使う
//   → タイミング攻撃（処理時間の違いから秘密を推測する攻撃）対策

const crypto = require('crypto');

/**
 * Webhook の署名（共有秘密）を検証する
 *
 * @param {string|undefined} signature - リクエストヘッダ X-Webhook-Secret の値
 * @returns {boolean} - 一致すれば true、不一致または未設定なら false
 */
function verifyWebhookSignature(signature) {
  // 署名が空、または環境変数が未設定なら即座に拒否
  if (!signature || !process.env.VOIPOKE_WEBHOOK_SECRET) {
    return false;
  }

  const expected = process.env.VOIPOKE_WEBHOOK_SECRET;
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  // 長さが違えば即座に false（timingSafeEqual は同じ長さでないとエラーになる）
  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  // タイミング攻撃対策の安全な比較
  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

module.exports = { verifyWebhookSignature };
