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
    GatewayIntentBits.GuildMessageReactions, // ★声劇: リアクション（絵文字スタンプ）の追加・削除を検知するパス
    GatewayIntentBits.GuildMembers,     // ★アーリーアクセス: 新規参加検知＆既存メンバー一括取得（Privileged Intent）
  ],
  // ★声劇: 部分的にキャッシュされたリアクション・メッセージを完全に取得できるようにする設定
  // （Botが起動していない間に付けられたリアクションも正しく処理するための保険）
  partials: [
    require('discord.js').Partials.Message, 
    require('discord.js').Partials.Reaction,
    require('discord.js').Partials.Channel,      // スレッド（チャンネル）のキャッシュ対策
    require('discord.js').Partials.ThreadMember // スレッドメンバーのキャッシュ対策
  ],
});

// cron設定を読み込む
const { setupCron } = require('./cron');

// M-5: 新規メンバーの自動モデレーション（新規アカウント警告 + スパム検知）
const { registerNewMemberGuard } = require('./handlers/voipoke/new-member-guard');

// テスト投稿用の関数を読み込む
const { postDailyScript } = require('./handlers/dailyPost');

// アンケート機能を読み込む
const { setupSurveyMessage, handleSurveyButton } = require('./handlers/survey');

// ★ 新規追加: AI壁打ち機能を読み込む
const { handleAiChatButton, setupAiChatMessage } = require('./handlers/aiChat');

// ★ 新規追加: 音声練習の動画自動生成機能を読み込む
const { handleVoicePractice } = require('./handlers/voicePracticeHandler');

// ★ 新規追加: 声劇イベント機能を読み込む
const { handleVoiceDramaTrigger, handleVoiceDramaButton, handleVoiceDramaSelectMenu, handleReactionAdd, handleReactionRemove, handleEmergencyCancelModal, isEmergencyCancelModalId } = require('./handlers/voiceDrama');

// M-6 Phase 2-B: 辞退・代役募集
const {
  handleDeclineButton,
  handleDeclineModalSubmit,
  handleSeekSubstituteButton,
  isDeclineButtonId,
  isDeclineModalId,
  isSeekSubstituteButtonId,
} = require('./handlers/voiceDramaDecline');

// M-6 Phase 2-D: 声劇一覧ボタン
const {
  handleListButton: handleDramaListButton,
  isListButtonId: isDramaListButtonId,
} = require('./handlers/voiceDramaList');

// M-6 Phase 3-D: X 配信許可フロー
const {
  handleBroadcastRequest,
  handleConsentButton,
  isBroadcastRequestButtonId,
  isBroadcastConsentButtonId,
} = require('./handlers/voiceDramaBroadcast');
const { restoreReminders } = require('./handlers/voiceDramaReminder');

// ★ 新規追加: 自己紹介・ボイスサンプル・日記リアクション
const { setupIntroMessage, handleIntroButton } = require('./handlers/introHandler');
const {
  setupVoiceChallengeMessage,
  handleVoiceChallengeButton,
  // F2: リスナーボタン2種
  handleVoiceSukiButton,
  handleVoiceYomiButton,
  handleVoiceYomiModalSubmit,
  isVoiceSukiButtonId,
  isVoiceYomiButtonId,
  isVoiceYomiModalId,
} = require('./handlers/voiceChallengeHandler');
const { handleDiaryReaction } = require('./handlers/diaryReactionHandler');

// ★ VoiPoke 連携: Webhook サーバー（Express）
// VoiPoke iOS / Supabase Edge Function からのリクエストを受信して
// ロール同期・新作通知などを処理する。既存機能には触れない独立モジュール。
const { startWebhookServer } = require('./handlers/voipoke/webhook-server');

// ★ Reverb ニュース：通知ロール案内 / リアクション / 手動配信
const {
  setupReverbSubscriptionMessage,
  handleReverbReactionAdd,
  handleReverbReactionRemove,
} = require('./handlers/reverb/subscription');
const { handleReverbUpdate } = require('./handlers/reverb/webhook-handler');
const { runDailyFallback } = require('./handlers/reverb/daily-fallback');
const { getToolIdByName, getToolById } = require('./handlers/reverb/tool-defs');

// ★ クリエイター集客（F1 MVP）
const {
  setupCreatorWelcomeMessage,
  handleCreatorJoinButton,
  CREATOR_JOIN_BUTTON_ID,
} = require('./handlers/creator/onboarding');
const { postMonthlyTheme } = require('./handlers/creator/events');

