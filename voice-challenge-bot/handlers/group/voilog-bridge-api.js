// handlers/group/voilog-bridge-api.js — VoiLog → Bot Webhook ルート
//
// VoiLog (Web/iOS) でグループ操作があったときに POST される。
// 既存の voipoke/webhook-server.js に同居する形でルートを登録する。
//
// 認証: X-Voilab-Bridge-Secret ヘッダ + 共通シークレット (VOILAB_BRIDGE_SECRET)
//
// エンドポイント:
//   POST /voilog/group-create  - VoiLog でグループ作成
//   POST /voilog/group-join    - VoiLog でメンバー参加
//   POST /voilog/group-leave   - VoiLog でメンバー脱退
//   POST /voilog/group-dissolve - VoiLog でグループ解散

const crypto = require('crypto');
const {
  createGroup,
  findGroupByInviteCode,
  addGroupMember,
  leaveGroup,
  dissolveGroup,
  getGroupsForUser,
  getGroupById,
} = require('../../db');

function verifyBridgeSecret(req) {
  const secret = process.env.VOILAB_BRIDGE_SECRET;
  if (!secret) return false;
  const provided = req.headers['x-voilab-bridge-secret'] || '';
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(secret));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Express アプリにルートを登録する。
 * webhook-server.js から呼ばれる。
 *
 * @param {express.Express} app
 */
function registerVoilogBridgeRoutes(app) {
  // 全 /voilog/* ルートで認証
  app.use('/voilog', (req, res, next) => {
    if (req.path === '/healthz') return next();
    if (!verifyBridgeSecret(req)) {
      console.warn(`[voilog-bridge] rejected ${req.path} (invalid secret)`);
      return res.status(401).json({ error: 'Invalid bridge secret' });
    }
    next();
  });

  app.get('/voilog/healthz', (req, res) => res.json({ ok: true }));

  // ----- POST /voilog/group-create -----
  // VoiLog 側でグループ作成された通知。Bot 側 SQLite にミラー作成。
  // 既に同じ discord_user_id でグループ所有してたら既存を返す。
  //
  // body: { owner_discord_id: string, name?: string, voilog_group_id: string }
  // resp: { ok: true, discord_group_id: number, invite_code: string }
  app.post('/voilog/group-create', (req, res) => {
    try {
      const { owner_discord_id, name, voilog_group_id } = req.body || {};
      if (!owner_discord_id) {
        return res.status(400).json({ error: 'owner_discord_id is required' });
      }

      // 既存グループ確認（オーナーかつ未解散）
      const existing = getGroupsForUser(owner_discord_id)
        .filter((g) => g.owner_user_id === owner_discord_id);

      if (existing.length > 0) {
        const g = existing[0];
        return res.json({
          ok: true,
          discord_group_id: g.id,
          invite_code: g.invite_code,
          existing: true,
        });
      }

      const created = createGroup(owner_discord_id, name || null, 24);
      return res.json({
        ok: true,
        discord_group_id: created.id,
        invite_code: created.code,
        voilog_group_id: voilog_group_id || null,
        existing: false,
      });
    } catch (err) {
      console.error('[voilog-bridge] group-create error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ----- POST /voilog/group-join -----
  // VoiLog 側でメンバーがグループに参加した通知。
  //
  // body: { discord_group_id: number, joiner_discord_id: string }
  // resp: { ok: true, member_count: number }
  app.post('/voilog/group-join', (req, res) => {
    try {
      const { discord_group_id, joiner_discord_id } = req.body || {};
      if (!discord_group_id || !joiner_discord_id) {
        return res.status(400).json({ error: 'discord_group_id and joiner_discord_id required' });
      }
      const result = addGroupMember(parseInt(discord_group_id, 10), joiner_discord_id);
      if (!result.ok) {
        return res.status(409).json({ error: result.reason });
      }
      return res.json({ ok: true, member_count: result.memberCount });
    } catch (err) {
      console.error('[voilog-bridge] group-join error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ----- POST /voilog/group-leave -----
  // VoiLog 側でメンバーが脱退した通知。
  //
  // body: { discord_group_id: number, leaver_discord_id: string }
  app.post('/voilog/group-leave', (req, res) => {
    try {
      const { discord_group_id, leaver_discord_id } = req.body || {};
      if (!discord_group_id || !leaver_discord_id) {
        return res.status(400).json({ error: 'discord_group_id and leaver_discord_id required' });
      }
      const ok = leaveGroup(parseInt(discord_group_id, 10), leaver_discord_id);
      return res.json({ ok });
    } catch (err) {
      console.error('[voilog-bridge] group-leave error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ----- POST /voilog/group-dissolve -----
  // VoiLog 側でグループ解散の通知（オーナーのみ）。
  //
  // body: { discord_group_id: number, requester_discord_id: string }
  app.post('/voilog/group-dissolve', (req, res) => {
    try {
      const { discord_group_id, requester_discord_id } = req.body || {};
      if (!discord_group_id || !requester_discord_id) {
        return res.status(400).json({ error: 'discord_group_id and requester_discord_id required' });
      }
      const result = dissolveGroup(parseInt(discord_group_id, 10), requester_discord_id);
      if (!result.ok) {
        return res.status(409).json({ error: result.reason });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error('[voilog-bridge] group-dissolve error:', err);
      return res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerVoilogBridgeRoutes };
