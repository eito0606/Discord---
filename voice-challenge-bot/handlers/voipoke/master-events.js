// master-events.js — マスタープラン会員限定イベント機能
// マスタープラン（VoiPoke の最上位サブスク）会員に対して特典を提供することで
// ロイヤリティを高める仕組み。
//
// 提供機能：
//   F-1: /master-coupon スラッシュコマンド … 管理者がクーポンを配布
//   F-2: 月次マスターボーナス cron       … 毎月1日 09:00 にポケ銭配布
//
// 注意：このファイルはコマンド定義と関数を export するだけ。
//      スラッシュコマンドの登録（REST 経由）と cron への組み込みは
//      呼び出し側（index.js / cron.js）で別途行うこと。

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

/**
 * メンバーが Bot 管理者かどうか判定する
 * - Discord 側の Administrator 権限を持っているかをチェック
 *   （より厳密にやるなら BOT_ADMIN_USER_IDS 環境変数で個別指定する設計も可）
 *
 * @param {GuildMember} member
 * @returns {boolean}
 */
function isAdmin(member) {
  if (!member) return false;
  try {
    return member.permissions.has(PermissionFlagsBits.Administrator);
  } catch (err) {
    console.error('[VoiPoke] isAdmin check failed:', err);
    return false;
  }
}

/**
 * VoiPoke 側にクーポンを登録する
 * Supabase Edge Function /functions/v1/register-coupon を叩く
 *
 * @param {string} couponCode
 * @param {number} discount - 割引率(%)
 * @param {string} validUntil - 有効期限（YYYY-MM-DD）
 * @param {string} eligibility - 'master_only' など
 */
async function registerCouponInVoiPoke(couponCode, discount, validUntil, eligibility) {
  const supabaseUrl = process.env.VOIPOKE_SUPABASE_URL;
  const secret = process.env.VOIPOKE_WEBHOOK_SECRET;
  if (!supabaseUrl || !secret) {
    throw new Error('VOIPOKE_SUPABASE_URL or VOIPOKE_WEBHOOK_SECRET is not set');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/register-coupon`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': secret,
    },
    body: JSON.stringify({
      coupon_code: couponCode,
      discount_percent: discount,
      valid_until: validUntil,
      eligibility,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`VoiPoke register-coupon failed: ${response.status} ${text}`);
  }
  return await response.json().catch(() => ({}));
}

/**
 * /master-coupon スラッシュコマンド定義
 * - 管理者だけが実行可能
 * - VoiPoke 側にクーポン登録 → マスター限定チャンネルに告知
 *
 * 使い方：
 *   /master-coupon coupon_code:MASTER-2026-05-XYZ discount_percent:30 valid_until:2026-05-31
 */
const masterCouponCommand = {
  data: new SlashCommandBuilder()
    .setName('master-coupon')
    .setDescription('マスター限定クーポンを配布する（管理者専用）')
    .addStringOption(option =>
      option.setName('coupon_code')
        .setDescription('クーポンコード（例：MASTER-2026-05-XYZ）')
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
    // 管理者チェック
    if (!isAdmin(interaction.member)) {
      return interaction.reply({
        content: '⚠️ このコマンドは管理者のみ実行可能です。',
        ephemeral: true,
      });
    }

    const couponCode = interaction.options.getString('coupon_code');
    const discount = interaction.options.getInteger('discount_percent');
    const validUntil = interaction.options.getString('valid_until');

    // 割引率の簡易バリデーション
    if (discount < 1 || discount > 100) {
      return interaction.reply({
        content: '⚠️ 割引率は 1〜100 の範囲で指定してください。',
        ephemeral: true,
      });
    }

    // 即時応答で "考え中" 状態にする（外部APIで時間がかかるため）
    await interaction.deferReply({ ephemeral: true });

    try {
      // VoiPoke API にクーポン登録
      await registerCouponInVoiPoke(couponCode, discount, validUntil, 'master_only');

      // マスター限定チャンネルに告知投稿
      const eventChannelId = process.env.MASTER_EVENT_CHANNEL_ID;
      if (!eventChannelId) {
        throw new Error('MASTER_EVENT_CHANNEL_ID is not set');
      }
      const eventChannel = await interaction.client.channels.fetch(eventChannelId);

      const embed = new EmbedBuilder()
        .setTitle('🎁 マスター限定クーポン配布')
        .setDescription(
          `**コード**：\`${couponCode}\`\n` +
          `**割引**：${discount}%OFF\n` +
          `**有効期限**：${validUntil}`
        )
        .setColor(0xFFD700) // ゴールド（マスターロールの色と一致）
        .setFooter({ text: 'マスタープラン会員のみ利用可能' })
        .setTimestamp();

      await eventChannel.send({ embeds: [embed] });

      await interaction.editReply({ content: `✅ クーポン \`${couponCode}\` を配布しました。` });
    } catch (err) {
      console.error('[VoiPoke] master-coupon error:', err);
      await interaction.editReply({ content: `❌ クーポン配布に失敗しました：${err.message}` });
    }
  },
};

