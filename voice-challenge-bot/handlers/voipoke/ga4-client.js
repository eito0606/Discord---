// handlers/voipoke/ga4-client.js — Google Analytics 4 Data API ラッパー
//
// M-5 週次レポート用：voilab-lp / voipoke-lp / ぼいフォリオ / VoiPoke iOS の
// 直近 N 日 KPI を一括取得する。
//
// 認証:
//   GOOGLE_APPLICATION_CREDENTIALS_JSON 環境変数に Firebase サービスアカウント JSON を貼る
//   （Vercel のように1行 JSON で扱える形）。
//   または GOOGLE_APPLICATION_CREDENTIALS にファイルパスでも可。
//
// 必要環境変数:
//   GA4_PROPERTY_ID_VOILAB_LP   - voilab-lp の GA4 プロパティ ID（数値）
//   GA4_PROPERTY_ID_VOIPOKE_LP  - voipoke-lp の GA4 プロパティ ID
//   GA4_PROPERTY_ID_VOIFOLIO    - ぼいフォリオの GA4 プロパティ ID
//   GA4_PROPERTY_ID_VOIPOKE_IOS - VoiPoke iOS（Firebase 連携済）の GA4 プロパティ ID
//
// 未設定のプロパティは集計対象から自動的に外れる（エラーにしない）。

const { BetaAnalyticsDataClient } = require('@google-analytics/data');

let _client = null;

function getClient() {
    if (_client) return _client;

    const jsonStr = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (jsonStr) {
        // 環境変数 JSON 文字列から認証
        let credentials;
        try {
            credentials = JSON.parse(jsonStr);
        } catch (err) {
            console.error('[ga4-client] GOOGLE_APPLICATION_CREDENTIALS_JSON parse error:', err);
            return null;
        }
        // private_key は \n がエスケープされてくる場合があるので戻す
        if (credentials.private_key && credentials.private_key.includes('\\n')) {
            credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
        }
        _client = new BetaAnalyticsDataClient({ credentials });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        // ファイルパス指定（標準動作）
        _client = new BetaAnalyticsDataClient();
    } else {
        return null;
    }
    return _client;
}

/**
 * GA4 から直近 N 日のサマリを取得
 * @param {string} propertyId - 例: '123456789'
 * @param {number} daysBack - 例: 7
 * @returns {Promise<{pageviews:number, users:number, sessions:number}|null>}
 */
async function fetchSummary(propertyId, daysBack = 7) {
    const client = getClient();
    if (!client || !propertyId) return null;

    try {
        const [response] = await client.runReport({
            property: `properties/${propertyId}`,
            dateRanges: [{ startDate: `${daysBack}daysAgo`, endDate: 'today' }],
            metrics: [
                { name: 'screenPageViews' },
                { name: 'totalUsers' },
                { name: 'sessions' },
            ],
        });

        const row = response.rows && response.rows[0];
        if (!row) return { pageviews: 0, users: 0, sessions: 0 };

        const vals = row.metricValues.map(v => parseInt(v.value || '0', 10));
        return {
            pageviews: vals[0] || 0,
            users: vals[1] || 0,
            sessions: vals[2] || 0,
        };
    } catch (err) {
        console.error(`[ga4-client] fetchSummary failed for ${propertyId}:`, err.message);
        return null;
    }
}

/**
 * GA4 から特定イベントの直近 N 日カウントを取得
 * @param {string} propertyId
 * @param {string} eventName 例: 'discord_invite_click', 'diagnosis_complete'
 * @param {number} daysBack
 * @returns {Promise<number>}
 */
async function fetchEventCount(propertyId, eventName, daysBack = 7) {
    const client = getClient();
    if (!client || !propertyId) return 0;

    try {
        const [response] = await client.runReport({
            property: `properties/${propertyId}`,
            dateRanges: [{ startDate: `${daysBack}daysAgo`, endDate: 'today' }],
            metrics: [{ name: 'eventCount' }],
            dimensions: [{ name: 'eventName' }],
            dimensionFilter: {
                filter: {
                    fieldName: 'eventName',
                    stringFilter: { matchType: 'EXACT', value: eventName },
                },
            },
        });
        const row = response.rows && response.rows[0];
        if (!row) return 0;
        return parseInt(row.metricValues[0].value || '0', 10);
    } catch (err) {
        console.error(`[ga4-client] fetchEventCount failed for ${propertyId}/${eventName}:`, err.message);
        return 0;
    }
}

/**
 * 全 4 サイト/アプリの週次サマリを並列取得。
 * 未設定プロパティは結果に含まれない。
 * @param {number} daysBack
 * @returns {Promise<{[serviceName: string]: {pageviews,users,sessions}}>}
 */
async function fetchAllServicesSummary(daysBack = 7) {
    const services = [
        { key: 'voilab-lp', envName: 'GA4_PROPERTY_ID_VOILAB_LP' },
        { key: 'voipoke-lp', envName: 'GA4_PROPERTY_ID_VOIPOKE_LP' },
        { key: 'voifolio', envName: 'GA4_PROPERTY_ID_VOIFOLIO' },
        { key: 'voipoke-ios', envName: 'GA4_PROPERTY_ID_VOIPOKE_IOS' },
    ];
    const result = {};
    await Promise.all(services.map(async (s) => {
        const propertyId = process.env[s.envName];
        if (!propertyId) return;
        const summary = await fetchSummary(propertyId, daysBack);
        if (summary) result[s.key] = summary;
    }));
    return result;
}

module.exports = {
    fetchSummary,
    fetchEventCount,
    fetchAllServicesSummary,
};
