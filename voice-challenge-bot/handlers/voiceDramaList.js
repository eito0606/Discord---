// handlers/voiceDramaList.js — M-6 Phase 2-D: 声劇一覧ボタン
//
// ハブの「📋 直近の声劇」ボタンから呼び出される。
// 直近の声劇予定（recruiting / confirmed / seeking_substitute）と
// 過去の声劇（archived）を Embed でまとめて DM 送信。

const { EmbedBuilder } = require('discord.js');
const { db } = require('../db');

const LIST_BUTTON_ID = 'hub_drama_list';

function fmtDate(iso) {
    if (!iso) return '日時未定';
    return new Date(iso).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

async function sendDramaListToUser(user) {
    // 直近予定（未来3週間以内）
    const upcoming = db.prepare(`
        SELECT * FROM voice_drama_events
        WHERE status IN ('recruiting', 'confirmed', 'seeking_substitute')
          AND event_datetime > datetime('now')
        ORDER BY event_datetime ASC
        LIMIT 10
    `).all();

    // 過去5件
    const past = db.prepare(`
        SELECT * FROM voice_drama_events
        WHERE status IN ('archived', 'performed', 'done')
        ORDER BY event_datetime DESC
        LIMIT 5
    `).all();

    const upcomingLines = upcoming.length === 0
        ? '_予定なし。「🎭 声劇を主催」ボタンから新しい声劇を立てよう！_'
        : upcoming.map((e) => {
            const kindEmoji = e.event_kind === 'practice' ? '🧪' : '🎭';
            const statusLabel = {
                recruiting: '📢 募集中',
                confirmed: '✅ 確定',
                seeking_substitute: '🔍 代役募集',
            }[e.status] || e.status;
            return `${kindEmoji} **${e.event_title}**\n　${fmtDate(e.event_datetime)}｜${statusLabel}｜<@${e.host_user_id}>`;
        }).join('\n\n');

    const pastLines = past.length === 0
        ? '_まだ過去の声劇はありません_'
        : past.map((e) => `📜 ${e.event_title}（${fmtDate(e.event_datetime)}）`).join('\n');

    const embed = new EmbedBuilder()
        .setColor(0x1B5E3F)
        .setTitle('📋 ぼいラボ 声劇一覧')
        .addFields(
            {
                name: '🎭 直近の予定',
                value: upcomingLines.slice(0, 1024),
                inline: false,
            },
            {
                name: '📜 過去の声劇',
                value: pastLines.slice(0, 1024),
                inline: false,
            },
        )
        .setFooter({ text: 'Reverb Lab｜声劇' })
        .setTimestamp();

    let dmDelivered = true;
    try {
        await user.send({ embeds: [embed] });
    } catch (err) {
        console.warn('[DramaList] DM 送信失敗:', err.message);
        dmDelivered = false;
    }
    return { ok: true, dmDelivered };
}

async function handleListButton(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const result = await sendDramaListToUser(interaction.user);
    if (result.dmDelivered) {
        await interaction.editReply({ content: '📋 声劇一覧を DM にお送りしました！' });
    } else {
        await interaction.editReply({ content: '❌ DM をお送りできませんでした（DM 受信 OFF？）' });
    }
}

function isListButtonId(customId) {
    return customId === LIST_BUTTON_ID;
}

module.exports = {
    sendDramaListToUser,
    handleListButton,
    isListButtonId,
    LIST_BUTTON_ID,
};
