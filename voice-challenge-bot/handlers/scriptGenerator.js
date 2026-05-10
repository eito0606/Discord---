// handlers/scriptGenerator.js — プロンプトを組み立て、台本を生成するモジュール（v2）
//
// v2 の改善点：
// 1. ジャンル選択を「dayNumber % 5 の固定ローテーション」から「ランダム + 直近14日に同カテゴリで使ったジャンルを除外」へ
// 2. シチュエーション選択を「同日内の重複回避」から「直近7日間に同カテゴリで使った situation_id を除外」へ
// 3. data/situations.json を新フォーマット（{id,title,emotionTag,keywords}の配列）に対応
//    （旧フォーマット：文字列の配列、もフォールバックで読める）
// 4. Gemini呼び出しに temperature/topP を渡してバリエーションを増やす
// 5. last_generated.json の履歴保持を3日 → 14日に拡張（DBが履歴の主源だが、起動直後やDB復旧時のフォールバックとしても残す）

const fs = require('fs');
const path = require('path');
const { generateText } = require('./geminiClient');
const {
    getNextDayNumber,
    getRecentGenresForCategory,
    getRecentSituationIdsForCategory,
} = require('../db');

const situationsPath = path.join(__dirname, '../data/situations.json');
const promptsPath = path.join(__dirname, '../data/prompts.json');
const lastGeneratedPath = path.join(__dirname, '../data/last_generated.json');

// 男女向けに使うジャンル一覧（situations.json の male/female キーと一致）
const ALL_GENRES_MF = ['日常', '恋愛', 'コメディ', '戦闘アクション', 'その他'];

// 「2週間以内に同カテゴリで同ジャンルが再出現しないこと」を実現するための日数
const GENRE_BAN_DAYS = 14;
// 「1週間以内に同カテゴリで同シチュエーションが再出現しないこと」を実現するための日数
const SITUATION_BAN_DAYS = 7;

// Gemini 生成パラメータ（バリエーションを上げる）
const GEMINI_OPTIONS = { temperature: 1.2, topP: 0.95, topK: 40 };

// ============================================
// シチュエーション辞書ローダー（新旧フォーマット両対応）
// ============================================

/**
 * 1ジャンル分のシチュエーション配列を「常に object 配列」に正規化して返す。
 * - 新フォーマット：[{id,title,emotionTag,keywords}, ...] そのまま
 * - 旧フォーマット：["仲間とのふざけ合い", ...] → {id: 自動採番, title: 文字列, emotionTag: 'その他'} に変換
 */
function normalizeSituationList(rawList, idPrefix) {
    if (!Array.isArray(rawList)) return [];
    return rawList.map((item, idx) => {
        if (typeof item === 'string') {
            return {
                id: `${idPrefix}-legacy-${String(idx + 1).padStart(3, '0')}`,
                title: item,
                emotionTag: 'その他',
                keywords: [],
            };
        }
        return {
            id: item.id || `${idPrefix}-auto-${String(idx + 1).padStart(3, '0')}`,
            title: item.title || '（無題）',
            emotionTag: item.emotionTag || 'その他',
            keywords: Array.isArray(item.keywords) ? item.keywords : [],
        };
    });
}

function loadSituations() {
    try {
        const raw = JSON.parse(fs.readFileSync(situationsPath, 'utf-8'));
        // _meta は除外
        const result = { male: {}, female: {}, narration: {} };
        for (const cat of ['male', 'female', 'narration']) {
            const catData = raw[cat] || {};
            for (const genre of Object.keys(catData)) {
                if (genre.startsWith('_')) continue;
                const idPrefix = `${cat}-${genre}`;
                result[cat][genre] = normalizeSituationList(catData[genre], idPrefix);
            }
        }
        return result;
    } catch (error) {
        console.error('シチュエーション読み込み失敗:', error);
        return { male: {}, female: {}, narration: {} };
    }
}

function loadPrompts() {
    try {
        if (fs.existsSync(promptsPath)) {
            return JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
        }
    } catch (error) {
        console.error('プロンプト読み込み失敗:', error);
    }
    return null;
}

// ============================================
// 履歴ファイル（バックアップ用、主源はDB）
// ============================================

function loadHistory() {
    try {
        if (fs.existsSync(lastGeneratedPath)) {
            const raw = JSON.parse(fs.readFileSync(lastGeneratedPath, 'utf-8'));
            return Array.isArray(raw.entries) ? raw : { entries: [] };
        }
    } catch (error) {
        console.error('履歴読み込み失敗:', error);
    }
    return { entries: [] };
}

function saveHistory(history) {
    // 直近14日分だけ残す
    const cutoff = Date.now() - GENRE_BAN_DAYS * 24 * 60 * 60 * 1000;
    history.entries = (history.entries || []).filter((e) => {
        const t = new Date(e.posted_at).getTime();
        return Number.isFinite(t) && t >= cutoff;
    });
    try {
        fs.writeFileSync(lastGeneratedPath, JSON.stringify(history, null, 2));
    } catch (error) {
        console.error('履歴保存失敗:', error);
    }
}

