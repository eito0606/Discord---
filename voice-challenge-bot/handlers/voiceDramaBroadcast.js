// handlers/voiceDramaBroadcast.js — M-6 Phase 3-D / 3-F: X 配信許可フロー + SNS 自動シェア
//
// フロー：
//   1. 主催者対話の最後に「公式 X で告知 + 配信する？」ボタンを提示
//   2. キャスト確定後、確定 DM に「✅ X 配信に同意 / ❌ 同意しない」ボタンを表示
//   3. 全員 ✅ が揃ったら、運営ログ（OPS_LOG_CHANNEL_ID）に構造化 Embed を投稿
//   4. Bot が運営ログを監視し、構造化 Embed を検知したら：
//      - 開演 30分前に X に告知ツイート
//      - 開演中に Discord Stage 自動作成 + 録音
//      - 終演後にアーカイブ + YouTube アップロード + 完了ツイート
//
// X API / YouTube API は env が無ければ「投稿しないで運営ログのみ」になる（スタブ動作）。

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { db } = require('../db');

const BROADCAST_CONSENT_AGREE_PREFIX = 'vd_bc_agree_';
const BROADCAST_CONSENT_DECLINE_PREFIX = 'vd_bc_decline_';
const BROADCAST_REQUEST_BUTTON_PREFIX = 'vd_bc_request_';

function isBroadcastConsentButtonId(customId) {
    return typeof customId === 'string'
        && (customId.startsWith(BROADCAST_CONSENT_AGREE_PREFIX) || customId.startsWith(BROADCAST_CONSENT_DECLINE_PREFIX));
}
function isBroadcastRequestButtonId(customId) {
    return typeof customId === 'string' && customId.startsWith(BROADCAST_REQUEST_BUTTON_PREFIX);
}

/**
 * 主催者対話の最後に呼び出す。「X 配信を希望するか」を尋ねるボタンを送る。
 */
async function offerBroadcastRequest(thread, eventId) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${BROADCAST_REQUEST_BUTTON_PREFIX}${eventId}_yes`)
            .setLabel('公式 X で配信したい')
            .setEmoji('📡')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`${BROADCAST_REQUEST_BUTTON_PREFIX}${eventId}_no`)
            .setLabel('内輪だけで開催')
            .setEmoji('🤫')
            .setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
        embeds: [new EmbedBuilder()
            .setColor(0x1B5E3F)
            .setTitle('📡 X 配信オプション')
            .setDescription([
                'この声劇を **公式 X アカウント（@itty_voice + @voilab_official）** で',
                '告知 + ライブ配信できます。',
                '',
                '配信を選ぶと：',
                '・ キャスト全員に「配信に同意するか」確認 DM が届きます',
                '・ 全員の同意が揃ったら、開演 30分前に X 告知',
                '・ 開演中に Discord Stage で配信 + 録音',
                '・ 終演後に YouTube にアーカイブを公開',
                '',
                '内輪開催を選ぶと、SNS には何も投稿されません。',
            ].join('\n'))],
        components: [row],
    });
}

/**
 * 主催者が「配信したい」を選んだとき → broadcast_status を 'pending' に
 * 確定後のキャストに同意 DM を送るフラグだけ立てる（実送信は announceRoles 後）
 */
async function handleBroadcastRequest(interaction) {
    const rest = interaction.customId.replace(BROADCAST_REQUEST_BUTTON_PREFIX, '');
    const lastUnderscore = rest.lastIndexOf('_');
    const eventId = parseInt(rest.slice(0, lastUnderscore), 10);
    const choice = rest.slice(lastUnderscore + 1); // 'yes' | 'no'

    const newStatus = choice === 'yes' ? 'pending' : 'not_requested';
    db.prepare(`UPDATE voice_drama_events SET broadcast_status = ? WHERE id = ?`).run(newStatus, eventId);

    await interaction.update({
        content: choice === 'yes'
            ? '📡 キャスト確定後、全員に配信同意確認 DM が届きます。'
            : '🤫 内輪開催で進めます。',
        components: [],
    });
}

/**
 * キャスト確定（announceRoles）後に呼ばれる。broadcast_status='pending' なら全員に同意 DM を送る。
 */
async function requestBroadcastConsents(client, event) {
    if (event.broadcast_status !== 'pending') return;
    const eventId = event.id;
    const confirmedRows = db.prepare(`
        SELECT user_id FROM voice_drama_participants
        WHERE event_id = ? AND status = 'confirmed'
    `).all(eventId);

    const embed = new EmbedBuilder()
        .setColor(0x1B5E3F)
        .setTitle('📡 X 配信への同意を確認させてください')
        .setDescription([
            `📖 **${event.event_title}**`,
            '',
            'この公演を **公式 X アカウント（@itty_voice + @voilab_official）** で告知 + ライブ配信したいと',
            '主催者が希望しています。',
            '',
            'あなたが配信に同意する場合は **「✅ 同意」**、',
            '映りたくない場合は **「❌ 同意しない」** を選んでください。',
            '',
            '_全員が ✅ を押したときだけ配信が実行されます。1人でも ❌ なら内輪開催になります。_',
        ].join('\n'));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${BROADCAST_CONSENT_AGREE_PREFIX}${eventId}`)
            .setLabel('同意')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`${BROADCAST_CONSENT_DECLINE_PREFIX}${eventId}`)
            .setLabel('同意しない')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger),
    );

    for (const c of confirmedRows) {
        try {
            const u = await client.users.fetch(c.user_id);
            await u.send({ embeds: [embed], components: [row] });
        } catch (err) {
            console.warn('[Broadcast] 同意 DM 失敗:', err.message);
        }
    }
}

/**
 * 同意ボタンが押されたとき → broadcast_consents に追加、全員揃ったら運営ログに構造化 Embed
 */
