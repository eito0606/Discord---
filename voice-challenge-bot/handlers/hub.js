// handlers/hub.js — ぼいラボ「つながりハブ」（声優志望者向けボタンUI）
//
// 声優志望者は `!pair_invite` のような呪文コマンドを覚えない前提で、
// ボタンを押すだけ／Modalに入力するだけで全部完結する常設パネルを提供する。
//
// 提供する操作：
//   🤝 同期を招待 → 押すだけでDMに6桁コードが届く
//   🔗 コードで参加 → Modalで6桁コード入力 → ペア成立
//   📓 自分の記録 → DMにダッシュボードEmbedが届く
//
// 設置：管理者がチャンネルで `!hub_setup` と打つと、その場にEmbed＋ボタンを設置。

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');

const { createGroupInviteAndDM } = require('./group/invite');
const { processGroupJoin } = require('./group/join');
const { openDissolveModal, DISSOLVE_OPEN_BUTTON } = require('./group/dissolve');
const { sendDashboardToUser } = require('./dashboard');

const HUB_INVITE_BUTTON_ID = 'hub_invite';
const HUB_JOIN_BUTTON_ID = 'hub_join';
const HUB_DASHBOARD_BUTTON_ID = 'hub_dashboard';
const HUB_DRAMA_BUTTON_ID = 'hub_drama';
const HUB_DISSOLVE_BUTTON_ID = DISSOLVE_OPEN_BUTTON;
const HUB_JOIN_MODAL_ID = 'hub_join_modal';
const HUB_FOOTER_MARKER = 'Reverb Lab｜つながりハブ';

/**
 * チャンネルにハブEmbedとボタンを設置する。
 * 既存の同種メッセージ（同じfooter）があれば削除して張り直す。
 */
async function setupHubMessage(channel) {
    // 古い案内を掃除
    try {
        const messages = await channel.messages.fetch({ limit: 50 });
        const oldGuides = messages.filter(
            (m) =>
                m.author.id === channel.client.user.id &&
                m.embeds.length > 0 &&
                m.embeds[0].footer?.text?.includes(HUB_FOOTER_MARKER),
        );
        for (const m of oldGuides.values()) {
            await m.delete().catch(() => {});
        }
    } catch (err) {
        console.warn('[Hub] 既存案内の削除中にエラー:', err.message);
    }

    const embed = new EmbedBuilder()
        .setColor(0x1B5E3F)
        .setTitle('🌿 ぼいラボのなかま、つながりかた')
        .setDescription(
            [
                '養成所の同期や友達と一緒にぼいラボを使うと、',
                '**継続率が約8倍**にあがるという話があります。',
                '',
                '下のボタンを押すだけで、つながれます。',
                '',
                '**🤝 同期/仲間を招待**',
                '　→ 6桁コードがDMに届きます。**2〜10人まで**同じグループに入れます。',
                '',
                '**🔗 コードで参加**',
                '　→ もらった6桁コードを入力。3人以上集まると専用チャンネルが自動で作られます。',
                '',
                '**👥 みんなの状況**',
                '　→ あなたとグループ仲間の連続日数・累計投稿をDMでお届け。',
                '',
                '**🎭 声劇を主催**',
                '　→ ボタン1つで対話形式の声劇募集が始まります。',
                '',
                '**🚪 グループを解散**',
                '　→ オーナー専用。2重確認のうえ、専用チャンネルも削除されます。',
            ].join('\n'),
        )
        .setFooter({ text: HUB_FOOTER_MARKER });

    const inviteBtn = new ButtonBuilder()
        .setCustomId(HUB_INVITE_BUTTON_ID)
        .setLabel('同期/仲間を招待')
        .setEmoji('🤝')
        .setStyle(ButtonStyle.Primary);

    const joinBtn = new ButtonBuilder()
        .setCustomId(HUB_JOIN_BUTTON_ID)
        .setLabel('コードで参加')
        .setEmoji('🔗')
        .setStyle(ButtonStyle.Secondary);

    const dashboardBtn = new ButtonBuilder()
        .setCustomId(HUB_DASHBOARD_BUTTON_ID)
        .setLabel('みんなの状況')
        .setEmoji('👥')
        .setStyle(ButtonStyle.Secondary);

    const dramaBtn = new ButtonBuilder()
        .setCustomId(HUB_DRAMA_BUTTON_ID)
        .setLabel('声劇を主催')
        .setEmoji('🎭')
        .setStyle(ButtonStyle.Secondary);

    const dissolveBtn = new ButtonBuilder()
        .setCustomId(HUB_DISSOLVE_BUTTON_ID)
        .setLabel('グループを解散')
        .setEmoji('🚪')
        .setStyle(ButtonStyle.Danger);

    const { LIST_BUTTON_ID } = require('./voiceDramaList');
    const dramaListBtn = new ButtonBuilder()
        .setCustomId(LIST_BUTTON_ID)
        .setLabel('直近の声劇')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Secondary);

    // Discord は 1 行に 5 ボタンまで → 主要 4 + 一覧/解散 を 2 行に
    const row1 = new ActionRowBuilder().addComponents(inviteBtn, joinBtn, dashboardBtn, dramaBtn);
    const row2 = new ActionRowBuilder().addComponents(dramaListBtn, dissolveBtn);

    const message = await channel.send({ embeds: [embed], components: [row1, row2] });
    console.log(`[Hub] ハブメッセージを設置: ${channel.id}`);
    return message;
}

