// handlers/weeklyBest.js — 1週間の間で一番リアクションが多かった演技を発表する機能
// 月曜日〜日曜日の期間に投稿された音声ファイルの中で、絵文字の反応が一番多いものを探します。

const { db } = require('../db');

/**
 * 過去1週間（月曜〜日曜）の投稿からベストなものを探し、両チャンネルに発表する関数。
 * 
 * @param {Client} client - index.jsで作ったDiscordのBot本体
 */
async function announceWeeklyBest(client) {
    // 送信先のチャンネルを準備する
    const enjoyChannelId = process.env.ENJOY_CHANNEL_ID;
    const gachiChannelId = process.env.GACHI_CHANNEL_ID;

    const enjoyChannel = await client.channels.fetch(enjoyChannelId).catch(() => null);
    const gachiChannel = await client.channels.fetch(gachiChannelId).catch(() => null);

    if (!enjoyChannel && !gachiChannel) {
        console.error('エラー: 週間ベストの発表先チャンネルが見つかりません。');
        return;
    }

    // ==== 1. 「いつから、いつまで」の範囲を決める（先週の月曜〜日曜） ====

    const nowStr = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const baseDate = new Date(nowStr); // 今日（例：日曜日なら日曜日の日付）

    // 今日の曜日を取得（0: 日曜, 1: 月曜, ... , 6: 土曜）
    let dayOfWeek = baseDate.getDay();
    // 万一日曜以外で実行されたとしても、直前の「月曜〜日曜」を集計するように調整
    // JSの仕様上、日曜は0なので、都合よく計算するために日曜を7として扱う
    if (dayOfWeek === 0) dayOfWeek = 7;

    // 集計の「開始日（月曜日）」と「終了日（日曜日）」の計算
    const startDate = new Date(baseDate);
    startDate.setDate(baseDate.getDate() - dayOfWeek + 1); // 今週の月曜日に戻る（もし日曜実行なら -7+1 = 6日前）

    const endDate = new Date(baseDate);
    endDate.setDate(startDate.getDate() + 6); // 月曜日から6日進めて日曜日にする

    // データベースで検索しやすい形（YYYY-MM-DD）に整える関数
    const formatDate = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const startStr = formatDate(startDate);
    const endStr = formatDate(endDate);

    console.log(`📊 週間ベスト集計期間: ${startStr} 〜 ${endStr}`);

    // ==== 2. データベースからこの期間の投稿をすべて取り出す ====

    // user_participation テーブルから、この1週間の間に投稿された記録をすべて引き出す
    // BETWEEN '開始日' AND '終了日' で、その期間内のデータをスパッと切り出せる
    const thisWeekPosts = db.prepare(`
    SELECT * FROM user_participation
    WHERE participated_date BETWEEN ? AND ?
  `).all(startStr, endStr);

    if (thisWeekPosts.length === 0) {
        // もし誰も投稿していなかったら、残念なお知らせを出す
        const noPostMessage = '今週はまだ投稿がありませんでした。\n来週こそチャレンジしよう！ 🎙️';
        if (enjoyChannel) await enjoyChannel.send(noPostMessage);
        if (gachiChannel) await gachiChannel.send(noPostMessage);
        return;
    }

    // ==== 3. 各投稿の「リアクション数」をDiscordから取得して調べる ====

    let bestPost = null;
    let maxReactions = -1; // リアクション数の最大値（最初はマイナスにしておく）
    let bestMessageUrl = '';

    // 取り出した投稿データベースの記録を、1つずつ見ていく
    // for...of ループは、配列の中身を一つずつ取り出して処理する便利な構文
    for (const record of thisWeekPosts) {
        try {
            // 記録にある「チャンネルID」と「メッセージID」を使って、Discord上から実際の投稿データを持ってくる
            const channel = await client.channels.fetch(record.channel_id);
            const message = await channel.messages.fetch(record.message_id);

            // その投稿についているリアクション（絵文字）の数を全部かき集める
            // メッセージの reactions.cache（反応リスト）の中の、「何人が押したか」を合計する
            let reactionCount = 0;
            message.reactions.cache.forEach((reaction) => {
                reactionCount += reaction.count;
            });

            // 自分以外の（Botの音符マークなどを除いた）人に押してもらえた数、など厳密にやると複雑なので
            // 今回はシンプルに「全てのリアクションの合計数」で競う。

            // もし今のリアクション数が、これまでの最大記録を更新したら
            if (reactionCount > maxReactions) {
                maxReactions = reactionCount;     // 最高記録を更新
                bestPost = record;                // 今の投稿を「暫定1位」としてキープ
                bestMessageUrl = message.url;     // ついでにその投稿へのリンクもキープ
            } else if (reactionCount === maxReactions && maxReactions > -1) {
                // 同点の場合は「投稿日時が早い」方を優先するというルールの処理
                const currentBestTime = new Date(bestPost.created_at).getTime();
                const thisPostTime = new Date(record.created_at).getTime();

                if (thisPostTime < currentBestTime) {
                    bestPost = record;
                    bestMessageUrl = message.url;
                }
            }
        } catch (error) {
            // メッセージが削除されていたりするとエラーになるので、その場合はスキップする
            console.log(`メッセージID ${record.message_id} の取得に失敗したためスキップしました。`);
        }
    }

    // ==== 4. 決まった「ベスト演技」を発表する ====

    if (bestPost && maxReactions > 0) {
        // 誰の投稿かわかるように、ユーザーの表示名を取得する
        const user = await client.users.fetch(bestPost.user_id);
        const username = user ? user.username : '不明なユーザー';

        const announceMessage = `🏆 **今週のベスト演技** 🏆

<@${bestPost.user_id}> さんの投稿
リアクション数：${maxReactions}
🔊 演技を聴きに行く：${bestMessageUrl}

今週も皆さんお疲れさまでした！
来週も一緒に声出していきましょう 🎙️`;

        // 結果を両チャンネルにお知らせ
        if (enjoyChannel) await enjoyChannel.send(announceMessage);
        if (gachiChannel) await gachiChannel.send(announceMessage);

        console.log(`🏅 週間ベスト発表完了（勝者: ${username}, リアクション数: ${maxReactions}）`);
    } else {
        // 投稿はあったけど、誰にもリアクションされていなかった場合
        const announceMessage = `🏆 今週のベスト演技\n\n今週はリアクションがついた投稿がありませんでした。\n来週はお互いの演技を聴いて、どんどんリアクションし合おう！ 🎙️`;
        if (enjoyChannel) await enjoyChannel.send(announceMessage);
        if (gachiChannel) await gachiChannel.send(announceMessage);
    }
}

module.exports = {
    announceWeeklyBest,
};
