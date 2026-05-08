// handlers/voipoke/grant-login-ticket.js — Discord 投稿時のログインボーナス処理
//
// 用途:
//   - 「今日初投稿」のユーザーに ぼいフォリオのガチャチケット 1 枚を付与
//   - メッセージに 🎫 リアクション + 短い reply（連続日数表示）でフィードバック
//
// 呼び出し元: handlers/participation.js（INSERT INTO user_participation 直後）
//
// 冪等性:
//   - bot 側 daily_login_grants PK = (discord_user_id, granted_date)
//   - ぼいフォリオ側 ticket_grants UNIQUE = (user_id, reason, granted_date)
//   - 二重付与は両層で防がれる

const {
  recordDailyLoginAttempt,
  updateDailyLoginStatus,
  hasEverSentNoLinkDm,
  getCachedLink,
  setCachedLink,
} = require('../../db');

const voilab = require('./voilab-client');

const TICKET_EMOJI = '🎫';
const STREAK_BADGE_DAYS = [7, 14, 30, 50, 100, 150, 200, 300, 365];

function buildBadge(streak) {
  if (STREAK_BADGE_DAYS.includes(streak)) {
    return ` ✨**Day ${streak} 達成！**`;
  }
  return '';
}

/**
 * 今日初投稿だったユーザーに対するログインボーナス処理。
 * 完全に fire-and-forget で呼ばれることを想定し、内部でエラーは握り潰す。
 *
 * @param {Message} message - Discord.js Message オブジェクト
 * @param {string}  discordUserId
 * @param {string}  dateStr - 'YYYY-MM-DD' JST
 * @param {number}  streak  - 今日含む連続日数（participation.js 側で計算済み）
 */
async function tryGrantDailyTicket(message, discordUserId, dateStr, streak = 1) {
  // ----- 1. 冪等性チェック（bot 側）-----
  const { isFirst } = recordDailyLoginAttempt(discordUserId, dateStr);
  if (!isFirst) {
    // 今日もう処理済 → 何もしない
    return { ok: true, alreadyProcessed: true };
  }

  // ----- 2. voilab 接続未設定なら静かにスキップ -----
  if (!voilab.isConfigured()) {
    updateDailyLoginStatus(discordUserId, dateStr, 'no_voilab_config');
    return { ok: false, error: 'voilab_not_configured' };
  }

  // ----- 3. Discord ↔ ぼいフォリオ user_id 解決（cache 1h）-----
  let supabaseUserId = getCachedLink(discordUserId);
  if (supabaseUserId === null) {
    // cache miss → ぼいフォリオに lookup
    const lookup = await voilab.lookupLink(discordUserId);
    if (!lookup.linked) {
      // 未連携：cache に空文字でネガキャ
      setCachedLink(discordUserId, '');
      // 生涯1回だけ DM 案内
      if (!hasEverSentNoLinkDm(discordUserId)) {
        await sendNoLinkDm(message).catch(() => {});
        updateDailyLoginStatus(discordUserId, dateStr, 'no_link_dm_sent');
      } else {
        updateDailyLoginStatus(discordUserId, dateStr, 'no_link');
      }
      return { ok: true, granted: false, reason: 'no_link' };
    }
    supabaseUserId = lookup.supabaseUserId;
    setCachedLink(discordUserId, supabaseUserId);
  } else if (supabaseUserId === '') {
    // ネガティブキャッシュ ヒット
    updateDailyLoginStatus(discordUserId, dateStr, 'no_link');
    return { ok: true, granted: false, reason: 'no_link_cached' };
  }

  // ----- 4. ぼいフォリオに付与 webhook を送る -----
  const result = await voilab.grantTicket(discordUserId, dateStr);
  if (!result.ok) {
    updateDailyLoginStatus(discordUserId, dateStr, 'failed', result.error);
    return result;
  }
  updateDailyLoginStatus(discordUserId, dateStr, 'sent');

  // ----- 5. Discord 上に視覚的フィードバック -----
  await deliverFeedback(message, streak, result.balance).catch((err) => {
    console.warn('[grant-login-ticket] feedback failed:', err.message);
  });

  return { ok: true, granted: true, balance: result.balance, streak };
}

/**
 * 投稿への視覚的フィードバック：🎫 react + 短い reply
 */
async function deliverFeedback(message, streak, balance) {
  // emoji react
  try {
    await message.react(TICKET_EMOJI);
  } catch (err) {
    // emoji react の失敗は致命的ではない
    console.warn('[grant-login-ticket] react failed:', err.message);
  }

  // reply メッセージ
  const badge = buildBadge(streak);
  const balanceText = (typeof balance === 'number') ? `（残り ${balance}🎫）` : '';
  const text = `+1🎫 / 連続 **${streak}** 日目${badge} ${balanceText}`.trim();
  try {
    await message.reply({
      content: text,
      allowedMentions: { repliedUser: false },  // mention 通知は飛ばさない
    });
  } catch (err) {
    console.warn('[grant-login-ticket] reply failed:', err.message);
  }
}

/**
 * 未連携ユーザーへの初回 DM 案内（生涯1回）
 */
async function sendNoLinkDm(message) {
  const text = [
    '🎫 **ぼいフォリオを Discord と連携しませんか？**',
    '',
    'ぼいラボに毎日投稿すると、ぼいフォリオで使える **ガチャチケット 1 枚** を獲得できます。',
    'チケットでデザインガチャやポートフォリオ生成が無制限に。',
    '',
    '👉 連携する: https://voifolio.reverb-lab.com/profile.html',
    '',
    '※ この案内は1度だけ送信されます。',
  ].join('\n');
  await message.author.send(text);
}

module.exports = {
  tryGrantDailyTicket,
};
