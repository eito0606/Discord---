// handlers/surveySheet.js — アンケート回答をGoogleスプレッドシートに記録するモジュール
// GAS（Google Apps Script）で作ったWeb Appに対してデータを送信し、
// スプレッドシートの行として保存してもらいます。

// ==========================================
// スプレッドシートへの記録
// ==========================================

// ⚠️ セキュリティ確認ポイント：
// この関数では、アンケートの回答データ（ユーザー名、ユーザーID、回答内容、AI分析結果）のみを
// GAS Web Appに送信します。Discordトークンやサーバー機密情報は送信しません。
// GAS Web AppのURLは .env ファイルの SURVEY_SHEET_URL に設定します。

/**
 * アンケートの回答データをGAS Web Appに送信し、スプレッドシートに記録する関数。
 *
 * @param {Object} data - スプレッドシートに記録するデータ
 * @param {string} data.timestamp - 回答日時（ISO形式の文字列）
 * @param {string} data.userName - 回答者のDiscord表示名
 * @param {string} data.userId - 回答者のDiscord ID
 * @param {number} data.q1 - Q1の回答（満足度: 1〜5）
 * @param {string} data.q2 - Q2の回答（困った点のテキスト）
 * @param {string} data.q3 - Q3の回答（よく使う機能のテキスト）
 * @param {string} data.q4 - Q4の回答（追加希望のテキスト）
 * @param {string} data.q5 - Q5の回答（自由記述）
 * @param {string} data.priority - AI優先度（高/中/低）
 * @param {string} data.tag - AIタグ（Bot機能/台本/UI/UXなど）
 * @param {string} data.summary - AI要約
 * @param {string} data.actionSuggestion - AI推奨アクション
 * @param {string} data.status - 対応状況（初期値: "未対応"）
 */
async function recordToSheet(data) {
    const sheetUrl = process.env.SURVEY_SHEET_URL;

    // URLが設定されていなければスキップ（開発中はスプレッドシートなしでもBotが動くようにする）
    if (!sheetUrl) {
        console.warn('⚠️ SURVEY_SHEET_URLが設定されていません。スプレッドシート記録をスキップします。');
        return;
    }

    try {
        // fetch（フェッチ）= 外部のサーバーにデータを取りに行く / 送りに行く機能
        // ここではPOSTメソッド（「データを送る」方式）で、GAS Web Appに回答データを送信します
        const response = await fetch(sheetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', // 「送るデータはJSON形式ですよ」というお知らせ
            },
            body: JSON.stringify(data), // JavaScriptのオブジェクトを文字列に変換して送る
        });

        if (!response.ok) {
            throw new Error(`スプレッドシートへの送信に失敗しました（ステータス: ${response.status}）`);
        }

        console.log('📊 アンケート回答をスプレッドシートに記録しました');
    } catch (error) {
        // スプレッドシートへの記録が失敗してもBotは止めない（回答データはEmbed通知で確認できるため）
        console.error('❌ スプレッドシート記録エラー:', error.message);
    }
}

module.exports = {
    recordToSheet,
};
