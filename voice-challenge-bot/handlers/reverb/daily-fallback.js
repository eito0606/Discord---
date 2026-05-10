// handlers/reverb/daily-fallback.js — 毎晩21時の活用事例フォールバック配信
//
// 動作フロー：
//   1. 当日（JST 0時〜）の reverb_updates 件数をチェック
//   2. 1件以上あれば → 何もしない（webhookで既に賑わってる日）
//   3. 0件なら → ペルソナ × ツールをローテで選び、AIで活用事例を生成して配信
//   4. AI生成失敗時はフォールバックJSONから1本拾う
//   5. ローテ履歴を記録して、次回の重複回避に使う

const { buildUseCaseEmbed } = require('./embed-builder');
const { pickRotation, generateUseCase, pickFallbackCase } = require('./case-generator');
const {
  countReverbUpdatesToday,
  recordReverbRotation,
} = require('../../db');

/**
 * 21時のフォールバック配信を実行する
 *
 * @param {Client} client - discord.js の Client
 * @param {object} options - { force?: boolean } force=true なら当日件数を無視して必ず配信（テスト用）
 */
async function runDailyFallback(client, options = {}) {
  const { force = false } = options;

  // ----- 1. 当日アップデート件数チェック -----
  if (!force) {
    const todayCount = countReverbUpdatesToday();
    if (todayCount > 0) {
      console.log(`[Reverb] 今日はアップデート投稿が ${todayCount} 件あったのでフォールバックスキップ`);
      return { skipped: true, reason: 'updates_exist', count: todayCount };
    }
  }

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

  // ----- 3. ペルソナ × ツール のローテーション選択 -----
  const { persona, tool } = pickRotation();
  console.log(`[Reverb] 今夜の組み合わせ: ${persona.name}（${persona.id}） × ${tool.name}（${tool.id}）`);

  // ----- 4. AI で活用事例を生成（失敗時はフォールバックJSON） -----
  let story = await generateUseCase({ persona, tool });
  let usedFallback = false;
  if (!story) {
    console.warn('[Reverb] AI 生成に失敗。フォールバック事例を使用');
    story = pickFallbackCase(tool.id);
    usedFallback = true;
  }

  if (!story) {
    console.error('[Reverb] フォールバックも取得できず配信中止');
    return { success: false, error: 'no story available' };
  }

  // ----- 5. Embed 構築 -----
  const embed = buildUseCaseEmbed({ persona, tool, story });

  // ----- 6. ロールメンション -----
  const notifyRoleId = process.env.REVERB_NOTIFY_ROLE_ID;
  const content = notifyRoleId ? `<@&${notifyRoleId}>` : null;

  // ----- 7. 投稿 -----
  let message;
  try {
    message = await channel.send({
      content,
      embeds: [embed],
      allowedMentions: notifyRoleId ? { roles: [notifyRoleId] } : { parse: [] },
    });
  } catch (err) {
    console.error('[Reverb] フォールバック投稿失敗:', err);
    return { success: false, error: err.message };
  }

  // ----- 8. リアクション付与 -----
  try {
    await message.react('💚');
    await message.react('🪞'); // 「自分ごと化できた」を意味する鏡リアクション
  } catch (err) {
    console.warn('[Reverb] リアクション付与失敗:', err.message);
  }

  // ----- 9. ローテ履歴記録 -----
  try {
    recordReverbRotation(persona.id, tool.id, message.id);
  } catch (err) {
    console.error('[Reverb] ローテ記録失敗:', err);
  }

  console.log(`[Reverb] 活用事例配信完了 (fallback=${usedFallback})`);
  return {
    success: true,
    messageId: message.id,
    persona: persona.id,
    tool: tool.id,
    usedFallback,
  };
}

module.exports = {
  runDailyFallback,
};
