// handlers/group/invite.js — M-6 グループ機能（2〜10人）招待コード発行
//
// ペア機能を内包したグループ招待。
// オーナーがまだいない場合はグループ自体を作成。
// 既にグループ所属なら、既存グループのコードを再生成して返す。

const { EmbedBuilder } = require('discord.js');
const {
    createGroup,
    regenerateGroupInvite,
    getGroupsForUser,
} = require('../../db');
const voilogSync = require('../../lib/voilogSync');

/**
 * グループ招待コードを発行（必要ならグループ作成）し、本人に DM 送信
 * @returns {Promise<{success: boolean, code?: string, groupId?: number, dmDelivered?: boolean, error?: string}>}
 */
async function createGroupInviteAndDM(user) {
    let group;
    let code;
    let expiresAt;
    let isNew = false;

    try {
        const existing = getGroupsForUser(user.id);
        if (existing.length === 0) {
            const created = createGroup(user.id, null, 24);
            group = { id: created.id, name: created.name };
            code = created.code;
            expiresAt = created.expiresAt;
            isNew = true;
            // VoiLog Supabase に非同期でミラー（失敗時はログのみ、Bot は止めない）
            voilogSync.mirrorGroupCreate({
                discordGroupId: created.id,
                ownerDiscordId: user.id,
                name: created.name,
                inviteCode: created.code,
            }).catch(() => {});
        } else {
            group = existing[0];
            const regen = regenerateGroupInvite(group.id, 24);
            code = regen.code;
            expiresAt = regen.expiresAt;
        }
    } catch (err) {
        console.error('[Group] 招待コード発行失敗:', err);
        return { success: false, error: err.message };
    }

    const expiresJst = new Date(expiresAt).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });

    const title = isNew ? '🤝 仲間招待コードを発行しました' : '🤝 仲間招待コード（再発行）';
    const desc = [
        '養成所の同期や友達をぼいラボに呼びましょう！',
        '**2〜10人まで** 同じグループに入れます。',
        '一緒に参加すると、継続率が **8倍** に上がるという話もあります。',
        '',
        '**あなたの招待コード**',
        `\`\`\`${code}\`\`\``,
        '',
        `**有効期限**：${expiresJst}（24時間）`,
        '',
        '**つかいかた**',
        '1. このコードを LINE / X DM / 直接 などで仲間にシェア',
        '2. 仲間がぼいラボに参加して **「🔗 コードで参加」ボタン**から入力',
        '3. 3人以上集まると、グループ専用チャンネルが自動でできます',
    ].join('\n');

    const embed = new EmbedBuilder()
        .setColor(0x1B5E3F)
        .setTitle(title)
        .setDescription(desc)
        .setFooter({ text: 'Reverb Lab｜仲間招待（ペア / グループ）' });

    let dmDelivered = true;
    try {
        await user.send({ embeds: [embed] });
    } catch (err) {
        console.warn(`[Group] DM送信失敗: ${err.message}`);
        dmDelivered = false;
    }

    return { success: true, code, groupId: group.id, dmDelivered, isNew };
}

module.exports = { createGroupInviteAndDM };