// ★ 養成所同期ペアリング（A案）
const { handlePairInviteCommand } = require('./handlers/pair/invite');
const { handlePairJoinCommand } = require('./handlers/pair/join');

// ★ 投稿者ダッシュボード（D案）
const { handleMyDashboardCommand } = require('./handlers/dashboard');

// ★ つながりハブ（A+D のボタンUI、声優志望者向け）
const {
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
} = require('./handlers/hub');

// ★ M-6 グループ機能（規約承認 + 解散 Modal）
const {
  handleTermsAgree,
  handleTermsDecline,
  isTermsButtonId,
  TERMS_BUTTON_AGREE,
  TERMS_BUTTON_DECLINE,
} = require('./handlers/group/join');
const {
  handleDissolveModalSubmit,
  isDissolveModalId,
} = require('./handlers/group/dissolve');

// ★ アーリーアクセス（Reverb Lab 早期メンバー）
const { grantAllExisting, setupAutoGrantOnJoin } = require('./handlers/earlyAccess');
const { countEarlyMembers } = require('./db');

// Botの起動準備が完了したときに1回だけ実行される処理
// → 起床して「おはよう」と言うようなイメージ
client.once('clientReady', (c) => {
  console.log(`Botがオンラインになった: ${c.user.tag}`);

  // ★デバッグ: 読み込まれている環境変数のリストを表示（値は見せない）
  const envKeys = Object.keys(process.env).filter(key => 
    key.includes('ID') || key.includes('TOKEN') || key.includes('KEY') || key.includes('URL')
  );
  console.log(`[Debug] 読み込まれた主要な設定項目 (${envKeys.length}件):`, envKeys.join(', '));

  // 定期実行（アラーム）をセットする
  setupCron(client);

  // ★アーリーアクセス: 新規参加者への自動付与ハンドラを起動
  setupAutoGrantOnJoin(client);

  // ★ M-5: 新規メンバー自動モデレーション（GuildMemberAdd + MessageCreate 監視）
  registerNewMemberGuard(client);

  // ★声劇: Bot再起動時に未送信のリマインドタイマーを復元する（目覚まし時計を再セット）
  restoreReminders(client);

  // ★案内メッセージの自動設置・更新
  refreshGuides(client);

  // ★ Webhook サーバー起動（VoiPoke + Reverb 共通）
  // どちらかのシークレットが設定されていれば起動。両方未設定ならスキップ。
  const hasVoipokeSecret = !!process.env.VOIPOKE_WEBHOOK_SECRET;
  const hasReverbSecret = !!process.env.REVERB_WEBHOOK_SECRET;
  if (hasVoipokeSecret || hasReverbSecret) {
    try {
      startWebhookServer(client);
      if (!hasVoipokeSecret) console.log('[Webhook] VoiPoke secret 未設定 → VoiPoke 系ルートは無効');
      if (!hasReverbSecret) console.log('[Webhook] Reverb secret 未設定 → /reverb/update は無効');
    } catch (err) {
      console.error('[Webhook] サーバー起動失敗:', err);
    }
  } else {
    console.log('[Webhook] シークレット未設定のため webhook サーバーをスキップ');
  }
});

