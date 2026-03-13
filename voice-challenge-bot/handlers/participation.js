// handlers/participation.js — 音声ファイルの投稿を検知して、参加日数をカウントする機能
// ユーザーが音声データをアップロードしたときに、それが「今日のお題への参加」かどうかを判定して記録します。

const { db } = require('../db');
const { checkAndGrantRole } = require('./roleManager');
const { sendAutoReply } = require('./autoReply');

// 許可する音声ファイルの拡張子（これ以外のファイルや動画は無視する）
const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.ogg', '.webm'];

/**
 * 送られたメッセージが音声ファイルを含んでいるかチェックし、
 * 条件を満たせば参加としてカウントする関数。
 * 
 * @param {Message} message - Discord上で送信されたメッセージ
 */
async function handleAudioSubmission(message) {
    // 1. まず、投稿されたチャンネルが「エンジョイ」か「ガチ」のどちらかであるか確認
    const enjoyChannelId = process.env.ENJOY_CHANNEL_ID;
    const gachiChannelId = process.env.GACHI_CHANNEL_ID;

    if (message.channelId !== enjoyChannelId && message.channelId !== gachiChannelId) {
        return; // 関係ないチャンネルの投稿は無視
    }

    // 2. メッセージに「添付ファイル」があるか、それが指定の音声ファイル形式か確認
    const attachments = Array.from(message.attachments.values());
    const hasAudioFile = attachments.some((attachment) => {
        // ファイルの名前を小文字にして、許可する拡張子で終わっているかチェック
        const fileName = attachment.name.toLowerCase();
        return ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext));
    });

    if (!hasAudioFile) {
        return; // テキストだけの投稿や、画像などは無視
    }

    // ==== ここから先は「音声ファイルがアップロードされた場合」の処理 ====

    const userId = message.author.id;
    const channelId = message.channelId;

    // 今の日付を取得（JST基準）
    // 日本の「YYYY-MM-DD」形式の文字列を作ります
    const jstDateStr = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
    // 例: "2026/2/25" のようになるので、ハイフンつなぎに直す（"2026-02-25"）
    const [year, month, day] = jstDateStr.split('/');
    const todayStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    // 3. 今日の参加記録がもうあるかチェック（1日何回投稿しても1回扱い）
    const alreadyParticipatedToday = db.prepare(`
    SELECT * FROM user_participation
    WHERE user_id = ? AND participated_date = ?
  `).get(userId, todayStr);

    if (alreadyParticipatedToday) {
        // 今日はもうカウント済みなのね、ということで終わる
        console.log(`${message.author.username} さんは本日すでに参加記録があります。（追加の投稿です）`);
        return;
    }

    // 4. 新たな参加なので、参加記録のテーブルに保存する
    const now = new Date().toISOString();
    db.prepare(`
    INSERT INTO user_participation (user_id, channel_id, participated_date, message_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, channelId, todayStr, message.id, now);

    // 5. 連続日数の計算（昨日も参加していたか？）
    let userStreak = db.prepare('SELECT * FROM user_streaks WHERE user_id = ?').get(userId);
    let newCurrentStreak = 1;

    if (userStreak && userStreak.last_participated_date) {
        // 前回の参加日付と今日の日付を引き算して、何日離れているか計算する
        const lastDate = new Date(userStreak.last_participated_date);
        const todayDate = new Date(todayStr);

        // 時刻の差をミリ秒で出し、1日のミリ秒（24×60×60×1000 = 86400000）で割って「日数の差」を出す
        const diffTime = todayDate.getTime() - lastDate.getTime();
        const diffDays = Math.round(diffTime / (1000 * 3600 * 24));

        if (diffDays === 1) {
            // 昨日も参加していれば、連続日数を+1
            newCurrentStreak = userStreak.current_streak + 1;
        } else {
            // 2日以上空いていれば、連続日数は1から再スタート
            newCurrentStreak = 1;
        }
    }

    // 6. 計算し直した「連続日数」「最高連続記録」をデータベースに保存・更新する
    if (userStreak) {
        const newMaxStreak = Math.max(userStreak.max_streak, newCurrentStreak);
        const newTotalDays = userStreak.total_days + 1;

        db.prepare(`
      UPDATE user_streaks
      SET current_streak = ?, max_streak = ?, total_days = ?, last_participated_date = ?, updated_at = ?
      WHERE user_id = ?
    `).run(newCurrentStreak, newMaxStreak, newTotalDays, todayStr, now, userId);
    } else {
        // 初めて参加した人の場合
        db.prepare(`
      INSERT INTO user_streaks (user_id, current_streak, max_streak, total_days, last_participated_date, updated_at)
      VALUES (?, 1, 1, 1, ?, ?)
    `).run(userId, todayStr, now);
    }

    console.log(`${message.author.username} さんの参加を検知しました！（連続 ${newCurrentStreak} 日目）`);

    // 🌟 変更点1：リアクションを🔥（炎）に変更
    await message.react('🔥');

    // 🌟 変更点2：自動返信機能の呼び出し
    // 通算日数（累計ファイル投稿数）を渡して、自動で返信と5分後の消去を行ってもらう
    const totalDays = userStreak ? userStreak.total_days + 1 : 1;
    await sendAutoReply(message, totalDays);

    // 7. ロール付与の条件（3日目、7日目など）を満たしているかチェックする
    // → ここで先ほど作った checkAndGrantRole 関数を呼び出す
    await checkAndGrantRole(message, newCurrentStreak);
}

module.exports = {
    handleAudioSubmission,
};
