// handlers/group/join.js — M-6 グループ機能（2〜10人）招待コードで参加
//
// 既存ペア機能の processJoinByCode を内包し、グループ参加にも対応。
// 3人目以降が加入した瞬間に「専用チャンネル自動作成（規約承認待ち）」フローを起動。

const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const {
    findGroupByInviteCode,
    addGroupMember,
    getGroupMembers,
    getGroupById,
    setGroupChannelId,
} = require('../../db');

const TERMS_BUTTON_AGREE = 'group_terms_agree:';
const TERMS_BUTTON_DECLINE = 'group_terms_decline:';

/**
 * 招待コードで参加
 * @param {User} joiner
 * @param {string} rawCode
 * @param {Client} client
 * @param {TextChannel|null} channel
 */
async function processGroupJoin(joiner, rawCode, client, channel = null) {
    const code = (rawCode || '').trim().toUpperCase();
    if (!code) return { ok: false, message: '❌ 招待コードを入力してください。' };

    const group = findGroupByInviteCode(code);
    if (!group) return { ok: false, message: '❌ そのコードは見つかりません。タイプミスがないか確認してみてください。' };

    if (group.invite_expires_at && new Date(group.invite_expires_at).getTime() < Date.now()) {
        return { ok: false, message: '⏰ そのコードは期限切れです（24時間有効）。新しいコードを発行してもらってください。' };
    }

    if (group.owner_user_id === joiner.id) {
        return { ok: false, message: 'ℹ️ あなたはこのグループのオーナーです。コードは仲間にシェアしてください。' };
    }

    const result = addGroupMember(group.id, joiner.id);
    if (!result.ok) {
        if (result.reason === 'full') return { ok: false, message: '❌ このグループは満員（10人）です。' };
        if (result.reason === 'already_member') return { ok: false, message: 'ℹ️ あなたはすでにこのグループの仲間です。' };
        return { ok: false, message: '❌ 参加処理に失敗しました。' };
    }

    const members = getGroupMembers(group.id);
    const memberCount = members.length;

    // DM 通知（全員）
    const buildMemberDM = (recipientName) => new EmbedBuilder()
        .setColor(0x1B5E3F)
        .setTitle('🤝 新しい仲間がグループに参加しました！')
        .setDescription([
            `${joiner.displayName} さんが参加してくれました。`,
            '',
            `現在のメンバー: **${memberCount}人**`,
            memberCount >= 3
                ? '🌿 3人以上になったので、グループ専用チャンネルを準備中です。'
                : 'もう少し人が集まったら、グループ専用のチャンネルができます。',
        ].join('\n'))
        .setFooter({ text: 'Reverb Lab｜グループ' });

    for (const m of members) {
        if (m.user_id === joiner.id) continue;
        try {
            const u = await client.users.fetch(m.user_id);
            await u.send({ embeds: [buildMemberDM(u.displayName)] });
        } catch (err) {
            console.warn('[Group] DM 送信失敗 (member):', err.message);
        }
    }
    // 本人にも welcome DM
    try {
        await joiner.send({
            embeds: [new EmbedBuilder()
                .setColor(0x1B5E3F)
                .setTitle('🤝 グループに参加しました')
                .setDescription([
                    `仲間グループに加わりました。現在 **${memberCount}人**。`,
                    '',
                    'ハブの「👥 みんなの状況」ボタンで仲間の連続日数が見られます。',
                ].join('\n'))],
        });
    } catch (err) {
        console.warn('[Group] DM 送信失敗 (self):', err.message);
    }

    // チャンネル告知（コードは非表示、プライバシー配慮）
    if (channel && memberCount === 2) {
        try {
            await channel.send({
                content: `🤝 <@${group.owner_user_id}> と <@${joiner.id}> がペアになりました！おめでとう🌿`,
                allowedMentions: { users: [group.owner_user_id, joiner.id] },
            });
        } catch (err) { /* ignore */ }
    }

    // 3人到達でチャンネル作成プロセスを発動
    let channelCreated = false;
    if (memberCount === 3 && !group.channel_id) {
        await proposeGroupChannel(client, group.id);
        channelCreated = true;
    }

    return {
        ok: true,
        message: memberCount >= 3
            ? `🌿 グループに参加しました！（${memberCount}人）専用チャンネルの準備が始まります。`
            : `🤝 ${memberCount === 2 ? 'ペア成立！' : 'グループ参加完了'}（${memberCount}人）`,
        groupId: group.id,
        memberCount,
        channelCreated,
    };
}

/**
 * 3人到達時にオーナーへ「規約同意 → チャンネル作成」フローを送る
 */
