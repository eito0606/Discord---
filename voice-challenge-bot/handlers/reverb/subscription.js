// handlers/reverb/subscription.js — Reverb 通知ロールの opt-in 管理
//
// 「Reverb ニュース」チャンネルの一番上に固定する案内メッセージを設置し、
// 🔔リアクションを押した人に通知ロールを付与、外したら剥奪する。
//
// 強制通知だとぼいラボの空気にあわないので、必ず opt-in にする。

const { buildSubscriptionEmbed } = require('./embed-builder');

const TARGET_EMOJI = '🔔';
// 案内メッセージかどうかを後から判定するためのマーカー（footer 文字列で識別）
const FOOTER_MARKER = 'opt-in通知';

/**
 * 指定チャンネルに通知ロール案内メッセージを設置（既存のものは削除して張り直し）
 *
 * @param {TextChannel} channel - 設置先チャンネル
 */
async function setupReverbSubscriptionMessage(channel) {
  // 過去に Bot が貼った案内メッセージを探して削除（古い案内を残さない）
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    const oldGuides = messages.filter(
      (m) =>
        m.author.id === channel.client.user.id &&
        m.embeds.length > 0 &&
        m.embeds[0].footer?.text?.includes(FOOTER_MARKER),
    );
    for (const m of oldGuides.values()) {
      await m.delete().catch(() => {});
    }
  } catch (err) {
    console.warn('[Reverb] 既存案内の削除中にエラー:', err.message);
  }

  // 新規設置
  const embed = buildSubscriptionEmbed();
  const message = await channel.send({ embeds: [embed] });
  await message.react(TARGET_EMOJI);

  console.log(`[Reverb] 通知ロール案内を設置: ${channel.id}`);
  return message;
}

/**
 * このメッセージが「Reverb 通知ロール案内」かどうかを判定
 * リアクションのadd/remove時に余計なメッセージを処理しないためのフィルター
 */
function isSubscriptionMessage(message) {
  if (!message || !message.embeds || message.embeds.length === 0) return false;
  return message.embeds[0].footer?.text?.includes(FOOTER_MARKER) === true;
}

/**
 * 🔔リアクションが追加されたら、対象ユーザーに通知ロールを付与
 *
 * @param {MessageReaction} reaction
 * @param {User} user
 */
async function handleReverbReactionAdd(reaction, user) {
  if (user.bot) return;
  if (reaction.emoji.name !== TARGET_EMOJI) return;
  if (!isSubscriptionMessage(reaction.message)) return;

  const roleId = process.env.REVERB_NOTIFY_ROLE_ID;
  if (!roleId) {
    console.warn('[Reverb] REVERB_NOTIFY_ROLE_ID 未設定のためロール付与スキップ');
    return;
  }

  try {
    const guild = reaction.message.guild;
    if (!guild) return;
    const member = await guild.members.fetch(user.id);
    await member.roles.add(roleId);
    console.log(`[Reverb] 通知ロール付与: ${user.tag}`);
  } catch (err) {
    console.error(`[Reverb] ロール付与失敗 (${user.tag}):`, err.message);
  }
}

/**
 * 🔔リアクションが外されたら、対象ユーザーから通知ロールを剥奪
 */
async function handleReverbReactionRemove(reaction, user) {
  if (user.bot) return;
  if (reaction.emoji.name !== TARGET_EMOJI) return;
  if (!isSubscriptionMessage(reaction.message)) return;

  const roleId = process.env.REVERB_NOTIFY_ROLE_ID;
  if (!roleId) return;

  try {
    const guild = reaction.message.guild;
    if (!guild) return;
    const member = await guild.members.fetch(user.id);
    await member.roles.remove(roleId);
    console.log(`[Reverb] 通知ロール解除: ${user.tag}`);
  } catch (err) {
    console.error(`[Reverb] ロール解除失敗 (${user.tag}):`, err.message);
  }
}

module.exports = {
  setupReverbSubscriptionMessage,
  isSubscriptionMessage,
  handleReverbReactionAdd,
  handleReverbReactionRemove,
};