async function handleConsentButton(interaction) {
    const isAgree = interaction.customId.startsWith(BROADCAST_CONSENT_AGREE_PREFIX);
    const prefix = isAgree ? BROADCAST_CONSENT_AGREE_PREFIX : BROADCAST_CONSENT_DECLINE_PREFIX;
    const eventId = parseInt(interaction.customId.replace(prefix, ''), 10);
    const event = db.prepare('SELECT * FROM voice_drama_events WHERE id = ?').get(eventId);
    if (!event) {
        await interaction.update({ content: '❌ イベントが見つかりません。', embeds: [], components: [] });
        return;
    }

    if (!isAgree) {
        // 1人でも ❌ → 配信中止
        db.prepare(`UPDATE voice_drama_events SET broadcast_status = 'declined' WHERE id = ?`).run(eventId);
        await interaction.update({
            content: '🤫 配信は行わないことになりました。あなたの選択を尊重します。',
            embeds: [],
            components: [],
        });
        // 主催者に通知
        try {
            const host = await interaction.client.users.fetch(event.host_user_id);
            await host.send({
                embeds: [new EmbedBuilder()
                    .setColor(0x808080)
                    .setTitle('🤫 配信中止のお知らせ')
                    .setDescription([
                        `📖 **${event.event_title}**`,
                        '',
                        'キャストの1人が配信に同意しなかったため、',
                        'この公演は **内輪開催** となります。',
                    ].join('\n'))],
            });
        } catch {}
        return;
    }

    // 同意リスト更新
    const consents = JSON.parse(event.broadcast_consents || '[]');
    if (!consents.includes(interaction.user.id)) consents.push(interaction.user.id);
    db.prepare(`UPDATE voice_drama_events SET broadcast_consents = ? WHERE id = ?`).run(JSON.stringify(consents), eventId);

    // 全員揃ったかチェック
    const confirmedIds = db.prepare(`
        SELECT user_id FROM voice_drama_participants
        WHERE event_id = ? AND status = 'confirmed'
    `).all(eventId).map((r) => r.user_id);
    const allAgree = confirmedIds.every((id) => consents.includes(id));

    await interaction.update({
        content: allAgree
            ? '🎉 全員の同意が揃いました！配信実行に進みます。'
            : `✅ 同意ありがとうございます。残り ${confirmedIds.length - consents.length} 人の同意待ち。`,
        embeds: [],
        components: [],
    });

    if (allAgree) {
        db.prepare(`UPDATE voice_drama_events SET broadcast_status = 'consented' WHERE id = ?`).run(eventId);
        await postOpsLogStructured(interaction.client, eventId);
    }
}

/**
 * 運営ログに構造化 Embed を投稿（Bot が後でこれを検知して X/Stage 自動化を起動）
 */
async function postOpsLogStructured(client, eventId) {
    const opsId = process.env.OPS_LOG_CHANNEL_ID;
    if (!opsId) {
        console.warn('[Broadcast] OPS_LOG_CHANNEL_ID 未設定、ログ投稿スキップ');
        return;
    }
    const event = db.prepare('SELECT * FROM voice_drama_events WHERE id = ?').get(eventId);
    if (!event) return;
    const confirmedIds = db.prepare(`
        SELECT user_id FROM voice_drama_participants
        WHERE event_id = ? AND status = 'confirmed'
    `).all(eventId).map((r) => r.user_id);

    const embed = new EmbedBuilder()
        .setColor(0x3FE0A0)
        .setTitle('📡 X 配信許可成立')
        .addFields(
            { name: 'イベントID', value: String(eventId), inline: true },
            { name: '主催者', value: `<@${event.host_user_id}>`, inline: true },
            { name: 'タイトル', value: event.event_title, inline: false },
            { name: '開演日時', value: new Date(event.event_datetime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }), inline: false },
            { name: 'キャスト', value: confirmedIds.map((id) => `<@${id}>`).join(', '), inline: false },
            { name: '配信OK', value: `全員 ✓（${confirmedIds.length}名）`, inline: true },
            { name: 'ステージch', value: event.stage_channel_id ? `<#${event.stage_channel_id}>` : '未設定', inline: true },
            { name: 'broadcast_status', value: 'consented', inline: true },
        )
        .setFooter({ text: 'M-6 自動判定マーカー｜vd-broadcast-ready' })
        .setTimestamp();

    try {
        const ch = await client.channels.fetch(opsId);
        await ch.send({ embeds: [embed] });
    } catch (err) {
        console.error('[Broadcast] 運営ログ投稿失敗:', err);
    }
}

/**
 * アーカイブ後に SNS に投稿（スタブ：X API 未設定なら何もしない）
 * @returns void（投稿失敗は warning ログのみ）
 */
async function shareArchiveToSNS(client, event, archiveMsg) {
    // 配信許可がなかった内輪公演はシェアしない
    if (event.broadcast_status !== 'consented' && event.broadcast_status !== 'broadcasting') {
        return;
    }
    // X API 未設定ならスキップ
    if (!process.env.X_API_KEY || !process.env.X_API_SECRET) {
        console.log(`[Broadcast] X API 未設定のため、アーカイブシェアはスタブ動作（${event.id}）`);
        return;
    }
    // ここで X / Threads に POST する実装（後日 OAuth 連携が整ってから実装）
    console.log(`[Broadcast] X / Threads シェア未実装（${event.id}）`);
}

module.exports = {
    offerBroadcastRequest,
    requestBroadcastConsents,
    handleBroadcastRequest,
    handleConsentButton,
    isBroadcastRequestButtonId,
    isBroadcastConsentButtonId,
    postOpsLogStructured,
    shareArchiveToSNS,
};