async function proposeGroupChannel(client, groupId) {
    const group = getGroupById(groupId);
    if (!group) return;

    const owner = await client.users.fetch(group.owner_user_id).catch(() => null);
    if (!owner) return;

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const embed = new EmbedBuilder()
        .setColor(0x1B5E3F)
        .setTitle('🌿 グループ専用チャンネルを作る準備ができました')
        .setDescription([
            '3人以上集まったので、グループ専用のプライベートチャンネルを作れます。',
            'メンバーだけが見られて、台本相談・練習報告・雑談などに使えます。',
            '',
            '⚠️ **ご利用にあたって（同意必須）**',
            'チャンネル内で起こったトラブル（揉め事・個人情報の流出・迷惑行為など）について、',
            '**Reverb Lab 運営は一切の責任を負いません。**',
            'グループメンバー間で自己責任で解決してください。',
            '',
            'トラブルが解決できない場合は、グループを解散して再構築してください。',
            '',
            '上記に同意できる場合は「同意して作成」をクリック。',
        ].join('\n'))
        .setFooter({ text: `Group ID: ${groupId}` });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${TERMS_BUTTON_AGREE}${groupId}`)
            .setLabel('同意して作成')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`${TERMS_BUTTON_DECLINE}${groupId}`)
            .setLabel('作らない')
            .setEmoji('🛑')
            .setStyle(ButtonStyle.Secondary),
    );

    try {
        await owner.send({ embeds: [embed], components: [row] });
    } catch (err) {
        console.warn('[Group] 規約 DM 送信失敗:', err.message);
    }
}

/**
 * 規約同意ボタン → ぼいラボに専用チャンネル作成
 */
async function handleTermsAgree(interaction) {
    const groupId = parseInt(interaction.customId.replace(TERMS_BUTTON_AGREE, ''), 10);
    const group = getGroupById(groupId);
    if (!group) {
        await interaction.update({ content: '❌ グループが見つかりません。', embeds: [], components: [] });
        return;
    }
    if (group.owner_user_id !== interaction.user.id) {
        await interaction.reply({ content: '⚠️ このボタンはグループオーナーのみ操作できます。', ephemeral: true });
        return;
    }
    if (group.channel_id) {
        await interaction.update({ content: '✅ すでにチャンネルが作成されています。', embeds: [], components: [] });
        return;
    }

    await interaction.deferUpdate();

    const guildId = process.env.GUILD_ID;
    const categoryId = process.env.GROUP_CHANNELS_CATEGORY_ID || null;

    let channel;
    try {
        const guild = await interaction.client.guilds.fetch(guildId);
        const members = getGroupMembers(groupId);
        const ownerMember = await guild.members.fetch(group.owner_user_id).catch(() => null);
        const groupName = group.name || `${ownerMember?.displayName || 'なまえなし'}グループ`;

        const permissionOverwrites = [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        ];
        for (const m of members) {
            permissionOverwrites.push({
                id: m.user_id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
            });
        }
        // Bot 自身も
        permissionOverwrites.push({
            id: interaction.client.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages],
        });

        channel = await guild.channels.create({
            name: `🌿-${groupName}`.slice(0, 90),
            type: ChannelType.GuildText,
            parent: categoryId || undefined,
            permissionOverwrites,
            reason: `M-6 グループ専用チャンネル自動作成（group ${groupId}）`,
        });

        setGroupChannelId(groupId, channel.id);

        await channel.send({
            embeds: [new EmbedBuilder()
                .setColor(0x1B5E3F)
                .setTitle('🌿 グループ専用チャンネルへようこそ')
                .setDescription([
                    'ここは皆さんが自由に使えるプライベート空間です。',
                    '台本相談・練習報告・雑談など、自由にどうぞ。',
                    '',
                    '⚠️ チャンネル内で起こったトラブルについて、',
                    'Reverb Lab 運営は一切の責任を負いません。',
                    'メンバー間で自己責任で解決してください。',
                ].join('\n'))
                .setFooter({ text: `Group ID: ${groupId}` })],
        });

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0x1B5E3F)
                .setTitle('✅ 専用チャンネルを作成しました')
                .setDescription(`<#${channel.id}> でお待ちしてます。`)],
            components: [],
        });
    } catch (err) {
        console.error('[Group] チャンネル作成失敗:', err);
        await interaction.editReply({
            content: '❌ チャンネル作成に失敗しました。運営に連絡してください。',
            embeds: [],
            components: [],
        });
    }
}

async function handleTermsDecline(interaction) {
    await interaction.update({
        content: '🛑 チャンネル作成を見送りました。あとからもう一度作りたくなったら、運営に声をかけてください。',
        embeds: [],
        components: [],
    });
}

function isTermsButtonId(customId) {
    return customId.startsWith(TERMS_BUTTON_AGREE) || customId.startsWith(TERMS_BUTTON_DECLINE);
}

module.exports = {
    processGroupJoin,
    proposeGroupChannel,
    handleTermsAgree,
    handleTermsDecline,
    isTermsButtonId,
    TERMS_BUTTON_AGREE,
    TERMS_BUTTON_DECLINE,
};
