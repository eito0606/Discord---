// handlers/pair/invite.js — 養成所同期ペアリング機能：招待コード発行（A案）
//
// ぼいラボの新目的「独りにしない」を実現する仕組み。
// 養成所の同期や友達と一緒に参加すると、お互いの継続を支え合える。
//
// 提供形態（呼び出し元）：
//   1. ハブEmbedの「🤝 同期を招待」ボタン（推奨、声優志望者向け）
//   2. 管理者向け `!pair_invite` テキストコマンド（後方互換）
//
// どちらも内部的には createInviteAndDM(user) を呼ぶ。

const { EmbedBuilder } = require('discord.js');
const { createPairInvite } = require('../../db');

/**
 * 共通処理：招待コードを発行して本人にDMで送る。
 *
 * @param {User} user - Discord ユーザーオブジェクト
 * @returns {Promise<{success: boolean, code?: string, dmDelivered?: boolean, error?: string}>}
 */
async function createInviteAndDM(user) {
    let invite;
    try {
        invite = createPairInvite(user.id, 24);
    } catch (err) {
        console.error('[Pair] 招待コード生成失敗:', err);
        return { success: false, error: err.message };
    }

    const expiresJst = new Date(invite.expiresAt).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });

    const embed = new EmbedBuilder()
        .setColor(0x1B5E3F)
        .setTitle('🤝 同期招待コード')
        .setDescription(
            [
                '養成所の同期や友達を、ぼいラボに招待しましょう！',
                '一緒に参加すると、継続率が **8倍** に上がるという話もあります。',
                '',
                '**あなたの招待コード**',
                `\`\`\`${invite.code}\`\`\``,
                '',
                `**有効期限**：${expiresJst}（24時間）`,
                '',
                '**つかいかた**',
                '1. このコードを LINE / X DM / 直接 などで同期にシェア',
                '2. 同期がぼいラボに参加して **「🔗 コードで参加」ボタン**から入力',
                '3. ペア成立！お互いに通知が届きます',
            ].join('\n'),
        )
        .setFooter({ text: 'Reverb Lab｜養成所同期ペアリング' });

    let dmDelivered = true;
    try {
        await user.send({ embeds: [embed] });
    } catch (err) {
        console.warn(`[Pair] DM送信失敗: ${err.message}`);
        dmDelivered = false;
    }

    return { success: true, code: invite.code, dmDelivered };
}

/**
 * !pair_invite コマンド（後方互換用）。実体は createInviteAndDM に委譲。
 */
async function handlePairInviteCommand(message) {
    const result = await createInviteAndDM(message.author);

    if (!result.success) {
        await message.reply('❌ 招待コードの発行に失敗しました。少し待ってもう一度お試しください。').catch(() => {});
        return;
    }

    if (result.dmDelivered) {
        await message.reply({
            content: `✅ <@${message.author.id}> 招待コードを DM でお送りしました。同期に渡してね！`,
            allowedMentions: { users: [message.author.id] },
        }).catch(() => {});
    } else {
        await message.reply({
            content: `❌ DM をお送りできませんでした（DM受信OFF？）。設定を確認してから再度お試しください。`,
        }).catch(() => {});
    }

    await message.delete().catch(() => {});
}

module.exports = {
    createInviteAndDM,
    handlePairInviteCommand,
};
