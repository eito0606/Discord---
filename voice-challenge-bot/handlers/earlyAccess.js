// handlers/earlyAccess.js — アーリーアクセス（Reverb Lab 早期メンバー）ロール付与
//
// 動作概要：
//   1. 一括付与コマンド（!grant_early_role_all）で既存メンバー全員にロール付与
//   2. 以降の新規参加者は GuildMemberAdd イベントで自動付与
//   3. VoiPoke ローンチ時、early_members テーブルから対象者を引いて訴求DM配信予定
//
// LP経由判定はしない（Discord招待リンクは1本のみ）。
// 一括付与日以降の参加者は全員「LP経由 or 直接、結果オーライ」として扱う。

const { recordEarlyMember } = require('../db');

const ROLE_ID = process.env.EARLY_ACCESS_ROLE_ID || null;

/**
 * 1人のメンバーにロール付与＋DB記録を行う。冪等。
 *
 * @param {GuildMember} member - 対象メンバー
 * @param {'existing'|'auto_join'|'manual'} source - 付与経路
 * @returns {Promise<{ ok: boolean, alreadyHadRole: boolean, alreadyInDb: boolean, error?: string }>}
 */
async function grantEarlyRole(member, source = 'manual') {
  if (!ROLE_ID) {
    return { ok: false, alreadyHadRole: false, alreadyInDb: false, error: 'EARLY_ACCESS_ROLE_ID 未設定' };
  }
  if (!member || member.user?.bot) {
    return { ok: false, alreadyHadRole: false, alreadyInDb: false, error: 'bot or null member' };
  }

  const alreadyHadRole = member.roles.cache.has(ROLE_ID);
  if (!alreadyHadRole) {
    try {
      await member.roles.add(ROLE_ID, `早期メンバー自動付与 (source=${source})`);
    } catch (err) {
      return { ok: false, alreadyHadRole: false, alreadyInDb: false, error: err.message };
    }
  }

  const { inserted } = recordEarlyMember(member.id, source);
  return { ok: true, alreadyHadRole, alreadyInDb: !inserted };
}

/**
 * ギルドの全メンバーにロール付与する。一括付与コマンド用。
 *
 * @param {Guild} guild
 * @returns {Promise<{ granted: number, alreadyHad: number, botSkipped: number, errors: number, total: number }>}
 */
async function grantAllExisting(guild) {
  if (!ROLE_ID) {
    throw new Error('EARLY_ACCESS_ROLE_ID 未設定');
  }

  // 全メンバー取得（GuildMembers Intent + fetch が必要）
  const members = await guild.members.fetch();

  let granted = 0;
  let alreadyHad = 0;
  let botSkipped = 0;
  let errors = 0;

  for (const [, member] of members) {
    if (member.user.bot) {
      botSkipped++;
      continue;
    }
    const result = await grantEarlyRole(member, 'existing');
    if (!result.ok) {
      errors++;
      console.warn(`[EarlyAccess] 付与失敗 ${member.user.tag}: ${result.error}`);
      continue;
    }
    if (result.alreadyHadRole) {
      alreadyHad++;
    } else {
      granted++;
    }
  }

  return { granted, alreadyHad, botSkipped, errors, total: members.size };
}

/**
 * GuildMemberAdd イベント時に自動付与するハンドラを Client に登録する。
 *
 * @param {Client} client
 */
function setupAutoGrantOnJoin(client) {
  if (!ROLE_ID) {
    console.warn('[EarlyAccess] EARLY_ACCESS_ROLE_ID 未設定のため自動付与は無効');
    return;
  }
  client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    const result = await grantEarlyRole(member, 'auto_join');
    if (result.ok) {
      console.log(`[EarlyAccess] 自動付与: ${member.user.tag} (alreadyHadRole=${result.alreadyHadRole})`);
    } else {
      console.warn(`[EarlyAccess] 自動付与失敗 ${member.user.tag}: ${result.error}`);
    }
  });
  console.log('[EarlyAccess] GuildMemberAdd 自動付与ハンドラを登録しました');
}

module.exports = {
  grantEarlyRole,
  grantAllExisting,
  setupAutoGrantOnJoin,
};
