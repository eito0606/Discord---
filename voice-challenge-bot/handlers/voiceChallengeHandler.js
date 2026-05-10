// handlers/voiceChallengeHandler.js — ボイスサンプル投稿ガイド機能
// 音声ファイルのアップロードと情報のヒアリングをスレッド形式で行い、
// 整理された形式でチャンネルに投稿する。

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ThreadAutoArchiveDuration,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const { recordVoiceSampleSuggestion } = require('../db');

const VOICE_CHALLENGE_BUTTON_ID = 'voice_challenge_start';
// 投稿メッセージに付ける2種のリスナー向けボタン（F2機能）
const VOICE_SUKI_BUTTON_PREFIX = 'vsamp_suki';            // customId: vsamp_suki_<posterUserId>
const VOICE_YOMI_BUTTON_PREFIX = 'vsamp_yomi';            // customId: vsamp_yomi_<posterUserId>
const VOICE_YOMI_MODAL_PREFIX = 'vsamp_yomi_modal';       // customId: vsamp_yomi_modal_<posterUserId>_<messageId>
const TIMEOUT_MS = 5 * 60 * 1000; // 5分

// チャンネルに案内メッセージとボタンを設置する
async function setupVoiceChallengeMessage(channel) {
    const mainEmbed = new EmbedBuilder()
        .setTitle('🎤 お題をアップしよう！')
        .setDescription(
            '下のボタンを押すと、あなた専用のアップロード用スレッドが作成されます。\n\n' +
            '① 音声ファイルをアップロード\n' +
            '② お題番号とこだわりポイントを入力\n' +
            'だけで、きれいに整頓された形式で投稿できます！'
        )
        .setColor(0x00FF7F) // SHIFT AI風のグリーンに統一
        .setThumbnail('https://cdn.discordapp.com/attachments/1475783333932826767/1494155993263636480/mic_sample.png');

    const sampleEmbed = new EmbedBuilder()
        .setTitle('📋 【完成イメージ：ひながた】')
        .setColor(0x00FF7F)
        .setDescription('投稿されると以下のように表示されます。')
        .addFields(
            { name: '**お題番号**', value: 'No.1', inline: true },
            { name: '**投稿者**', value: 'ヴォイポケ太郎', inline: true },
            { name: '\u200b', value: '\u200b' },
            { name: '**こだわりポイント**', value: '中性的な声を意識して表現しました。最後の吐息がポイントです！' }
        )
        .setFooter({ text: '※音声ファイルが一緒に投稿されます' });

    const button = new ButtonBuilder()
        .setCustomId(VOICE_CHALLENGE_BUTTON_ID)
        .setLabel('お題をアップ')
        .setEmoji('⬆️')
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    await channel.send({ embeds: [mainEmbed, sampleEmbed], components: [row] });
}

// ボタン押下時の処理
async function handleVoiceChallengeButton(interaction) {
    if (interaction.customId !== VOICE_CHALLENGE_BUTTON_ID) return;

    const user = interaction.user;
    await interaction.deferReply({ ephemeral: true });

    try {
        const thread = await interaction.channel.threads.create({
            name: `🎤アップロード_${user.displayName}`,
            type: ChannelType.PrivateThread,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
            reason: `${user.displayName} のボイスサンプル投稿用`,
        });

        await thread.join(); // Botをスレッドに参加させる
        await thread.members.add(user.id);

        console.log(`[VoiceChallenge] スレッドを作成しました: ${thread.name} (ID: ${thread.id})`);

        await interaction.editReply({
            content: `✅ 投稿用のスレッドを作成しました！\n👉 <#${thread.id}> で提出を進めてください。`,
        });

        // 投稿先チャンネルIDを引き継ぐ
        const targetChannelId = interaction.channel.id;
        await runVoiceChallengeInThread(thread, user, interaction.client, targetChannelId);

    } catch (error) {
        console.error('ボイスサンプルスレッド作成エラー:', error);
        await interaction.editReply({
            content: '❌ スレッドの作成中にエラーが発生しました。',
        });
    }
}

