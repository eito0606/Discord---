// handlers/dailyPost.js — 毎日のお題をチャンネルに投稿する機能

const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const { getNextDayNumber, saveDailyPost } = require('../db');
const { generateScript } = require('./scriptGenerator');
const { generateCharacterImage } = require('./characterImage');

const scriptsPath = path.join(__dirname, '../data/scripts.json');

/**
 * フォールバック（JSONからランダム選択）
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

        selectedScript.usedAt = new Date().toISOString();
        const scriptIndex = scripts.findIndex(s => s.id === selectedScript.id);
        scripts[scriptIndex] = selectedScript;
        fs.writeFileSync(scriptsPath, JSON.stringify(scripts, null, 2));

        return selectedScript;
    } catch (error) {
        console.error('フォールバック処理中にエラー:', error);
        return null;
    }
}

/**
 * 毎日のお題（3種類）を生成・投稿する
 */
async function postDailyScript(client) {
    const enjoyChannelId = process.env.ENJOY_CHANNEL_ID;
    const gachiChannelId = process.env.GACHI_CHANNEL_ID;

    const enjoyChannel = await client.channels.fetch(enjoyChannelId).catch(() => null);
    const gachiChannel = await client.channels.fetch(gachiChannelId).catch(() => null);

    if (!enjoyChannel && !gachiChannel) {
        console.error('エラー: 投稿先のチャンネルがどちらも見つかりません。');
        return;
    }

    const dayNumber = getNextDayNumber();

    const categories = [
        { id: 'male', title: '① 男性向け' },
        { id: 'female', title: '② 女性向け' },
        { id: 'narration', title: '③ ナレーター向け' }
    ];

    for (const category of categories) {
        let scriptData = null;
        let isFallback = false;

        try {
            console.log(`[生成開始] ${category.title} の台本を生成しています...`);
            scriptData = await generateScript(category.id);
        } catch (error) {
            console.error(`[生成エラー] ${category.id} の生成に失敗:`, error);
        }

        if (!scriptData) {
            console.log(`⚠️ Gemini APIエラー: フォールバック(JSON)を使用します (${category.id})`);
            scriptData = getFallbackScript();
            isFallback = true;
        }

        if (!scriptData) {
            console.error(`❌ ${category.id} の台本が用意できず、投稿をスキップします。`);
            continue;
        }

        // --- メッセージ組み立て ---
        const sourceHeader = isFallback ? '📖 出典' : '🎬 シチュエーション';
        const genreHeader = isFallback ? '🎭 演技指定' : '📌 ジャンル';

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

        // --- 画像生成（male/femaleのみ） ---
        let imageBuffer = null;
        if (!isFallback && scriptData.imagePrompt && (category.id === 'male' || category.id === 'female')) {
            try {
                console.log(`[画像生成] ${category.title} のキャラクター画像を生成中...`);
                imageBuffer = await generateCharacterImage(scriptData.text, category.id);
                if (imageBuffer) {
                    console.log(`[画像生成] ${category.title} の画像生成完了!`);
                } else {
                    console.log(`[画像生成] ${category.title} の画像生成失敗。テキストのみで投稿します。`);
                }
            } catch (error) {
                console.error(`[画像生成] ${category.title} でエラー:`, error);
            }
        }

        // --- 送信 ---
        let finalContent = messageContent;
        if (imageBuffer) {
            finalContent += `\n\n🖼️ *このイメージ画像はキャラクタービジュアライザーを使用して生成しています*`;
        }

        const sendOptions = { content: finalContent };
        if (imageBuffer) {
            const attachment = new AttachmentBuilder(imageBuffer, {
                name: `character_${category.id}.png`
            });
            sendOptions.files = [attachment];
        }

        let sentMessageEnjoy = null;
        let sentMessageGachi = null;

        try {
            if (enjoyChannel) {
                sentMessageEnjoy = await enjoyChannel.send(sendOptions);
            }
            if (gachiChannel) {
                sentMessageGachi = await gachiChannel.send(sendOptions);
            }

            const representativeMessageId = (sentMessageEnjoy || sentMessageGachi)?.id;
            const scriptRecordId = isFallback ? scriptData.id : `gemini-${category.id}`;

            if (representativeMessageId) {
                // scriptData が generateScript() からのものなら、拡張メタデータを DB に渡す。
                // フォールバック（scripts.json）の場合はメタなし。
                const extra = isFallback
                    ? {}
                    : {
                          category: scriptData.category || category.id,
                          genre: scriptData.genre || null,
                          situationId: scriptData.situationId || null,
                          situationTitle: scriptData.situationTitle || null,
                          emotionTag: scriptData.emotionTag || null,
                      };
                saveDailyPost(dayNumber, scriptRecordId, representativeMessageId, extra);
            }
            console.log(`[投稿完了] ${category.title} のお題を投稿しました！`);
        } catch (error) {
            console.error(`${category.id} のメッセージ送信中にエラー:`, error);
        }

        // 画像生成を含むため待機時間を延長
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

module.exports = { postDailyScript };
