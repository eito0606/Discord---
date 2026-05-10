// handlers/geminiClient.js — Gemini APIと通信してテキストを生成するモジュール
// Google AIの機能を使って、与えられたプロンプトから台本を作成します。

const { GoogleGenerativeAI } = require('@google/generative-ai');

// .envファイルからAPIキーを読み込みます
const apiKey = process.env.GEMINI_API_KEY;

// APIキーが設定されていない場合は警告を出します
if (!apiKey) {
    console.warn('⚠️ 警告: GEMINI_API_KEYが.envに設定されていません。Gemini APIによる自動生成は機能しません。');
}

// Gemini APIを使うための準備（初期化）
const genAI = new GoogleGenerativeAI(apiKey);

// 使用するAIモデルを指定（高速でコストパフォーマンスに優れた flash モデルを使用）
// ※ 2026/04/26 時点では gemini-3.0-flash は API 公開未対応のため 2.5-flash を使用
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

/**
 * プロンプト（指示の文章）を受け取り、Geminiにテキストを生成させる関数。
 *
 * @param {string} prompt - AIにお願いする指示の文章
 * @param {object} [options] - 生成パラメータ（任意）
 * @param {number} [options.temperature] - 多様性の調整（0.0〜2.0、デフォルト未指定）
 * @param {number} [options.topP] - サンプリングの累積確率（0.0〜1.0）
 * @param {number} [options.topK] - サンプリングのトップK
 * @returns {Promise<string|null>} 生成されたテキスト、エラー時はnull
 */
async function generateText(prompt, options = {}) {
    try {
        // generationConfig を組み立て（指定された値だけ渡す）
        const generationConfig = {};
        if (typeof options.temperature === 'number') generationConfig.temperature = options.temperature;
        if (typeof options.topP === 'number') generationConfig.topP = options.topP;
        if (typeof options.topK === 'number') generationConfig.topK = options.topK;

        const requestPayload = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
        if (Object.keys(generationConfig).length > 0) {
            requestPayload.generationConfig = generationConfig;
        }

        // AIにテキスト生成をお願いする（外部のサーバーと通信するので少し待ちます）
        // ⚠️ セキュリティ確認ポイント: ここでプロンプトに含まれる情報だけがGoogleのサーバーに送信されます。
        // 個人情報やサーバーの機密情報は含めないようにしています。
        const result = await model.generateContent(requestPayload);
        const response = await result.response;
        const text = response.text();
        return text;
    } catch (error) {
        console.error('Gemini APIの呼び出し中にエラーが発生しました:', error);
        return null;
    }
}

module.exports = {
    generateText,
};