// スレッド内でのヒアリングループ
async function runVoiceChallengeInThread(thread, user, client, targetChannelId) {
    await thread.send(
        `こんにちは、${user.displayName} さん！🎧\n` +
        'ボイスサンプルの投稿ガイドを開始します。\n' +
        '━━━━━━━━━━━━━━━━━━━━'
    );

    // 1. 音声ファイルのアップロード待ち
    await thread.send('**① 音声ファイルをアップロードしてください** 📎\n（ドラッグ＆ドロップまたはファイル選択して送信してください）');
    const fileMessage = await collectMessage(thread, user, (msg) => msg.attachments.size > 0);
    
    if (!fileMessage) {
        await thread.send('⏰ 時間切れ、またはファイルが確認できませんでした。中断します。');
        await thread.setArchived(true);
        return;
    }
    const firstAttachment = fileMessage.attachments.first();
    const attachmentSize = firstAttachment.size;
    const attachmentUrl = firstAttachment.url;

    console.log(`[VoiceChallenge] ファイルを受信しました: ${firstAttachment.name} (${attachmentSize} bytes)`);

    // 2. お題番号
    await thread.send('**② お題番号** を教えてください（例：お題番号1、No.5 など）');
    const topicNo = await collectMessage(thread, user);
    if (!topicNo) {
        await thread.send('⏰ 時間切れのため、投稿を中断しました。');
        await thread.setArchived(true);
        return;
    }

    // 3. こだわりポイント
    await thread.send('**③ こだわりポイント** を教えてください（例：感情を込めた、滑舌を意識した、など）');
    const commitment = await collectMessage(thread, user);
    if (!commitment) {
        await thread.send('⏰ 時間切れのため、投稿を中断しました。');
        await thread.setArchived(true);
        return;
    }

    console.log(`[VoiceChallenge] ヒアリング完了、投稿処理を開始します...`);

    // 投稿
    await thread.send('✅ 情報を整理して投稿しています...');
    
    try {
        await postVoiceEmbed(client, {
            attachmentUrl: attachmentUrl,
            topicNo: topicNo.content,
            commitment: commitment.content,
        }, user, targetChannelId);
        await thread.send('✨ 投稿が完了しました！お疲れ様でした。');
    } catch (error) {
        console.error('ボイスサンプル投稿失敗:', error);
        await thread.send(
            '❌ **エラー: 投稿に失敗しました。**\n' +
            'Botがチャンネルにメッセージを送る権限がないか、チャンネルが見つかりません。\n' +
            'お手数ですが、管理者にお問い合わせください。'
        );
    }

    setTimeout(async () => {
        try { await thread.setArchived(true); } catch (e) {}
    }, 10000);
}

// メッセージ収集（汎用）
async function collectMessage(thread, user, extraFilter = () => true) {
    try {
        const collected = await thread.awaitMessages({
            filter: (msg) => msg.author.id === user.id && !msg.author.bot && extraFilter(msg),
            max: 1,
            time: TIMEOUT_MS,
            errors: ['time'],
        });
        return collected.first();
    } catch (error) {
        if (error.name !== 'time') console.error('Message collection error:', error);
        return null;
    }
}

