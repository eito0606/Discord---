// handlers/introHandler.js — 自己紹介Bot機能のメインモジュール
// チャンネルに「自己紹介をつくる」ボタンを設置し、ユーザーがボタンを押すとプライベートスレッドで
// 対話形式の自己紹介作成を実施する。

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ThreadAutoArchiveDuration,
} = require('discord.js');

const INTRO_BUTTON_ID = 'intro_start';
const TIMEOUT_MS = 5 * 60 * 1000; // 5分

// 自己紹介チャンネルに案内メッセージとボタンを設置する
async function setupIntroMessage(channel) {
    const mainEmbed = new EmbedBuilder()
        .setTitle('👋 自己紹介を作成しよう！')
        .setDescription(
            '「自己紹介をつくる」ボタンを押すと、あなた専用のプライベートスレッドが作成されます。\n' +
            'Botの質問に答えるだけで、スッキリ整理された自己紹介を投稿できます！\n\n' +
            '※回答内容は後でこのチャンネルに公開されます。'
        )
        .setColor(0x00FF7F) // 春を感じる明るい緑
        .setThumbnail('https://cdn.discordapp.com/attachments/1475783333932826767/1494155993263636480/sample.png');

    const sampleEmbed = new EmbedBuilder()
        .setTitle('📋 【完成イメージ：ひながた】')
        .setColor(0x00FF7F)
        .setDescription('投稿されると以下のように表示されます。')
        .addFields(
            { name: '**名前**', value: 'ヴォイポケ太郎', inline: true },
            { name: '**SNSアカウント**', value: '@voipoke_sample', inline: true },
            { name: '\u200b', value: '\u200b' },
            { name: '**好きなこと・趣味**', value: 'アニメ鑑賞、ボイス練習' },
            { name: '**得意なこと・スキル**', value: '元気な少年声、ナレーション' },
            { name: '**ひとこと**', value: 'よろしくお願いします！✨' }
        );

    const button = new ButtonBuilder()
        .setCustomId(INTRO_BUTTON_ID)
        .setLabel('自己紹介をつくる')
        .setEmoji('📝')
        .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    await channel.send({ embeds: [mainEmbed, sampleEmbed], components: [row] });
}

// ボタン押下時の処理
async function handleIntroButton(interaction) {
    if (interaction.customId !== INTRO_BUTTON_ID) return;

    const user = interaction.user;
    await interaction.deferReply({ ephemeral: true });

    try {
        const thread = await interaction.channel.threads.create({
            name: `📝自己紹介作成_${user.displayName}`,
            type: ChannelType.PrivateThread,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
            reason: `${user.displayName} の自己紹介作成用`,
        });

        await thread.join(); // Botをスレッドに参加させる
        await thread.members.add(user.id);

        console.log(`[Intro] スレッドを作成しました: ${thread.name} (ID: ${thread.id})`);

        await interaction.editReply({
            content: `✅ 自己紹介作成用のスレッドを作成しました！\n👉 <#${thread.id}> で回答してください。`,
        });

        await runIntroInThread(thread, user, interaction.client);

    } catch (error) {
        console.error('自己紹介スレッド作成エラー:', error);
        await interaction.editReply({
            content: '❌ スレッドの作成中にエラーが発生しました。',
        });
    }
}

