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
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

/**
 * プロンプト（指示の文章）を受け取り、Geminiにテキストを生成させる関数。
 * 
 * @param {string} prompt - AIにお願いする指示の文章
 * @returns {Promise<string|null>} 生成されたテキスト、エラー時はnull
 */
async function generateText(prompt) {
    try {
        // AIにテキスト生成をお願いする（外部のサーバーと通信するので少し待ちます）
        // ⚠️ セキュリティ確認ポイント: ここでプロンプトに含まれる情報だけがGoogleのサーバーに送信されます。
        // 個人情報やサーバーの機密情報は含めないようにしています。
        const result = await model.generateContent(prompt);
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
