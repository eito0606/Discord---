// handlers/diaryReactionHandler.js — 日記報告部屋の自動リアクション機能
// 投稿された画像に対してBotが自動でリアクション（絵文字）を付けます。

async function handleDiaryReaction(message) {
    // 自分が送ったメッセージには反応しない
    if (message.author.bot) return;

    // 日記報告部屋のチャンネルIDを確認
    const diaryChannelId = process.env.DIARY_CHANNEL_ID;
    
    // デバッグログ: どのチャンネルでメッセージを検知したか
    if (message.channelId === diaryChannelId) {
        console.log(`日記報告部屋でメッセージを検知: ${message.author.displayName}`);
    } else {
        // 必要に応じて他のチャンネルでの無視ログを出す（通常は不要）
        return;
    }

    // メッセージに添付ファイル（画像等）があるか確認
    if (message.attachments.size > 0) {
        try {
            // リアクションを付ける（ハートとキラキラ）
            await message.react('❤️');
            await message.react('✨');
            console.log(`日記投稿へのリアクション完了: ${message.author.displayName} (${message.id})`);
        } catch (error) {
            console.error('リアクション付与エラー:', error);
        }
    } else {
        console.log('添付ファイルがないためリアクションをスキップしました。');
    }
}

module.exports = {
    handleDiaryReaction,
};
