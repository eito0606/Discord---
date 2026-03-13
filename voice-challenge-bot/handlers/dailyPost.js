// handlers/dailyPost.js — 毎日のお題をチャンネルに投稿する機能
// APIを使って台本を生成し、男性向け・女性向け・ナレーター向けの3本を指定のチャンネルへメッセージを送ります。

const fs = require('fs');
const path = require('path');
const { getNextDayNumber, saveDailyPost } = require('../db');
const { generateScript } = require('./scriptGenerator'); // AI台本生成のプログラムを読み込む

// jsonファイル（バックアップ用）の場所を定義
const scriptsPath = path.join(__dirname, '../data/scripts.json');

/**
 * 古い仕組み（JSONからランダムに選ぶ）を動かす関数。
 * APIが止まってしまった時の「予備（フォールバック）」として使います。
 * @returns {Object|null} 古いJSON台本データ。見つからない場合はnull。
 */
function getFallbackScript() {
    try {
        let scripts = JSON.parse(fs.readFileSync(scriptsPath, 'utf-8'));
        let unusedScripts = scripts.filter(s => s.usedAt === null);

        if (unusedScripts.length === 0) {
            console.log('フォールバック用の全てのお題を使い切ったため、使用履歴をリセットします。');
            scripts = scripts.map(s => ({ ...s, usedAt: null }));
            unusedScripts = scripts;
        }

        const randomIndex = Math.floor(Math.random() * unusedScripts.length);
        const selectedScript = unusedScripts[randomIndex];

        // 選んだ台本に使用履歴をつけて保存する
        selectedScript.usedAt = new Date().toISOString();
        const scriptIndex = scripts.findIndex(s => s.id === selectedScript.id);
        scripts[scriptIndex] = selectedScript;
        fs.writeFileSync(scriptsPath, JSON.stringify(scripts, null, 2));

        return selectedScript;
    } catch (error) {
        console.error('フォールバック処理中にエラーが発生しました:', error);
        return null; // バックアップさえも壊れていた場合は諦める
    }
}

/**
 * 毎日のお題（3種類）を生成して、指定された両チャンネルに順番に投稿する中心的な関数。
 *
 * @param {Client} client - index.jsで作ったDiscordのBot本体
 */
async function postDailyScript(client) {
    // --- 1. 送信先のチャンネルを準備する ---
    const enjoyChannelId = process.env.ENJOY_CHANNEL_ID;
    const gachiChannelId = process.env.GACHI_CHANNEL_ID;

    // Botにお願いして、Discord上から各チャンネルを見つけてもらう
    const enjoyChannel = await client.channels.fetch(enjoyChannelId).catch(() => null);
    const gachiChannel = await client.channels.fetch(gachiChannelId).catch(() => null);

    if (!enjoyChannel && !gachiChannel) {
        console.error('エラー: 投稿先のチャンネルがどちらも見つかりません。設定を確認してください。');
        return;
    }

    const dayNumber = getNextDayNumber();

    // 投稿する予定のカテゴリ情報（順番、表示名、内部で使うID）
    const categories = [
        { id: 'male', title: '① 男性向け' },
        { id: 'female', title: '② 女性向け' },
        { id: 'narration', title: '③ ナレーター向け' }
    ];

    // --- 2. 各カテゴリごとに台本を生成・投稿するループ ---
    for (const category of categories) {
        let scriptData = null;
        let isFallback = false;

        // まずはAIになんとかして台本を作ってもらうようにお願いする
        try {
            console.log(`[生成開始] ${category.title} の台本を生成しています...`);
            scriptData = await generateScript(category.id);
        } catch (error) {
            console.error(`[生成エラー] ${category.id} の生成に失敗しました:`, error);
        }

        // もしAIが返事をしてくれなかったら（失敗したら）、仕方ないので古いバックアップから持ってくる
        if (!scriptData) {
            console.log(`⚠️ Gemini APIエラー: フォールバック(JSON)を使用します (${category.id})`);
            scriptData = getFallbackScript();
            isFallback = true;
        }

        // 予備（JSON）すらもダメだった場合は、このカテゴリはおやすみにする
        if (!scriptData) {
            console.error(`❌ ${category.id} の台本が用意できず、投稿をスキップします。`);
            continue;
        }

        // 送るメッセージ（台本）をきれいに飾り付ける
        // テンプレートリテラル `${変数名}` を使って文字に埋め込む
        const sourceHeader = isFallback ? '📖 出典' : '🎬 シチュエーション'; // AI作ならシチュエーション、既存作なら出典
        const genreHeader = isFallback ? '🎭 演技指定' : '📌 ジャンル';

        // （ソース情報がスラッシュで区切られて返ってくる想定）
        // "アニメ台詞 / 仲間の死を目の当たりにする" みたいな形を分割する
        const parts = scriptData.source.split(' / ');
        const genreText = parts[0] || '不明';
        const situationText = parts[1] || scriptData.source;

        const messageContent = `━━━━━━━━━━━━━━━━━━
🎭 今日のお題 ${category.title}（Day ${dayNumber}）
━━━━━━━━━━━━━━━━━━
${genreHeader}：${isFallback ? scriptData.direction : genreText}
${sourceHeader}：${isFallback ? scriptData.source : situationText}
🎯 ト書き：${isFallback ? '（自由）' : scriptData.direction}

${scriptData.text}
━━━━━━━━━━━━━━━━━━`;

        // 両方のチャンネルに投稿する
        let sentMessageEnjoy = null;
        let sentMessageGachi = null;

        try {
            if (enjoyChannel) {
                sentMessageEnjoy = await enjoyChannel.send(messageContent);
            }
            if (gachiChannel) {
                sentMessageGachi = await gachiChannel.send(messageContent);
            }

            // 代表のメッセージIDを取得してデータベースに記録する（IDはAIを示す固定文字と合わせる）
            const representativeMessageId = (sentMessageEnjoy || sentMessageGachi)?.id;
            const scriptRecordId = isFallback ? scriptData.id : `gemini-${category.id}`;

            if (representativeMessageId) {
                saveDailyPost(dayNumber, scriptRecordId, representativeMessageId);
            }
            console.log(`[投稿完了] ${category.title} のお題を投稿しました！`);
        } catch (error) {
            console.error(`${category.id} のメッセージ送信中にエラーが発生しました:`, error);
        }

        // もし3本連続で送る際に早すぎるとDiscordに怒られるため、2秒ほど待ってから次へ行く
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

module.exports = {
    postDailyScript,
};

