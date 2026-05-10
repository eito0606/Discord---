// handlers/creator/events.js — クリエイター月次お題（F1 MVP）
//
// 毎月1日10時（JST）に Bot が自動で「今月のお題テーマ」を CREATOR_CHANNEL_ID に投稿する。
// テーマは data/creator-event-themes.json から、過去の使用履歴を見て未使用のものを優先選択。
//
// 重複防止：creator_event_history テーブルで「年月」をユニークキーにし、同月2回投稿は止める。

const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { getCreatorEventForMonth, recordCreatorEvent } = require('../../db');

const themesPath = path.join(__dirname, '../../data/creator-event-themes.json');

function loadThemes() {
    try {
        const raw = fs.readFileSync(themesPath, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('[Creator] テーマ辞書の読み込み失敗:', err.message);
        return [];
    }
}

/**
 * 今月の年月文字列（JST基準）。例：'2026-04'
 */
function getCurrentYearMonth(now = new Date()) {
    const jstOffset = 9 * 60 * 60 * 1000;
    const jst = new Date(now.getTime() + jstOffset);
    const y = jst.getUTCFullYear();
    const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

/**
 * 当月のテーマを選ぶ。
 * 履歴にない id を優先、全部使い終わったら theme_id を新しい順で並べ替えてローテ復元。
 */
function pickThemeForMonth(themes, db) {
    if (themes.length === 0) return null;
    // 履歴から past の theme_id を集める
    let pastThemeIds = [];
    try {
        const rows = db
            .prepare('SELECT theme_id, posted_at FROM creator_event_history ORDER BY posted_at DESC')
            .all();
        pastThemeIds = rows.map((r) => r.theme_id);
    } catch (err) {
        console.warn('[Creator] 履歴取得失敗:', err.message);
    }
    const pastSet = new Set(pastThemeIds);
    const fresh = themes.filter((t) => !pastSet.has(t.id));
    if (fresh.length > 0) {
        return fresh[Math.floor(Math.random() * fresh.length)];
    }
    // 全部使い切り → 一番古いものを再利用
    const ordered = [...pastThemeIds].reverse(); // 古い順
    for (const id of ordered) {
        const t = themes.find((x) => x.id === id);
        if (t) return t;
    }
    return themes[0];
}

/**
 * 月次お題テーマを CREATOR_CHANNEL_ID に投稿する。
 * 同月既に投稿済みなら何もしない（冪等）。
 *
 * @param {Client} client - discord.js の Client
 * @param {object} options - { force?: boolean } force=true なら同月チェックをスキップ
 */
async function postMonthlyTheme(client, options = {}) {
    const { force = false } = options;
    const yearMonth = getCurrentYearMonth();

    if (!force) {
        const exist = getCreatorEventForMonth(yearMonth);
        if (exist) {
            console.log(`[Creator] ${yearMonth} は既に投稿済み (theme=${exist.theme_id})`);
            return { skipped: true, reason: 'already_posted', yearMonth };
        }
    }

    const channelId = process.env.CREATOR_CHANNEL_ID;
    if (!channelId) {
        console.error('[Creator] CREATOR_CHANNEL_ID が未設定');
        return { success: false, error: 'CREATOR_CHANNEL_ID not set' };
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
        console.error(`[Creator] チャンネル取得失敗: ${channelId}`);
        return { success: false, error: 'channel not found' };
    }

    const themes = loadThemes();
    if (themes.length === 0) {
        console.error('[Creator] テーマ辞書が空');
        return { success: false, error: 'no themes' };
    }

    // db を直接使うため遅延 require（循環依存対策）
    const { db } = require('../../db');
    const theme = pickThemeForMonth(themes, db);
    if (!theme) {
        console.error('[Creator] テーマ選択失敗');
        return { success: false, error: 'no theme picked' };
    }

    const monthLabel = yearMonth.split('-')[1].replace(/^0/, '');
    const tagsLine = (theme.tags || []).map((t) => `\`${t}\``).join('  ');

    const embed = new EmbedBuilder()
        .setColor(typeof theme.color === 'number' ? theme.color : 0x1B5E3F)
        .setTitle(`📢 ${monthLabel}月のテーマ：${theme.title}`)
        .setDescription(
            [
                `*${theme.subtitle || ''}*`,
                '',
                theme.description || '',
                '',
                tagsLine ? `🏷️ ${tagsLine}` : '',
                '',
                '今月もみんなの声、楽しみに待ってます🌿',
            ]
                .filter(Boolean)
                .join('\n'),
        )
        .setFooter({ text: 'Reverb Lab｜クリエイター月次お題' })
        .setTimestamp(new Date());

    let message;
    try {
        message = await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('[Creator] 投稿失敗:', err);
        return { success: false, error: err.message };
    }

    try {
        recordCreatorEvent(yearMonth, theme.id, message.id);
    } catch (err) {
        console.error('[Creator] 履歴記録失敗:', err.message);
    }

    console.log(`[Creator] ${yearMonth} のお題投稿完了: ${theme.title} (${theme.id})`);
    return { success: true, yearMonth, themeId: theme.id, messageId: message.id };
}

module.exports = {
    postMonthlyTheme,
    getCurrentYearMonth,
};
