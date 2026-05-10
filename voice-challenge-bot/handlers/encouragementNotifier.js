// handlers/encouragementNotifier.js — M-6 Phase 3-C: 励まし通知 cron
//
// 毎日 22:00 JST に起動：
//  1) 連続 5日 以上続いていた人で、今日まだ投稿していない人を抽出
//  2) その本人に「あと2時間で今日が終わる」リマインド DM
//  3) その人のグループ仲間にも匿名でやんわり通知（週1回まで、スパム抑止）

const { db } = require('../db');
const { EmbedBuilder } = require('discord.js');

const SPAM_GUARD_KEY = (userId, day) => `enc_${userId}_${day}`;
// メモリ内：同一仲間への DM 送信履歴（週1回まで）
const _sentThisWeek = new Map();

function todayJstDate() {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
}

function withinLastWeek(iso) {
    if (!iso) return false;
    return Date.now() - new Date(iso).getTime() < 7 * 24 * 60 * 60 * 1000;
}

/**
 * 励まし通知本体（cron から毎晩 22:00 JST 呼ばれる）
 */
async function runEncouragementCheck(client) {
    try {
        const today = todayJstDate();

        // 連続 5日 以上の人で、今日まだ参加してない人
        const candidates = db.prepare(`
            SELECT us.user_id, us.current_streak, us.last_participated_date
            FROM user_streaks us
            WHERE us.current_streak >= 5
              AND COALESCE(us.last_participated_date, '') != ?
        `).all(today);

        console.log(`[Encouragement] 候補 ${candidates.length} 名`);

        for (const c of candidates) {
            const userId = c.user_id;

            // 本人へリマインド
            try {
                const user = await client.users.fetch(userId);
                await user.send({
                    embeds: [new EmbedBuilder()
                        .setColor(0xE67E22)
                        .setTitle('⏳ あと2時間で今日が終わるよ')
                        .setDescription([
                            `現在 **${c.current_streak}日連続**。今日もう一声入れておきませんか？`,
                            '',
                            '無理な日は無理でOK。**続けたいなら今夜のうちに**。',
                        ].join('\n'))
                        .setFooter({ text: 'Reverb Lab｜励まし通知' })],
                });
            } catch (err) { /* DM closed: skip */ }

            // グループ仲間にやんわり通知（週1回まで）
            const groups = db.prepare(`
                SELECT g.id FROM groups g
                JOIN group_members m ON m.group_id = g.id
                WHERE m.user_id = ? AND m.left_at IS NULL AND g.dissolved_at IS NULL
            `).all(userId);

            for (const g of groups) {
                const members = db.prepare(`
                    SELECT user_id FROM group_members
                    WHERE group_id = ? AND left_at IS NULL AND user_id != ?
                `).all(g.id, userId);
                for (const m of members) {
                    const key = SPAM_GUARD_KEY(m.user_id, today);
                    if (_sentThisWeek.has(key)) continue;
                    // 週1回チェック：過去7日に同じ人へ DM 送ってたらスキップ
                    let recentlySent = false;
                    for (const [k, sentAt] of _sentThisWeek.entries()) {
                        if (k.startsWith(`enc_${m.user_id}_`) && withinLastWeek(sentAt)) {
                            recentlySent = true;
                            break;
                        }
                    }
                    if (recentlySent) continue;

                    try {
                        const friend = await client.users.fetch(m.user_id);
                        await friend.send({
                            embeds: [new EmbedBuilder()
                                .setColor(0x16A085)
                                .setTitle('🌿 同期のひとりが今日まだ静かみたい')
                                .setDescription([
                                    '同じグループの仲間が、今日まだ投稿していないようです。',
                                    '',
                                    '無理にお節介する必要はないけれど、',
                                    'もし声をかけてあげる気分なら、',
                                    'そっと「今日どう？」って聞いてみるのもいいかもしれません。',
                                    '',
                                    '_この通知は週に1度までです。あなたへの押しつけではありません。_',
                                ].join('\n'))
                                .setFooter({ text: 'Reverb Lab｜仲間サポート' })],
                        });
                        _sentThisWeek.set(key, new Date().toISOString());
                    } catch (err) { /* DM closed: skip */ }
                }
            }
        }
    } catch (err) {
        console.error('[Encouragement] エラー:', err);
    }
}

module.exports = {
    runEncouragementCheck,
};