/**
 * 月次マスターボーナス配布処理（cron から呼ばれる）
 *
 * - VoiPoke の Edge Function /functions/v1/grant-master-monthly-bonus を叩く
 * - 結果をマスター限定チャンネルに通知
 *
 * @param {Client} client - discord.js の Client
 * @param {number} bonusAmount - 配布するポケ銭額（既定 50）
 */
async function distributeMonthlyMasterBonus(client, bonusAmount = 50) {
  const supabaseUrl = process.env.VOIPOKE_SUPABASE_URL;
  const secret = process.env.VOIPOKE_WEBHOOK_SECRET;
  if (!supabaseUrl || !secret) {
    console.error('[VoiPoke] Cannot distribute master bonus: VOIPOKE_SUPABASE_URL or VOIPOKE_WEBHOOK_SECRET not set');
    return;
  }

  const month = new Date().toISOString().slice(0, 7); // YYYY-MM

  console.log(`[VoiPoke] Starting monthly master bonus distribution (${month})`);

  let result = { recipient_count: 0 };
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/grant-master-monthly-bonus`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': secret,
      },
      body: JSON.stringify({
        bonus_amount: bonusAmount,
        reason: 'master_monthly_bonus',
        month,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`grant-master-monthly-bonus failed: ${response.status} ${text}`);
    }
    result = await response.json().catch(() => ({ recipient_count: 0 }));
  } catch (err) {
    console.error('[VoiPoke] Monthly master bonus API call failed:', err);
    return; // 失敗時はチャンネル通知もスキップ
  }

  // 配布完了をマスターチャンネルに通知
  try {
    const eventChannelId = process.env.MASTER_EVENT_CHANNEL_ID;
    if (!eventChannelId) {
      console.warn('[VoiPoke] MASTER_EVENT_CHANNEL_ID not set, skipping notification');
      return;
    }
    const channel = await client.channels.fetch(eventChannelId);
    const embed = new EmbedBuilder()
      .setTitle('🎁 月次ボーナス配布完了')
      .setDescription(
        `マスター会員 **${result.recipient_count ?? '?'}名** に ` +
        `**${bonusAmount}ポケ銭** を配布しました！\n\n` +
        `今月もご愛顧ありがとうございます。`
      )
      .setColor(0xFFD700)
      .setTimestamp();
    await channel.send({ embeds: [embed] });
    console.log(`[VoiPoke] Master bonus distributed to ${result.recipient_count} members`);
  } catch (err) {
    console.error('[VoiPoke] Failed to post master bonus notification:', err);
  }
}

module.exports = {
  masterCouponCommand,
  distributeMonthlyMasterBonus,
  // テスト用に内部関数も export
  _internal: { isAdmin, registerCouponInVoiPoke },
};
