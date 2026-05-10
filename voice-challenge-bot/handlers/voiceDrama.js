// handlers/voiceDrama.js — 声劇イベントのメインハンドラー
// ユーザーが「声劇やりたい」等のトリガーワードを投稿すると、
// Botが対話形式で登場人物を聞き取り、募集Embedを生成し、
// リアクションによる参加管理・抽選・確定までを自動化するモジュール。

const {
  EmbedBuilder,       // Embed（装飾付きカード型メッセージ）を作る道具
  ActionRowBuilder,   // ボタンを並べる「棚」
  ButtonBuilder,      // ボタンを作る道具
  ButtonStyle,        // ボタンの色を決める定数
  StringSelectMenuBuilder, // ドロップダウンメニューを作る道具（候補者選択用）
  ChannelType,        // チャンネルの種類を指定する定数
} = require('discord.js');

const {
  createVoiceDramaEvent,
  getVoiceDramaEvent,
  getVoiceDramaEventByMessageId,
  updateVoiceDramaEventStatus,
  setRecruitMessageId,
  addVoiceDramaParticipant,
  removeVoiceDramaParticipant,
  getVoiceDramaParticipants,
  getCandidatesForCharacter,
  updateParticipantStatus,
  getConfirmedParticipants,
} = require('../db');

// リマインド機能を読み込む
const { scheduleReminders } = require('./voiceDramaReminder');

// アーカイブ機能を読み込む
const { archiveEvent } = require('./voiceDramaArchive');

// ==========================================
// 定数
// ==========================================

// トリガーワード（これらのキーワードがメッセージに含まれていたらイベント作成を開始する）
// テレビのリモコンの電源ボタンのようなもの — 特定の言葉でBotが「ON」になる
const TRIGGER_WORDS = ['声劇やりたい', '声劇したい', '声劇開きたい', '声劇やろう', '声劇しよう'];

// 各役に対応するリアクション絵文字（最大15役まで対応）
// 役の数字を絵文字の番号で表現する仕組み（役1 → 1️⃣、役2 → 2️⃣ ...）
const ROLE_EMOJIS = [
  '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣',
  '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟',
  '🅰️', '🅱️', '🅾️', '🇲', '🇳',
];

// ボタンのカスタムID（ボタンを識別するためのラベル）
const CONFIRM_BUTTON_PREFIX = 'vd_confirm_';    // 「確定」ボタン
const CANCEL_BUTTON_PREFIX = 'vd_cancel_';      // 「キャンセル」ボタン
const CHOOSE_SELF_PREFIX = 'vd_choose_self_';   // 「自分で選ぶ」ボタン
const CHOOSE_RANDOM_PREFIX = 'vd_choose_rand_'; // 「おまかせ（抽選）」ボタン
const ARCHIVE_BUTTON_PREFIX = 'vd_archive_';    // 「アーカイブ」ボタン
const SELECT_MENU_PREFIX = 'vd_select_';        // 候補者選択メニュー

// 回答待ちのタイムアウト（5分）
const INPUT_TIMEOUT_MS = 5 * 60 * 1000;

// ==========================================
// 1. トリガーワード検知 + 対話フロー開始
// ==========================================

// メッセージにトリガーワードが含まれているかチェックし、
// 含まれていれば声劇イベント作成の対話を開始する関数
// message: ユーザーが送ったメッセージ
// client: Botのクライアント
/**
 * ハブの「🎭 声劇を主催」ボタンから直接起動するための入口。
 * トリガーワード判定をスキップして対話スレッドを作る。
 *
 * @param {User} user - 主催者
 * @param {Client} client - Discord Client
 * @param {TextChannel} channel - ボタンが押されたチャンネル
 */
async function handleVoiceDramaTriggerForUser(user, client, channel) {
  if (!channel || !channel.threads || typeof channel.threads.create !== 'function') {
    throw new Error('スレッドを作れるチャンネルからボタンを押してください。');
  }
  try {
    const thread = await channel.threads.create({
      name: `🎭 声劇イベント作成｜${user.displayName}`,
      type: ChannelType.PrivateThread,
      autoArchiveDuration: 60,
      reason: `声劇イベント作成（ハブボタン）: ${user.tag}`,
    });
    await thread.join();
    await thread.members.add(user.id);
    await thread.send(
      `🎭 **声劇イベントを作成します！**\n\n` +
      `${user} さん、声劇イベントの準備を始めましょう。\n\n` +
      `まず、**登場人物の名前と性別**を1人ずつ教えてください。\n` +
      `入力形式: \`名前 性別\`（例: \`太郎 男\` や \`花子 女\`）\n\n` +
      `全員入力したら **\`完了\`** と送信してください。\n` +
      `━━━━━━━━━━━━━━━━━━━━`
    );
    await collectCharacters(thread, user, client);
  } catch (error) {
    console.error('声劇イベント作成エラー（ボタン経由）:', error);
    throw error;
  }
}

