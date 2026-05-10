// handlers/group/dissolve.js — M-6 グループ解散フロー（2重チェック付き）
//
// 押し間違い防止：Modal でグループ名を入力させて、一致したら解散実行。

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
    getGroupsForUser,
    getGroupById,
    getGroupMembers,
    dissolveGroup,
} = require('../../db');

const DISSOLVE_OPEN_BUTTON = 'group_dissolve_open';
const DISSOLVE_MODAL_PREFIX = 'group_dissolve_modal:';

/**
 * ハブから「🚪 グループを解散」ボタンが押されたとき。
 * オーナーになっているグループを抽出し、Modal で名前確認を要求。
 */
async function openDissolveModal(interaction) {
    const userId = interaction.user.id;
    const groups = getGroupsForUser(userId);
    const ownerGroups = groups.filter((g) => g.owner_user_id === userId);

    if (ownerGroups.length === 0) {
        await interaction.reply({
            content: 'ℹ️ あなたがオーナーになっているグループはありません。',
            ephemeral: true,
        });
        return;
    }

    // 複数オーナーの場合は最新1つを対象に（必要なら将来 SelectMenu に拡張）
    const target = ownerGroups[0];
    const displayName = target.name || `グループ #${target.id}`;

    const modal = new ModalBuilder()
        .setCustomId(`${DISSOLVE_MODAL_PREFIX}${target.id}`)
        .setTitle('グループ解散の確認');

    const input = new TextInputBuilder()
        .setCustomId('confirm_text')
        .setLabel(`「${displayName}」と入力してください`)
        .setPlaceholder(displayName)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(80);

    modal.addComponents(new ActionRowBuilder().addComponents(input));

    try {
        await interaction.showModal(modal);
    } catch (err) {
        console.error('[Group] dissolve modal failed:', err);
        await interaction.reply({
            content: '❌ モーダルの表示に失敗しました。少し待ってもう一度試してみてください。',
            ephemeral: true,
        }).catch(() => {});
    }
}

/**
 * Modal Submit。グループ名が一致したら解散実行。
 */
async function handleDissolveModalSubmit(interaction) {
    const groupId = parseInt(interaction.customId.replace(DISSOLVE_MODAL_PREFIX, ''), 10);
    const group = getGroupById(groupId);

    if (!group || group.dissolved_at) {
        await interaction.reply({ content: '❌ グループが見つからないか、すでに解散済みです。', ephemeral: true });
        return;
    }
    if (group.owner_user_id !== interaction.user.id) {
        await interaction.reply({ content: '⚠️ オーナーのみ操作できます。', ephemeral: true });
        return;
    }

    const typed = (interaction.fields.getTextInputValue('confirm_text') || '').trim();
    const expected = (group.name || `グループ #${group.id}`).trim();

    if (typed !== expected) {
        await interaction.reply({
            content: `❌ 入力が一致しませんでした。\n期待: \`${expected}\`\n入力: \`${typed}\``,
            ephemeral: true,
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const members = getGroupMembers(groupId);
    const result = dissolveGroup(groupId, interaction.user.id);

    if (!result.ok) {
        await interaction.editReply({ content: '❌ 解散処理に失敗しました。' });
        return;
    }

    // 専用チャンネルの削除
    if (group.channel_id) {
        try {
            const ch = await interaction.client.channels.fetch(group.channel_id);
            if (ch) await ch.delete(`M-6 グループ解散（group ${groupId}）`);
        } catch (err) {
            console.warn('[Group] チャンネル削除失敗:', err.message);
        }
    }

    // 全メンバーへ DM
    const farewell = new EmbedBuilder()
        .setColor(0xC0392B)
        .setTitle('🚪 グループが解散されました')
        .setDescription([
            `**${expected}** のグループが、オーナーによって解散されました。`,
            '',
            '専用チャンネルは削除されましたが、',
            'あなたの個人記録（連続日数など）は残ります。',
            '',
            '新しいグループを作りたい場合は、',
            'ハブで「🤝 同期/仲間を招待」ボタンを押してください。',
        ].join('\n'))
        .setFooter({ text: 'Reverb Lab｜グループ' });

    for (const m of members) {
        try {
            const u = await interaction.client.users.fetch(m.user_id);
            await u.send({ embeds: [farewell] });
        } catch (err) { /* ignore */ }
    }

    await interaction.editReply({ content: `✅ グループ「${expected}」を解散しました。メンバーに通知済みです。` });
}

function isDissolveButtonId(customId) {
    return customId === DISSOLVE_OPEN_BUTTON;
}
function isDissolveModalId(customId) {
    return customId.startsWith(DISSOLVE_MODAL_PREFIX);
}

module.exports = {
    openDissolveModal,
    handleDissolveModalSubmit,
    isDissolveButtonId,
    isDissolveModalId,
    DISSOLVE_OPEN_BUTTON,
    DISSOLVE_MODAL_PREFIX,
};
