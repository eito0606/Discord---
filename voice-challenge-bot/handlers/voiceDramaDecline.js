// handlers/voiceDramaDecline.js — M-6 Phase 2-B: 辞退・代役募集
//
// 確定後の役者が「やっぱり出れない」となったときの辞退フロー。
// 1. 辞退ボタン押下 → Modal で理由記入
// 2. 主催者と他キャストに DM 通知
// 3. ステータスを 'seeking_substitute' に
// 4. 募集 Embed に「🔍 代役を募集」ボタンを表示
// 5. 代役募集中は空き役のみ再立候補可能

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');

const {
    getVoiceDramaEvent,
    getVoiceDramaParticipants,
    getConfirmedParticipants,
    updateParticipantStatus,
    updateVoiceDramaEventStatus,
} = require('../db');

const DECLINE_BUTTON_PREFIX = 'vd_decline_';
const DECLINE_MODAL_PREFIX = 'vd_decline_modal_';
const SEEK_SUB_BUTTON_PREFIX = 'vd_seek_sub_';

function isDeclineButtonId(customId) {
    return typeof customId === 'string' && customId.startsWith(DECLINE_BUTTON_PREFIX);
}
function isDeclineModalId(customId) {
    return typeof customId === 'string' && customId.startsWith(DECLINE_MODAL_PREFIX);
}
function isSeekSubstituteButtonId(customId) {
    return typeof customId === 'string' && customId.startsWith(SEEK_SUB_BUTTON_PREFIX);
}

/**
 * 「🙇 辞退する」ボタン → Modal で理由入力
 */
async function handleDeclineButton(interaction) {
    const eventId = parseInt(interaction.customId.replace(DECLINE_BUTTON_PREFIX, ''), 10);
    const event = getVoiceDramaEvent(eventId);
    if (!event) {
        await interaction.reply({ content: '❌ イベントが見つかりません。', ephemeral: true });
        return;
    }

    const confirmed = getConfirmedParticipants(eventId);
    const myRole = confirmed.find((p) => p.user_id === interaction.user.id);
    if (!myRole) {
        await interaction.reply({ content: '⚠️ あなたはこの公演の確定キャストではありません。', ephemeral: true });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`${DECLINE_MODAL_PREFIX}${eventId}_${encodeURIComponent(myRole.character_name)}`)
        .setTitle('🙇 辞退の理由を入力');
    const reason = new TextInputBuilder()
        .setCustomId('decline_reason')
        .setLabel('辞退の理由（主催者と他キャストに通知されます）')
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(10)
        .setMaxLength(400)
        .setRequired(true)
        .setPlaceholder('例: 急な体調不良のため、出演が難しくなりました。');
    modal.addComponents(new ActionRowBuilder().addComponents(reason));

    try {
        await interaction.showModal(modal);
    } catch (err) {
        console.error('[Decline] Modal 表示失敗:', err);
        await interaction.reply({ content: '❌ Modal の表示に失敗しました。', ephemeral: true }).catch(() => {});
    }
}

/**
 * 辞退 Modal Submit → ステータス変更 + 通知
 */