async function handleVoiceDramaTrigger(message, client) {
  // トリガーワードが含まれているかチェック
  const triggered = TRIGGER_WORDS.some(word => message.content.includes(word));
  if (!triggered) return;

  // プライベートスレッドを作成して対話を行う
  // （他のメンバーの会話を邪魔しないように個室で作業するイメージ）
  try {
    const thread = await message.channel.threads.create({
      name: `🎭 声劇イベント作成｜${message.author.displayName}`,
      type: ChannelType.PrivateThread,
      autoArchiveDuration: 60, // 1時間で自動アーカイブ（片付け）
      reason: `声劇イベント作成: ${message.author.tag}`,
    });

    await thread.join(); // Botをスレッドに参加させる
    // スレッドに主催者を招待
    await thread.members.add(message.author.id);

    // 最初の案内メッセージ
    await thread.send(
      `🎭 **声劇イベントを作成します！**\n\n` +
      `${message.author} さん、声劇イベントの準備を始めましょう。\n\n` +
      `まず、**登場人物の名前と性別**を1人ずつ教えてください。\n` +
      `入力形式: \`名前 性別\`（例: \`太郎 男\` や \`花子 女\`）\n\n` +
      `全員入力したら **\`完了\`** と送信してください。\n` +
      `━━━━━━━━━━━━━━━━━━━━`
    );

    // 登場人物の入力ループを開始
    await collectCharacters(thread, message.author, client);

  } catch (error) {
    console.error('声劇イベント作成エラー:', error);
    await message.reply('❌ イベント作成中にエラーが発生しました。もう一度お試しください。').catch(() => {});
  }
}

// ==========================================
// 2. 登場人物入力ループ
// ==========================================

// ユーザーから登場人物の名前と性別を1人ずつ聞き取る関数
// thread: 作成したプライベートスレッド
// user: 主催者
// client: Botのクライアント
async function collectCharacters(thread, user, client) {
  const characters = []; // 登場人物リスト（料理の材料リストのようなもの）

  while (true) {
    try {
      // ユーザーのメッセージを待つ（5分タイムアウト）
      const collected = await thread.awaitMessages({
        filter: (msg) => msg.author.id === user.id && !msg.author.bot,
        max: 1,
        time: INPUT_TIMEOUT_MS,
        errors: ['time'],
      });

      const msg = collected.first();
      const input = msg.content.trim();

      // 「完了」で入力終了
      if (input === '完了') {
        if (characters.length === 0) {
          await thread.send('⚠️ まだ1人も登場人物が登録されていません。最低1人は登録してください。');
          continue;
        }
        break; // ループを抜けて次のステップへ
      }

      // 入力の解析（「名前 性別」の形式を分解する）
      // スペースで分割して、名前と性別を取り出す
      const parts = input.split(/\s+/); // \s+ は「1つ以上の空白文字」にマッチする正規表現（パターンマッチング）
      if (parts.length < 2) {
        await thread.send('⚠️ `名前 性別` の形式で入力してください（例: `太郎 男`）');
        continue;
      }

      const name = parts[0];
      // 性別の表記を統一する（「男」→「男性」、「女」→「女性」等）
      let gender = parts[1];
      if (['男', '男性', 'M', 'm'].includes(gender)) gender = '男性';
      else if (['女', '女性', 'F', 'f'].includes(gender)) gender = '女性';
      else gender = gender; // それ以外はそのまま（「指定なし」「中性」等）

      // 絵文字を割り当てる（リストの何番目かで決まる）
      const emoji = ROLE_EMOJIS[characters.length];
      if (!emoji) {
        await thread.send('⚠️ 登場人物は最大15人までです。`完了` と送信してください。');
        continue;
      }

      characters.push({ name, gender, emoji });

      // 登録確認メッセージ
      await thread.send(
        `✅ ${emoji} **${name}**（${gender}）を登録しました！（${characters.length}人目）\n` +
        `続けて次の登場人物を入力するか、\`完了\` と送信してください。`
      );

    } catch (error) {
      // タイムアウト
      await thread.send('⏰ 5分間入力がなかったため、イベント作成を中断します。');
      await thread.setArchived(true);
      return;
    }
  }

  // 登場人物リストの確認表示
  let characterList = characters.map(c => `${c.emoji} ${c.name}（${c.gender}）`).join('\n');
  await thread.send(
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 **登場人物一覧**\n${characterList}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `次に、**イベント名（台本名）**を入力してください。\n` +
    `（例: \`ロミオとジュリエット\`）`
  );

  // イベント名の入力
  let eventTitle = '声劇イベント';
  try {
    const titleCollected = await thread.awaitMessages({
      filter: (msg) => msg.author.id === user.id && !msg.author.bot,
      max: 1,
      time: INPUT_TIMEOUT_MS,
      errors: ['time'],
    });
    eventTitle = titleCollected.first().content.trim();
  } catch {
    await thread.send('⏰ タイムアウトしました。');
    await thread.setArchived(true);
    return;
  }

  // 開演日時の入力
  await thread.send(
    `✅ イベント名: **${eventTitle}**\n\n` +
    `最後に、**開演日時**を入力してください。\n` +
    `入力形式: \`YYYY/MM/DD HH:MM\`（例: \`2026/04/20 20:00\`）`
  );

  let eventDatetime = null;
  try {
    // 正しい形式が来るまで繰り返す
    while (true) {
      const dtCollected = await thread.awaitMessages({
        filter: (msg) => msg.author.id === user.id && !msg.author.bot,
        max: 1,
        time: INPUT_TIMEOUT_MS,
        errors: ['time'],
      });

      const dtInput = dtCollected.first().content.trim();
      // 日時のパース（解析）を試みる
      // 「2026/04/20 20:00」→ JavaScriptのDateオブジェクトに変換
      const dateMatch = dtInput.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
      if (!dateMatch) {
        await thread.send('⚠️ `YYYY/MM/DD HH:MM` の形式で入力してください（例: `2026/04/20 20:00`）');
        continue;
      }

      const [, y, m, d, h, min] = dateMatch;
      // Date（日時）オブジェクトを作成（月は0始まりなので-1する — JavaScriptの古い仕様）
      const dt = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(h), parseInt(min));

      if (dt <= new Date()) {
        await thread.send('⚠️ 過去の日時は指定できません。未来の日時を入力してください。');
        continue;
      }

      eventDatetime = dt.toISOString();
      break;
    }
  } catch {
    await thread.send('⏰ タイムアウトしました。');
    await thread.setArchived(true);
    return;
  }

  // 確認メッセージ
  const formattedDate = new Date(eventDatetime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  await thread.send(
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🎭 **イベント情報の確認**\n\n` +
    `📖 **イベント名**: ${eventTitle}\n` +
    `📅 **開演日時**: ${formattedDate}\n` +
    `👥 **登場人物**: ${characters.length}人\n` +
    `${characterList}\n\n` +
    `この内容で募集を開始しますか？\n` +
    `━━━━━━━━━━━━━━━━━━━━`
  );

  // 確認ボタンを表示
  // （レジで「お会計よろしいですか？」と最終確認するようなもの）
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('vd_setup_confirm')
      .setLabel('✅ 募集開始')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('vd_setup_cancel')
      .setLabel('❌ キャンセル')
      .setStyle(ButtonStyle.Danger),
  );
  const confirmMsg = await thread.send({ components: [confirmRow] });

  // ボタンの応答を待つ
  try {
    const buttonInteraction = await confirmMsg.awaitMessageComponent({
      filter: (i) => i.user.id === user.id,
      time: INPUT_TIMEOUT_MS,
    });

    if (buttonInteraction.customId === 'vd_setup_cancel') {
      await buttonInteraction.update({ content: '❌ イベント作成をキャンセルしました。', components: [] });
      await thread.setArchived(true);
      return;
    }

    // 「募集開始」が押された → DBにイベントを作成して募集Embedを投稿
    await buttonInteraction.update({ content: '⏳ 募集を準備しています...', components: [] });

    const channelId = process.env.VOICE_DRAMA_CHANNEL_ID;
    const stageChannelId = process.env.VOICE_DRAMA_STAGE_CHANNEL_ID || channelId;

    // DBにイベントを保存
    const event = createVoiceDramaEvent({
      hostUserId: user.id,
      recruitChannelId: channelId,
      stageChannelId: stageChannelId,
      eventTitle: eventTitle,
      eventDatetime: eventDatetime,
      characters: characters,
    });

    // 募集Embedを専用チャンネルに投稿
    await postRecruitmentEmbed(client, event, user);

    // リマインドを設定
    scheduleReminders(client, event);

    await thread.send(
      `✅ **募集を開始しました！**\n\n` +
      `募集Embedが <#${channelId}> に投稿されました。\n` +
      `参加者が集まったら、募集Embedの「✅ 確定する」ボタンを押してください。\n\n` +
      `このスレッドは自動的にアーカイブされます。📁`
    );
    await thread.setArchived(true);

  } catch (error) {
    console.error('確認ボタンエラー:', error);
    await thread.send('⏰ タイムアウトしました。イベント作成を中断します。');
    await thread.setArchived(true);
  }
}