/**
 * 「🤝 同期を招待」ボタン処理。
 * 押した本人にDMで6桁コードを送る。チャンネルにはephemeralで結果通知。
 */
async function handleHubInviteButton(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const result = await createGroupInviteAndDM(interaction.user);

    if (!result.success) {
        await interaction.editReply({
            content: '❌ 招待コードの発行に失敗しました。少し待ってもう一度お試しください。',
        });
        return;
    }
    if (result.dmDelivered) {
        await interaction.editReply({
            content: result.isNew
                ? '✅ DMに招待コードをお送りしました！2〜10人まで仲間を呼べます。'
                : '✅ DMに招待コードを再発行しました！',
        });
    } else {
        await interaction.editReply({
            content: '❌ DMをお送りできませんでした（DM受信OFFの可能性）。設定を確認してから再度お試しください。',
        });
    }
}

/**
 * 「🔗 コードで参加」ボタン処理。
 * Modalを表示して6桁コード入力を待つ。
 */
async function handleHubJoinButton(interaction) {
    const modal = new ModalBuilder()
        .setCustomId(HUB_JOIN_MODAL_ID)
        .setTitle('コードで参加');

    const input = new TextInputBuilder()
        .setCustomId('pair_code')
        .setLabel('同期からもらった6桁コード')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('例：AB23CD')
        .setRequired(true)
        .setMinLength(6)
        .setMaxLength(6);

    const row = new ActionRowBuilder().addComponents(input);
    modal.addComponents(row);

    try {
        await interaction.showModal(modal);
    } catch (err) {
        console.error('[Hub] showModal failed:', err);
        await interaction.reply({
            content: '❌ モーダルの表示に失敗しました。少し待ってもう一度試してみてください。',
            ephemeral: true,
        }).catch(() => {});
    }
}

/**
 * Modal Submit（コード入力後）。
 * processJoinByCode で参加処理。チャンネルへの告知も投稿。
 */
async function handleHubJoinModalSubmit(interaction) {
    const code = interaction.fields.getTextInputValue('pair_code')?.trim() || '';
    await interaction.deferReply({ ephemeral: true });

    const result = await processGroupJoin(
        interaction.user,
        code,
        interaction.client,
        interaction.channel,
    );

    await interaction.editReply({ content: result.message });
}

/**
 * 「📓 自分の記録」ボタン処理。
 * 押した本人にダッシュボードEmbedをDMで送る。
 */
async function handleHubDashboardButton(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const result = await sendDashboardToUser(interaction.user, interaction.client);

    if (result.dmDelivered) {
        await interaction.editReply({
            content: '📓 ダッシュボードをDMにお送りしました！',
        });
    } else {
        await interaction.editReply({
            content: '❌ DMをお送りできませんでした（DM受信OFFの可能性）。設定を確認してから再度お試しください。',
        });
    }
}

/**
 * 🎭 「声劇を主催」ボタン → DM で対話フロー開始
 * 既存の handleVoiceDramaTrigger と同じ動線を、ボタンから起動する。
 */
async function handleHubDramaButton(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const { handleVoiceDramaTriggerForUser } = require('./voiceDrama');
    try {
        await handleVoiceDramaTriggerForUser(interaction.user, interaction.client, interaction.channel);
        await interaction.editReply({
            content: '🎭 声劇イベントの準備スレッドを作成しました。DM か直近のチャンネルを確認してください。',
        });
    } catch (err) {
        console.error('[Hub] drama button error:', err);
        await interaction.editReply({
            content: '❌ 声劇イベントの作成に失敗しました。少し待ってもう一度試してみてください。',
        });
    }
}

/**
 * 🚪 「グループを解散」ボタン → 2重チェック Modal
 */
async function handleHubDissolveButton(interaction) {
    await openDissolveModal(interaction);
}

// 判定ヘルパー
function isHubButtonId(customId) {
    return customId === HUB_INVITE_BUTTON_ID
        || customId === HUB_JOIN_BUTTON_ID
        || customId === HUB_DASHBOARD_BUTTON_ID
        || customId === HUB_DRAMA_BUTTON_ID
        || customId === HUB_DISSOLVE_BUTTON_ID;
}
function isHubJoinModalId(customId) {
    return customId === HUB_JOIN_MODAL_ID;
}

module.exports = {
    setupHubMessage,
    handleHubInviteButton,
    handleHubJoinButton,
    handleHubJoinModalSubmit,
    handleHubDashboardButton,
    handleHubDramaButton,
    handleHubDissolveButton,
    isHubButtonId,
    isHubJoinModalId,
    HUB_INVITE_BUTTON_ID,
    HUB_JOIN_BUTTON_ID,
    HUB_DASHBOARD_BUTTON_ID,
    HUB_DRAMA_BUTTON_ID,
    HUB_DISSOLVE_BUTTON_ID,
    HUB_JOIN_MODAL_ID,
};