async function handleDeclineModalSubmit(interaction) {
    const rest = interaction.customId.replace(DECLINE_MODAL_PREFIX, '');
    const sepIdx = rest.indexOf('_');
    const eventId = parseInt(rest.slice(0, sepIdx), 10);
    const characterName = decodeURIComponent(rest.slice(sepIdx + 1));
    const reason = interaction.fields.getTextInputValue('decline_reason')?.trim() || '';

    const event = getVoiceDramaEvent(eventId);
    if (!event) {
        await interaction.reply({ content: '❌ イベントが見つかりません。', ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    // 辞退者のステータスを 'declined' に
    updateParticipantStatus(eventId, interaction.user.id, characterName, 'declined');
    // イベントステータスを「代役募集中」に
    updateVoiceDramaEventStatus(eventId, 'seeking_substitute');

    // 主催者・他キャストに DM
    const confirmed = getConfirmedParticipants(eventId);
    const notifyIds = new Set([event.host_user_id, ...confirmed.map((p) => p.user_id)]);
    notifyIds.delete(interaction.user.id);

    const notifyEmbed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('🙇 キャスト辞退のお知らせ')
        .setDescription([
            `📖 **${event.event_title}**`,
            '',
            `<@${interaction.user.id}> さん（**${characterName}** 役）が辞退となりました。`,
            '',
            `**理由**`,
            reason,
            '',
            '主催者は **「🔍 代役を募集」** ボタンから代役探しを始められます。',
        ].join('\n'))
        .setFooter({ text: 'Reverb Lab｜声劇' });

    for (const uid of notifyIds) {
        try {
            const u = await interaction.client.users.fetch(uid);
            await u.send({ embeds: [notifyEmbed] });
        } catch (err) { /* ignore */ }
    }

    // 主催者にだけ代役募集ボタンを別途送る
    try {
        const host = await interaction.client.users.fetch(event.host_user_id);
        await host.send({
            embeds: [new EmbedBuilder()
                .setColor(0xE67E22)
                .setTitle('🔍 代役を募集できます')
                .setDescription(`**${characterName}** 役の代役募集ボタンです。`)],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`${SEEK_SUB_BUTTON_PREFIX}${eventId}_${encodeURIComponent(characterName)}`)
                    .setLabel('代役を募集')
                    .setEmoji('🔍')
                    .setStyle(ButtonStyle.Primary),
            )],
        });
    } catch (err) {
        console.warn('[Decline] 主催者 DM 失敗:', err.message);
    }

    await interaction.editReply({ content: '🙇 辞退を受け付けました。主催者と他キャストに通知しました。' });
}

/**
 * 「🔍 代役を募集」ボタン → 募集チャンネルに代役募集 Embed 投稿
 */
async function handleSeekSubstituteButton(interaction) {
    const rest = interaction.customId.replace(SEEK_SUB_BUTTON_PREFIX, '');
    const sepIdx = rest.indexOf('_');
    const eventId = parseInt(rest.slice(0, sepIdx), 10);
    const characterName = decodeURIComponent(rest.slice(sepIdx + 1));

    const event = getVoiceDramaEvent(eventId);
    if (!event) {
        await interaction.reply({ content: '❌ イベントが見つかりません。', ephemeral: true });
        return;
    }
    if (event.host_user_id !== interaction.user.id) {
        await interaction.reply({ content: '⚠️ 主催者のみ操作できます。', ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const character = (event.characters || []).find((c) => c.name === characterName);
    if (!character) {
        await interaction.editReply({ content: '❌ 該当の役が見つかりません。' });
        return;
    }

    const channel = await interaction.client.channels.fetch(event.recruit_channel_id).catch(() => null);
    if (!channel) {
        await interaction.editReply({ content: '❌ 募集チャンネルが見つかりません。' });
        return;
    }

    const formattedDate = new Date(event.event_datetime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const embed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('🔍 代役募集！')
        .setDescription([
            `📖 **${event.event_title}**`,
            '',
            `主催: <@${event.host_user_id}>`,
            `開演: ${formattedDate}`,
            '',
            `🆘 **${character.emoji} ${character.name}** 役の代役を探しています。`,
            '',
            '立候補したい方は **下のリアクション** を押してください。',
        ].join('\n'))
        .setFooter({ text: `イベントID: ${eventId}｜代役募集` });

    const msg = await channel.send({ embeds: [embed] });
    await msg.react(character.emoji);

    await interaction.editReply({ content: `🔍 <#${channel.id}> に代役募集 Embed を投稿しました。` });
}

module.exports = {
    handleDeclineButton,
    handleDeclineModalSubmit,
    handleSeekSubstituteButton,
    isDeclineButtonId,
    isDeclineModalId,
    isSeekSubstituteButtonId,
    DECLINE_BUTTON_PREFIX,
    SEEK_SUB_BUTTON_PREFIX,
};