// ==========================================
// 3. 募集Embed生成 + リアクション付与
// ==========================================

// 声劇イベントの募集情報をEmbed（装飾カード）にして専用チャンネルに投稿する関数
// client: Botのクライアント
// event: DBに保存されたイベントデータ
// host: 主催者のユーザーオブジェクト
async function postRecruitmentEmbed(client, event, host) {
  const channelId = event.recruitChannelId;
  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    console.error('募集チャンネルが見つかりません:', channelId);
    return;
  }

  // 開演日時を見やすい日本語形式に変換
  const formattedDate = new Date(event.eventDatetime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  // 配役一覧を組み立てる（各役の横に参加人数を表示）
  let roleList = event.characters.map(c => {
    return `${c.emoji} **${c.name}**（${c.gender}）— 0人`;
  }).join('\n');

  // Embed（装飾カード）を作成
  // ゲームの募集掲示板のようなデザインをイメージ
  const embed = new EmbedBuilder()
    .setTitle(`🎭 声劇イベント募集！`)
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📖 **${event.eventTitle}**\n\n` +
      `👑 主催: <@${event.hostUserId}>\n` +
      `📅 開演: ${formattedDate}\n` +
      `🎤 ステージ: <#${event.stageChannelId}>\n\n` +
      `**【配役一覧】**\n${roleList}\n\n` +
      `参加したい役の**リアクション（絵文字）を押して**立候補してください！\n` +
      `━━━━━━━━━━━━━━━━━━━━`
    )
    .setColor(0xFF6B6B) // 赤に近いピンク色（舞台の幕のイメージ）
    .setFooter({ text: `イベントID: ${event.id} | 主催者が「確定」を押すとキャスト決定` })
    .setTimestamp();

  // 「確定」ボタンと「キャンセル」ボタンをつける
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONFIRM_BUTTON_PREFIX}${event.id}`)
      .setLabel('✅ 確定する')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${CANCEL_BUTTON_PREFIX}${event.id}`)
      .setLabel('❌ 募集キャンセル')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${ARCHIVE_BUTTON_PREFIX}${event.id}`)
      .setLabel('📁 アーカイブ')
      .setStyle(ButtonStyle.Secondary),
  );

  // チャンネルにEmbedとボタンを投稿
  const recruitMessage = await channel.send({ embeds: [embed], components: [buttonRow] });

  // 各役に対応するリアクション絵文字を自動で付ける
  // （お店のメニューに最初から「いいね！」のスタンプ欄が印刷されているイメージ）
  for (const character of event.characters) {
    await recruitMessage.react(character.emoji);
  }

  // 投稿したメッセージのIDをDBに保存（後でリアクションと紐付けるため）
  setRecruitMessageId(event.id, recruitMessage.id);
}

// ==========================================
// 4. リアクション処理（参加者のリアルタイム管理）
// ==========================================

// リアクションが追加された時の処理
// → 「この人がこの役に立候補した」をDBに記録し、Embedの表示を更新する
async function handleReactionAdd(reaction, user) {
  // 募集メッセージかどうかチェック
  const event = getVoiceDramaEventByMessageId(reaction.message.id);
  if (!event) return; // この募集に関係ないリアクションは無視
  if (event.status !== 'recruiting') return; // 募集中でなければ無視

  // どの役に対するリアクションかを特定する
  const emoji = reaction.emoji.name;
  const character = event.characters.find(c => c.emoji === emoji);
  if (!character) return; // 登録された絵文字以外は無視

  // DBに参加者を追加（立候補）
  addVoiceDramaParticipant(event.id, user.id, character.name);

  // Embedの参加者カウントを更新
  await updateRecruitmentEmbed(reaction.message, event);
}

// リアクションが削除された時の処理
// → 「この人がこの役への立候補を取り消した」をDBから削除し、Embedを更新する
async function handleReactionRemove(reaction, user) {
  const event = getVoiceDramaEventByMessageId(reaction.message.id);
  if (!event) return;
  if (event.status !== 'recruiting') return;

  const emoji = reaction.emoji.name;
  const character = event.characters.find(c => c.emoji === emoji);
  if (!character) return;

  // DBから参加者を削除（立候補取り消し）
  removeVoiceDramaParticipant(event.id, user.id, character.name);

  // Embedの参加者カウントを更新
  await updateRecruitmentEmbed(reaction.message, event);
}

// 募集EmbedのEmbed内容を最新の参加者数で更新する関数
// （掲示板の「残り○席」を書き換えるイメージ）
async function updateRecruitmentEmbed(message, event) {
  try {
    // 最新のイベントデータを取得（参加者数が変わっている可能性）
    const freshEvent = getVoiceDramaEvent(event.id);
    const participants = getVoiceDramaParticipants(event.id);

    // 各役ごとの参加者数を集計
    const formattedDate = new Date(freshEvent.eventDatetime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    let roleList = freshEvent.characters.map(c => {
      // この役に立候補している人のリストを取得
      const candidates = participants.filter(p => p.character_name === c.name);
      const count = candidates.length;
      // 参加者のメンション（@名前）をリストアップ
      const names = candidates.map(p => `<@${p.user_id}>`).join(', ');
      return `${c.emoji} **${c.name}**（${c.gender}）— ${count}人${names ? ` : ${names}` : ''}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`🎭 声劇イベント募集！`)
      .setDescription(
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📖 **${freshEvent.event_title}**\n\n` +
        `👑 主催: <@${freshEvent.host_user_id}>\n` +
        `📅 開演: ${formattedDate}\n` +
        `🎤 ステージ: <#${freshEvent.stage_channel_id}>\n\n` +
        `**【配役一覧】**\n${roleList}\n\n` +
        `参加したい役の**リアクション（絵文字）を押して**立候補してください！\n` +
        `━━━━━━━━━━━━━━━━━━━━`
      )
      .setColor(0xFF6B6B)
      .setFooter({ text: `イベントID: ${freshEvent.id} | 主催者が「確定」を押すとキャスト決定` })
      .setTimestamp();

    await message.edit({ embeds: [embed] });
  } catch (error) {
    console.error('Embed更新エラー:', error);
  }
}

