// handlers/voipoke/new-member-guard.js — 新規メンバーの自動モデレーション
//
// M-5: ぼいラボ Discord 自動招待化
//
// 役割:
//   ① 新規アカウント（作成 3 日未満）の入室時に #運営ログ にアラート
//   ② 入室後 5 分以内に同じメッセージを 3 回以上投稿したら 24h タイムアウト
//   ③ ban の最終判断は人間（エイト）が行う。Bot は通知 + タイムアウトまで
//
// 仕様参照: /Users/hidehisa/【監督】/specs/M-5-community-design-2026-05-07.md D セクション

const { EmbedBuilder, Events } = require('discord.js');

// メモリ内の発言履歴（メンバーごと、入室から一定時間のみ保持）
// key: discordUserId, value: { joinedAt: Date, messages: Array<{content, ts}> }
const recentJoiners = new Map();
const JOINER_WINDOW_MS = 5 * 60 * 1000; // 入室後 5 分間だけ監視
const SPAM_THRESHOLD = 3;               // 同一メッセージ N 回でアウト
const TIMEOUT_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
const NEW_ACCOUNT_DAYS = 3;             // アカウント作成 N 日未満で警告

/**
 * #運営ログ チャンネルを取得（無ければ null）
 */
async function getOpsLogChannel(client) {
    const channelId = process.env.OPS_LOG_CHANNEL_ID;
    if (!channelId) return null;
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel && channel.isTextBased && channel.isTextBased()) return channel;
    } catch (err) {
        console.error('[new-member-guard] failed to fetch ops log channel:', err);
    }
    return null;
}

/**
 * 新規メンバー入室時のハンドラ：作成 3 日未満なら #運営ログ に通知
 */
async function handleGuildMemberAdd(client, member) {
    if (!member || !member.user) return;
    const accountAgeMs = Date.now() - member.user.createdAt.getTime();
    const accountAgeDays = accountAgeMs / (24 * 60 * 60 * 1000);

    // 監視対象に登録（5 分後に自動 cleanup）
    recentJoiners.set(member.id, { joinedAt: new Date(), messages: [] });
    setTimeout(() => recentJoiners.delete(member.id), JOINER_WINDOW_MS);

    if (accountAgeDays < NEW_ACCOUNT_DAYS) {
        const channel = await getOpsLogChannel(client);
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle('🟠 新規アカウント入室アラート')
            .setDescription(`${member.user.tag}（${member.id}）が入室しました。`)
            .addFields(
                { name: 'アカウント作成', value: member.user.createdAt.toISOString(), inline: true },
                { name: '経過日数', value: `${accountAgeDays.toFixed(1)} 日`, inline: true },
            )
            .setFooter({ text: 'M-5 自動モデレーション。エイトの目視確認推奨。' })
            .setTimestamp(new Date());
        try {
            await channel.send({ embeds: [embed] });
        } catch (err) {
            console.error('[new-member-guard] failed to send alert:', err);
        }
    }
}

/**
 * メッセージ投稿時のスパム監視：入室から 5 分以内に同じ内容を 3 回 → 24h タイムアウト
 */
async function handleMessageCreate(client, message) {
    if (!message || message.author.bot) return;
    if (!message.guild) return; // DM は対象外

    const userId = message.author.id;
    const tracker = recentJoiners.get(userId);
    if (!tracker) return; // 入室から 5 分超 or 監視対象外

    const content = (message.content || '').trim();
    if (!content) return;

    tracker.messages.push({ content, ts: Date.now() });
    // 同一メッセージのカウント
    const sameCount = tracker.messages.filter(m => m.content === content).length;
    if (sameCount < SPAM_THRESHOLD) return;

    // タイムアウト発動
    try {
        const member = await message.guild.members.fetch(userId);
        await member.timeout(TIMEOUT_DURATION_MS, '入室直後の連続同文投稿（M-5 自動モデレーション）');
        console.log(`[new-member-guard] Timed out ${userId} for spam`);
    } catch (err) {
        console.error('[new-member-guard] failed to timeout member:', err);
    }

    // #運営ログ に通知
    const channel = await getOpsLogChannel(client);
    if (channel) {
        const embed = new EmbedBuilder()
            .setColor(0xC0392B)
            .setTitle('🔴 連続同文投稿でタイムアウト適用')
            .setDescription(`${message.author.tag}（${userId}）に 24h タイムアウトを適用しました。`)
            .addFields(
                { name: '投稿内容', value: content.slice(0, 500), inline: false },
                { name: '投稿回数', value: `${sameCount} 回`, inline: true },
            )
            .setFooter({ text: 'BAN 判断はエイト承認制。確認のうえ対応してください。' })
            .setTimestamp(new Date());
        try {
            await channel.send({ embeds: [embed] });
        } catch (err) {
            console.error('[new-member-guard] failed to send timeout alert:', err);
        }
    }

    // 監視対象から外す（重複通知防止）
    recentJoiners.delete(userId);
}

/**
 * Discord Client にイベントリスナを登録する
 * @param {Client} client - discord.js Client
 */
function registerNewMemberGuard(client) {
    client.on(Events.GuildMemberAdd, (member) => handleGuildMemberAdd(client, member));
    client.on(Events.MessageCreate, (message) => handleMessageCreate(client, message));
    console.log('[new-member-guard] registered listeners (GuildMemberAdd + MessageCreate)');
}

module.exports = {
    registerNewMemberGuard,
    // テスト用
    handleGuildMemberAdd,
    handleMessageCreate,
};