// スレッド内での質問ループ
async function runIntroInThread(thread, user, client) {
    const questions = [
        { key: 'name', label: 'お名前（またはニックネーム）', required: true },
        { key: 'likes', label: '好きなこと・趣味', required: true },
        { key: 'skills', label: '得意なこと・スキル', required: true },
        { key: 'sns', label: 'SNSアカウント', required: false },
        { key: 'message', label: 'ひとこと', required: false },
    ];

    const answers = {};

    await thread.send(
        `こんにちは、${user.displayName} さん！💐\n` +
        '今からいくつか質問をします。メッセージで回答を送ってください。\n' +
        '（5分以内に返信がない場合は中断されます）\n' +
        '━━━━━━━━━━━━━━━━━━━━'
    );

    for (const q of questions) {
        let prompt = `**【${q.label}】** を教えてください。`;
        if (!q.required) {
            prompt += '\n（特にない場合や公開したくない場合は「なし」と入力してください）';
        }
        await thread.send(prompt);

        const answer = await collectAnswer(thread, user);
        if (answer === null) {
            await thread.send('⏰ 時間切れのため、自己紹介の作成を中断しました。はじめからやり直してください。');
            await thread.setArchived(true);
            return;
        }
        answers[q.key] = answer;
    }

    // 完了メッセージとメインへの投稿
    await thread.send('✅ ありがとうございます！自己紹介を公開します。');
    
    try {
        await postIntroEmbed(client, answers, user);
        await thread.send('✨ 公開が完了しました！このスレッドは数分後に自動で閉じられます。');
    } catch (error) {
        console.error('自己紹介投稿失敗:', error);
        await thread.send(
            '❌ **エラー: 公開に失敗しました。**\n' +
            'Botがチャンネルにメッセージを送信する権限がないか、チャンネルが見つかりません。\n' +
            'お手数ですが、管理者にお問い合わせください。'
        );
    }

    // 少し待ってからアーカイブ
    setTimeout(async () => {
        try { await thread.setArchived(true); } catch (e) {}
    }, 10000);
}

// 回答収集
async function collectAnswer(thread, user) {
    try {
        const collected = await thread.awaitMessages({
            filter: (msg) => msg.author.id === user.id && !msg.author.bot,
            max: 1,
            time: TIMEOUT_MS,
            errors: ['time'],
        });
        return collected.first().content.trim();
    } catch (error) {
        return null;
    }
}

// メインチャンネルへの投稿
async function postIntroEmbed(client, answers, user) {
    const introChannelId = process.env.INTRO_CHANNEL_ID;

    if (!introChannelId) {
        console.error('❌ [Config Error] INTRO_CHANNEL_ID が .env ファイルに設定されていません。');
        throw new Error('自己紹介投稿先のチャンネルIDが設定されていません。');
    }

    const channel = await client.channels.fetch(introChannelId).catch((err) => {
        console.error(`❌ [Discord Error] 自己紹介チャンネルの取得に失敗しました (ID: ${introChannelId}):`, err.message);
        return null;
    });

    if (!channel) {
        console.error('❌ [Runtime Error] 自己紹介チャンネルが見つかりませんでした。Botがチャンネルを閲覧できるか確認してください。');
        throw new Error('投稿先チャンネルが見つかりませんでした。');
    }

    const embed = new EmbedBuilder()
        .setTitle('📋 自己紹介')
        .setColor(0x00FF7F) // SHIFT AI風のアクセントカラー
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 })) // 右上のアイコン
        .addFields(
            { name: '**名前**', value: answers.name, inline: true },
            { name: '**SNSアカウント**', value: (answers.sns === 'なし' ? '未設定' : answers.sns), inline: true },
            { name: '\u200b', value: '\u200b' }, // 空行で区切り（スマートに見せるため）
            { name: '**好きなこと・趣味**', value: answers.likes },
            { name: '**得意なこと・スキル**', value: answers.skills },
            { name: '**ひとこと**', value: (answers.message === 'なし' ? 'よろしくお願いします！' : answers.message) }
        )
        .setTimestamp()
        .setFooter({ text: `ID: ${user.id}` });

    try {
        await channel.send({ 
            content: `✨ **<@${user.id}> さんが新しい自己紹介を投稿しました！**`, 
            embeds: [embed] 
        });
        console.log(`自己紹介の投稿に成功しました: ${user.displayName}`);
    } catch (error) {
        console.error('自己紹介のチャンネル送信中にエラーが発生しました:', error);
        throw error; // 上位の thread.send でエラーを把握できるように一旦投げる
    }
}

module.exports = {
    setupIntroMessage,
    handleIntroButton,
    INTRO_BUTTON_ID,
};