// メインチャンネルへの投稿
async function postVoiceEmbed(client, data, user, targetChannelId) {
    // 1. 指定されたターゲットがあれば優先し、なければ環境変数を探す
    const channelId = targetChannelId || process.env.VOICE_CHALLENGE_CHANNEL_ID || process.env.VOICE_PRACTICE_CHANNEL_ID;

    if (!channelId) {
        console.error('❌ [Config Error] VOICE_CHALLENGE_CHANNEL_ID または VOICE_PRACTICE_CHANNEL_ID が設定されていません。');
        throw new Error('ボイスサンプル投稿先のチャンネルIDが設定されていません。');
    }

    const channel = await client.channels.fetch(channelId).catch((err) => {
        console.error(`❌ [Discord Error] ボイスサンプルチャンネルの取得に失敗しました (ID: ${channelId}):`, err.message);
        return null;
    });

    if (!channel) {
        console.error('❌ [Runtime Error] ボイスサンプル投稿先チャンネルが見つかりませんでした。Botがチャンネルを閲覧できるか確認してください。');
        throw new Error('投稿先チャンネルが見つかりません。');
    }

    const embed = new EmbedBuilder()
        .setTitle('🎤 ボイスサンプル')
        .setColor(0x00FF7F) // SHIFT AI風
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            { name: '**お題番号**', value: data.topicNo, inline: true },
            { name: '**投稿者**', value: user.displayName, inline: true },
            { name: '\u200b', value: '\u200b' },
            { name: '**こだわりポイント**', value: data.commitment }
        )
        .setTimestamp()
        .setFooter({ text: `ID: ${user.id}` });

    // F2: リスナー向けボタン2種
    // ・「すき！」 → 押すと投稿メッセージに ❤️ リアクションが付く
    // ・「こんなふうに読んでみて！」 → Modalで読み方提案を入力 → 投稿者にDM転送
    const sukiBtn = new ButtonBuilder()
        .setCustomId(`${VOICE_SUKI_BUTTON_PREFIX}_${user.id}`)
        .setLabel('すき！')
        .setEmoji('❤️')
        .setStyle(ButtonStyle.Secondary);

    const yomiBtn = new ButtonBuilder()
        .setCustomId(`${VOICE_YOMI_BUTTON_PREFIX}_${user.id}`)
        .setLabel('こんなふうに読んでみて！')
        .setEmoji('💭')
        .setStyle(ButtonStyle.Secondary);

    const buttonRow = new ActionRowBuilder().addComponents(sukiBtn, yomiBtn);

    try {
        await channel.send({
            content: `🎙️ **<@${user.id}> さんが新しいお題をアップしました！**`,
            embeds: [embed],
            files: [{ attachment: data.attachmentUrl, name: `voice_sample_${user.id}.mp3` }],
            components: [buttonRow],
        });
        console.log(`ボイスサンプルの投稿に成功しました: ${user.displayName}`);
    } catch (error) {
        console.error('ボイスサンプルのチャンネル送信中にエラーが発生しました:', error);
        throw error;
    }
}

// ============================================
// F2: リスナーボタン2種のハンドラ
// ============================================

/**
 * Embed の footer から `ID: xxx` を抽出して投稿者IDを返す。
 * ボタン customId にも posterUserId を埋めているが、後方互換のため footer 抽出も用意。
 */
function extractPosterIdFromMessage(message) {
    if (!message?.embeds?.length) return null;
    const footer = message.embeds[0].footer?.text;
    if (!footer) return null;
    const match = footer.match(/ID:\s*(\d+)/);
    return match ? match[1] : null;
}

/**
 * 「すき！」ボタンを押したときの処理。
 * 投稿メッセージに ❤️ リアクションを付与し、押した本人にだけ ephemeral で確認。
 */
async function handleVoiceSukiButton(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });
        const message = interaction.message;
        await message.react('❤️').catch((err) => {
            console.warn('[VoiceChallenge] すきリアクション付与失敗:', err.message);
        });
        await interaction.editReply({ content: '❤️ すき！を伝えました。' });
    } catch (err) {
        console.error('[VoiceChallenge] handleVoiceSukiButton error:', err);
        try {
            await interaction.editReply({ content: '❌ うまく伝えられませんでした。もう一度試してみてください。' });
        } catch {}
    }
}

/**
 * 「こんなふうに読んでみて！」ボタンを押したときの処理。
 * Modalを表示してリスナーから1文の提案を受け取る（押した本人にしか見えない）。
 */
async function handleVoiceYomiButton(interaction) {
    // customId: vsamp_yomi_<posterUserId>
    const parts = interaction.customId.split('_');
    const posterUserIdFromBtn = parts[2] || extractPosterIdFromMessage(interaction.message);
    const messageId = interaction.message.id;

    if (!posterUserIdFromBtn) {
        await interaction.reply({
            content: '❌ 投稿者の情報が取れませんでした。',
            ephemeral: true,
        }).catch(() => {});
        return;
    }

    // Modal の customId に投稿者ID と メッセージID を埋め込み、Submit時に取り出す
    const modal = new ModalBuilder()
        .setCustomId(`${VOICE_YOMI_MODAL_PREFIX}_${posterUserIdFromBtn}_${messageId}`)
        .setTitle('こんなふうに読んでみて！');

    const input = new TextInputBuilder()
        .setCustomId('yomi_image')
        .setLabel('どんなイメージがありますか？')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('声優さんのDMに送信されます。現場監督になった気分でかいてみてみてください！')
        .setRequired(true)
        .setMaxLength(300);

    const row = new ActionRowBuilder().addComponents(input);
    modal.addComponents(row);

    try {
        await interaction.showModal(modal);
    } catch (err) {
        console.error('[VoiceChallenge] showModal failed:', err);
        await interaction.reply({
            content: '❌ モーダルの表示に失敗しました。少し待ってもう一度試してみてください。',
            ephemeral: true,
        }).catch(() => {});
    }
}