// 案内メッセージを最新の状態にする関数
async function refreshGuides(client) {
  const guides = [
    { channelId: process.env.INTRO_CHANNEL_ID, setupFn: setupIntroMessage, name: '自己紹介' },
    { channelId: process.env.VOICE_CHALLENGE_CHANNEL_ID, setupFn: setupVoiceChallengeMessage, name: 'ボイスサンプル' },
  ];

  for (const guide of guides) {
    if (!guide.channelId) continue;
    try {
      const channel = await client.channels.fetch(guide.channelId);
      if (!channel) continue;

      // 過去のBotによる案内メッセージを探して削除（古い情報を残さないため）
      const messages = await channel.messages.fetch({ limit: 50 });
      const oldGuides = messages.filter(m => 
        m.author.id === client.user.id && 
        m.embeds.length > 0 && 
        (m.embeds[0].title?.includes('自己紹介') || m.embeds[0].title?.includes('お題をアップ'))
      );
      
      if (oldGuides.size > 0) {
        console.log(`${guide.name} の既存案内を削除して更新します...`);
        for (const m of oldGuides.values()) {
          await m.delete().catch(() => {});
        }
      }

      // 新規設置
      await guide.setupFn(channel);
      console.log(`${guide.name} の案内を自動設置しました。`);
    } catch (err) {
      console.error(`${guide.name} の自動設置に失敗しました:`, err);
    }
  }
}

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

  // AI壁打ち設置コマンド：「!aichat」と打つとそのチャンネルにAIの相談ボタンを設置する
  if (message.content === '!aichat') {
    await setupAiChatMessage(message.channel);
    await message.delete().catch(() => {});
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

  // ─── Reverb ニュース：通知ロール案内の設置 ───
  // 管理者がチャンネル内で `!reverb_setup` と打つと、その場に案内Embedを設置する
  if (message.content === '!reverb_setup') {
    try {
      await setupReverbSubscriptionMessage(message.channel);
      await message.delete().catch(() => {});
    } catch (err) {
      console.error('[Reverb] setup error:', err);
      await message.reply(`設置に失敗: ${err.message}`).catch(() => {});
    }
    return;
  }

  // ─── Reverb ニュース：活用事例配信のテスト ───
  // `!testreverb_case` で当日件数チェックを無視して即時配信
  // 成功時はサイレント（チャンネルにノイズを残さない）
  if (message.content === '!testreverb_case') {
    await message.delete().catch(() => {}); // コマンド自体を消してノイズ削減
    try {
      const result = await runDailyFallback(client, { force: true });
      console.log('[Reverb] !testreverb_case 結果:', JSON.stringify(result));
      if (!result.success) {
        const notice = await message.channel.send(
          `❌ 活用事例配信に失敗: ${result.error || 'unknown'}`,
        ).catch(() => null);
        if (notice) setTimeout(() => notice.delete().catch(() => {}), 10_000);
      }
    } catch (err) {
      console.error('[Reverb] testreverb_case error:', err);
      const notice = await message.channel.send(`❌ エラー: ${err.message}`).catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => {}), 10_000);
    }
    return;
  }

  // ─── 養成所同期ペアリング（A案） ───
  // 通常はハブEmbedのボタン経由を使うが、後方互換のためコマンドも残す
  if (message.content.trim() === '!pair_invite') {
    await handlePairInviteCommand(message);
    return;
  }
  if (message.content.trim().startsWith('!pair_join')) {
    await handlePairJoinCommand(message);
    return;
  }

  // ─── 投稿者ダッシュボード（D案） ───
  if (message.content.trim() === '!my_dashboard') {
    await handleMyDashboardCommand(message);
    return;
  }

  // ─── つながりハブ：ボタンEmbed設置コマンド ───
  // 「!hub_setup」と打つと、その場にA+D機能のボタンUIを設置
  if (message.content.trim() === '!hub_setup') {
    try {
      await setupHubMessage(message.channel);
      await message.delete().catch(() => {});
    } catch (err) {
      console.error('[Hub] setup error:', err);
      await message.reply(`❌ 設置に失敗: ${err.message}`).catch(() => {});
    }
    return;
  }

  // ─── クリエイター招待：Embed設置 ───
  // チャンネル内で `!creator_setup` を打つと、その場にクリエイター招待Embedを設置する
  if (message.content === '!creator_setup') {
    try {
      await setupCreatorWelcomeMessage(message.channel);
      await message.delete().catch(() => {});
    } catch (err) {
      console.error('[Creator] setup error:', err);
      await message.reply(`❌ 設置に失敗: ${err.message}`).catch(() => {});
    }
    return;
  }

  // ─── クリエイター月次お題：手動テスト ───
  // `!testcreator_theme` で同月チェックを無視して即時投稿（force=true）
  if (message.content === '!testcreator_theme') {
    await message.delete().catch(() => {});
    try {
      const result = await postMonthlyTheme(client, { force: true });
      console.log('[Creator] !testcreator_theme 結果:', JSON.stringify(result));
      if (!result.success) {
        const notice = await message.channel.send(
          `❌ 月次お題の投稿に失敗: ${result.error || 'unknown'}`,
        ).catch(() => null);
        if (notice) setTimeout(() => notice.delete().catch(() => {}), 10_000);
      }
    } catch (err) {
      console.error('[Creator] testcreator_theme error:', err);
      const notice = await message.channel.send(`❌ エラー: ${err.message}`).catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => {}), 10_000);
    }
    return;
  }

  // ─── Reverb ニュース：アップデート webhook 投稿のローカルテスト ───
  // 使い方: `!testreverb_update VoiLog` （ツール名省略時は VoiLog）
  // 成功時はサイレント
  if (message.content.startsWith('!testreverb_update')) {
    const parts = message.content.split(/\s+/);
    const tool = parts[1] || 'VoiLog';
    await message.delete().catch(() => {});
    // ツール定義から実URLを引く（example.com への誤誘導を防ぐ）
    // 公開前ツール（coming_soon）はテスト投稿でもリンク無しにする
    const toolId = getToolIdByName(tool);
    const toolDef = toolId ? getToolById(toolId) : null;
    const link = toolDef?.coming_soon ? null : (toolDef?.url || null);
    try {
      const result = await handleReverbUpdate(client, {
        tool,
        type: 'feature',
        title: `${tool} のテスト機能が追加されました`,
        body: 'これは `!testreverb_update` によるローカル投稿テストです。本番では各ツールの webhook 経由で配信されます。',
        link,
      }, { isTest: true });
      console.log('[Reverb] !testreverb_update 結果:', JSON.stringify(result));
      if (!result.success) {
        const notice = await message.channel.send(
          `❌ アップデート投稿に失敗: ${result.error || 'unknown'}`,
        ).catch(() => null);
        if (notice) setTimeout(() => notice.delete().catch(() => {}), 10_000);
      }
    } catch (err) {
      console.error('[Reverb] testreverb_update error:', err);
      const notice = await message.channel.send(`❌ エラー: ${err.message}`).catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => {}), 10_000);
    }
    return;
  }

  // ─── アーリーアクセス：既存メンバー一括付与（管理者専用・1回叩けば十分）───
  // 使い方: `!grant_early_role_all`
  // 実行後の参加者は GuildMemberAdd で自動付与される（VoiPokeローンチ前まで永続）
  if (message.content === '!grant_early_role_all') {
    if (!message.member?.permissions?.has('Administrator')) {
      await message.reply('⛔ このコマンドは管理者専用です').catch(() => {});
      return;
    }
    if (!message.guild) {
      await message.reply('⛔ サーバー内で実行してください').catch(() => {});
      return;
    }
    const notice = await message.channel.send('🌀 既存メンバーへアーリーアクセス付与を開始します...').catch(() => null);
    try {
      const result = await grantAllExisting(message.guild);
      const beforeCount = countEarlyMembers();
      const summary = [
        '✅ アーリーアクセス一括付与 完了',
        `・新規付与: **${result.granted}** 人`,
        `・既保持: **${result.alreadyHad}** 人`,
        `・Bot除外: ${result.botSkipped} 人`,
        result.errors > 0 ? `・付与失敗: ${result.errors} 人（ログ確認）` : null,
        `・現在の早期メンバー総数: **${beforeCount}** 人`,
      ].filter(Boolean).join('\n');
      if (notice) await notice.edit(summary).catch(() => {});
      else await message.channel.send(summary).catch(() => {});
    } catch (err) {
      console.error('[EarlyAccess] grant_early_role_all error:', err);
      const errMsg = `❌ 一括付与エラー: ${err.message}`;
      if (notice) await notice.edit(errMsg).catch(() => {});
      else await message.channel.send(errMsg).catch(() => {});
    }
    return;
  }

  // 開発者の手動テスト用：「!testdrama」と打つとテスト用の声劇イベントを作成する
  if (message.content === '!testdrama') {
    await message.reply('🎭 テスト用の声劇イベントを作成します...');
    // テスト用に30分後の日時を設定
    const testDatetime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { createVoiceDramaEvent, setRecruitMessageId } = require('./db');
    const { scheduleReminders } = require('./handlers/voiceDramaReminder');
    const testEvent = createVoiceDramaEvent({
      hostUserId: message.author.id,
      recruitChannelId: process.env.VOICE_DRAMA_CHANNEL_ID,
      stageChannelId: process.env.VOICE_DRAMA_STAGE_CHANNEL_ID || process.env.VOICE_DRAMA_CHANNEL_ID,
      eventTitle: 'テスト声劇',
      eventDatetime: testDatetime,
      characters: [
        { name: '太郎', gender: '男性', emoji: '1️⃣' },
        { name: '花子', gender: '女性', emoji: '2️⃣' },
        { name: 'ナレーション', gender: '指定なし', emoji: '3️⃣' },
      ],
    });
    // 募集Embedを投稿
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const channel = await client.channels.fetch(process.env.VOICE_DRAMA_CHANNEL_ID);
    const formattedDate = new Date(testDatetime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const embed = new EmbedBuilder()
      .setTitle('🎭 声劇イベント募集！')
      .setDescription(
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📖 **テスト声劇**\n\n` +
        `👑 主催: <@${message.author.id}>\n` +
        `📅 開演: ${formattedDate}\n` +
        `🎤 ステージ: <#${process.env.VOICE_DRAMA_STAGE_CHANNEL_ID || process.env.VOICE_DRAMA_CHANNEL_ID}>\n\n` +
        `**【配役一覧】**\n` +
        `1️⃣ **太郎**（男性）— 0人\n` +
        `2️⃣ **花子**（女性）— 0人\n` +
        `3️⃣ **ナレーション**（指定なし）— 0人\n\n` +
        `参加したい役の**リアクション（絵文字）を押して**立候補してください！\n` +
        `━━━━━━━━━━━━━━━━━━━━`
      )
      .setColor(0xFF6B6B)
      .setFooter({ text: `イベントID: ${testEvent.id} | 主催者が「確定」を押すとキャスト決定` })
      .setTimestamp();
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`vd_confirm_${testEvent.id}`).setLabel('✅ 確定する').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`vd_cancel_${testEvent.id}`).setLabel('❌ 募集キャンセル').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`vd_archive_${testEvent.id}`).setLabel('📁 アーカイブ').setStyle(ButtonStyle.Secondary),
    );
    const recruitMsg = await channel.send({ embeds: [embed], components: [buttonRow] });
    await recruitMsg.react('1️⃣');
    await recruitMsg.react('2️⃣');
    await recruitMsg.react('3️⃣');
    setRecruitMessageId(testEvent.id, recruitMsg.id);
    scheduleReminders(client, testEvent);
    await message.reply(`✅ テストイベント（ID: ${testEvent.id}）を作成しました！`);
    return;
  }

  // 機能B：音声ファイルが送られてきたら、参加日数や連続記録を計算する
  const { handleAudioSubmission } = require('./handlers/participation');
  await handleAudioSubmission(message);

  // ★ 新規追加: 音声練習 → 動画生成の処理を実行
  await handleVoicePractice(message, client);

  // ★ 新規追加: 声劇イベントのトリガーワード検知
  // 「声劇やりたい」等のキーワードを検知して、イベント作成フローを開始する
  await handleVoiceDramaTrigger(message, client);

  // ★ 新規追加: 自己紹介・ボイスサンプル設置コマンド
  if (message.content === '!intro_setup') {
    await setupIntroMessage(message.channel);
    await message.delete().catch(() => {});
    return;
  }
  if (message.content === '!voice_setup') {
    await setupVoiceChallengeMessage(message.channel);
    await message.delete().catch(() => {});
    return;
  }

  // ★ 新規追加: 日記報告部屋の自動リアクション
  await handleDiaryReaction(message);
});

