// handlers/voipoke/weekly-report.js — ぼいラボ × 全ツール 週次レポート
//
// M-5 フェーズ B 完全版：
//   ① Discord 経路別入室数（discord_invitations）
//   ② アクティブ率（user_participation, 直近7日）
//   ③ 今週の注目 TOP3（user_participation の投稿数最多）
//   ④ サイト・アプリ KPI（GA4 Data API → voilab-lp / voipoke-lp / voifolio / VoiPoke iOS）
//   ⑤ 先週比（必要に応じて拡張）
//
// 起動：cron.js から毎週月曜 9:00 JST に呼び出される。
// 投稿先：OPS_LOG_CHANNEL_ID（#運営ログ）。

const { EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const {
    getActiveUserIdsSince,
    getTopParticipantsSince,
    countParticipationSince,
} = require('../../db');
const { fetchAllServicesSummary } = require('./ga4-client');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

const SOURCES = ['voilab-lp', 'voipoke-lp', 'diagnosis', 'organic'];

// ════════════════════════════════════════════════
// ① Discord 経路別入室数
// ════════════════════════════════════════════════
async function aggregateDiscordInvitations() {
    const empty = { thisWeek: zeroSources(), total: zeroSources(), joinedThisWeek: 0, totalJoined: 0 };
    if (!supabase) return empty;

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [{ data: weekRows, error: weekErr }, { data: totalRows, error: totalErr }] = await Promise.all([
        supabase.from('discord_invitations').select('source, joined_at').gte('joined_at', weekAgo.toISOString()),
        supabase.from('discord_invitations').select('source, joined_at'),
    ]);

    if (weekErr || totalErr) {
        console.error('[weekly-report] supabase error:', weekErr || totalErr);
        return empty;
    }

    const tally = (rows) => {
        const counts = zeroSources();
        for (const r of rows || []) {
            if (!r.joined_at) continue;
            const key = SOURCES.includes(r.source) ? r.source : 'organic';
            counts[key] = (counts[key] || 0) + 1;
        }
        return counts;
    };

    const thisWeek = tally(weekRows);
    const total = tally(totalRows);
    return {
        thisWeek,
        total,
        joinedThisWeek: sumValues(thisWeek),
        totalJoined: sumValues(total),
    };
}

// ════════════════════════════════════════════════
// ② アクティブ率（直近 7 日）
// ════════════════════════════════════════════════
function aggregateActivity() {
    const activeIds = getActiveUserIdsSince(7);
    const totalPosts = countParticipationSince(7);
    return {
        activeUserCount: activeIds.length,
        totalPosts,
    };
}

// ════════════════════════════════════════════════
// ③ 今週の注目 TOP3
// ════════════════════════════════════════════════
function aggregateTopUsers() {
    return getTopParticipantsSince(7, 3); // [{ user_id, cnt }, ...]
}

// ════════════════════════════════════════════════
// ④ サイト・アプリ KPI（GA4）
// ════════════════════════════════════════════════
async function aggregateAnalytics() {
    try {
        return await fetchAllServicesSummary(7);
    } catch (err) {
        console.error('[weekly-report] GA4 fetch failed:', err);
        return {};
    }
}

// ════════════════════════════════════════════════
// 投稿
// ════════════════════════════════════════════════
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

    // 4 ブロックを並列取得（GA4 が遅いので並列が効く）
    const [invites, analytics] = await Promise.all([
        aggregateDiscordInvitations(),
        aggregateAnalytics(),
    ]);
    const activity = aggregateActivity();
    const topUsers = aggregateTopUsers();

    // ──── Embed 組み立て ────
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    const period = `${fmt(weekAgo)}(月) 〜 ${fmt(now)}(日)`;

    const embed = new EmbedBuilder()
        .setColor(0x27AE60)
        .setTitle(`ぼいラボ × 全ツール 週次レポート`)
        .setDescription(`期間: **${period}**`)
        .setFooter({ text: 'M-5 自動集計（毎週月曜 9:00）' })
        .setTimestamp(now);

    // ① Discord
    const inviteField = [
        `今週 +${invites.joinedThisWeek} 人（累計 ${invites.totalJoined} 人）`,
        '```',
        `voilab-lp     ${invites.thisWeek['voilab-lp']} 人`,
        `voipoke-lp    ${invites.thisWeek['voipoke-lp']} 人`,
        `diagnosis     ${invites.thisWeek['diagnosis']} 人`,
        `organic       ${invites.thisWeek['organic']} 人`,
        '```',
    ].join('\n');
    embed.addFields({ name: '📥 Discord 入室', value: inviteField, inline: false });

    // ② アクティブ
    embed.addFields({
        name: '🔥 投稿アクティビティ（直近7日）',
        value: `アクティブユーザー: **${activity.activeUserCount} 人**\n総投稿数: **${activity.totalPosts} 件**`,
        inline: false,
    });

    // ③ TOP3
    const topField = topUsers.length === 0
        ? '（投稿なし）'
        : topUsers.map((u, i) => `${i + 1}. <@${u.user_id}> — ${u.cnt} 投稿`).join('\n');
    embed.addFields({ name: '🏆 今週の注目', value: topField, inline: false });

    // ④ サイト KPI
    const services = [
        { key: 'voifolio', label: 'ぼいフォリオ' },
        { key: 'voilab-lp', label: 'voilab-lp' },
        { key: 'voipoke-lp', label: 'voipoke-lp' },
        { key: 'voipoke-ios', label: 'VoiPoke iOS' },
    ];
    const lines = [];
    for (const s of services) {
        const m = analytics[s.key];
        if (!m) {
            lines.push(`${s.label.padEnd(14)} （未計測）`);
        } else {
            lines.push(`${s.label.padEnd(14)} PV ${m.pageviews} / UU ${m.users}`);
        }
    }
    embed.addFields({
        name: '🌐 サイト・アプリ KPI（直近7日）',
        value: '```' + lines.join('\n') + '```',
        inline: false,
    });

    try {
        await channel.send({ embeds: [embed] });
        console.log('[weekly-report] posted weekly report');
    } catch (err) {
        console.error('[weekly-report] failed to send embed:', err);
    }
}

// ════════════════════════════════════════════════
// helpers
// ════════════════════════════════════════════════
function zeroSources() {
    return { 'voilab-lp': 0, 'voipoke-lp': 0, 'diagnosis': 0, 'organic': 0 };
}
function sumValues(obj) {
    return Object.values(obj).reduce((a, b) => a + (b || 0), 0);
}

module.exports = {
    postWeeklyReport,
    aggregateDiscordInvitations,
    aggregateActivity,
    aggregateTopUsers,
    aggregateAnalytics,
};
