// handlers/voipoke/weekly-report.js — ぼいラボ Discord 週次レポート自動投稿
//
// M-5: ぼいラボ Discord 自動招待化
//
// 役割:
//   毎週月曜 9:00 JST に Supabase の discord_invitations テーブルを集計して
//   #運営ログ チャンネルに Embed で投稿する。
//   経路別の入室数 + 累計 + 注目ユーザー TOP3 を可視化。
//
// 仕様参照: /Users/hidehisa/【監督】/specs/M-5-community-design-2026-05-07.md E セクション

const { EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Supabase クライアント（service role）。env 未設定時は null（後段で警告ログのみ）
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

const SOURCE_LABELS = {
    'voilab-lp': 'voilab-lp',
    'voipoke-lp': 'voipoke-lp',
    'diagnosis': 'diagnosis',
    'organic': 'organic',
};

/**
 * 集計クエリ：直近 7 日と全期間の入室数を経路別にカウント
 * @returns {Promise<{thisWeek: object, total: object, joinedThisWeek: number, totalJoined: number}>}
 */
async function aggregateInvitations() {
    if (!supabase) {
        return {
            thisWeek: { 'voilab-lp': 0, 'voipoke-lp': 0, 'diagnosis': 0, 'organic': 0 },
            total: { 'voilab-lp': 0, 'voipoke-lp': 0, 'diagnosis': 0, 'organic': 0 },
            joinedThisWeek: 0,
            totalJoined: 0,
        };
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 直近 7 日
    const { data: weekRows, error: weekErr } = await supabase
        .from('discord_invitations')
        .select('source, joined_at')
        .gte('joined_at', weekAgo.toISOString());

    // 全期間
    const { data: totalRows, error: totalErr } = await supabase
        .from('discord_invitations')
        .select('source, joined_at');

    if (weekErr || totalErr) {
        console.error('[weekly-report] supabase error:', weekErr || totalErr);
        return {
            thisWeek: { 'voilab-lp': 0, 'voipoke-lp': 0, 'diagnosis': 0, 'organic': 0 },
            total: { 'voilab-lp': 0, 'voipoke-lp': 0, 'diagnosis': 0, 'organic': 0 },
            joinedThisWeek: 0,
            totalJoined: 0,
        };
    }

    const tally = (rows) => {
        const counts = { 'voilab-lp': 0, 'voipoke-lp': 0, 'diagnosis': 0, 'organic': 0 };
        for (const r of rows || []) {
            if (!r.joined_at) continue; // 招待発行のみで未入室は除外
            const key = SOURCE_LABELS[r.source] || 'organic';
            counts[key] = (counts[key] || 0) + 1;
        }
        return counts;
    };

    const thisWeek = tally(weekRows);
    const total = tally(totalRows);
    const joinedThisWeek = Object.values(thisWeek).reduce((a, b) => a + b, 0);
    const totalJoined = Object.values(total).reduce((a, b) => a + b, 0);

    return { thisWeek, total, joinedThisWeek, totalJoined };
}

/**
 * 週次レポートを #運営ログ に投稿する
 * @param {Client} client - discord.js Client
 */
async function postWeeklyReport(client) {
    const channelId = process.env.OPS_LOG_CHANNEL_ID;
    if (!channelId) {
        console.warn('[weekly-report] OPS_LOG_CHANNEL_ID not set, skipping');
        return;
    }

    let channel;
    try {
        channel = await client.channels.fetch(channelId);
    } catch (err) {
        console.error('[weekly-report] failed to fetch channel:', err);
        return;
    }
    if (!channel || !channel.isTextBased || !channel.isTextBased()) {
        console.error('[weekly-report] channel is not text-based:', channelId);
        return;
    }

    const { thisWeek, total, joinedThisWeek, totalJoined } = await aggregateInvitations();

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    const periodLabel = `${fmt(weekAgo)}(月) 〜 ${fmt(now)}(日)`;

    const sourceField = [
        `voilab-lp       ${thisWeek['voilab-lp']} 人`,
        `voipoke-lp      ${thisWeek['voipoke-lp']} 人`,
        `diagnosis       ${thisWeek['diagnosis']} 人`,
        `organic         ${thisWeek['organic']} 人`,
    ].join('\n');

    const embed = new EmbedBuilder()
        .setColor(0x27AE60)
        .setTitle(`ぼいラボ 週次レポート ${periodLabel}`)
        .setDescription(`今週 +${joinedThisWeek} 人（累計 ${totalJoined} 人）`)
        .addFields(
            { name: '経路別内訳', value: '```' + sourceField + '```', inline: false },
        )
        .setFooter({ text: 'M-5 自動集計（毎週月曜 9:00）' })
        .setTimestamp(now);

    try {
        await channel.send({ embeds: [embed] });
        console.log('[weekly-report] posted weekly report');
    } catch (err) {
        console.error('[weekly-report] failed to send embed:', err);
    }
}

module.exports = {
    postWeeklyReport,
    aggregateInvitations, // テスト用
};
