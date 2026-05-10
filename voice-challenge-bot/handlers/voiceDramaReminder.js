// handlers/voiceDramaReminder.js — 声劇イベントのリマインド（お知らせ）機能
// 開演の1時間前と10分前に自動で通知を送るモジュール。
// 「目覚まし時計」のように、指定した時刻になったら自動でチャンネルにメッセージを送る。

const { EmbedBuilder } = require('discord.js');
const {
  getActiveVoiceDramaEvents,
  getConfirmedParticipants,
  getVoiceDramaEvent,
  markReminderSent,
  updateVoiceDramaEventStatus,
} = require('../db');

// ==========================================
// アクティブなタイマーの管理
// ==========================================

// 現在セットされているタイマーを保持するMap（辞書のようなもの）
// Key: "eventId_1h" or "eventId_10m", Value: setTimeout の返り値
const activeTimers = new Map();

// ==========================================
// 1. リマインドをスケジュール（予約）する関数
// ==========================================

// 新しいイベントが作成されたときに呼び出される
// 開演の1時間前と10分前にリマインドを送るタイマーをセットする
// client: Botのクライアント
// event: イベントデータ（eventDatetimeが含まれている）
function scheduleReminders(client, event) {
  // M-6 Phase 2-C: 練習回はリマインドをスキップ（負担軽減）
  if ((event.event_kind || event.eventKind) === 'practice') {
    console.log(`🧪 イベント${event.id}: 練習回のためリマインドをスキップ`);
    return;
  }
  const eventDatetime = new Date(event.eventDatetime || event.event_datetime);
  const now = new Date();

  // 1時間前のリマインド（60分 × 60秒 × 1000ミリ秒 = 3,600,000ミリ秒前）
  const oneHourBefore = new Date(eventDatetime.getTime() - 60 * 60 * 1000);
  const msUntil1h = oneHourBefore.getTime() - now.getTime();

  // 10分前のリマインド
  const tenMinBefore = new Date(eventDatetime.getTime() - 10 * 60 * 1000);
  const msUntil10m = tenMinBefore.getTime() - now.getTime();

  const eventId = event.id;

  // ── 1時間前のタイマーをセット ──
  // まだ1時間前を過ぎていない場合のみセットする
  if (msUntil1h > 0 && !(event.reminder_sent_1h)) {
    const timer1h = setTimeout(async () => {
      await sendReminder(client, eventId, '1h');
      activeTimers.delete(`${eventId}_1h`); // タイマーを使い終わったら辞書から消す
    }, msUntil1h);

    activeTimers.set(`${eventId}_1h`, timer1h);
    console.log(`⏰ イベント${eventId}: 1時間前リマインドを ${oneHourBefore.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} にセット`);
  }

  // ── 10分前のタイマーをセット ──
  if (msUntil10m > 0 && !(event.reminder_sent_10m)) {
    const timer10m = setTimeout(async () => {
      await sendReminder(client, eventId, '10m');
      activeTimers.delete(`${eventId}_10m`);
    }, msUntil10m);

    activeTimers.set(`${eventId}_10m`, timer10m);
    console.log(`⏰ イベント${eventId}: 10分前リマインドを ${tenMinBefore.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} にセット`);
  }
}

// ==========================================
// 2. リマインドを実際に送信する関数
// ==========================================

// タイマーが発火した時に呼ばれる
// client: Botのクライアント
// eventId: イベントID
// type: '1h'（1時間前）or '10m'（10分前）
async function sendReminder(client, eventId, type) {
  try {
    const event = getVoiceDramaEvent(eventId);
    if (!event) return;

    // 既にキャンセルされたイベントにはリマインドを送らない
    if (event.status === 'archived') return;

    const channelId = event.recruit_channel_id;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.error(`リマインド送信失敗: チャンネル ${channelId} が見つかりません`);
      return;
    }

    // 確定メンバーのメンションを作成
    const confirmed = getConfirmedParticipants(eventId);
    const mentions = confirmed.map(p => `<@${p.user_id}>`).join(' ');

    // リマインドの内容を組み立てる
    const timeLabel = type === '1h' ? '1時間' : '10分';
    const emoji = type === '1h' ? '⏰' : '🔔';

    const formattedDate = new Date(event.event_datetime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    const embed = new EmbedBuilder()
      .setTitle(`${emoji} 声劇イベント — 開演${timeLabel}前！`)
      .setDescription(
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📖 **${event.event_title}**\n\n` +
        `📅 開演: ${formattedDate}\n` +
        `🎤 ステージ: <#${event.stage_channel_id}>\n\n` +
        `${type === '10m' ? '🎭 まもなく開演です！ステージチャンネルに集合してください！' : '📋 開演まであと1時間です。台本の最終確認をお願いします！'}\n` +
        `━━━━━━━━━━━━━━━━━━━━`
      )
      .setColor(type === '1h' ? 0xFFAA00 : 0xFF4444) // 1時間前=黄色、10分前=赤（緊急度をイメージ）
      .setTimestamp();

    // メンション付きでリマインドを送信
    const content = mentions ? `${mentions}\n` : '';
    await channel.send({ content, embeds: [embed] });

    // DBにリマインド送信済みフラグを記録
    markReminderSent(eventId, type);
    console.log(`✅ イベント${eventId}: ${timeLabel}前リマインドを送信しました`);

  } catch (error) {
    console.error(`リマインド送信エラー (イベント${eventId}, ${type}):`, error);
  }
}

// ==========================================
// 3. Bot再起動時のリマインド復元
// ==========================================

// Botが再起動されたとき、まだ送信されていないリマインドのタイマーを再セットする関数
// （コンセントが抜けてもう一度差した時に、目覚まし時計をセットし直すようなもの）
// client: Botのクライアント
function restoreReminders(client) {
  try {
    const activeEvents = getActiveVoiceDramaEvents();
    let restored = 0;

    for (const event of activeEvents) {
      if (!event.event_datetime) continue;
      scheduleReminders(client, event);
      restored++;
    }

    if (restored > 0) {
      console.log(`📅 ${restored}件のイベントのリマインドを復元しました`);
    }
  } catch (error) {
    console.error('リマインド復元エラー:', error);
  }
}

// ==========================================
// 4. タイマーのクリーンアップ
// ==========================================

// イベントがキャンセルされた時にタイマーを削除する関数
// （不要になった目覚まし時計をオフにするイメージ）
function cancelReminders(eventId) {
  const timer1h = activeTimers.get(`${eventId}_1h`);
  const timer10m = activeTimers.get(`${eventId}_10m`);

  if (timer1h) {
    clearTimeout(timer1h);
    activeTimers.delete(`${eventId}_1h`);
  }
  if (timer10m) {
    clearTimeout(timer10m);
    activeTimers.delete(`${eventId}_10m`);
  }
}

// エクスポート
module.exports = {
  scheduleReminders,
  restoreReminders,
  cancelReminders,
};
