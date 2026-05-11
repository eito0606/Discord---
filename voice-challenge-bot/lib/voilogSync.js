// lib/voilogSync.js — VoiLog Supabase へのミラー同期
//
// 既存の SQLite ベースのグループ機能は一切変更せず、
// 「成功した処理の後で」呼び出されるオプショナルなミラー書き込み層。
//
// 失敗してもエラーを投げない（console.warn のみ）。
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定なら no-op。
//
// 依存: Node 18+ の built-in fetch（追加 npm パッケージ不要）。

const { getCachedLink } = require('../db');

const VOILOG_SUPABASE_URL = process.env.VOILOG_SUPABASE_URL || '';
const VOILOG_SUPABASE_SERVICE_ROLE_KEY = process.env.VOILOG_SUPABASE_SERVICE_ROLE_KEY || '';

function isEnabled() {
  return !!(VOILOG_SUPABASE_URL && VOILOG_SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Supabase REST API への汎用呼び出し。
 * 失敗時は throw せず、戻り値 { ok: false, error } で返す。
 */
async function rest(method, path, options = {}) {
  if (!isEnabled()) return { ok: false, error: 'voilog sync disabled' };
  const url = VOILOG_SUPABASE_URL.replace(/\/$/, '') + '/rest/v1' + path;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'apikey': VOILOG_SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + VOILOG_SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': options.prefer || 'return=representation',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, status: res.status, error: text };
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Discord ID から VoiLog の Supabase user_id を取得。
 * 1. ローカルキャッシュ (account_link_cache) を確認
 * 2. キャッシュになければ discord_user_links を Supabase に問い合わせ
 */
async function resolveSupabaseUserId(discordUserId) {
  if (!discordUserId) return null;
  try {
    const cached = getCachedLink(discordUserId, 3600);
    if (cached) return cached;
  } catch { /* ignore */ }

  // Supabase 検索（discord_user_links から）
  const result = await rest('GET',
    `/discord_user_links?discord_user_id=eq.${encodeURIComponent(discordUserId)}&select=supabase_user_id`,
    { prefer: '' });
  if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
    return result.data[0].supabase_user_id;
  }
  return null;
}

/**
 * Bot 側でグループが作成されたとき、VoiLog Supabase にもミラー作成。
 *
 * @param {object} payload
 * @param {string|number} payload.discordGroupId - Bot SQLite の groups.id
 * @param {string} payload.ownerDiscordId - Discord owner snowflake
 * @param {string|null} payload.name
 * @param {string} payload.inviteCode - 6桁招待コード
 */
async function mirrorGroupCreate(payload) {
  if (!isEnabled()) return;
  try {
    const ownerSupabaseId = await resolveSupabaseUserId(payload.ownerDiscordId);
    if (!ownerSupabaseId) {
      console.log('[voilog-sync] owner not linked to VoiLog, skip mirror create');
      return;
    }

    const body = [{
      name: payload.name || ('グループ #' + payload.discordGroupId),
      owner_id: ownerSupabaseId,
      invite_code: payload.inviteCode,
      discord_group_id: String(payload.discordGroupId),
      discord_owner_id: payload.ownerDiscordId,
      bridge_source: 'voilab',
    }];

    const result = await rest('POST', '/groups?on_conflict=discord_group_id', {
      body,
      prefer: 'return=representation,resolution=merge-duplicates',
    });

    if (!result.ok) {
      console.warn('[voilog-sync] mirror create failed:', result.error);
      return;
    }

    const voilogGroup = Array.isArray(result.data) ? result.data[0] : result.data;
    if (voilogGroup?.id) {
      // オーナーを group_members に追加
      await rest('POST', '/group_members?on_conflict=group_id,user_id', {
        body: [{
          group_id: voilogGroup.id,
          user_id: ownerSupabaseId,
          role: 'owner',
          discord_user_id: payload.ownerDiscordId,
        }],
        prefer: 'resolution=ignore-duplicates',
      });
    }
    console.log(`[voilog-sync] mirrored group ${payload.discordGroupId} -> ${voilogGroup?.id}`);
  } catch (err) {
    console.warn('[voilog-sync] mirrorGroupCreate exception:', err.message);
  }
}

/**
 * Bot 側でメンバーが追加されたとき、VoiLog 側にも反映。
 */
async function mirrorGroupJoin(payload) {
  if (!isEnabled()) return;
  try {
    const supabaseUserId = await resolveSupabaseUserId(payload.discordUserId);
    if (!supabaseUserId) {
      console.log('[voilog-sync] joiner not linked, skip mirror join');
      return;
    }

    // discord_group_id から VoiLog 側 group を検索
    const lookup = await rest('GET',
      `/groups?discord_group_id=eq.${encodeURIComponent(String(payload.discordGroupId))}&select=id`,
      { prefer: '' });
    if (!lookup.ok || !Array.isArray(lookup.data) || lookup.data.length === 0) return;
    const voilogGroupId = lookup.data[0].id;

    await rest('POST', '/group_members?on_conflict=group_id,user_id', {
      body: [{
        group_id: voilogGroupId,
        user_id: supabaseUserId,
        role: 'member',
        discord_user_id: payload.discordUserId,
      }],
      prefer: 'resolution=ignore-duplicates',
    });
    console.log(`[voilog-sync] mirrored join ${payload.discordUserId} -> group ${voilogGroupId}`);
  } catch (err) {
    console.warn('[voilog-sync] mirrorGroupJoin exception:', err.message);
  }
}

/**
 * Bot 側で個別離脱があったとき、VoiLog 側にも反映。
 */
async function mirrorGroupLeave(payload) {
  if (!isEnabled()) return;
  try {
    const supabaseUserId = await resolveSupabaseUserId(payload.discordUserId);
    if (!supabaseUserId) return;

    const lookup = await rest('GET',
      `/groups?discord_group_id=eq.${encodeURIComponent(String(payload.discordGroupId))}&select=id`,
      { prefer: '' });
    if (!lookup.ok || !Array.isArray(lookup.data) || lookup.data.length === 0) return;
    const voilogGroupId = lookup.data[0].id;

    await rest('DELETE',
      `/group_members?group_id=eq.${voilogGroupId}&user_id=eq.${supabaseUserId}`,
      { prefer: '' });
    console.log(`[voilog-sync] mirrored leave ${payload.discordUserId} from group ${voilogGroupId}`);
  } catch (err) {
    console.warn('[voilog-sync] mirrorGroupLeave exception:', err.message);
  }
}

/**
 * Bot 側でグループが解散されたとき、VoiLog 側でも削除。
 */
async function mirrorGroupDissolve(payload) {
  if (!isEnabled()) return;
  try {
    const lookup = await rest('GET',
      `/groups?discord_group_id=eq.${encodeURIComponent(String(payload.discordGroupId))}&select=id`,
      { prefer: '' });
    if (!lookup.ok || !Array.isArray(lookup.data) || lookup.data.length === 0) return;
    const voilogGroupId = lookup.data[0].id;

    // CASCADE で group_members も自動削除される
    await rest('DELETE', `/groups?id=eq.${voilogGroupId}`, { prefer: '' });
    console.log(`[voilog-sync] mirrored dissolve of group ${voilogGroupId}`);
  } catch (err) {
    console.warn('[voilog-sync] mirrorGroupDissolve exception:', err.message);
  }
}

/**
 * Bot 側でグループ専用チャンネルが作成されたとき、VoiLog にも channel_id を反映。
 */
async function mirrorChannelLink(payload) {
  if (!isEnabled()) return;
  try {
    await rest('PATCH',
      `/groups?discord_group_id=eq.${encodeURIComponent(String(payload.discordGroupId))}`,
      { body: { discord_channel_id: payload.channelId }, prefer: '' });
  } catch (err) {
    console.warn('[voilog-sync] mirrorChannelLink exception:', err.message);
  }
}

module.exports = {
  isEnabled,
  resolveSupabaseUserId,
  mirrorGroupCreate,
  mirrorGroupJoin,
  mirrorGroupLeave,
  mirrorGroupDissolve,
  mirrorChannelLink,
};
