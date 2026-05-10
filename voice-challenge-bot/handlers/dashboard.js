// handlers/dashboard.js — 投稿者ダッシュボード（D案 + A案ペア状況統合）
//
// 提供形態（呼び出し元）：
//   1. ハブEmbedの「📓 自分の記録」ボタン（推奨、声優志望者向け）
//   2. 管理者向け `!my_dashboard` テキストコマンド（後方互換）
//
// どちらも内部的には sendDashboardToUser(user, client) を呼ぶ。

const { EmbedBuilder } = require('discord.js');
const {
    countParticipationByUser,
    getStreakForUser,
    getSuggestionsReceivedByUser,
    countSuggestionsReceivedByUser,
    getPairsForUser,
    getGroupsForUser,
    getGroupMembers,
} = require('../db');

/**
 * 共通処理：本人にダッシュボードEmbedをDMで送る。
 * @returns {Promise<{ok: boolean, dmDelivered: boolean}>}
 */
async function sendDashboardToUser(user, client) {
    const totalParticipation = safe(() => countParticipationByUser(user.id), 0);
    const streak = safe(() => getStreakForUser(user.id), null);
    const totalSuggestions = safe(() => countSuggestionsReceivedByUser(user.id), 0);
    const recentSuggestions = safe(() => getSuggestionsReceivedByUser(user.id, 5), []);
    const pairs = safe(() => getPairsForUser(user.id), []);
    const groups = safe(() => getGroupsForUser(user.id), []);

    const currentStreak = streak?.current_streak || 0;
    const maxStreak = streak?.max_streak || 0;
    const totalDays = streak?.total_days || 0;

    // ペア相手の displayName
    const pairLines = [];
    for (const pair of pairs) {
        const partnerId = pair.user_a_id === user.id ? pair.user_b_id : pair.user_a_id;
        let partnerName = '同期';
        try {
            const partner = await client.users.fetch(partnerId);
            partnerName = partner.displayName || partner.tag || '同期';
        } catch {}
        pairLines.push(`・${partnerName}`);
    }

    // M-6 Phase 3-B: グループメンバー全員の連続日数を表示
    const groupLines = [];
    for (const g of groups) {
        const members = safe(() => getGroupMembers(g.id), []);
        const memberDetails = [];
        for (const m of members) {
            if (m.user_id === user.id) continue;
            let name = '仲間';
            try {
                const u = await client.users.fetch(m.user_id);
                name = u.displayName || u.tag || '仲間';
            } catch {}
            const memberStreak = safe(() => getStreakForUser(m.user_id), null);
            const streakDays = memberStreak?.current_streak || 0;
            memberDetails.push({ name, streakDays });
        }
        // 連続日数の多い順
        memberDetails.sort((a, b) => b.streakDays - a.streakDays);
        const groupName = g.name || `グループ #${g.id}`;
        const avgStreak = memberDetails.length > 0
            ? Math.round(memberDetails.reduce((sum, m) => sum + m.streakDays, 0) / memberDetails.length)
            : 0;
        const memberStr = memberDetails.length > 0
            ? memberDetails.map((m) => `　・${m.name}：**${m.streakDays}日**`).join('\n')
            : '　_他のメンバーはまだ参加していません_';
        groupLines.push(`**${groupName}**（${members.length}人、平均 ${avgStreak} 日）\n${memberStr}`);
    }

    const suggestionLines = recentSuggestions.map((s) => {
        const date = new Date(s.created_at).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
        const truncated = s.suggestion_text.length > 80
            ? s.suggestion_text.slice(0, 77) + '...'
            : s.suggestion_text;
        return `・[${date}] ${truncated}`;
    });

    const embed = new EmbedBuilder()
        .setColor(0x1B5E3F)
        .setAuthor({
            name: `${user.displayName} さんのダッシュボード`,
            iconURL: user.displayAvatarURL({ dynamic: true, size: 128 }),
        })
        .setTitle('📓 ぼいラボ｜あなたの記録')
        .addFields(
            {
                name: '🔥 連続記録',
                value: `現在 **${currentStreak}日** ／ 最高 **${maxStreak}日** ／ 通算 **${totalDays}日**`,
                inline: false,
            },
            { name: '🎤 累計投稿数', value: `**${totalParticipation}回**`, inline: true },
            { name: '💭 もらった提案', value: `**${totalSuggestions}件**`, inline: true },
            {
                name: '🤝 同期ペア（旧）',
                value: pairLines.length > 0
                    ? pairLines.join('\n')
                    : '_旧ペア機能のデータはなし_',
                inline: false,
            },
            {
                name: '👥 仲間グループ',
                value: groupLines.length > 0
                    ? groupLines.join('\n\n').slice(0, 1024)
                    : '_まだグループがいません。「🤝 同期/仲間を招待」ボタンから始めよう！_',
                inline: false,
            },
            {
                name: '💌 直近の「こんなふうに読んでみて！」',
                value: suggestionLines.length > 0
                    ? suggestionLines.join('\n')
                    : '_まだ提案は届いていません。投稿を続けると、リスナーから声が届くかも🌿_',
                inline: false,
            },
        )
        .setFooter({ text: 'Reverb Lab｜365本ボイスサンプルへの道' })
        .setTimestamp();

    let dmDelivered = true;
    try {
        await user.send({ embeds: [embed] });
    } catch (err) {
        console.warn(`[Dashboard] DM送信失敗: ${err.message}`);
        dmDelivered = false;
    }
    return { ok: true, dmDelivered };
}

/**
 * !my_dashboard コマンド（後方互換）
 */
async function handleMyDashboardCommand(message) {
    const result = await sendDashboardToUser(message.author, message.client);

    if (result.dmDelivered) {
        const notice = await message.reply({
            content: `📓 <@${message.author.id}> ダッシュボードをDMにお送りしました。`,
            allowedMentions: { users: [message.author.id] },
        }).catch(() => null);
        if (notice) setTimeout(() => notice.delete().catch(() => {}), 10_000);
    } else {
        await message.reply({
            content: '❌ DMをお送りできませんでした（DM受信OFFの可能性）。設定を確認してから再度お試しください。',
        }).catch(() => {});
    }
    await message.delete().catch(() => {});
}

function safe(fn, fallback) {
    try {
        return fn();
    } catch (err) {
        console.error('[Dashboard] safe call failed:', err.message);
        return fallback;
    }
}

module.exports = {
    sendDashboardToUser,
    handleMyDashboardCommand,
};
