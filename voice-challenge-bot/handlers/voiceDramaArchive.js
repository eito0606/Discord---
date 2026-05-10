// handlers/voiceDramaArchive.js — 声劇イベントのアーカイブ（記録保存）機能
// 終演後にイベントの記録（日時・台本名・主催者・参加者・配役）を保存するモジュール。
// 「卒業アルバム」のように、イベントの思い出を整理して残すイメージ。

const { EmbedBuilder } = require('discord.js');
const {
  getVoiceDramaEvent,
  getConfirmedParticipants,
  getVoiceDramaParticipants,
  updateVoiceDramaEventStatus,
} = require('../db');

// ==========================================
// 1. アーカイブの実行
// ==========================================

// イベントのアーカイブを作成する関数
// - DBのステータスを 'archived' に更新
// - アーカイブチャンネルに記録Embedを投稿
// client: Botのクライアント
// event: イベントデータ（DBから取得済み、またはcreateVoiceDramaEvent直後のデータ）
async function archiveEvent(client, event) {
  try {
    const eventId = event.id;

    // ステータスを「アーカイブ済み」に更新
    updateVoiceDramaEventStatus(eventId, 'archived');

    // 確定済みの参加者を取得
    const confirmed = getConfirmedParticipants(eventId);

    // 全参加者（立候補者含む）を取得（統計用）
    const allParticipants = getVoiceDramaParticipants(eventId);

    // アーカイブチャンネルにEmbedを投稿
    const archiveChannelId = process.env.VOICE_DRAMA_ARCHIVE_CHANNEL_ID ||
                              process.env.VOICE_DRAMA_CHANNEL_ID;
    const channel = await client.channels.fetch(archiveChannelId).catch(() => null);

    if (!channel) {
      console.error('アーカイブチャンネルが見つかりません:', archiveChannelId);
      return;
    }

    // 配役情報を文字列に整形
    const characters = event.characters || [];
    const formattedDate = new Date(event.event_datetime || event.eventDatetime)
      .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const createdDate = new Date(event.created_at)
      .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    // 配役一覧を作成
    let castList = characters.map(c => {
      const member = confirmed.find(p => p.character_name === c.name);
      if (member) {
        return `${c.emoji} **${c.name}**（${c.gender}）→ <@${member.user_id}>`;
      }
      return `${c.emoji} **${c.name}**（${c.gender}）→ ─`;
    }).join('\n');

    // 参加者一覧（重複なし）
    const uniqueParticipantIds = [...new Set(confirmed.map(p => p.user_id))];
    const participantMentions = uniqueParticipantIds.map(id => `<@${id}>`).join(', ');

    // アーカイブEmbedを作成
    // 古い巻物を開いた時のような金色の装飾
    const embed = new EmbedBuilder()
      .setTitle('📜 声劇アーカイブ')
      .setDescription(
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📖 **${event.event_title || event.eventTitle}**\n\n` +
        `👑 **主催者**: <@${event.host_user_id || event.hostUserId}>\n` +
        `📅 **開演日時**: ${formattedDate}\n` +
        `📝 **作成日時**: ${createdDate}\n` +
        `👥 **参加者数**: ${uniqueParticipantIds.length}人\n` +
        `🎭 **登場人物**: ${characters.length}人\n\n` +
        `**【配役】**\n${castList}\n\n` +
        `**【参加者】**\n${participantMentions || 'なし'}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━`
      )
      .setColor(0xD4AF37) // 金色（アーカイブの重厚感をイメージ）
      .setFooter({ text: `アーカイブID: ${eventId}` })
      .setTimestamp();

    const archiveMsg = await channel.send({ embeds: [embed] });
    console.log(`📜 イベント${eventId}「${event.event_title || event.eventTitle}」をアーカイブしました`);

    // M-6 Phase 3-E: 振り返りスレッド自動作成
    try {
      const reflectionThread = await channel.threads.create({
        startMessage: archiveMsg,
        name: `🎭 ${(event.event_title || event.eventTitle).slice(0, 60)} 振り返り`,
        autoArchiveDuration: 1440 * 7, // 7 日
        reason: 'M-6 公演振り返りスレッド自動作成',
      });
      const uniqueParticipantIds = [...new Set(confirmed.map(p => p.user_id))];
      const mentions = uniqueParticipantIds.map((id) => `<@${id}>`).join(' ');
      await reflectionThread.send({
        content: mentions || null,
        embeds: [new EmbedBuilder()
          .setColor(0x1B5E3F)
          .setTitle('🎭 公演おつかれさまでした！')
          .setDescription([
            'リスナーの方は感想を、',
            'キャストの方は反省 / 良かった点を自由に投稿してください。',
            '',
            'このスレッドは **7日後にアーカイブ** されます。',
          ].join('\n'))],
      });
    } catch (err) {
      console.warn('[Archive] 振り返りスレッド作成失敗:', err.message);
    }

    // M-6 Phase 3-F: 配信済み or X 共有 OK ならアーカイブ Embed を X / Threads にも投稿
    // （実投稿は voiceDramaBroadcast.js が担当。env が無ければスキップ）
    try {
      const { shareArchiveToSNS } = require('./voiceDramaBroadcast');
      await shareArchiveToSNS(client, event, archiveMsg);
    } catch (err) {
      // 未実装 / env 未設定でも警告のみ
      console.log('[Archive] SNS シェア スキップ:', err.message);
    }

  } catch (error) {
    console.error('アーカイブ作成エラー:', error);
  }
}

// エクスポート
module.exports = {
  archiveEvent,
};
