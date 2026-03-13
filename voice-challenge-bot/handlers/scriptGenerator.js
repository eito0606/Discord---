// handlers/scriptGenerator.js — プロンプトを組み立て、台本を生成するモジュール

const fs = require('fs');
const path = require('path');
const { generateText } = require('./geminiClient');
const { getNextDayNumber } = require('../db');

// ファイルパスの定義
const situationsPath = path.join(__dirname, '../data/situations.json');
const promptsPath = path.join(__dirname, '../data/prompts.json');
const lastGeneratedPath = path.join(__dirname, '../data/last_generated.json');

// ジャンルのローテーション順（5日周期）
const GENRE_ROTATION = ['日常', '恋愛', 'コメディ', '戦闘アクション', 'その他'];

/**
 * 今日のジャンルをDay番号から決定する
 * @returns {string} 今日のジャンル
 */
function getTodayGenre() {
    const dayNumber = getNextDayNumber();
    const index = dayNumber % GENRE_ROTATION.length;
    return GENRE_ROTATION[index];
}

/**
 * シチュエーション一覧を読み込む
 */
function loadSituations() {
    try {
        const data = fs.readFileSync(situationsPath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error('シチュエーション一覧の読み込みに失敗しました:', error);
        return { male: {}, female: {}, narration: {} };
    }
}

/**
 * プロンプトを読み込む
 */
function loadPrompts() {
    try {
        if (fs.existsSync(promptsPath)) {
            const data = fs.readFileSync(promptsPath, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('プロンプトファイルの読み込みに失敗しました:', error);
    }
    return null;
}

/**
 * 前日の生成履歴を読み込む
 * @returns {Array} 前日に使ったシチュエーションの文字列リスト
 */
function loadLastGenerated() {
    try {
        if (fs.existsSync(lastGeneratedPath)) {
            const data = JSON.parse(fs.readFileSync(lastGeneratedPath, 'utf-8'));
            const today = new Date().toISOString().split('T')[0];
            if (data.date && data.date !== today) {
                return data.used || [];
            }
        }
    } catch (error) {
        console.error('前日の生成履歴の読み込みに失敗しました:', error);
    }
    return [];
}

/**
 * 今日の生成履歴を保存する
 * @param {Array} usedList - 今日使ったシチュエーションの配列
 */
function saveLastGenerated(usedList) {
    const data = {
        date: new Date().toISOString().split('T')[0],
        used: usedList
    };
    try {
        fs.writeFileSync(lastGeneratedPath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('生成履歴の保存に失敗しました:', error);
    }
}

/**
 * 配列の中からランダムに1つ選ぶ（除外リスト考慮）
 */
function getRandomItemExcluding(arr, excludeList = []) {
    const available = arr.filter(item => !excludeList.includes(item));
    const pool = available.length > 0 ? available : arr;
    return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * デフォルトテンプレート（フォールバック用）
 */
const DEFAULT_SCENARIO_TEMPLATE = `
あなたはアニメ・吹き替えの脚本家です。
声優の演技練習用に、以下の条件で短い台本を1つ作成してください。

【条件】
- ジャンル：{genre}
- キャラクター：{character}
- シチュエーション：{situation}
- 長さ：4〜5行（読み上げて20〜30秒程度）
- セリフのみ出力（地の文は不要）

【出力フォーマット】
1行目：【シチュエーション】一言でシーンを説明
2行目：【ト書き】演技のディレクションを一言で
3行目以降：セリフ（4〜5行）

キャラクター名は「キャラA」等ではなく、具体的な名前をつけてください。
セリフは自然な話し言葉で、感情の起伏がわかるように書いてください。
`;

const DEFAULT_NARRATION_TEMPLATE = `
あなたはナレーション台本の作家です。
ナレーターの演技練習用に、以下の条件で短いナレーション台本を1つ作成してください。

【条件】
- ジャンル：{genre}
- シチュエーション：{situation}
- 長さ：4〜5行（読み上げて20〜30秒程度）

【出力フォーマット】
1行目：【シチュエーション】一言でシーンを説明
2行目：【ト書き】読みのディレクションを一言で
3行目以降：ナレーション本文（4〜5行）

プロのナレーターが読むことを想定し、間やテンポを意識した文章にしてください。
`;

/**
 * 指定カテゴリの台本を1つ生成する
 * @param {string} category - 'male', 'female', 'narration'
 * @returns {Promise<Object|null>} 生成された台本データ
 */
async function generateScript(category) {
    const situations = loadSituations();
    const loadedPrompts = loadPrompts();
    const excludedSituations = loadLastGenerated();
    const todayGenre = getTodayGenre();

    // --- シチュエーション選択 ---
    let situation = '';

    if (category === 'narration') {
        const narrationData = situations.narration || {};
        const allNarrationSituations = Object.values(narrationData).flat();
        if (allNarrationSituations.length === 0) {
            console.error('ナレーションのシチュエーションが見つかりません。');
            return null;
        }
        situation = getRandomItemExcluding(allNarrationSituations, excludedSituations);
    } else {
        const categoryData = situations[category] || {};
        const genreSituations = categoryData[todayGenre] || [];
        if (genreSituations.length === 0) {
            console.error(`${category} の ${todayGenre} シチュエーションが見つかりません。`);
            return null;
        }
        situation = getRandomItemExcluding(genreSituations, excludedSituations);
    }

    // --- プロンプト組み立て ---
    const systemRules = loadedPrompts?.system_rules ? `${loadedPrompts.system_rules}\n\n` : '';
    let prompt = '';
    let usedGenre = '';

    if (category === 'male' || category === 'female') {
        usedGenre = Math.random() < 0.9 ? 'アニメ台詞' : '吹き替え台詞';

        let character = '男性';
        if (category === 'female') {
            character = Math.random() < 0.8 ? '女性キャラクター' : '女性が演じる少年';
        }

        let template;
        if (category === 'male') {
            template = loadedPrompts?.male_prompt || DEFAULT_SCENARIO_TEMPLATE;
        } else {
            template = loadedPrompts?.female_prompt || DEFAULT_SCENARIO_TEMPLATE;
        }

        prompt = systemRules + template
            .replace('{genre}', `${usedGenre}（${todayGenre}）`)
            .replace('{character}', character)
            .replace('{situation}', situation);

    } else if (category === 'narration') {
        usedGenre = 'ナレーション';
        const template = loadedPrompts?.narration_prompt || DEFAULT_NARRATION_TEMPLATE;

        prompt = systemRules + template
            .replace('{genre}', situation)
            .replace('{situation}', situation);
    }

    // --- Gemini API呼び出し ---
    const rawText = await generateText(prompt);
    if (!rawText) return null;

    // --- レスポンス解析 ---
    const lines = rawText.split('\n').map(line => line.trim()).filter(line => line !== '');

    if (lines.length < 3) {
        console.error(`AIの回答が短すぎます(${category}):`, rawText);
        return null;
    }

    let generatedSituation = situation;
    let direction = '';
    let textLines = [];

    for (const line of lines) {
        if (line.startsWith('【シチュエーション】')) {
            generatedSituation = line.replace('【シチュエーション】', '').trim();
        } else if (line.startsWith('【ト書き】')) {
            direction = line.replace('【ト書き】', '').trim();
        } else {
            textLines.push(line);
        }
    }

    // ナレーション台本のセリフ混入チェック
    if (category === 'narration') {
        textLines = textLines.filter(line => {
            if (/「[^」]*」/.test(line)) {
                console.warn(`[ナレーション] セリフ混入を除去: ${line}`);
                return false;
            }
            return true;
        });
    }

    const finalScriptText = textLines.join('\n');

    // 生成履歴に追加保存
    const currentHistory = loadLastGenerated();
    // 今日の日付なら追記、違う日付なら新規
    const todayDate = new Date().toISOString().split('T')[0];
    let existingData = { date: '', used: [] };
    try {
        if (fs.existsSync(lastGeneratedPath)) {
            existingData = JSON.parse(fs.readFileSync(lastGeneratedPath, 'utf-8'));
        }
    } catch (e) { /* ignore */ }

    if (existingData.date === todayDate) {
        existingData.used.push(situation);
    } else {
        existingData = { date: todayDate, used: [situation] };
    }
    saveLastGenerated(existingData.used);

    return {
        text: finalScriptText,
        direction: direction,
        source: `${usedGenre} / ${generatedSituation}`
    };
}

module.exports = {
    generateScript
};
