// handlers/pair/join.js — 養成所同期ペアリング機能：招待コードで参加（A案）
//
// 提供形態（呼び出し元）：
//   1. ハブEmbedの「🔗 コードで参加」ボタン → Modal入力 → processJoinByCode()
//   2. 管理者向け `!pair_join <CODE>` テキストコマンド（後方互換）

const { EmbedBuilder } = require('discord.js');
const {
    findPairInviteByCode,
    consumePairInvite,
    createPairRelationship,
} = require('../../db');

/**
 * 共通処理：招待コードを検証してペアを成立させる。
 * 双方にDM通知 + チャンネルへ軽い告知。
 *
 * @param {User} joiner - 参加した人のUser
 * @param {string} rawCode - ユーザーが入力したコード（前後空白OK、小文字でもOK）
 * @param {Client} client - Discord Client（招待者の取得に使う）
 * @param {TextChannel|null} channel - 参加コマンドを打ったチャンネル（告知に使う、nullなら告知スキップ）
 * @returns {Promise<{ok: boolean, status: string, message: string, inviterUserId?: string}>}
 */
async function processJoinByCode(joiner, rawCode, client, channel = null) {
    const code = (rawCode || '').trim().toUpperCase();

    if (!code) {
        return { ok: false, status: 'no_code', message: '❌ 招待コードを入力してください。' };
    }

    const invite = findPairInviteByCode(code);
    if (!invite) {
        return { ok: false, status: 'not_found', message: '❌ そのコードは見つかりません。タイプミスがないか確認してみてください。' };
    }

    if (new Date(invite.expires_at).getTime() < Date.now()) {
        return { ok: false, status: 'expired', message: '⏰ そのコードは期限切れです（24時間有効）。新しいコードを発行してもらってください。' };
    }

    if (invite.used_by_user_id) {
        return { ok: false, status: 'used', message: '❌ そのコードはすでに使われています。' };
    }

    if (invite.inviter_user_id === joiner.id) {
        return { ok: false, status: 'self', message: '❌ 自分自身が発行したコードでは参加できません。' };
    }

    const created = createPairRelationship(invite.inviter_user_id, joiner.id, code);
    if (!created) {
        return { ok: false, status: 'already_paired', message: 'ℹ️ あなたとそのお相手は、すでにペアになっています。' };
    }

    consumePairInvite(code, joiner.id);

    // --- 双方にDM通知 ---
    let inviterUser = null;
    try {
        inviterUser = await client.users.fetch(invite.inviter_user_id);
    } catch (err) {
        console.warn('[Pair] 招待者ユーザー取得失敗:', err.message);
    }

    const inviterName = inviterUser?.displayName || '同期';
    const joinerName = joiner.displayName;

    const buildEmbed = (toName, fromName) =>
        new EmbedBuilder()
            .setColor(0x1B5E3F)
            .setTitle('🤝 ペアが成立しました！')
            .setDescription(
                [
                    `**${toName}** さんと **${fromName}** さんが養成所同期ペアになりました。`,
                    '',
                    'これからお互いの継続を支え合いましょう。**「📓 自分の記録」ボタン**で自分とペア相手の継続が見られます。',
                    '',
                    '一緒に365本のボイスサンプル、積み上げよう🌿',
                ].join('\n'),
            )
            .setFooter({ text: 'Reverb Lab｜養成所同期ペアリング' });

    if (inviterUser) {
        try {
            await inviterUser.send({ embeds: [buildEmbed(inviterName, joinerName)] });
        } catch (err) {
            console.warn('[Pair] 招待者DM失敗:', err.message);
        }
    }

    try {
        await joiner.send({ embeds: [buildEmbed(joinerName, inviterName)] });
    } catch (err) {
        console.warn('[Pair] 参加者DM失敗:', err.message);
    }

    // --- チャンネルへ軽い告知（プライバシー配慮：コードは出さない） ---
    if (channel) {
        try {
            await channel.send({
                content: `🤝 <@${invite.inviter_user_id}> と <@${joiner.id}> がペアになりました！おめでとう🌿`,
                allowedMentions: { users: [invite.inviter_user_id, joiner.id] },
            });
        } catch (err) {
            console.warn('[Pair] 成立告知失敗:', err.message);
        }
    }

    return {
        ok: true,
        status: 'paired',
        message: `🤝 ${inviterName} さんとペアになりました！おめでとう🌿`,
        inviterUserId: invite.inviter_user_id,
    };
}

/**
 * !pair_join <code> コマンド（後方互換）。実体は processJoinByCode に委譲。
 */
async function handlePairJoinCommand(message) {
    const parts = message.content.trim().split(/\s+/);
    const code = parts[1] || '';

    const result = await processJoinByCode(message.author, code, message.client, message.channel);

    if (!result.ok) {
        await message.reply({ content: result.message }).catch(() => {});
        return;
    }

    await message.delete().catch(() => {});
}

module.exports = {
    processJoinByCode,
    handlePairJoinCommand,
};
