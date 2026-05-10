// handlers/aiChat.js — ユーザー専用のプライベートスレッドを作成し、AI（Gemini）と1対1で会話できる機能を提供するモジュール

const { ChannelType, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { generateText } = require('./geminiClient');

// ★ ここを実際のボタンのcustomIdに合わせる
const AI_CHAT_BUTTON_ID = 'start_ai_chat';

// 1ユーザーあたりの1日の利用上限
const DAILY_LIMIT = 3;
// 無操作タイムアウト（10分）
const IDLE_TIMEOUT = 10 * 60 * 1000;

// 利用回数を追跡（日付ごと）
const usageMap = new Map();

// ユーザーごとの今日のキー（目印）を生成する。引数: userId(ユーザーのID) → 戻り値: "ID_日付"の文字列
function getTodayKey(userId) {
  const today = new Date().toISOString().split('T')[0];
  return `${userId}_${today}`;
}

// ユーザーの今日の利用回数を取得する。引数: userId(ユーザーのID) → 戻り値: 利用回数(数値)
function getUsageCount(userId) {
  const key = getTodayKey(userId);
  return usageMap.get(key) || 0;
}

// ユーザーの今日の利用回数を1増やす。引数: userId(ユーザーのID)
function incrementUsage(userId) {
  const key = getTodayKey(userId);
  usageMap.set(key, (usageMap.get(key) || 0) + 1);
}

// AI壁打ち開始ボタンが押されたときの処理。引数: interaction(ボタン操作情報) → 戻り値: 処理したかどうか(boolean)
async function handleAiChatButton(interaction) {
  // 該当のボタン以外は無視する（関係ないボタンには反応しない）
  if (interaction.customId !== AI_CHAT_BUTTON_ID) return false;

  const user = interaction.user;

  // 利用回数チェック
  // 1日の上限に達していたら、お断りのメッセージを出して終わる（遊園地の入場制限のようなもの）
  const count = getUsageCount(user.id);
  if (count >= DAILY_LIMIT) {
    await interaction.reply({
      content: `⚠️ 本日の利用上限（${DAILY_LIMIT}回）に達しました。また明日ご利用ください！`,
      ephemeral: true
    });
    return true;
  }

  // ★ 最重要：即座にdeferReplyして3秒タイムアウトを回避
  // （「ちょっと待ってね」という札を立てることで、Discordから怒られないようにする）
  await interaction.deferReply({ ephemeral: true });

  try {
    // プライベートスレッドを作成
    // 他の人からは見えない、ユーザー専用の個室を用意する
    const thread = await interaction.channel.threads.create({
      name: `🤖 AI壁打ち｜${user.displayName}`,
      type: ChannelType.PrivateThread,
      autoArchiveDuration: 60,
      reason: `AI壁打ち: ${user.tag}`
    });

    // ユーザーを個室に招待し、入場した記録（利用回数）をつける
    await thread.members.add(user.id);
    incrementUsage(user.id);

    // 待たせていたユーザーに「個室ができましたよ」とURLを送る
    await interaction.editReply({
      content: `✅ スレッドを作成しました！ → ${thread}`
    });

    // 初期メッセージ
    // 初めて入室した人へのご案内（メニュー表のようなもの）を表示する
    await thread.send(
      `🤖 **AI壁打ちへようこそ！**\n\n` +
      `${user} さん、何でも聞いてください。\n` +
      `声優・ナレーションに関する相談、台本の改善、演技のアドバイスなど、AIが相談相手になります。\n\n` +
      `📌 **ルール**\n` +
      `・10分間操作がないと自動終了します\n` +
      `・「終了」と送ると会話を終了します\n` +
      `・会話内容は他のメンバーには見えません`
    );

    // 会話ループ開始
    await runAiChat(thread, user);

  } catch (error) {
    console.error('AI壁打ちエラー:', error);
    await interaction.editReply({
      content: '❌ スレッドの作成に失敗しました。もう一度お試しください。'
    }).catch(() => {});
  }

  return true;
}

// AIとの実際のやり取り（会話）を続けるためのループ処理。引数: thread(作成したスレッド), user(ユーザー情報)
async function runAiChat(thread, user) {
  const conversationHistory = [];
  // AIの性格や役割を設定する（役者に台本を渡して「こういうキャラで演じて」と指示するようなもの）
  const systemPrompt = 
    'あなたは声優・ナレーターを目指す人の相談相手AIです。' +
    '親しみやすく、具体的なアドバイスを心がけてください。' +
    '演技、発声、滑舌、オーディション対策、台本の読み方、業界知識など幅広く対応します。' +
    '回答は簡潔に、Discord上で読みやすい長さ（300文字程度）にまとめてください。';

  while (true) {
    try {
      // ユーザーのメッセージを待つ（10分タイムアウト）
      // 相手からの手紙が届くまで待つ。10分経っても来なければ諦める。
      const collected = await thread.awaitMessages({
        filter: (msg) => msg.author.id === user.id && !msg.author.bot,
        max: 1,
        time: IDLE_TIMEOUT,
        errors: ['time']
      });

      const userMessage = collected.first();
      if (!userMessage) break;

      // 「終了」で会話終了
      if (userMessage.content.trim() === '終了') {
        await thread.send('👋 お疲れさまでした！またいつでも相談してくださいね。');
        await thread.setArchived(true); // 部屋の鍵を閉めて片付ける
        return;
      }

      // typing表示（「考え中...」というペンが動くアニメーションを出す）
      await thread.sendTyping();

      // 会話履歴を組み立て
      conversationHistory.push({ role: 'user', content: userMessage.content });

      // Geminiに送るプロンプトを作成
      // これまでの会話の文脈をまとめて、AIに「こういう流れで話してるよ」と教える
      const fullPrompt = 
        systemPrompt + '\n\n' +
        '【会話履歴】\n' +
        conversationHistory.slice(-10).map(m => 
          `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`
        ).join('\n') +
        '\n\n上記の会話を踏まえて、最新のユーザーの発言に回答してください。';

      // 実際にAI(Gemini)に聞いて返事をもらう
      const aiResponse = await generateText(fullPrompt);

      conversationHistory.push({ role: 'assistant', content: aiResponse });

      // 2000文字制限対応（Discord）
      // Discordの仕様上、1回に送れる手紙の文字数は2000文字までなので、長すぎる場合は分割する
      if (aiResponse.length > 1900) {
        const chunks = aiResponse.match(/.{1,1900}/gs);
        for (const chunk of chunks) {
          await thread.send(chunk);
        }
      } else {
        await thread.send(aiResponse);
      }

    } catch (error) {
      // タイムアウト
      if (error.message === 'time' || (error instanceof Map && error.size === 0) || error.code === 'INTERACTION_COLLECTOR_ERROR') {
        await thread.send('⏰ 10分間操作がなかったため、自動終了します。またいつでも相談してくださいね！').catch(() => {});
        await thread.setArchived(true).catch(() => {});
        return;
      }
      console.error('AI会話エラー:', error);
      await thread.send('⚠️ エラーが発生しました。もう一度メッセージを送ってみてください。').catch(() => {});
    }
  }
}

// チャンネルにAI壁打ちの開始ボタン（メニュー）を設置する。引数: channel(設置先のチャンネル)
async function setupAiChatMessage(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x00b894)
    .setTitle('🤖 ぼいラボ AI壁打ち')
    .setDescription(
      '声優・ナレーターを目指すあなたの相談相手AIです。\n\n' +
      '🎯 **こんなことに使えます**\n' +
      '・配信ネタ・企画のアイデア出し\n' +
      '・台本やセリフの改善相談\n' +
      '・演技・発声の練習方法\n' +
      '・オーディション対策\n' +
      '・SNS運用の相談\n\n' +
      'ボタンを押すとあなた専用のスレッドが作られ、\nAIと1対1で自由に会話できます。\n\n' +
      '※ 1日3回まで利用できます\n' +
      '※ 10分間操作がないと自動終了します\n' +
      '※ 会話内容は他のメンバーには見えません'
    )
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/4712/4712027.png');

  const button = new ButtonBuilder()
    .setCustomId(AI_CHAT_BUTTON_ID)
    .setLabel('🤖 AI壁打ちを始める')
    .setStyle(ButtonStyle.Success);

  // ボタンを専用の棚に並べる
  const row = new ActionRowBuilder().addComponents(button);

  // メッセージと一緒にボタンをチャンネルに送信
  await channel.send({ embeds: [embed], components: [row] });
}

module.exports = { handleAiChatButton, setupAiChatMessage, AI_CHAT_BUTTON_ID };