// ボタンが押されたときに実行される処理
// interactionCreate: Discordのボタンやスラッシュコマンドなどの「操作」を検知するイベント
client.on('interactionCreate', async (interaction) => {
  // ★ F2 / Hub: Modal Submit
  if (interaction.isModalSubmit()) {
    if (isVoiceYomiModalId(interaction.customId)) {
      await handleVoiceYomiModalSubmit(interaction);
      return;
    }
    if (isHubJoinModalId(interaction.customId)) {
      await handleHubJoinModalSubmit(interaction);
      return;
    }
    // M-6: グループ解散モーダル
    if (isDissolveModalId(interaction.customId)) {
      await handleDissolveModalSubmit(interaction);
      return;
    }
    // M-6 Phase 2-A: 声劇 当日緊急キャンセル モーダル
    if (isEmergencyCancelModalId(interaction.customId)) {
      await handleEmergencyCancelModal(interaction);
      return;
    }
    // M-6 Phase 2-B: 辞退理由モーダル
    if (isDeclineModalId(interaction.customId)) {
      await handleDeclineModalSubmit(interaction);
      return;
    }
    return;
  }

  // ★声劇: セレクトメニュー（ドロップダウン）操作の処理
  // （超過した役の候補者を主催者が手動選択するときに使う）
  if (interaction.isStringSelectMenu()) {
    await handleVoiceDramaSelectMenu(interaction);
    return;
  }

  // ボタン操作でなければ無視する
  if (!interaction.isButton()) return;

  // ★ F2: ボイスサンプル「すき！」「こんなふうに読んでみて！」ボタン
  if (isVoiceSukiButtonId(interaction.customId)) {
    await handleVoiceSukiButton(interaction);
    return;
  }
  if (isVoiceYomiButtonId(interaction.customId)) {
    await handleVoiceYomiButton(interaction);
    return;
  }

  // ★ F1: クリエイター参加ボタン
  if (interaction.customId === CREATOR_JOIN_BUTTON_ID) {
    await handleCreatorJoinButton(interaction);
    return;
  }

  // ★ つながりハブ：5ボタン（同期招待・コード参加・みんなの状況・声劇・解散）
  if (interaction.customId === HUB_INVITE_BUTTON_ID) {
    await handleHubInviteButton(interaction);
    return;
  }
  if (interaction.customId === HUB_JOIN_BUTTON_ID) {
    await handleHubJoinButton(interaction);
    return;
  }
  if (interaction.customId === HUB_DASHBOARD_BUTTON_ID) {
    await handleHubDashboardButton(interaction);
    return;
  }
  if (interaction.customId === HUB_DRAMA_BUTTON_ID) {
    await handleHubDramaButton(interaction);
    return;
  }
  if (interaction.customId === HUB_DISSOLVE_BUTTON_ID) {
    await handleHubDissolveButton(interaction);
    return;
  }

  // ★ M-6: グループ専用チャンネル作成の規約承認ボタン
  if (isTermsButtonId(interaction.customId)) {
    if (interaction.customId.startsWith(TERMS_BUTTON_AGREE)) {
      await handleTermsAgree(interaction);
    } else {
      await handleTermsDecline(interaction);
    }
    return;
  }

  // ★ M-6 Phase 2-B: 辞退ボタン / 代役募集ボタン
  if (isDeclineButtonId(interaction.customId)) {
    await handleDeclineButton(interaction);
    return;
  }
  if (isSeekSubstituteButtonId(interaction.customId)) {
    await handleSeekSubstituteButton(interaction);
    return;
  }

  // ★ M-6 Phase 2-D: 声劇一覧ボタン
  if (isDramaListButtonId(interaction.customId)) {
    await handleDramaListButton(interaction);
    return;
  }

  // ★ M-6 Phase 3-D: X 配信オファー / 同意ボタン
  if (isBroadcastRequestButtonId(interaction.customId)) {
    await handleBroadcastRequest(interaction);
    return;
  }
  if (isBroadcastConsentButtonId(interaction.customId)) {
    await handleConsentButton(interaction);
    return;
  }

  // ★声劇: 声劇イベントのボタン処理（確定・キャンセル・抽選・アーカイブ）
  const dramaHandled = await handleVoiceDramaButton(interaction);
  if (dramaHandled) return;

  // AI壁打ちボタンの処理（先にチェックし、処理済みの場合はここで終了）
  const handled = await handleAiChatButton(interaction);
  if (handled) return;

  // アンケートボタンの処理を呼び出す
  await handleSurveyButton(interaction);

  // ★ 新規追加: 自己紹介・ボイスサンプルボタン
  await handleIntroButton(interaction);
  await handleVoiceChallengeButton(interaction);
});

// ★声劇 + Reverb: リアクションが追加されたときの処理
// 声劇イベントの立候補と、Reverb 通知ロールの opt-in を同居処理
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return; // Botのリアクション（自動付与分）は無視
  // 部分的にキャッシュされたリアクションを完全に取得する（古いメッセージへのリアクション対策）
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  if (reaction.message.partial) {
    try { await reaction.message.fetch(); } catch { return; }
  }
  // 声劇イベントの立候補処理
  await handleReactionAdd(reaction, user);
  // Reverb 通知ロール 🔔 の付与処理（対象メッセージでなければ内部で無視される）
  await handleReverbReactionAdd(reaction, user);
});

// ★声劇 + Reverb: リアクションが削除されたときの処理
client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  if (reaction.message.partial) {
    try { await reaction.message.fetch(); } catch { return; }
  }
  // 声劇イベントの立候補取り消し処理
  await handleReactionRemove(reaction, user);
  // Reverb 通知ロール 🔔 の解除処理
  await handleReverbReactionRemove(reaction, user);
});

// BotをDiscordにログイン（接続）させる
// DISCORD_BOT_TOKENはBotの「パスワード付身分証明書」のようなもの
client.login(process.env.DISCORD_BOT_TOKEN);
