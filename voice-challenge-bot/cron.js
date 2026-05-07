// cron.js — 決められた時間にプログラムを自動実行するための機能
// アラーム時計のように「毎日何時にこれを実行して！」と設定しておく場所です。

const cron = require('node-cron');
const { postDailyScript } = require('./handlers/dailyPost');

// ★新しく作成した週間ベスト発表の機能を読み込む
const { announceWeeklyBest } = require('./handlers/weeklyBest');

// ★新しく作成した声優ニュース自動収集の機能を読み込む
const newsCollector = require('./handlers/newsCollector');

// ★ Reverb ニュース：21時の活用事例フォールバック配信
const { runDailyFallback } = require('./handlers/reverb/daily-fallback');

// ★ クリエイター月次お題：毎月1日10時の自動投稿
const { postMonthlyTheme } = require('./handlers/creator/events');

// ★ M-5 ぼいラボ週次レポート：毎週月曜 9:00
const { postWeeklyReport } = require('./handlers/voipoke/weekly-report');

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
    cron.schedule('0 18 * * *', () => {
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

    // アラームの設定④: 毎晩21時の Reverb ニュースフォールバック
    // 当日 webhook 投稿が0件のときだけ、AI生成の活用事例を1本配信する
    cron.schedule('0 21 * * *', async () => {
        console.log('⏰ 21時になりました。Reverb ニュースのフォールバックを確認します...');
        try {
            await runDailyFallback(client);
        } catch (err) {
            console.error('[Reverb] daily fallback error:', err);
        }
    }, {
        timezone: 'Asia/Tokyo'
    });

    // アラームの設定⑤: 毎月1日10時、クリエイター月次お題テーマを自動投稿
    cron.schedule('0 10 1 * *', async () => {
        console.log('⏰ 月初10時になりました。クリエイター月次お題を投稿します...');
        try {
            await postMonthlyTheme(client);
        } catch (err) {
            console.error('[Creator] monthly theme error:', err);
        }
    }, {
        timezone: 'Asia/Tokyo'
    });

    // アラームの設定⑥: M-5 ぼいラボ週次レポート（毎週月曜 9:00）
    // discord_invitations テーブルを集計して #運営ログ に Embed 投稿
    cron.schedule('0 9 * * 1', async () => {
        console.log('⏰ 月曜 9 時になりました。ぼいラボ週次レポートを投稿します...');
        try {
            await postWeeklyReport(client);
        } catch (err) {
            console.error('[M-5] weekly report error:', err);
        }
    }, {
        timezone: 'Asia/Tokyo'
    });

    console.log('📅 定期実行（18時お題／日曜22時ベスト／毎時ニュース／21時 Reverb／月初10時 クリエイター／月曜9時 M-5週次）のスケジュールがセットされました！');
}

// 他のファイルから「setupCron」という関数を使えるようにする
module.exports = {
    setupCron,
};