function recordToHistory(entry) {
    const history = loadHistory();
    history.entries = history.entries || [];
    history.entries.push(entry);
    saveHistory(history);
}

// 履歴ファイルから直近 N 日分の値を集める（DBが空のときのフォールバック）
function getFromHistoryFile(category, daysBack, key) {
    const history = loadHistory();
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    const values = new Set();
    for (const e of history.entries || []) {
        if (e.category !== category) continue;
        const t = new Date(e.posted_at).getTime();
        if (!Number.isFinite(t) || t < cutoff) continue;
        if (e[key]) values.add(e[key]);
    }
    return Array.from(values);
}

// ============================================
// ジャンル選択：直近14日で使ったジャンルを除外してランダム
// ============================================

/**
 * 男女向け category（male/female）のジャンルを選ぶ。
 * - DBから直近14日間に同カテゴリで使ったジャンル一覧を取得
 * - 履歴ファイル側の保険も足し合わせる
 * - 5ジャンルから除外して残った中からランダム選択
 * - 5つ全部使い切ってたら（=14日完走）、フォールバックとして全候補から選ぶ
 */
function selectGenre(category) {
    let recent = [];
    try {
        recent = getRecentGenresForCategory(category, GENRE_BAN_DAYS);
    } catch (err) {
        console.warn('[scriptGenerator] DB履歴取得失敗、履歴ファイルにフォールバック:', err.message);
    }
    const fileRecent = getFromHistoryFile(category, GENRE_BAN_DAYS, 'genre');
    const recentSet = new Set([...recent, ...fileRecent]);

    let candidates = ALL_GENRES_MF.filter((g) => !recentSet.has(g));
    if (candidates.length === 0) {
        // 全ジャンル使い切ったら全候補から（実運用ではほぼ起きない）
        candidates = [...ALL_GENRES_MF];
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
}

// ============================================
// シチュエーション選択：直近7日で使った id を除外してランダム
// ============================================

/**
 * pool は object 配列 [{id, title, emotionTag, keywords}, ...]
 */
function selectSituation(pool, category) {
    if (!Array.isArray(pool) || pool.length === 0) return null;

    let recent = [];
    try {
        recent = getRecentSituationIdsForCategory(category, SITUATION_BAN_DAYS);
    } catch (err) {
        console.warn('[scriptGenerator] DB履歴取得失敗:', err.message);
    }
    const fileRecent = getFromHistoryFile(category, SITUATION_BAN_DAYS, 'situation_id');
    const recentSet = new Set([...recent, ...fileRecent]);

    let candidates = pool.filter((s) => !recentSet.has(s.id));
    if (candidates.length === 0) {
        // 候補が枯れたら、直近1日除外にフォールバック
        const recent1 = getFromHistoryFile(category, 1, 'situation_id');
        const recent1Set = new Set(recent1);
        candidates = pool.filter((s) => !recent1Set.has(s.id));
    }
    if (candidates.length === 0) candidates = pool;

    return candidates[Math.floor(Math.random() * candidates.length)];
}

// ============================================
// キャラクター定義（hardcoded、画像生成のためのバリエーション）
// ============================================
const MALE_CHARACTERS = [
    '20代の男性、短い黒髪、カジュアルな服装',
    '10代の男子学生、やや癖のある茶髪、制服姿',
    '30代の男性、短髪、スーツ姿',
    '20代の男性、金髪、ストリート系のファッション',
];

const FEMALE_CHARACTERS = [
    '20代の女性、セミロングの茶髪、オフィスカジュアル',
    '10代の女子学生、黒髪のストレート、セーラー服',
    '10代の女性、ショートヘア、スポーティな服装',
    '20代の女性、ゆるいウェーブヘア、おしゃれなワンピース',
];

const BOY_CHARACTERS = [
    '10代の少年（中性的）、短い髪、活発な服装',
    '10代の少年（大人しい）、少し長めの前髪、制服姿',
];

// デフォルトテンプレート（prompts.json読み込み失敗時のフォールバック）
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

キャラクター名は具体的な名前をつけてください。
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

// ============================================
// メイン関数：generateScript
// ============================================
/**
 * 指定カテゴリの台本を1つ生成する
 * @param {string} category - 'male', 'female', 'narration'
 * @returns {Promise<Object|null>} {
 *   text, direction, source, imagePrompt,
 *   situationId, situationTitle, emotionTag, genre, category
 * }
 */
async function generateScript(category) {
    const situations = loadSituations();
    const loadedPrompts = loadPrompts();

    // --- ジャンル選択 ---
    let genre = '';
    if (category === 'narration') {
        // narration は CM/番組/ドキュメンタリー/エンタメ/その他 のサブジャンルから選ぶ
        const narrationData = situations.narration || {};
        const narrationKeys = Object.keys(narrationData).filter((k) => !k.startsWith('_'));
        if (narrationKeys.length === 0) {
            console.error('ナレーションのデータが見つかりません');
            return null;
        }
        // ナレーションも直近14日除外を適用したい
        let recent = [];
        try { recent = getRecentGenresForCategory('narration', GENRE_BAN_DAYS); } catch {}
        const recentSet = new Set([...recent, ...getFromHistoryFile('narration', GENRE_BAN_DAYS, 'genre')]);
        let candidates = narrationKeys.filter((k) => !recentSet.has(k));
        if (candidates.length === 0) candidates = narrationKeys;
        genre = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
        genre = selectGenre(category);
    }

    // --- シチュエーション選択 ---
    let pool = [];
    if (category === 'narration') {
        pool = situations.narration?.[genre] || [];
    } else {
        pool = situations[category]?.[genre] || [];
    }
    if (pool.length === 0) {
        console.error(`${category}/${genre} のシチュエーションが見つかりません`);
        return null;
    }

    const situation = selectSituation(pool, category);
    if (!situation) {
        console.error(`${category}/${genre} の選択に失敗`);
        return null;
    }

    // --- 履歴ファイルへ記録（DBが主源だが、ファイルも残しておく） ---
    recordToHistory({
        posted_at: new Date().toISOString(),
        category,
        genre,
        situation_id: situation.id,
        situation_title: situation.title,
        emotion_tag: situation.emotionTag,
    });

    // --- プロンプト組み立て ---
    const systemRules = loadedPrompts?.system_rules ? `${loadedPrompts.system_rules}\n\n` : '';
    let prompt = '';
    let usedGenre = '';
    let character = '';

    if (category === 'male' || category === 'female') {
        usedGenre = Math.random() < 0.9 ? 'アニメ台詞' : '吹き替え台詞';

        if (category === 'male') {
            character = MALE_CHARACTERS[Math.floor(Math.random() * MALE_CHARACTERS.length)];
        } else {
            if (Math.random() < 0.8) {
                character = FEMALE_CHARACTERS[Math.floor(Math.random() * FEMALE_CHARACTERS.length)];
            } else {
                character = BOY_CHARACTERS[Math.floor(Math.random() * BOY_CHARACTERS.length)];
            }
        }

        const template = (category === 'male' ? loadedPrompts?.male_prompt : loadedPrompts?.female_prompt)
            || DEFAULT_SCENARIO_TEMPLATE;

        prompt = systemRules + template
            .replace('{genre}', `${usedGenre}（${genre}）`)
            .replace('{character}', character)
            .replace('{situation}', situation.title);

    } else if (category === 'narration') {
        usedGenre = 'ナレーション';
        const template = loadedPrompts?.narration_prompt || DEFAULT_NARRATION_TEMPLATE;

        // ナレーション専用の絶対ルールをプロンプトに追加
        const narrationGuard = `\n\n【絶対厳守】このカテゴリはナレーションです。キャラクターのセリフ（「」で囲んだ発話）は一切含めないでください。すべて三人称の客観的な語りで構成してください。\n\n`;

        prompt = systemRules + narrationGuard + template
            .replace('{genre}', genre)
            .replace('{situation}', situation.title);
    }

    // --- Gemini API呼び出し（temperature 1.2 で多様性を上げる） ---
    console.log(`[台本生成] ${category} / ${genre} / ${situation.title} (${situation.id})`);
    const rawText = await generateText(prompt, GEMINI_OPTIONS);
    if (!rawText) return null;

    // --- レスポンス解析 ---
    const lines = rawText.split('\n').map((line) => line.trim()).filter((line) => line !== '');

    if (lines.length < 3) {
        console.error(`AIの回答が短すぎます(${category}):`, rawText);
        return null;
    }

    let generatedSituation = situation.title;
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
        textLines = textLines.filter((line) => {
            if (/「[^」]*」/.test(line)) {
                console.warn(`[ナレーション] セリフ混入を除去: ${line}`);
                return false;
            }
            return true;
        });
    }

    const finalScriptText = textLines.join('\n');

    // --- 画像生成プロンプトの構築（male/femaleのみ） ---
    let imagePrompt = '';
    if (category === 'male' || category === 'female') {
        imagePrompt = `Character: ${character}. Situation: ${generatedSituation}.`;
    }

    return {
        text: finalScriptText,
        direction,
        source: `${usedGenre} / ${generatedSituation}`,
        imagePrompt,
        // dailyPost.js の saveDailyPost 拡張用メタデータ
        category,
        genre,
        situationId: situation.id,
        situationTitle: situation.title,
        emotionTag: situation.emotionTag,
    };
}

module.exports = { generateScript };
