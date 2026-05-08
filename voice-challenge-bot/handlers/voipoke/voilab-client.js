// handlers/voipoke/voilab-client.js — ぼいフォリオへの HMAC 付き fetch クライアント
//
// 用途:
//   - bot から ぼいフォリオの /api/voilab/* エンドポイントへ HMAC 認証付きリクエスト
//   - 同じ HMAC スキーム（X-Voilab-Secret = HMAC-SHA256(body or query, VOILAB_BACKEND_SECRET)）
//
// 環境変数:
//   - VOILAB_BACKEND_URL   : 例 https://voifolio.reverb-lab.com
//   - VOILAB_BACKEND_SECRET: 受信側と同じシークレット

const crypto = require('crypto');

const BACKEND_URL = (process.env.VOILAB_BACKEND_URL || '').replace(/\/$/, '');
const SECRET = process.env.VOILAB_BACKEND_SECRET || '';

function isConfigured() {
  return !!BACKEND_URL && !!SECRET;
}

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

/**
 * Discord user_id から Supabase user_id を解決する
 * @param {string} discordUserId
 * @returns {Promise<{ linked: boolean, supabaseUserId?: string }>}
 */
async function lookupLink(discordUserId) {
  if (!isConfigured()) {
    return { linked: false, error: 'voilab_not_configured' };
  }
  const queryString = `discord_user_id=${encodeURIComponent(discordUserId)}`;
  const sig = sign(queryString);
  const url = `${BACKEND_URL}/api/voilab/lookup-link?${queryString}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-Voilab-Secret': sig },
    });
    if (!res.ok) {
      return { linked: false, error: `http_${res.status}` };
    }
    const data = await res.json();
    return {
      linked: !!data.linked,
      supabaseUserId: data.supabase_user_id,
    };
  } catch (err) {
    return { linked: false, error: err.message };
  }
}

/**
 * ログインボーナスチケット 1 枚付与をぼいフォリオに通知する
 * @param {string} discordUserId
 * @param {string} grantedDate - 'YYYY-MM-DD' JST
 * @returns {Promise<{ ok: boolean, granted?: boolean, balance?: number, reason?: string, error?: string }>}
 */
async function grantTicket(discordUserId, grantedDate) {
  if (!isConfigured()) {
    return { ok: false, error: 'voilab_not_configured' };
  }
  const body = JSON.stringify({
    discord_user_id: discordUserId,
    granted_date: grantedDate,
  });
  const sig = sign(body);
  const url = `${BACKEND_URL}/api/voilab/grant-ticket`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Voilab-Secret': sig,
      },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || `http_${res.status}` };
    }
    return { ok: true, granted: data.granted, balance: data.balance, reason: data.reason };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  isConfigured,
  lookupLink,
  grantTicket,
};
