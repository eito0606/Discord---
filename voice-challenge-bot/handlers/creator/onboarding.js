// handlers/creator/onboarding.js — クリエイター招待・参加処理（F1 MVP）
//
// ぼいラボの「クリエイター」（声優以外でASMR・シチュボ・楽曲・脚本などを作る人）を
// 招待するための窓口。Embed + ボタンを設置し、ボタンを押すとクリエイターロールが付く。
//
// ⚠️ ロール分離の前提：
//   - `VOIPOKE_ROLE_CREATOR` … VoiPoke 連携専用（VoiPokeで擬似ASMR販売してるクリエイター）
//   - `CREATOR_ROLL_ID`     … ぼいラボのクリエイター集客（執筆・楽曲・脚本・編集・イラスト等）
//   F1 招待ボタンが付与するのは後者（ぼいラボ集客用）。VoiPoke 連携とは混ぜない。
//
// .env に未設定の場合は、ロール付与をスキップしつつ「メッセージだけ案内」として動く。

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');

const CREATOR_JOIN_BUTTON_ID = 'creator_join';

/**
 * 指定チャンネルにクリエイター招待Embed＋ボタンを設置する。
 * 既存のBot案内（同じfooter）があれば削除して張り直す。
 */
async function setupCreatorWelcomeMessage(channel) {
    // 古い案内を掃除
    try {
        const messages = await channel.messages.fetch({ limit: 50 });
        const oldGuides = messages.filter(
            (m) =>
                m.author.id === channel.client.user.id &&
                m.embeds.length > 0 &&
                m.embeds[0].footer?.text?.includes('Reverb Lab｜クリエイター招待'),
        );
        for (const m of oldGuides.values()) {
            await m.delete().catch(() => {});
        }
    } catch (err) {
        console.warn('[Creator] 既存案内の削除中にエラー:', err.message);
    }

    const embed = new EmbedBuilder()
        .setColor(0x1B5E3F)
        .setTitle('🎨 ぼいラボのクリエイターになる')
        .setDescription(
            [
                'ぼいラボで活動するクリエイター（ASMR・シチュボ・楽曲・脚本・編集・イラストなど）を歓迎します。',
                '',
                '**できること**',
                '・毎月のお題テーマで自由制作＆発表',
                '・声優志望メンバーとのコラボ提案',
                '・将来 Reverb Lab がブレイクしたとき、共創クリエイターとして名前が並びます',
                '',
                '**参加するには？**',
                '下の「クリエイターになる」ボタンを押してください。クリエイターロールが付与されます。',
                '退会したくなったら、サーバーのロール画面から外せます。',
            ].join('\n'),
        )
        .setFooter({ text: 'Reverb Lab｜クリエイター招待' });

    const button = new ButtonBuilder()
        .setCustomId(CREATOR_JOIN_BUTTON_ID)
        .setLabel('クリエイターになる')
        .setEmoji('🎨')
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    const message = await channel.send({ embeds: [embed], components: [row] });
    console.log(`[Creator] 招待メッセージを設置: ${channel.id}`);
    return message;
}

/**
 * 「クリエイターになる」ボタンを押したときの処理。
 * ぼいラボ集客用のクリエイターロール（CREATOR_ROLL_ID または CREATOR_ROLE_ID）を付与する。
 * VoiPoke 連携の VOIPOKE_ROLE_CREATOR とは**別物**なので混同しないこと。
 * 未設定なら案内のみ。
 */
async function handleCreatorJoinButton(interaction) {
    if (interaction.customId !== CREATOR_JOIN_BUTTON_ID) return false;

    await interaction.deferReply({ ephemeral: true });

    // CREATOR_ROLL_ID を優先、CREATOR_ROLE_ID もフォールバックで読む（spelling揺れ対策）
    const roleId = process.env.CREATOR_ROLL_ID || process.env.CREATOR_ROLE_ID;
    if (!roleId) {
        console.warn('[Creator] CREATOR_ROLL_ID（ぼいラボ集客用）未設定のためロール付与スキップ');
        await interaction.editReply({
            content:
                '⚠️ クリエイターロールがまだ管理者によって設定されていません。少し待ってからもう一度お試しください。',
        });
        return true;
    }

    try {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({
                content: '❌ サーバー情報が取得できませんでした。',
            });
            return true;
        }
        const member = await guild.members.fetch(interaction.user.id);
        await member.roles.add(roleId);
        console.log(`[Creator] クリエイターロール付与: ${interaction.user.tag}`);
        await interaction.editReply({
            content:
                '🎨 クリエイターロールを付与しました！\n毎月のお題テーマや創作交流を楽しんでください。',
        });
    } catch (err) {
        console.error('[Creator] ロール付与失敗:', err);
        await interaction.editReply({
            content:
                '❌ ロール付与に失敗しました。Botのロール階層が「クリエイター」より上にあるか、管理者にご確認ください。',
        });
    }
    return true;
}

module.exports = {
    setupCreatorWelcomeMessage,
    handleCreatorJoinButton,
    CREATOR_JOIN_BUTTON_ID,
};
