// index.js — Botの本体（メインプログラム）
// ここからBotが起動し、必要な設定やイベントを準備します。

require('dotenv').config(); // .envファイルから秘密のメモ（環境変数）を読み込む
const { Client, GatewayIntentBits } = require('discord.js'); // Discordとやり取りするための道具箱を取り出す

// Discord.js特有の概念: Intent（インテント）
// → 「BotがDiscord上でどんな情報を受け取るか」を決める、入場パスのようなもの。
//    全部受け取ると重くなるので、必要なもの（メッセージの読み取りなど）だけを指定します。

// Bot（クライアント）の設計図を作成
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,           // サーバー（Guild）の基本情報を受け取るパス
    GatewayIntentBits.GuildMessages,    // サーバー内のメッセージを受け取るパス
    GatewayIntentBits.MessageContent,   // メッセージの中身（テキストや文字など）を読み取るための特別なパス
  ],
});

// cron設定を読み込む
const { setupCron } = require('./cron');

// テスト投稿用の関数を読み込む
const { postDailyScript } = require('./handlers/dailyPost');

// アンケート機能を読み込む
const { setupSurveyMessage, handleSurveyButton } = require('./handlers/survey');

// Botの起動準備が完了したときに1回だけ実行される処理
// → 起床して「おはよう」と言うようなイメージ
client.once('ready', () => {
  console.log('Botがオンラインになった'); // コンソール（黒い画面）にメッセージを出す

  // 定期実行（アラーム）をセットする
  setupCron(client);
});

// メッセージが投稿されたときに実行される処理
// (後で機能Bの実装でここに処理を追加します。今は枠組みだけ)
client.on('messageCreate', async (message) => {
  // 自分が送ったメッセージには反応しないようにする（無限ループ防止）
  if (message.author.bot) return;

  // 開発者（エイトさん）の手動テスト用：「!testpost」と打つと強制的にお題を投稿する
  if (message.content === '!testpost') {
    await message.reply('テスト投稿を実行します...');
    await postDailyScript(client);
    return;
  }

  // アンケート設置コマンド：「!survey」と打つとそのチャンネルにアンケートを設置する
  if (message.content === '!survey') {
    await setupSurveyMessage(message.channel);
    // コマンドメッセージ自体を削除（チャンネルをきれいに保つため）
    await message.delete().catch(() => { });
    return;
  }

  // 開発者の手動テスト用：「!testbest」と打つと強制的に週間ベストを集計・発表する
  if (message.content === '!testbest') {
    await message.reply('週間ベストの集計と発表を実行します...');
    const { announceWeeklyBest } = require('./handlers/weeklyBest');
    await announceWeeklyBest(client);
    return;
  }

  // 開発者の手動テスト用：「!testnews」と打つと強制的にニュースを取得・投稿する
  if (message.content === '!testnews') {
    await message.reply('声優ニュースの収集と投稿テストを実行します...');
    const newsCollector = require('./handlers/newsCollector');
    await newsCollector.checkAndPost(client);
    return;
  }

  // 機能B：音声ファイルが送られてきたら、参加日数や連続記録を計算する
  const { handleAudioSubmission } = require('./handlers/participation');
  await handleAudioSubmission(message);
});

// ボタンが押されたときに実行される処理
// interactionCreate: Discordのボタンやスラッシュコマンドなどの「操作」を検知するイベント
client.on('interactionCreate', async (interaction) => {
  // ボタン操作でなければ無視する
  if (!interaction.isButton()) return;

  // アンケートボタンの処理を呼び出す
  await handleSurveyButton(interaction);
});

// BotをDiscordにログイン（接続）させる
// DISCORD_BOT_TOKENはBotの「パスワード付身分証明書」のようなもの
client.login(process.env.DISCORD_BOT_TOKEN);
