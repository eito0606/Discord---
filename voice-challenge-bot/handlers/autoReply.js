// handlers/autoReply.js — 音声ファイル投稿時の自動返信モジュール
// ユーザーがボイスサンプルを投稿した際に、通算回数に応じたメッセージを返し、
// 5分後にそのメッセージを自動で削除します。

// 自動削除までの時間（5分 = 300,000ミリ秒）
const DELETE_DELAY_MS = 5 * 60 * 1000;

/**
 * ユーザーの音声投稿に対して、通算回数に応じたメッセージを自動返信し、
 * 5分後に自動削除する関数。
 * 
 * @param {Message} originalMessage - ユーザーが投稿した音声ファイル付きメッセージ
 * @param {number} totalDays - そのユーザーの累計投稿日数（通算何本目か）
 */
async function sendAutoReply(originalMessage, totalDays) {
    let replyText = '';

    // 1. 通算回数（初回か、2回目以降か）で送るメッセージの文面を変える
    if (totalDays === 1) {
        // 初回投稿の場合：検索方法の案内を入れる
        replyText = `🎤 投稿ありがとうございます！（通算 ${totalDays} 本目）

毎日の投稿があなたの資産になります。
明日も投稿して、自分だけのポートフォリオ（資産）を積み上げていきましょう。

💡 自分の成長を振り返るには、チャンネル内の検索バーで
「from:${originalMessage.author.username} has:file」と入力してみてください。
過去の投稿が一覧で見れます。

※このメッセージは5分後に自動で消えます`;

    } else {
        // 2回目以降の投稿の場合：シンプルな応援メッセージにする
        replyText = `🎤 投稿ありがとうございます！（通算 ${totalDays} 本目）

毎日の投稿があなたの資産になります。
明日も投稿して、自分だけのポートフォリオ（資産）を積み上げていきましょう。

※このメッセージは5分後に自動で消えます`;
    }

    try {
        // 2. ユーザーの投稿に対して返信する（チャンネルにメッセージを送る）
        const replyMessage = await originalMessage.reply(replyText);

        // 3. 5分後にメッセージを自動で削除するタイマーをセット
        // setTimeoutは「指定した時間（ミリ秒）が経ったら、中の処理を実行する」という機能です
        setTimeout(async () => {
            try {
                // メッセージを削除する
                await replyMessage.delete();
            } catch (deleteError) {
                // もし削除しようとした時にエラーが起きた場合（すでに誰かが手動で消していた、権限がないなど）
                // Bot全体が止まらないように、ここでエラーをキャッチしてログ（裏側の記録）に残すだけにします
                console.error(`自動返信メッセージの削除に失敗しました（ID: ${replyMessage.id}）:`, deleteError.message);
            }
        }, DELETE_DELAY_MS);

    } catch (sendError) {
        // そもそも返信メッセージを送れなかった場合のエラー処理
        console.error('自動返信メッセージの送信に失敗しました:', sendError.message);
    }
}

// このファイル外からも関数を使えるようにエクスポート（外に出す）する
module.exports = {
    sendAutoReply,
};
