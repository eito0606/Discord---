// cron.js — 決められた時間にプログラムを自動実行するための機能
// アラーム時計のように「毎日何時にこれを実行して！」と設定しておく場所です。

const cron = require('node-cron');
const { postDailyScript } = require('./handlers/dailyPost');

// ★新しく作成した週間ベスト発表の機能を読み込む
const { announceWeeklyBest } = require('./handlers/weeklyBest');

// ★新しく作成した声優ニュース自動収集の機能を読み込む
const newsCollector = require('./handlers/newsCollector');

// cronの書式: '分 時 日 月 曜日'
// 設定例:
// '0 18 * * *' → 毎日18時00分に実行
// '* * * * *'  → 毎分実行（テスト用などに使う）
// '0 * * * *'  → 毎時0分に実行

/**
 * 毎日決まった時間にお題を投稿するためのスケジュール（アラーム）をセットします。
 *
 * @param {Client} client - index.jsで作ったDiscordのBot本体
 */
function setupCron(client) {
    // アラームの設定①: 毎日18時のお題投稿
    // timezone: 'Asia/Tokyo' を指定することで、日本の時間（JST）に合わせてくれます。
    cron.schedule('0 20 * * *', () => {
        console.log('⏰ 18時になりました。お題の投稿を開始します...');
        postDailyScript(client);
    }, {
        timezone: 'Asia/Tokyo'
    });

    // アラームの設定②: 毎週日曜日 22時の週間ベスト発表
    cron.schedule('0 22 * * 0', () => {
        console.log('⏰ 日曜日の22時になりました。今週のベスト演技を発表します...');
        announceWeeklyBest(client);
    }, {
        timezone: 'Asia/Tokyo'
    });

    // アラームの設定③: 1時間ごとのニュースチェック
    cron.schedule('0 * * * *', async () => {
        console.log('⏰ ニュースチェックの時間です。RSSフィードから新しい記事を探します...');
        await newsCollector.checkAndPost(client);
    }, {
        timezone: 'Asia/Tokyo'
    });

    console.log('📅 定期実行（毎日18時のお題、毎週日曜22時の週間ベスト、毎時0分のニュース）のスケジュールがセットされました！');
}

// 他のファイルから「setupCron」という関数を使えるようにする
module.exports = {
    setupCron,
};