// ==========================================
// 5. ボタン処理（確定・キャンセル・アーカイブ）
// ==========================================

// ボタンが押されたときの処理を振り分ける関数
// interaction: DiscordのボタンInteraction
// 戻り値: このモジュールで処理したかどうか（true/false）
async function handleVoiceDramaButton(interaction) {
  const customId = interaction.customId;

  // ────── 確定ボタン ──────
  if (customId.startsWith(CONFIRM_BUTTON_PREFIX)) {
    const eventId = parseInt(customId.replace(CONFIRM_BUTTON_PREFIX, ''));
    await handleConfirm(interaction, eventId);
    return true;
  }

  // ────── キャンセルボタン ──────
  if (customId.startsWith(CANCEL_BUTTON_PREFIX)) {
    const eventId = parseInt(customId.replace(CANCEL_BUTTON_PREFIX, ''));
    await handleCancel(interaction, eventId);
    return true;
  }

  // ────── おまかせ（抽選）ボタン ──────
  if (customId.startsWith(CHOOSE_RANDOM_PREFIX)) {
    const eventId = parseInt(customId.replace(CHOOSE_RANDOM_PREFIX, ''));
    await handleRandomSelection(interaction, eventId);
    return true;
  }

  // ────── 自分で選ぶボタン ──────
  if (customId.startsWith(CHOOSE_SELF_PREFIX)) {
    const eventId = parseInt(customId.replace(CHOOSE_SELF_PREFIX, ''));
    await handleManualSelection(interaction, eventId);
    return true;
  }

  // ────── アーカイブボタン ──────
  if (customId.startsWith(ARCHIVE_BUTTON_PREFIX)) {
    const eventId = parseInt(customId.replace(ARCHIVE_BUTTON_PREFIX, ''));
    await handleArchiveButton(interaction, eventId);
    return true;
  }

  return false; // このモジュールでは処理しなかった
}

