// handlers/newsCollector.js — 声優関連のニュースを自動で集めて投稿する機能
// 定期的にニュースサイト（RSS）を見に行き、新しい記事があれば綺麗なカード（Embed）の形でDiscordにお知らせします。

// RSSとは？
// ニュースサイトやブログが「新着記事の一覧表」を自動で公開している仕組みです。
// これを使うと、わざわざサイトを開かなくても「何か新しい記事ある？」とプログラムから直接聞くことができます。

const Parser = require('rss-parser');
const parser = new Parser();
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { db } = require('../db');

// データファイルの場所
const sourcesPath = path.join(__dirname, '../data/rss-sources.json');
const keywordsPath = path.join(__dirname, '../data/news-keywords.json');

// フィルタリング（キーワード検知）用の関数
function containsKeyword(text, keywords) {
    if (!text) return false;
    // 記事のタイトルや本文の中に、リストのキーワードが1つでも含まれていれば true（OK）を返す
    return keywords.some(keyword => text.includes(keyword));
}

// データベースを調べて、そのURLがすでに投稿済みかどうかを確認する関数
function isAlreadyPosted(url) {
    const row = db.prepare('SELECT id FROM posted_news WHERE article_url = ?').get(url);
    return !!row; // 見つかれば true（投稿済み）、なければ false
}

// 投稿したよ！という記録をデータベースに保存する関数
function markAsPosted(url, title, sourceName) {
    const now = new Date().toISOString();
    db.prepare(`
    INSERT INTO posted_news (article_url, article_title, source_name, posted_at)
    VALUES (?, ?, ?, ?)
  `).run(url, title, sourceName, now);
}

// RSSフィードの連続失敗回数を記録するための変数
// （3回連続で失敗したら警告を出すためのカウンター）
const failureCounts = {};

/**
 * ニュースサイトを巡回して、新しい記事を投稿する中心的な関数
 * 
 * @param {Client} client - index.jsで作ったDiscordのBot本体
 */
async function checkAndPost(client) {
    // 1. 送信先のニュースチャンネルを準備する
    const newsChannelId = process.env.NEWS_CHANNEL_ID;
    if (!newsChannelId) {
        console.error('エラー: NEWS_CHANNEL_ID が設定されていません。');
        return;
    }

    const newsChannel = await client.channels.fetch(newsChannelId).catch(() => null);
    if (!newsChannel) {
        console.error('エラー: ニュースチャンネルが見つかりません。');
        return;
    }

    // 2. ニュース取得元（RSSリスト）と、フィルタ用キーワードを読み込む
    const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
    const keywords = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));

    // 今回の巡回で見つけた「投稿すべき記事」の一時保管場所
    const articlesToPost = [];

    // 3. 各ニュースサイトを順番に回っていく
    for (const source of sources) {
        try {
            // rss-parserを使って、サイトから最新記事のリストをもらってくる
            const feed = await parser.parseURL(source.url);
            failureCounts[source.name] = 0; // 成功したら失敗カウンターをリセット

            // 最新から順に記事を取り出してチェック
            for (const item of feed.items) {
                // すでに投稿済みの記事は無視
                if (isAlreadyPosted(item.link)) continue;

                // キーワードが含まれているかチェック（タイトル、あるいは本文抜粋）
                const isTarget = containsKeyword(item.title, keywords) || containsKeyword(item.contentSnippet, keywords);
                if (!isTarget) continue;

                // 条件をクリアしたので、投稿候補リストに追加
                articlesToPost.push({
                    sourceName: source.name,
                    sourceEmoji: source.emoji,
                    title: item.title,
                    link: item.link,
                    // description（抜粋文）が長すぎる場合は150文字でカットする
                    description: item.contentSnippet ? item.contentSnippet.substring(0, 150) + (item.contentSnippet.length > 150 ? '...' : '') : '本文情報なし',
                    pubDate: item.pubDate,
                });
            }
        } catch (error) {
            console.error(`RSS取得失敗: ${source.name} (${error.message})`);

            // 失敗回数をカウントアップ
            failureCounts[source.name] = (failureCounts[source.name] || 0) + 1;

            // 3回連続で失敗した場合は、サイトが閉鎖した等の可能性があるので警告を出す
            if (failureCounts[source.name] >= 3) {
                console.warn(`⚠️ 警告: ${source.name} からのニュース取得が3回連続で失敗しています。URLが変更された可能性があります。`);
            }
        }
    }

    // 4. 見つけた記事を Discord に投稿する
    // 1回の投稿でスパムにならないよう、最大5件までに制限
    const postsThisTime = articlesToPost.slice(0, 5);

    for (const article of postsThisTime) {
        // Embedとは？
        // Discordの特別なメッセージ形式。
        // 左側に色のバーがついたり、綺麗な枠で囲われた「リンクカード」のような見た目を作れます。
        const embed = new EmbedBuilder()
            .setColor('#2A7A6E') // ティール（青緑色っぽい色）
            .setAuthor({ name: '🎙️ 声優ニュース｜自動収集' })
            .setTitle(article.title) // 記事のタイトル（クリックできるようになる）
            .setURL(article.link)    // タイトルを押したときの飛び先URL
            .setDescription(`📝 内容：\n${article.description}`)
            .addFields(
                { name: '📰 ソース', value: `${article.sourceEmoji} ${article.sourceName}`, inline: true },
                // 取得した公開日を「2026/02/24」のような分かりやすい形に変換
                { name: '📅 公開日', value: new Date(article.pubDate || new Date()).toLocaleDateString('ja-JP'), inline: true }
            )
            .setFooter({ text: '※ RSSフィードから自動収集しています' })
            .setTimestamp(new Date(article.pubDate || new Date())); // メッセージの右下に小さく表示される時間

        try {
            // チャンネルにEmbed形式で送信
            await newsChannel.send({ embeds: [embed] });

            // 送信に成功したら、データベースに「この記事は投稿済み」と記録して二度と出ないようにする
            markAsPosted(article.link, article.title, article.sourceName);
            console.log(`ニュースを自動投稿しました: ${article.title}`);
        } catch (error) {
            console.error('ニュースの投稿中にエラーが発生しました:', error);
        }
    }

    if (articlesToPost.length > 5) {
        console.log(`今回見つかった記事は ${articlesToPost.length} 件でした。5件を超えた分は次回の自動実行時に投稿されます。`);
    } else if (articlesToPost.length === 0) {
        console.log('今回の巡回で新しい声優ニュースは見つかりませんでした。');
    }
}

module.exports = {
    checkAndPost,
};