/**
 * 「こんなふうに読んでみて！」Modal の Submit 処理。
 * リスナーの入力を投稿者にDM転送し、リスナー本人に ephemeral で結果通知。
 */
async function handleVoiceYomiModalSubmit(interaction) {
    // customId: vsamp_yomi_modal_<posterUserId>_<messageId>
    const customId = interaction.customId;
    const rest = customId.replace(`${VOICE_YOMI_MODAL_PREFIX}_`, '');
    const sepIdx = rest.indexOf('_');
    if (sepIdx < 0) {
        await interaction.reply({
            content: '❌ 内部エラー：モーダルIDが不正です。',
            ephemeral: true,
        }).catch(() => {});
        return;
    }
    const posterUserId = rest.slice(0, sepIdx);
    const voiceMessageId = rest.slice(sepIdx + 1);

    const suggestionText = interaction.fields.getTextInputValue('yomi_image')?.trim() || '';
    if (!suggestionText) {
        await interaction.reply({
            content: '❌ 入力が空でした。もう一度お試しください。',
            ephemeral: true,
        }).catch(() => {});
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    // 投稿者にDM転送
    let delivered = true;
    let posterUser = null;
    try {
        posterUser = await interaction.client.users.fetch(posterUserId);
    } catch (err) {
        console.error('[VoiceChallenge] 投稿者ユーザー取得失敗:', err.message);
        delivered = false;
    }

    if (posterUser) {
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle('💭 リスナーから読み方の提案が届きました')
                .setColor(0x00FF7F)
                .setDescription(`**「${suggestionText}」**`)
                .addFields(
                    { name: '差出人', value: `${interaction.user.displayName}（${interaction.user.tag}）` },
                )
                .setFooter({ text: 'Reverb Lab｜ぼいラボ' })
                .setTimestamp();

            await posterUser.send({
                content: '💭 あなたのボイスサンプルへ、読み方の提案が届きました。',
                embeds: [dmEmbed],
            });
        } catch (err) {
            console.warn(`[VoiceChallenge] 投稿者DM送信失敗（DM拒否設定の可能性）: ${err.message}`);
            delivered = false;
        }
    }

    // DB記録（DM失敗でも残す）
    try {
        recordVoiceSampleSuggestion(voiceMessageId, interaction.user.id, posterUserId, suggestionText, delivered);
    } catch (err) {
        console.error('[VoiceChallenge] suggestion DB記録失敗:', err.message);
    }

    if (delivered) {
        await interaction.editReply({
            content: '✅ 投稿者にお伝えしました！素敵な提案、ありがとうございます。',
        });
    } else {
        await interaction.editReply({
            content: '⚠️ 投稿者にDMを届けられませんでした（DM受信OFFの可能性）。提案内容は記録されています。',
        });
    }
}

// customId プレフィックスから判別するためのヘルパー
function isVoiceSukiButtonId(customId) {
    return typeof customId === 'string' && customId.startsWith(`${VOICE_SUKI_BUTTON_PREFIX}_`);
}
function isVoiceYomiButtonId(customId) {
    return typeof customId === 'string'
        && customId.startsWith(`${VOICE_YOMI_BUTTON_PREFIX}_`)
        && !customId.startsWith(`${VOICE_YOMI_MODAL_PREFIX}_`);
}
function isVoiceYomiModalId(customId) {
    return typeof customId === 'string' && customId.startsWith(`${VOICE_YOMI_MODAL_PREFIX}_`);
}

module.exports = {
    setupVoiceChallengeMessage,
    handleVoiceChallengeButton,
    VOICE_CHALLENGE_BUTTON_ID,
    // F2: リスナーボタン2種
    handleVoiceSukiButton,
    handleVoiceYomiButton,
    handleVoiceYomiModalSubmit,
    isVoiceSukiButtonId,
    isVoiceYomiButtonId,
    isVoiceYomiModalId,
};
