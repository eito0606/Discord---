// new-voice-poster.js — VoiPoke で新作ボイスが投稿されたら Discord に通知する
// VoiPoke iOS 側で新しいボイスが公開されると、Supabase Edge Function 経由で
// Bot の /new-voice エンドポイントに POST される。
// このファイルは届いたペイロードを Embed に整形し、
//   1. メインチャンネル（#voipoke-新作）
//   2. カテゴリ別チャンネル（#voipoke-シチュボ / #voipoke-asmr）
// に投稿する。

const { EmbedBuilder } = require('discord.js');

// ----- スパム防止用の状態管理 -----
// クリエイター毎の投稿回数を記録するMap（メモリ内）
// Bot 再起動でリセットされるが、リセット間隔と「1日10件」のスパム判定は近似的に運用
// 本格運用では DB 保存に切り替えるべきだが、現状はシンプルに保つ
const recentPostsCount = new Map(); // creatorName => { count: number, resetAt: timestamp }
const RESET_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24時間
const SPAM_THRESHOLD = 10; // この件数を超えたらサマリー化

/**
 * クリエイターの最近の投稿回数をカウントアップし、スパム判定する
 * @param {string} creatorKey - クリエイターを一意に識別する文字列（例：creator_id か creator_name）
 * @returns {boolean} - サマリー化すべきなら true
 */
function shouldSendSummary(creatorKey) {
  const now = Date.now();
  const entry = recentPostsCount.get(creatorKey);

  // 24時間経過していたらリセット
  if (!entry || now > entry.resetAt) {
    recentPostsCount.set(creatorKey, { count: 1, resetAt: now + RESET_INTERVAL_MS });
    return false;
  }

  // カウントアップ
  entry.count += 1;
  recentPostsCount.set(creatorKey, entry);

  // 閾値を超えたらサマリー化
  return entry.count > SPAM_THRESHOLD;
}

/**
 * カテゴリの英字キーを日本語表示名に変換
 * @param {string} category - 'situation' | 'asmr' | 'narration' | 'character' など
 * @returns {string}
 */
function getCategoryDisplayName(category) {
  const map = {
    situation: 'シチュエーションボイス',
    asmr: 'ASMR',
    narration: 'ナレーション',
    character: 'キャラクターボイス',
  };
  return map[category] || category || '未分類';
}

/**
 * カテゴリ別チャンネル ID を環境変数から取得
 * @param {string} category
 * @returns {string|null}
 */
function getCategoryChannelId(category) {
  const map = {
    situation: process.env.VOIPOKE_NEW_SITUATION_CHANNEL_ID,
    asmr: process.env.VOIPOKE_NEW_ASMR_CHANNEL_ID,
  };
  return map[category] || null;
}

/**
 * 新作通知ペイロードを Embed に整形する（再利用しやすいよう関数化）
 * @param {object} payload - {voice_id, title, creator_name, creator_avatar_url, category, cover_art_url, voice_url}
 */
function buildVoiceEmbed(payload) {
  const {
    title,
    creator_name,
    creator_avatar_url,
    category,
    cover_art_url,
    voice_url,
  } = payload;

  const embed = new EmbedBuilder()
    .setTitle(`🎙 新作：${title || '（無題）'}`)
    .setDescription(`クリエイター：**${creator_name || '不明'}**`)
    .setColor(0x1A4D2E) // VoiPoke ブランドのダークグリーン
    .setTimestamp();

  // URL 設定（Universal Link）はあるときだけ
  if (voice_url) {
    embed.setURL(voice_url);
  }
  if (cover_art_url) {
    embed.setThumbnail(cover_art_url);
  }
  if (creator_name) {
    // アバターは無くてもエラーにならないようガード
    const authorOptions = { name: creator_name };
    if (creator_avatar_url) {
      authorOptions.iconURL = creator_avatar_url;
    }
    embed.setAuthor(authorOptions);
  }
  embed.addFields(
    { name: 'カテゴリ', value: getCategoryDisplayName(category), inline: true }
  );
  embed.setFooter({ text: 'VoiPoke で再生' });

  return embed;
}

/**
 * サマリー投稿用の Embed を作成（スパム抑制時に使用）
 * @param {object} payload
 */
function buildSummaryEmbed(payload) {
  const { creator_name } = payload;
  return new EmbedBuilder()
    .setTitle('📢 連続投稿サマリー')
    .setDescription(`**${creator_name || 'クリエイター'}** さんが本日多数の新作を公開中です。\nVoiPoke アプリで一覧をチェック！`)
    .setColor(0x1A4D2E)
    .setTimestamp();
}

/**
 * 新作ボイス通知を Discord に投稿する本体処理
 *
 * @param {Client} client - discord.js の Client
 * @param {object} payload - VoiPoke 側から送られてきた新作情報
 *   {
 *     voice_id: string,
 *     title: string,
 *     creator_name: string,
 *     creator_avatar_url?: string,
 *     category: string,
 *     cover_art_url?: string,
 *     voice_url?: string
 *   }
 */
async function handleNewVoice(client, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload is required');
  }
  const { creator_name, category } = payload;

  // メインチャンネル ID（必須）
  const mainChannelId = process.env.VOIPOKE_NEW_CHANNEL_ID;
  if (!mainChannelId) {
    throw new Error('VOIPOKE_NEW_CHANNEL_ID is not set');
  }

  // スパム判定キーは creator_name を用いる（VoiPoke 側で id があれば優先したい）
  const creatorKey = payload.creator_id || creator_name || 'unknown';
  const summarize = shouldSendSummary(creatorKey);

  // Embed 作成（サマリー or 通常）
  const embed = summarize ? buildSummaryEmbed(payload) : buildVoiceEmbed(payload);

  // メインチャンネルへ投稿
  try {
    const mainChannel = await client.channels.fetch(mainChannelId);
    await mainChannel.send({ embeds: [embed] });
    console.log(`[VoiPoke] Posted new voice to main channel: ${payload.title}`);
  } catch (err) {
    console.error(`[VoiPoke] Failed to post to main channel ${mainChannelId}:`, err);
    throw err;
  }

  // サマリー時はカテゴリ別チャンネルには投稿しない（連投を抑制）
  if (summarize) return;

  // カテゴリ別チャンネルへ投稿（あれば）
  const categoryChannelId = getCategoryChannelId(category);
  if (categoryChannelId) {
    try {
      const categoryChannel = await client.channels.fetch(categoryChannelId);
      await categoryChannel.send({ embeds: [embed] });
      console.log(`[VoiPoke] Posted new voice to category channel ${category}: ${payload.title}`);
    } catch (err) {
      // カテゴリ別チャンネル投稿失敗はメイン投稿成功なので致命的ではない、ログのみ
      console.error(`[VoiPoke] Failed to post to category channel ${categoryChannelId}:`, err.message);
    }
  }
}

module.exports = {
  handleNewVoice,
  // テスト用に内部関数も export
  _internal: { buildVoiceEmbed, buildSummaryEmbed, shouldSendSummary, getCategoryDisplayName, getCategoryChannelId },
};