// ────── 「確定」ボタンの処理 ──────
// 主催者が確定ボタンを押したとき、超過チェックを行い必要に応じて抽選フローに進む
async function handleConfirm(interaction, eventId) {
  const event = getVoiceDramaEvent(eventId);
  if (!event) {
    await interaction.reply({ content: '❌ イベントが見つかりません。', ephemeral: true });
    return;
  }

  // 主催者のみ操作可能
  if (interaction.user.id !== event.host_user_id) {
    await interaction.reply({ content: '⚠️ このボタンは主催者のみ操作できます。', ephemeral: true });
    return;
  }

  if (event.status !== 'recruiting') {
    await interaction.reply({ content: '⚠️ このイベントは既に募集終了しています。', ephemeral: true });
    return;
  }

  const participants = getVoiceDramaParticipants(eventId);

  // 各役の超過チェック（1つの役に2人以上立候補している場合）
  // 学校のクラスの席替えで「同じ席を希望する人が複数いる」状態
  const overbooked = []; // 超過している役のリスト
  for (const character of event.characters) {
    const candidates = participants.filter(p => p.character_name === character.name && p.status === 'candidate');
    if (candidates.length > 1) {
      overbooked.push({ character, candidates });
    }
  }

  if (overbooked.length === 0) {
    // ── 超過なし → そのまま全員確定 ──
    await interaction.deferReply({ ephemeral: true });

    // 全候補者を「確定」に更新
    for (const p of participants) {
      updateParticipantStatus(eventId, p.user_id, p.character_name, 'confirmed');
    }
    updateVoiceDramaEventStatus(eventId, 'confirmed');

    // 役決定を通知
    await announceRoles(interaction.client, event);

    await interaction.editReply({ content: '✅ 全員の配役が確定しました！通知を送信しました。' });
  } else {
    // ── 超過あり → 主催者に選択肢を提示 ──
    const overbookedList = overbooked.map(o =>
      `• **${o.character.name}**: ${o.candidates.length}人が立候補中`
    ).join('\n');

    const choiceRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CHOOSE_SELF_PREFIX}${eventId}`)
        .setLabel('🎯 自分で選ぶ')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${CHOOSE_RANDOM_PREFIX}${eventId}`)
        .setLabel('🎲 おまかせ（抽選）')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      content:
        `⚠️ **以下の役で定員超過しています：**\n${overbookedList}\n\n` +
        `どうしますか？`,
      components: [choiceRow],
      ephemeral: true,
    });
  }
}

// ────── 「おまかせ（抽選）」ボタンの処理 ──────
// Fisher-Yatesシャッフル（トランプをよくシャッフルする方法）で公平に抽選する
async function handleRandomSelection(interaction, eventId) {
  await interaction.deferUpdate();

  const event = getVoiceDramaEvent(eventId);
  if (!event) return;

  const participants = getVoiceDramaParticipants(eventId);

  for (const character of event.characters) {
    const candidates = participants.filter(p => p.character_name === character.name && p.status === 'candidate');

    if (candidates.length <= 1) {
      // 1人以下なら全員確定
      for (const c of candidates) {
        updateParticipantStatus(eventId, c.user_id, c.character_name, 'confirmed');
      }
    } else {
      // Fisher-Yatesシャッフルで公平に順番をまぜる
      // トランプを裏返して何度も入れ替えるようなイメージ
      const shuffled = [...candidates];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      // 先頭の1人を確定、残りは落選
      updateParticipantStatus(eventId, shuffled[0].user_id, shuffled[0].character_name, 'confirmed');
      for (let k = 1; k < shuffled.length; k++) {
        updateParticipantStatus(eventId, shuffled[k].user_id, shuffled[k].character_name, 'rejected');
      }
    }
  }

  updateVoiceDramaEventStatus(eventId, 'confirmed');

  // 役決定を通知
  await announceRoles(interaction.client, event);

  await interaction.editReply({
    content: '🎲 抽選が完了しました！配役を通知しました。',
    components: [],
  });
}

