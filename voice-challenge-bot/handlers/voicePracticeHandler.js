// voicePracticeHandler.js — 特定のチャンネルで音声投稿を検知し、動画生成を依頼するハンドラ
// 投稿者が許可リストに含まれている場合のみ、音声から動画を作成して専用チャンネルに送信します。

const { AttachmentBuilder } = require('discord.js');
const path = require('path');
const { downloadFile, generateShortVideo, cleanupTempFile } = require('../utils/videoGenerator');

// 一時ファイルの保存場所
const TEMP_DIR = path.join(__dirname, '..', 'temp');

// 環境変数から許可されたユーザーIDのリストを取得（カンマ区切りを配列に変換）
const allowedUsers = (process.env.ALLOWED_VIDEO_USERS || '').split(',').map(id => id.trim()).filter(Boolean);

// 動画生成の対象とする音声ファイルの拡張子リスト
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.webm'];

/**
 * 送信された添付ファイルが音声かどうかを判定する
 * @param {Object} attachment - Discordの添付ファイルオブジェクト
 * @returns {boolean} 音声であればtrue
 */
function isAudioAttachment(attachment) {
  const ext = path.extname(attachment.name || '').toLowerCase();
  // 拡張子、またはコンテンツタイプ（MIMEタイプ）でチェック
  if (AUDIO_EXTENSIONS.includes(ext)) return true;
  if (attachment.contentType && attachment.contentType.startsWith('audio/')) return true;
  return false;
}

/**
 * メッセージの本文から動画のタイトル（台本名など）を抽出する
 * @param {string} content - メッセージ本文
 * @returns {string} 抽出されたタイトル（最大30文字）
 */
function extractTitle(content) {
  if (!content || content.trim() === '') return '練習音声';
  // メッセージの最初の1行目をタイトルとして使用する
  const firstLine = content.split('\n')[0].trim();
  // 文字数が長すぎる場合は省略記号（…）を付ける
  return firstLine.length > 30 ? firstLine.substring(0, 30) + '…' : firstLine;
}

/**
 * メッセージが作成された時に実行されるメイン処理
 * @param {Object} message - Discordのメッセージオブジェクト
 * @param {Object} client - Discordクライアント
 */
async function handleVoicePractice(message, client) {
  // 設定された音声練習用チャンネル以外は無視する
  if (message.channel.id !== process.env.VOICE_PRACTICE_CHANNEL_ID) return;

  // ボット自身の投稿は無視する
  if (message.author.bot) return;

  // 許可されたユーザーリストに含まれない場合は何もしない
  if (!allowedUsers.includes(message.author.id)) return;

  // メッセージの中に音声ファイルが含まれているか探す
  const audioAttachment = message.attachments.find(att => isAudioAttachment(att));
  if (!audioAttachment) return;

  console.log(`[VoicePractice] 音声受信を検知: ${message.author.username} / ファイル: ${audioAttachment.name}`);

  // 処理開始の合図としてメッセージに「🎬（カチンコ）」リアクションを付ける
  try {
    await message.react('🎬');
  } catch (e) {
    console.error('[VoicePractice] リアクション失敗:', e.message);
  }

  let audioPath = null;
  let videoPath = null;

  try {
    // 1. 音声を一時ディレクトリにダウンロードする（名前は衝突しないようタイムスタンプを使用）
    const ext = path.extname(audioAttachment.name || '.mp3');
    audioPath = path.join(TEMP_DIR, `audio-${Date.now()}${ext}`);
    await downloadFile(audioAttachment.url, audioPath);
    console.log('[VoicePractice] 音声のダウンロードが完了しました:', audioPath);

    // 2. 音声から動画を生成する
    const title = extractTitle(message.content);
    const date = new Date().toLocaleDateString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).replace(/\//g, '-');

    videoPath = await generateShortVideo({
      audioPath,
      username: message.author.displayName || message.author.username,
      title,
      date
    });

    // 3. 完成した動画を専用のプライベートチャンネルへ送信する
    const privateChannel = await client.channels.fetch(process.env.PRIVATE_CHANNEL_ID);
    if (!privateChannel) {
      throw new Error('通知用のプライベートチャンネルを取得できませんでした。IDを確認してください。');
    }

    const attachment = new AttachmentBuilder(videoPath, {
      name: `voilab-short-${Date.now()}.mp4`
    });

    await privateChannel.send({
      content: [
        '🎬 **動画の生成が完了しました！**',
        '',
        `📝 **タイトル**: ${title}`,
        `👤 **投稿者**: ${message.author.displayName || message.author.username}`,
        `📅 **日付**: ${date}`,
        `🔗 **元メッセージ**: ${message.url}`,
        '',
        '※ SNS（YouTube Shorts / TikTok等）への投稿用素材として利用できます。'
      ].join('\n'),
      files: [attachment]
    });

    console.log('[VoicePractice] プライベートチャンネルへの送信が完了しました');

    // 4. 完了報告として元メッセージに「✅（チェックマーク）」リアクションを付ける
    try {
      await message.react('✅');
    } catch (e) {
      console.error('[VoicePractice] 完了リアクション失敗:', e.message);
    }

  } catch (error) {
    console.error('[VoicePractice] エラーが発生しました:', error);

    // エラーが発生した場合は、プライベートチャンネルに原因を報告する
    try {
      const privateChannel = await client.channels.fetch(process.env.PRIVATE_CHANNEL_ID);
      if (privateChannel) {
        await privateChannel.send(
          `❌ **動画生成に失敗しました**\n元メッセージ: ${message.url}\nエラー内容: ${error.message}`
        );
      }
    } catch (e) {
      console.error('[VoicePractice] エラー通知の送信も失敗しました:', e.message);
    }

  } finally {
    // 【重要】使い終わった一時ファイルはサーバの容量を圧迫しないよう必ず削除する
    if (audioPath) cleanupTempFile(audioPath);
    if (videoPath) cleanupTempFile(videoPath);
  }
}

module.exports = { handleVoicePractice };
