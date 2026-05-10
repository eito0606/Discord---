// handlers/reverb/webhook-handler.js — webhook 受信時の Reverb アップデート投稿処理
//
// 各ツール（VoiPoke / VoiLog / ぼいラボ / ぼいフォリオ / キャラビジュ）から
// POST /reverb/update が叩かれたとき、ここでEmbed化してDiscordに投稿する。
//
// 認証は webhook-server.js のミドルウェアで完了している前提。
// ここではビジネスロジック（投稿・記録・通知）だけに集中する。

const { buildUpdateEmbed } = require('./embed-builder');
const { getToolIdByName } = require('./tool-defs');
const { recordReverbUpdate } = require('../../db');

/**
 * webhook で受け取ったアップデート情報を Discord に投稿する
 *
 * @param {Client} client - discord.js の Client
 * @param {object} payload - {
 *   tool: 'VoiPoke' | 'VoiLog' | 'ぼいラボ' | 'ぼいフォリオ' | 'キャラビジュ',
 *   type: 'feature' | 'fix' | 'release' | 'campaign',
 *   title: string,
 *   body?: string,
 *   link?: string,
 *   thumbnail?: string,
 * }
 * @param {object} options - { isTest?: boolean }
 *   isTest=true なら DB に is_test=1 で記録され、21時フォールバック判定で無視される。
 *   !testreverb_update から呼ばれる場合に true を渡す。
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function handleReverbUpdate(client, payload, options = {}) {
  // ----- 1. バリデーション -----
  if (!payload || typeof payload !== 'object') {
    return { success: false, error: 'payload is required' };
  }
  if (!payload.title || typeof payload.title !== 'string') {
    return { success: false, error: 'title is required' };
  }
  if (!payload.tool) {
    return { success: false, error: 'tool is required' };
  }

  // ツール名の表記揺れを吸収（"VoiPoke" → "voipoke"）
  const toolId = getToolIdByName(payload.tool) || String(payload.tool).toLowerCase();

  const normalized = {
    tool: toolId,
    type: payload.type || 'feature', // 未指定なら feature 扱い
    title: payload.title,
    body: payload.body || null,
    link: payload.link || null,
    thumbnail: payload.thumbnail || null,
  };

  // ----- 2. 配信先チャンネル取得 -----
  const channelId = process.env.REVERB_NEWS_CHANNEL_ID;
  if (!channelId) {
    console.error('[Reverb] REVERB_NEWS_CHANNEL_ID が未設定です');
    return { success: false, error: 'REVERB_NEWS_CHANNEL_ID not set' };
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    console.error(`[Reverb] チャンネル取得失敗: ${channelId}`);
    return { success: false, error: 'channel not found' };
  }

  // ----- 3. Embed 構築 -----
  const embed = buildUpdateEmbed(normalized);

  // ----- 4. ロールメンション（opt-in登録者だけに通知が飛ぶ） -----
  const notifyRoleId = process.env.REVERB_NOTIFY_ROLE_ID;
  const content = notifyRoleId ? `<@&${notifyRoleId}>` : null;

  // ----- 5. 投稿 -----
  let message;
  try {
    message = await channel.send({
      content,
      embeds: [embed],
      allowedMentions: notifyRoleId ? { roles: [notifyRoleId] } : { parse: [] },
    });
  } catch (err) {
    console.error('[Reverb] 投稿失敗:', err);
    return { success: false, error: err.message };
  }

  // ----- 6. リアクション付与（エンゲージメント促進） -----
  // 失敗しても致命ではないので catch して握る
  try {
    await message.react('🔥');
    await message.react('💚');
    await message.react('🎉');
  } catch (err) {
    console.warn('[Reverb] リアクション付与に失敗:', err.message);
  }

  // ----- 7. スレッド自動作成（感想の受け皿） -----
  try {
    await message.startThread({
      name: `💬 ${normalized.title}`.slice(0, 100),
      autoArchiveDuration: 1440, // 24時間で自動アーカイブ
      reason: 'Reverb ニュースの感想スレッド',
    });
  } catch (err) {
    // 権限不足やスレッド非対応チャンネルなら無視
    console.warn('[Reverb] スレッド作成に失敗:', err.message);
  }

  // ----- 8. DB 記録（21時フォールバックの判定材料になる） -----
  // options.isTest=true（!testreverb_update 由来）なら is_test=1 で記録し、
  // countReverbUpdatesToday() の集計から外れる
  try {
    recordReverbUpdate({
      ...normalized,
      messageId: message.id,
      isTest: options.isTest === true,
    });
  } catch (err) {
    console.error('[Reverb] DB 記録失敗:', err);
  }

  console.log(`[Reverb] アップデート投稿完了: ${normalized.tool} / ${normalized.title}`);
  return { success: true, messageId: message.id };
}

module.exports = {
  handleReverbUpdate,
};