// ────── 「自分で選ぶ」ボタンの処理 ──────
// 超過している役の候補者リストをセレクトメニュー（ドロップダウン）で表示し、
// 主催者が一人ずつ選べるようにする
async function handleManualSelection(interaction, eventId) {
  await interaction.deferUpdate();

  const event = getVoiceDramaEvent(eventId);
  if (!event) return;

  const participants = getVoiceDramaParticipants(eventId);

  // まず超過していない役は全員自動確定
  for (const character of event.characters) {
    const candidates = participants.filter(p => p.character_name === character.name && p.status === 'candidate');
    if (candidates.length <= 1) {
      for (const c of candidates) {
        updateParticipantStatus(eventId, c.user_id, c.character_name, 'confirmed');
      }
    }
  }

  // 超過している役のセレクトメニューを構築
  const overbooked = [];
  for (const character of event.characters) {
    const candidates = participants.filter(p => p.character_name === character.name && p.status === 'candidate');
    if (candidates.length > 1) {
      overbooked.push({ character, candidates });
    }
  }

  if (overbooked.length === 0) {
    // 全て確定済み
    updateVoiceDramaEventStatus(eventId, 'confirmed');
    await announceRoles(interaction.client, event);
    await interaction.editReply({ content: '✅ 配役が確定しました！', components: [] });
    return;
  }

  // 最初の超過役のセレクトメニューを表示
  const first = overbooked[0];
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`${SELECT_MENU_PREFIX}${eventId}_${first.character.name}`)
    .setPlaceholder(`「${first.character.name}」役を選んでください`)
    .addOptions(
      first.candidates.map(c => ({
        label: `ユーザーID: ${c.user_id}`,
        description: `立候補日時: ${new Date(c.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
        value: c.user_id,
      }))
    );

  const selectRow = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.editReply({
    content: `🎯 **「${first.character.name}」**役（${first.candidates.length}人が立候補中）\n下のメニューから1人選んでください。`,
    components: [selectRow],
  });
}

// ────── キャンセルボタンの処理 ──────
async function handleCancel(interaction, eventId) {
  const event = getVoiceDramaEvent(eventId);
  if (!event) {
    await interaction.reply({ content: '❌ イベントが見つかりません。', ephemeral: true });
    return;
  }

  if (interaction.user.id !== event.host_user_id) {
    await interaction.reply({ content: '⚠️ このボタンは主催者のみ操作できます。', ephemeral: true });
    return;
  }

  updateVoiceDramaEventStatus(eventId, 'archived');

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle('🎭 声劇イベント — キャンセル済み')
        .setDescription(`📖 **${event.event_title}** は主催者によりキャンセルされました。`)
        .setColor(0x808080)
    ],
    components: [],
  });
}

// ────── アーカイブボタンの処理 ──────
async function handleArchiveButton(interaction, eventId) {
  const event = getVoiceDramaEvent(eventId);
  if (!event) {
    await interaction.reply({ content: '❌ イベントが見つかりません。', ephemeral: true });
    return;
  }

  if (interaction.user.id !== event.host_user_id) {
    await interaction.reply({ content: '⚠️ このボタンは主催者のみ操作できます。', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // アーカイブ処理を実行
  await archiveEvent(interaction.client, event);

  await interaction.editReply({ content: '📁 イベントをアーカイブしました！' });
}

// ==========================================
// 6. セレクトメニュー処理（手動選択）
// ==========================================

// 主催者が候補者をドロップダウンから選んだときの処理
async function handleVoiceDramaSelectMenu(interaction) {
  const customId = interaction.customId;
  if (!customId.startsWith(SELECT_MENU_PREFIX)) return false;

  // customId の形式: vd_select_{eventId}_{characterName}
  const rest = customId.replace(SELECT_MENU_PREFIX, '');
  const underscoreIdx = rest.indexOf('_');
  const eventId = parseInt(rest.substring(0, underscoreIdx));
  const characterName = rest.substring(underscoreIdx + 1);

  const selectedUserId = interaction.values[0]; // ドロップダウンで選ばれたユーザーID

  const event = getVoiceDramaEvent(eventId);
  if (!event) return true;

  // 主催者チェック
  if (interaction.user.id !== event.host_user_id) {
    await interaction.reply({ content: '⚠️ 主催者のみ操作できます。', ephemeral: true });
    return true;
  }

  // 選ばれた人を確定、それ以外を落選にする
  const candidates = getCandidatesForCharacter(eventId, characterName);
  for (const c of candidates) {
    if (c.user_id === selectedUserId) {
      updateParticipantStatus(eventId, c.user_id, characterName, 'confirmed');
    } else {
      updateParticipantStatus(eventId, c.user_id, characterName, 'rejected');
    }
  }

  // 次の超過役があるかチェック
  const allParticipants = getVoiceDramaParticipants(eventId);
  const nextOverbooked = [];
  for (const character of event.characters) {
    const remaining = allParticipants.filter(
      p => p.character_name === character.name && p.status === 'candidate'
    );
    if (remaining.length > 1) {
      nextOverbooked.push({ character, candidates: remaining });
    }
  }

  if (nextOverbooked.length > 0) {
    // まだ超過している役がある → 次のセレクトメニューを表示
    const next = nextOverbooked[0];
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${SELECT_MENU_PREFIX}${eventId}_${next.character.name}`)
      .setPlaceholder(`「${next.character.name}」役を選んでください`)
      .addOptions(
        next.candidates.map(c => ({
          label: `ユーザーID: ${c.user_id}`,
          description: `立候補日時: ${new Date(c.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
          value: c.user_id,
        }))
      );

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.update({
      content: `✅ 「${characterName}」役に <@${selectedUserId}> を選びました！\n\n` +
        `🎯 次は **「${next.character.name}」** 役（${next.candidates.length}人が立候補中）`,
      components: [selectRow],
    });
  } else {
    // 全ての超過が解決 → 残りの候補者も確定して通知
    // 超過していなかった候補者もまだcandidateのままの場合があるので確定する
    const remaining = allParticipants.filter(p => p.status === 'candidate');
    for (const p of remaining) {
      updateParticipantStatus(eventId, p.user_id, p.character_name, 'confirmed');
    }

    updateVoiceDramaEventStatus(eventId, 'confirmed');
    await announceRoles(interaction.client, event);

    await interaction.update({
      content: `✅ 「${characterName}」役に <@${selectedUserId}> を選びました！\n\n🎉 **全ての配役が確定しました！** 通知を送信しました。`,
      components: [],
    });
  }

  return true;
}

// ==========================================
// 7. 役決定通知 + 台本配布スレッド
// ==========================================

// 全員の配役が決まった後、チャンネルに通知し、
// 台本配布用のプライベートスレッドを作成する関数
async function announceRoles(client, event) {
  const channelId = event.recruitChannelId || event.recruit_channel_id;
  const channel = await client.channels.fetch(channelId);
  if (!channel) return;

  const confirmed = getConfirmedParticipants(event.id);
  const formattedDate = new Date(event.eventDatetime || event.event_datetime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  // 確定メンバーのリストを作成
  let castList = (event.characters || []).map(c => {
    const member = confirmed.find(p => p.character_name === c.name);
    if (member) {
      return `${c.emoji} **${c.name}**（${c.gender}）→ <@${member.user_id}>`;
    }
    return `${c.emoji} **${c.name}**（${c.gender}）→ ❌ 未定`;
  }).join('\n');

  // 確定メンバー全員へのメンション
  const mentions = confirmed.map(p => `<@${p.user_id}>`).join(' ');

  // 通知Embed
  const embed = new EmbedBuilder()
    .setTitle('🎉 声劇イベント — 配役決定！')
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📖 **${event.eventTitle || event.event_title}**\n\n` +
      `📅 開演: ${formattedDate}\n` +
      `🎤 ステージ: <#${event.stageChannelId || event.stage_channel_id}>\n\n` +
      `**【確定キャスト】**\n${castList}\n\n` +
      `おめでとうございます！🎊\n` +
      `台本は下に作成されるスレッドで配布されます。\n` +
      `━━━━━━━━━━━━━━━━━━━━`
    )
    .setColor(0x00D26A) // 緑色（合格・確定のイメージ）
    .setTimestamp();

  await channel.send({ content: mentions, embeds: [embed] });

  // 台本配布用のプライベートスレッドを作成
  try {
    const scriptThread = await channel.threads.create({
      name: `📜 台本配布｜${event.eventTitle || event.event_title}`,
      type: ChannelType.PrivateThread,
      autoArchiveDuration: 1440, // 24時間で自動アーカイブ
      reason: `声劇「${event.eventTitle || event.event_title}」の台本配布用スレッド`,
    });

    // 主催者と全確定メンバーを招待
    await scriptThread.members.add(event.hostUserId || event.host_user_id);
    for (const p of confirmed) {
      await scriptThread.members.add(p.user_id);
    }

    await scriptThread.send(
      `📜 **台本配布スレッド**\n\n` +
      `主催者 <@${event.hostUserId || event.host_user_id}> さん、ここに台本ファイルをアップロードしてください。\n` +
      `参加者全員がこのスレッドで台本を受け取れます。\n\n` +
      `━━━━━━━━━━━━━━━━━━━━`
    );
  } catch (error) {
    console.error('台本配布スレッド作成エラー:', error);
  }

  // 元の募集Embedを更新（確定済みにする）
  try {
    const recruitMsg = await channel.messages.fetch(event.recruitMessageId || event.recruit_message_id);
    if (recruitMsg) {
      const updatedEmbed = new EmbedBuilder()
        .setTitle('🎭 声劇イベント — 配役確定済み ✅')
        .setDescription(
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📖 **${event.eventTitle || event.event_title}**\n\n` +
          `📅 開演: ${formattedDate}\n` +
          `🎤 ステージ: <#${event.stageChannelId || event.stage_channel_id}>\n\n` +
          `**【確定キャスト】**\n${castList}\n` +
          `━━━━━━━━━━━━━━━━━━━━`
        )
        .setColor(0x00D26A)
        .setFooter({ text: '配役確定済み' })
        .setTimestamp();

      // アーカイブボタンだけ残す
      const archiveRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ARCHIVE_BUTTON_PREFIX}${event.id}`)
          .setLabel('📁 アーカイブ')
          .setStyle(ButtonStyle.Secondary),
      );

      await recruitMsg.edit({ embeds: [updatedEmbed], components: [archiveRow] });
    }
  } catch (error) {
    console.error('募集Embed更新エラー:', error);
  }
}

// ==========================================
// エクスポート（他のファイルから使えるようにする）
// ==========================================
module.exports = {
  handleVoiceDramaTrigger,
  handleVoiceDramaTriggerForUser,
  handleVoiceDramaButton,
  handleVoiceDramaSelectMenu,
  handleReactionAdd,
  handleReactionRemove,
};
