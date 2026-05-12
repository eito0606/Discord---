// db.js — データベース（SQLite）の準備と、データの読み書きをするためのモジュール
// SQLiteは、1つのファイル（ここではdatabase.db）にデータをまとめて保存できる、軽くて手軽なデータベースです。

const Database = require('better-sqlite3');
const path = require('path');

// データベースファイルの保存先を決める
// path.joinを使うと、OSごとのファイルパスの違い（\や/）を自動で直してくれます。
const dbPath = path.join(__dirname, 'database.db');

// データベースを開く（ファイルが無ければ自動で作ってくれる）
const db = new Database(dbPath);

// ==========================================
// 1. テーブル（表）を作成する準備
// ==========================================
// データベースはExcelのシートのような「テーブル」にデータを保存します。
// 最初にその「枠組み（カラム）」を作っておく必要があります。

// IF NOT EXISTS: 「もしそのテーブルが無ければ」作るという指定（2回目以降は無視される）
db.exec(`
  -- お題投稿の履歴（いつ、どのお題を投稿し、通算何日目か）
  CREATE TABLE IF NOT EXISTS daily_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_number INTEGER NOT NULL,
    script_id INTEGER NOT NULL,
    message_id TEXT NOT NULL,
    posted_at TEXT NOT NULL
  );

  -- ユーザー参加記録（誰が、いつ、どこに投稿したか）
  -- 2チャンネル対応用に channel_id を追加しています
  CREATE TABLE IF NOT EXISTS user_participation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    participated_date TEXT NOT NULL,
    message_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, participated_date) -- 同じ日に2回投稿しても1回しか保存しないためのガード
  );

  -- ユーザー連続記録（現在の連続日数、最高記録など）
  CREATE TABLE IF NOT EXISTS user_streaks (
    user_id TEXT PRIMARY KEY,
    current_streak INTEGER DEFAULT 0,
    max_streak INTEGER DEFAULT 0,
    total_days INTEGER DEFAULT 0,
    last_participated_date TEXT,
    updated_at TEXT NOT NULL
  );

  -- ロール付与履歴（誰が、どのロールを、いつもらったか）
  CREATE TABLE IF NOT EXISTS role_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role_name TEXT NOT NULL,
    streak_days INTEGER NOT NULL,
    granted_at TEXT NOT NULL,
    UNIQUE(user_id, role_name) -- 同じロールを2回付与しないためのガード
  );

  -- ニュース投稿履歴（重複投稿を防ぐためにURLを記録）
  CREATE TABLE IF NOT EXISTS posted_news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_url TEXT NOT NULL UNIQUE,
    article_title TEXT NOT NULL,
    source_name TEXT NOT NULL,
    posted_at TEXT NOT NULL
  );

  -- アンケート回答クールダウン管理（同じユーザーが7日以内に再回答するのを防ぐ）
  CREATE TABLE IF NOT EXISTS survey_cooldowns (
    user_id TEXT PRIMARY KEY,
    last_survey_at TEXT NOT NULL
  );

  -- ==========================================
  -- 声劇イベント管理テーブル
  -- ==========================================

  -- 声劇イベント本体（どんなイベントが立ち上がったかの記録表）
  CREATE TABLE IF NOT EXISTS voice_drama_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_user_id TEXT NOT NULL,          -- 主催者のDiscord ID
    recruit_message_id TEXT,             -- 募集メッセージのID（リアクション検知に使う）
    recruit_channel_id TEXT,             -- 募集メッセージがあるチャンネルのID
    stage_channel_id TEXT,               -- ステージチャンネルのID
    event_title TEXT,                    -- イベント名（台本名）
    event_datetime TEXT,                 -- 開演日時（ISO 8601形式）
    status TEXT DEFAULT 'recruiting',    -- ステータス: recruiting → confirmed → performing → archived
    characters TEXT NOT NULL,            -- JSON文字列: [{name, gender, emoji}] — 登場人物リスト
    reminder_sent_1h INTEGER DEFAULT 0,  -- 1時間前リマインド送信済みフラグ（0=未送信, 1=送信済み）
    reminder_sent_10m INTEGER DEFAULT 0, -- 10分前リマインド送信済みフラグ
    -- M-6 Phase 2-C: 'performance'（本番）/ 'practice'（練習回、リマインド省略）
    event_kind TEXT DEFAULT 'performance',
    -- M-6 Phase 3-D: X / Discord Stage 配信の許可状況（JSON配列で許可済キャストID保存）
    broadcast_consents TEXT,
    broadcast_status TEXT DEFAULT 'not_requested', -- not_requested / pending / consented / broadcasting / done
    created_at TEXT NOT NULL
  );

  -- 声劇参加者テーブル（誰がどの役に立候補・確定したかの記録）
  CREATE TABLE IF NOT EXISTS voice_drama_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,           -- どのイベントに対する参加か
    user_id TEXT NOT NULL,               -- 参加者のDiscord ID
    character_name TEXT NOT NULL,        -- 担当する（or 希望する）役名
    status TEXT DEFAULT 'candidate',     -- candidate（立候補中）→ confirmed（確定）→ rejected（落選）
    created_at TEXT NOT NULL,
    FOREIGN KEY (event_id) REFERENCES voice_drama_events(id),
    UNIQUE(event_id, user_id, character_name) -- 同じ人が同じ役に2回立候補するのを防ぐ
  );

  -- ==========================================
  -- Reverb ニュース管理テーブル
  -- ==========================================

  -- Reverb アップデート受信履歴
  -- webhook で各ツールから届いたアップデート情報の保管庫。
  -- 「今日アップデート投稿があったか？」を21時のフォールバック判定で参照する。
  CREATE TABLE IF NOT EXISTS reverb_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool TEXT NOT NULL,                  -- VoiPoke / VoiLog / ぼいラボ / ぼいフォリオ / キャラビジュ
    type TEXT NOT NULL,                  -- feature / fix / release / campaign
    title TEXT NOT NULL,                 -- アップデートのタイトル
    body TEXT,                           -- 本文（Embed の description に入る）
    link TEXT,                           -- 詳細リンク
    thumbnail TEXT,                      -- サムネイル画像URL
    message_id TEXT,                     -- 投稿後のDiscordメッセージID
    posted_at TEXT NOT NULL,             -- 投稿日時（ISO 8601）
    is_test INTEGER NOT NULL DEFAULT 0   -- 1 なら !testreverb_update 由来。21時フォールバック判定で無視する
  );

  -- Reverb ローテーション履歴
  -- ペルソナ × ツール の組み合わせを直近で使ったか記録し、
  -- 同じ組み合わせが連続しないように制御する。
  CREATE TABLE IF NOT EXISTS reverb_rotation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    persona_id TEXT NOT NULL,            -- mio_21 など
    tool_id TEXT NOT NULL,               -- voipoke / voilog / voilab / voiforio / charavisu
    posted_at TEXT NOT NULL,
    message_id TEXT
  );

  -- ==========================================
  -- ボイスサンプルチャレンジ：リスナー提案
  -- ==========================================
  -- 「こんなふうに読んでみて！」ボタンの履歴。
  -- 投稿者にDM送信されたリスナーの読み方提案を記録する。
  CREATE TABLE IF NOT EXISTS voice_sample_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,            -- 対象ボイスサンプルメッセージID
    suggester_id TEXT NOT NULL,          -- 提案したリスナーのDiscord ID
    poster_id TEXT NOT NULL,             -- 投稿者のDiscord ID
    suggestion_text TEXT NOT NULL,       -- 提案内容
    delivered INTEGER DEFAULT 1,         -- 投稿者DMに届いたか（1=届いた / 0=DM拒否で失敗）
    created_at TEXT NOT NULL
  );

  -- ==========================================
  -- クリエイター月次お題：投稿履歴
  -- ==========================================
  -- 月初に同月の重複投稿を防ぐためのガード。
  CREATE TABLE IF NOT EXISTS creator_event_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year_month TEXT NOT NULL UNIQUE,     -- '2026-04' 形式
    theme_id TEXT NOT NULL,              -- creator-event-themes.json の id
    message_id TEXT,                     -- 投稿後のDiscordメッセージID
    posted_at TEXT NOT NULL
  );

  -- ==========================================
  -- アーリーアクセス（Reverb Lab 早期メンバー）
  -- ==========================================
  -- VoiPoke ローンチ時に「クリエイター有料プラン3ヶ月無料」訴求対象。
  -- 一括付与コマンドの実行日以降に参加した人は GuildMemberAdd で自動付与される。
  CREATE TABLE IF NOT EXISTS early_members (
    user_id TEXT PRIMARY KEY,            -- DiscordユーザーID
    granted_at TEXT NOT NULL,            -- 付与日時（ISO 8601）
    source TEXT NOT NULL                 -- 'existing' | 'auto_join' | 'manual'
  );

  -- ==========================================
  -- 養成所同期ペアリング機能（A案）
  -- ==========================================

  -- 招待コード（24時間有効）
  CREATE TABLE IF NOT EXISTS pair_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,           -- 6桁の招待コード
    inviter_user_id TEXT NOT NULL,       -- 招待した人
    used_by_user_id TEXT,                -- 使った人（NULL=未使用）
    expires_at TEXT NOT NULL,            -- 24時間後の失効日時
    created_at TEXT NOT NULL,
    used_at TEXT
  );

  -- 同期ペア（双方向、各ユーザーは複数ペアを持てる）
  CREATE TABLE IF NOT EXISTS pair_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a_id TEXT NOT NULL,             -- ペアの片方（誘った人）
    user_b_id TEXT NOT NULL,             -- ペアのもう片方（参加した人）
    invite_code TEXT NOT NULL,           -- どの招待コードで成立したか
    created_at TEXT NOT NULL,
    UNIQUE(user_a_id, user_b_id)
  );

  -- ==========================================
  -- M-6 グループ機能（2〜10人、ペアを内包）
  -- ==========================================
  -- groups は M-6 でペア機能を拡張したもの。
  -- 旧 pair_invites / pair_relationships は読み取り互換のため残すが、
  -- 新規発行は groups 経由のみ。
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,                           -- グループ名（任意）
    owner_user_id TEXT NOT NULL,         -- グループ作成者（解散権限あり）
    invite_code TEXT NOT NULL UNIQUE,    -- 6桁招待コード（追加メンバー用）
    invite_expires_at TEXT,              -- コード失効（24h、再生成可能）
    channel_id TEXT,                     -- 自動作成された専用チャンネル ID（3人以上で生成）
    max_size INTEGER DEFAULT 10,         -- 上限（今は10固定）
    created_at TEXT NOT NULL,
    dissolved_at TEXT                    -- 解散時刻（NULL=活動中）
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    left_at TEXT,                        -- 個別離脱時刻（NULL=在籍中）
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(id)
  );

  CREATE INDEX IF NOT EXISTS idx_group_members_user
    ON group_members(user_id, left_at);
  CREATE INDEX IF NOT EXISTS idx_groups_invite_code
    ON groups(invite_code);

  -- ==========================================
  -- ぼいフォリオ ログインボーナス（ガチャチケット連携）
  -- ==========================================
  -- bot 側の冪等性ログ。ぼいフォリオ Supabase が canonical だが、
  -- ネットワーク不安定時のフェイルセーフとして bot 側にもシャドウ記録。
  CREATE TABLE IF NOT EXISTS daily_login_grants (
    discord_user_id TEXT NOT NULL,
    granted_date TEXT NOT NULL,          -- 'YYYY-MM-DD' JST
    webhook_status TEXT DEFAULT 'pending', -- 'pending' | 'sent' | 'failed' | 'no_link' | 'no_link_dm_sent'
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (discord_user_id, granted_date)
  );

  -- Discord ↔ Supabase user_id の高速参照キャッシュ（TTL 1h）
  CREATE TABLE IF NOT EXISTS account_link_cache (
    discord_user_id TEXT PRIMARY KEY,
    supabase_user_id TEXT NOT NULL,        -- 空文字なら "未連携" のネガティブキャッシュ
    cached_at TEXT NOT NULL
  );
`);

// ==========================================
// マイグレーション: groups.voilog_group_id を後付け（VoiLog 連携用）
// 既に存在すればスキップする冪等処理。Bot 既存挙動は変更しない。
// ==========================================
function _addColumnIfNotExistsForVoilog(table, column, type) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    const has = cols.some((c) => c.name === column);
    if (!has) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      console.log(`[db migration] added ${table}.${column}`);
    }
  } catch (e) {
    console.warn(`[db migration] ${table}.${column}:`, e.message);
  }
}
_addColumnIfNotExistsForVoilog('groups', 'voilog_group_id', 'TEXT');
_addColumnIfNotExistsForVoilog('groups', 'voilog_synced_at', 'TEXT');
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_groups_voilog_id ON groups(voilog_group_id)');
} catch (e) { /* ignore */ }

// ==========================================
// 既存テーブルへのカラム追加マイグレーション
// 既に動いている daily_posts に対し、台本ループ修正用の
// (category, genre, situation_id, situation_title, emotion_tag) を追加する。
// ALTER TABLE ... ADD COLUMN は SQLite で安全に追加でき、既存行はNULLになる。
// ==========================================
function migrateDailyPostsSchema() {
  const cols = db.prepare("PRAGMA table_info(daily_posts)").all().map((c) => c.name);
  const wanted = [
    { name: 'category', def: 'TEXT' },
    { name: 'genre', def: 'TEXT' },
    { name: 'situation_id', def: 'TEXT' },
    { name: 'situation_title', def: 'TEXT' },
    { name: 'emotion_tag', def: 'TEXT' },
  ];
  for (const w of wanted) {
    if (!cols.includes(w.name)) {
      try {
        db.exec(`ALTER TABLE daily_posts ADD COLUMN ${w.name} ${w.def}`);
        console.log(`[DB Migration] daily_posts に ${w.name} カラムを追加しました`);
      } catch (err) {
        console.error(`[DB Migration] ${w.name} の追加に失敗:`, err.message);
      }
    }
  }
}

migrateDailyPostsSchema();

// ==========================================
// reverb_updates への is_test カラム追加マイグレーション
// テスト投稿（!testreverb_update）を当日件数カウントから除外するためのフラグ。
// 既存行は DEFAULT 0 で「本番投稿」扱いになる（既存挙動を維持）。
// ==========================================
function migrateReverbUpdatesSchema() {
  const cols = db.prepare("PRAGMA table_info(reverb_updates)").all().map((c) => c.name);
  if (!cols.includes('is_test')) {
    try {
      db.exec(`ALTER TABLE reverb_updates ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0`);
      console.log(`[DB Migration] reverb_updates に is_test カラムを追加しました`);
    } catch (err) {
      console.error(`[DB Migration] is_test の追加に失敗:`, err.message);
    }
  }
}

migrateReverbUpdatesSchema();

// ==========================================
// M-6 voice_drama_events への event_kind / broadcast_* カラム追加マイグレーション
// 既存行は event_kind='performance' で本番扱い（既存挙動を維持）
// ==========================================
function migrateVoiceDramaEventsSchema() {
  const cols = db.prepare("PRAGMA table_info(voice_drama_events)").all().map((c) => c.name);
  const wanted = [
    { name: 'event_kind', def: "TEXT DEFAULT 'performance'" },
    { name: 'broadcast_consents', def: 'TEXT' },
    { name: 'broadcast_status', def: "TEXT DEFAULT 'not_requested'" },
  ];
  for (const w of wanted) {
    if (!cols.includes(w.name)) {
      try {
        db.exec(`ALTER TABLE voice_drama_events ADD COLUMN ${w.name} ${w.def}`);
        console.log(`[DB Migration] voice_drama_events に ${w.name} カラムを追加しました`);
      } catch (err) {
        console.error(`[DB Migration] ${w.name} の追加に失敗:`, err.message);
      }
    }
  }
}

migrateVoiceDramaEventsSchema();

// ==========================================
// 2. データベースを操作するための便利な関数を用意
// ==========================================

// --- 機能A: お題投稿関連 ---

// 今が通算何日目かを取得する関数
// データベースから一番新しい「day_number」を取ってきて、それに1を足します。
function getNextDayNumber() {
  const row = db.prepare('SELECT MAX(day_number) as max_day FROM daily_posts').get();
  // まだ1回も投稿されていなければ全体で0になっているので、1を返す
  return (row.max_day || 0) + 1;
}

// 投稿したお題の記録を保存する関数
// extra に { category, genre, situationId, situationTitle, emotionTag } を渡せば
// 拡張カラムにも記録される（後方互換のため引数省略可）。
function saveDailyPost(dayNumber, scriptId, messageId, extra = {}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO daily_posts
      (day_number, script_id, message_id, posted_at,
       category, genre, situation_id, situation_title, emotion_tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    dayNumber,
    scriptId,
    messageId,
    now,
    extra.category || null,
    extra.genre || null,
    extra.situationId || null,
    extra.situationTitle || null,
    extra.emotionTag || null,
  );
}

// 直近 N 日に同カテゴリで使われたジャンル一覧を取得（重複なし）。
// 「2週間以内に同ジャンルを再出現させない」ガードに使う。
function getRecentGenresForCategory(category, daysBack = 14) {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT DISTINCT genre FROM daily_posts
    WHERE category = ? AND posted_at >= ? AND genre IS NOT NULL
  `).all(category, since);
  return rows.map((r) => r.genre);
}

// 直近 N 日に同カテゴリで使われた situation_id 一覧（重複なし）。
// 「1週間以内に同シチュを再出現させない」ガードに使う。
function getRecentSituationIdsForCategory(category, daysBack = 7) {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT DISTINCT situation_id FROM daily_posts
    WHERE category = ? AND posted_at >= ? AND situation_id IS NOT NULL
  `).all(category, since);
  return rows.map((r) => r.situation_id);
}

// ==========================================
// ボイスサンプル「こんなふうに読んでみて！」用
// ==========================================
function recordVoiceSampleSuggestion(messageId, suggesterId, posterId, text, delivered = true) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO voice_sample_suggestions
      (message_id, suggester_id, poster_id, suggestion_text, delivered, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(messageId, suggesterId, posterId, text, delivered ? 1 : 0, now);
}

// ==========================================
// クリエイター月次お題用
// ==========================================
function getCreatorEventForMonth(yearMonth) {
  return db.prepare('SELECT * FROM creator_event_history WHERE year_month = ?').get(yearMonth);
}

function recordCreatorEvent(yearMonth, themeId, messageId) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO creator_event_history (year_month, theme_id, message_id, posted_at)
    VALUES (?, ?, ?, ?)
  `).run(yearMonth, themeId, messageId, now);
}

// ==========================================
// 養成所同期ペアリング用（A案）
// ==========================================

function generatePairInviteCode() {
  // 6桁の英数字（大文字＋数字、紛らわしい文字 0/O/1/I は除外）
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createPairInvite(inviterUserId, ttlHours = 24) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  // 衝突を避けるため最大10回まで再生成
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generatePairInviteCode();
    try {
      db.prepare(`
        INSERT INTO pair_invites (code, inviter_user_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `).run(code, inviterUserId, expires.toISOString(), now.toISOString());
      return { code, expiresAt: expires.toISOString() };
    } catch (err) {
      if (err.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw err;
      // 衝突したら次の試行
    }
  }
  throw new Error('招待コードの生成に失敗しました（10回連続衝突）');
}

function findPairInviteByCode(code) {
  return db.prepare('SELECT * FROM pair_invites WHERE code = ?').get(code);
}

function consumePairInvite(code, usedByUserId) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE pair_invites
    SET used_by_user_id = ?, used_at = ?
    WHERE code = ? AND used_by_user_id IS NULL
  `).run(usedByUserId, now, code);
}

function createPairRelationship(userAId, userBId, inviteCode) {
  const now = new Date().toISOString();
  // user_a_id < user_b_id で正規化して保存（重複防止）
  const [a, b] = [userAId, userBId].sort();
  try {
    db.prepare(`
      INSERT INTO pair_relationships (user_a_id, user_b_id, invite_code, created_at)
      VALUES (?, ?, ?, ?)
    `).run(a, b, inviteCode, now);
    return true;
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return false; // 既にペア
    throw err;
  }
}

function getPairsForUser(userId) {
  return db.prepare(`
    SELECT * FROM pair_relationships
    WHERE user_a_id = ? OR user_b_id = ?
    ORDER BY created_at DESC
  `).all(userId, userId);
}

// ==========================================
// M-6 グループ機能（2〜10人）— ペア互換 API
// ==========================================

// 新規グループ作成（オーナー1人だけのグループ）
// invite_code 衝突は最大10回までリトライ
function createGroup(ownerUserId, name = null, ttlHours = 24) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generatePairInviteCode();
    try {
      const info = db.prepare(`
        INSERT INTO groups (name, owner_user_id, invite_code, invite_expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(name, ownerUserId, code, expires.toISOString(), now.toISOString());
      const groupId = info.lastInsertRowid;
      // オーナーを自動加入
      db.prepare(`
        INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)
      `).run(groupId, ownerUserId, now.toISOString());
      return { id: groupId, code, expiresAt: expires.toISOString(), name };
    } catch (err) {
      if (err.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw err;
    }
  }
  throw new Error('グループ作成失敗（招待コード10回衝突）');
}

function findGroupByInviteCode(code) {
  return db.prepare(`
    SELECT * FROM groups
    WHERE invite_code = ? AND dissolved_at IS NULL
  `).get(code);
}

function regenerateGroupInvite(groupId, ttlHours = 24) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generatePairInviteCode();
    try {
      db.prepare(`
        UPDATE groups SET invite_code = ?, invite_expires_at = ?
        WHERE id = ?
      `).run(code, expires.toISOString(), groupId);
      return { code, expiresAt: expires.toISOString() };
    } catch (err) {
      if (err.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw err;
    }
  }
  throw new Error('招待コード再生成失敗');
}

// グループにメンバー追加（成功時 true、定員超過/重複は false + reason）
function addGroupMember(groupId, userId) {
  const group = db.prepare('SELECT * FROM groups WHERE id = ? AND dissolved_at IS NULL').get(groupId);
  if (!group) return { ok: false, reason: 'not_found' };

  // 在籍中（left_at IS NULL）のメンバー数チェック
  const activeCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = ? AND left_at IS NULL
  `).get(groupId).cnt;
  if (activeCount >= group.max_size) return { ok: false, reason: 'full' };

  const existing = db.prepare(`
    SELECT * FROM group_members WHERE group_id = ? AND user_id = ?
  `).get(groupId, userId);

  const now = new Date().toISOString();
  if (existing) {
    if (!existing.left_at) return { ok: false, reason: 'already_member' };
    // 再加入（left_at をクリア）
    db.prepare(`
      UPDATE group_members SET left_at = NULL, joined_at = ?
      WHERE group_id = ? AND user_id = ?
    `).run(now, groupId, userId);
  } else {
    db.prepare(`
      INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)
    `).run(groupId, userId, now);
  }

  const newCount = activeCount + 1;
  return { ok: true, group, memberCount: newCount };
}

// 個別離脱
function leaveGroup(groupId, userId) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    UPDATE group_members SET left_at = ?
    WHERE group_id = ? AND user_id = ? AND left_at IS NULL
  `).run(now, groupId, userId);
  return info.changes > 0;
}

// グループ解散（オーナーのみ。チャンネル削除は呼び出し側で行う）
function dissolveGroup(groupId, requesterUserId) {
  const group = db.prepare('SELECT * FROM groups WHERE id = ? AND dissolved_at IS NULL').get(groupId);
  if (!group) return { ok: false, reason: 'not_found' };
  if (group.owner_user_id !== requesterUserId) return { ok: false, reason: 'not_owner' };

  const now = new Date().toISOString();
  db.prepare('UPDATE groups SET dissolved_at = ? WHERE id = ?').run(now, groupId);
  db.prepare(`
    UPDATE group_members SET left_at = ?
    WHERE group_id = ? AND left_at IS NULL
  `).run(now, groupId);
  return { ok: true, group };
}

// グループにチャンネルIDを紐づけ
function setGroupChannelId(groupId, channelId) {
  db.prepare('UPDATE groups SET channel_id = ? WHERE id = ?').run(channelId, groupId);
}

// VoiLog Supabase の group UUID を Bot SQLite に書き戻し
function updateVoilogGroupId(discordGroupId, voilogGroupId) {
  db.prepare(`
    UPDATE groups
    SET voilog_group_id = ?, voilog_synced_at = ?
    WHERE id = ?
  `).run(voilogGroupId, new Date().toISOString(), discordGroupId);
}

// 在籍中メンバー一覧
function getGroupMembers(groupId) {
  return db.prepare(`
    SELECT * FROM group_members
    WHERE group_id = ? AND left_at IS NULL
    ORDER BY joined_at ASC
  `).all(groupId);
}

// ユーザーが所属している活動中グループ一覧
function getGroupsForUser(userId) {
  return db.prepare(`
    SELECT g.* FROM groups g
    JOIN group_members m ON m.group_id = g.id
    WHERE m.user_id = ? AND m.left_at IS NULL AND g.dissolved_at IS NULL
    ORDER BY g.created_at DESC
  `).all(userId);
}

function getGroupById(groupId) {
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
}

// ==========================================
// 投稿者ダッシュボード（D案）用クエリ
// ==========================================

// 自分が投稿したボイスサンプルへの「読み方提案」一覧（直近 N 件）
function getSuggestionsReceivedByUser(userId, limit = 5) {
  return db.prepare(`
    SELECT * FROM voice_sample_suggestions
    WHERE poster_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit);
}

// 受け取った提案の総数
function countSuggestionsReceivedByUser(userId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM voice_sample_suggestions WHERE poster_id = ?
  `).get(userId);
  return row.cnt || 0;
}

// 自分のストリーク取得
function getStreakForUser(userId) {
  return db.prepare('SELECT * FROM user_streaks WHERE user_id = ?').get(userId);
}

// 自分の累計投稿数
function countParticipationByUser(userId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM user_participation WHERE user_id = ?
  `).get(userId);
  return row.cnt || 0;
}

// --- M-5 週次レポート用：投稿活動の週次集計 ---

// 直近 N 日にユニークで投稿したユーザー ID 一覧
// 用途: 全体アクティブ率分母（直近の入室者）と分子（投稿した人）を計算
function getActiveUserIdsSince(daysBack = 7) {
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10); // YYYY-MM-DD
  const rows = db.prepare(`
    SELECT DISTINCT user_id FROM user_participation
    WHERE participated_date >= ?
  `).all(cutoff);
  return rows.map(r => r.user_id);
}

// 直近 N 日の投稿数 TOP K（user_id, count）
// 用途: 「今週の注目」TOP3 表示
function getTopParticipantsSince(daysBack = 7, limit = 3) {
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  return db.prepare(`
    SELECT user_id, COUNT(*) AS cnt
    FROM user_participation
    WHERE participated_date >= ?
    GROUP BY user_id
    ORDER BY cnt DESC
    LIMIT ?
  `).all(cutoff, limit);
}

// 直近 N 日の総投稿数（チャンネル別合計）
function countParticipationSince(daysBack = 7) {
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM user_participation
    WHERE participated_date >= ?
  `).get(cutoff);
  return row.cnt || 0;
}

// --- アンケート機能: クールダウン（連続回答防止）関連 ---

// ユーザーが7日以内にアンケートに回答済みかどうかを確認する関数
// 戻り値: { canAnswer: true/false, remainingDays: 残り日数 }
function checkSurveyCooldown(userId) {
  const row = db.prepare('SELECT last_survey_at FROM survey_cooldowns WHERE user_id = ?').get(userId);
  if (!row) return { canAnswer: true, remainingDays: 0 };

  const lastDate = new Date(row.last_survey_at);
  const now = new Date();
  const diffMs = now - lastDate; // ミリ秒（1000分の1秒）単位の差分
  const diffDays = diffMs / (1000 * 60 * 60 * 24); // 日数に変換

  if (diffDays >= 7) {
    return { canAnswer: true, remainingDays: 0 };
  }
  return { canAnswer: false, remainingDays: Math.ceil(7 - diffDays) };
}

// アンケート回答完了時に、回答日時を記録（次回のクールダウン判定に使う）
function recordSurveyCompletion(userId) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO survey_cooldowns (user_id, last_survey_at) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET last_survey_at = ?
  `).run(userId, now, now);
}

// ==========================================
// 3. 声劇イベント関連の便利な関数
// ==========================================

// --- 声劇イベント本体の操作 ---

// 新しい声劇イベントを作成する関数
// data: { hostUserId, recruitChannelId, stageChannelId, eventTitle, eventDatetime, characters }
// characters は配列: [{name: '太郎', gender: '男性', emoji: '1️⃣'}, ...]
// 戻り値: 作成されたレコードの情報（idが入っている）
function createVoiceDramaEvent(data) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO voice_drama_events
    (host_user_id, recruit_channel_id, stage_channel_id, event_title, event_datetime, characters, event_kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.hostUserId,
    data.recruitChannelId,
    data.stageChannelId,
    data.eventTitle || '声劇イベント',
    data.eventDatetime,
    JSON.stringify(data.characters), // 配列をJSON文字列に変換して保存（本棚に本を詰めるイメージ）
    data.eventKind || 'performance',
    now
  );
  return { id: result.lastInsertRowid, ...data, created_at: now };
}

// イベントIDを指定して1件取得する関数
// 戻り値: イベント情報のオブジェクト（無ければundefined）
function getVoiceDramaEvent(eventId) {
  const row = db.prepare('SELECT * FROM voice_drama_events WHERE id = ?').get(eventId);
  if (row && row.characters) {
    row.characters = JSON.parse(row.characters); // JSON文字列を配列に戻す（本棚から本を取り出す）
  }
  return row;
}

// 募集メッセージIDからイベントを探す関数
// リアクションが押された時に「どのイベントの募集なのか」を特定するために使う
function getVoiceDramaEventByMessageId(messageId) {
  const row = db.prepare('SELECT * FROM voice_drama_events WHERE recruit_message_id = ?').get(messageId);
  if (row && row.characters) {
    row.characters = JSON.parse(row.characters);
  }
  return row;
}

// 現在進行中（recruiting または confirmed）のイベント一覧を取得する関数
function getActiveVoiceDramaEvents() {
  const rows = db.prepare(
    "SELECT * FROM voice_drama_events WHERE status IN ('recruiting', 'confirmed')"
  ).all();
  return rows.map(row => {
    if (row.characters) row.characters = JSON.parse(row.characters);
    return row;
  });
}

// イベントのステータスを更新する関数
// status: 'recruiting' → 'confirmed' → 'performing' → 'archived'
function updateVoiceDramaEventStatus(eventId, status) {
  db.prepare('UPDATE voice_drama_events SET status = ? WHERE id = ?').run(status, eventId);
}

// 募集メッセージのIDを保存する関数（Embed投稿後に呼ぶ）
function setRecruitMessageId(eventId, messageId) {
  db.prepare('UPDATE voice_drama_events SET recruit_message_id = ? WHERE id = ?').run(messageId, eventId);
}

// リマインド送信済みフラグを更新する関数
// type: '1h' or '10m'
function markReminderSent(eventId, type) {
  if (type === '1h') {
    db.prepare('UPDATE voice_drama_events SET reminder_sent_1h = 1 WHERE id = ?').run(eventId);
  } else if (type === '10m') {
    db.prepare('UPDATE voice_drama_events SET reminder_sent_10m = 1 WHERE id = ?').run(eventId);
  }
}

// --- 声劇参加者の操作 ---

// 参加者を追加する（立候補）関数
// 同じ人が同じ役に重複立候補しないようにUNIQUE制約が守ってくれる
function addVoiceDramaParticipant(eventId, userId, characterName) {
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO voice_drama_participants (event_id, user_id, character_name, status, created_at)
      VALUES (?, ?, ?, 'candidate', ?)
    `).run(eventId, userId, characterName, now);
    return true;
  } catch (error) {
    // UNIQUE制約違反 = すでに立候補済み → 何もしない
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
    throw error;
  }
}

// 参加者を削除する（立候補取り消し）関数
function removeVoiceDramaParticipant(eventId, userId, characterName) {
  db.prepare(`
    DELETE FROM voice_drama_participants
    WHERE event_id = ? AND user_id = ? AND character_name = ?
  `).run(eventId, userId, characterName);
}

// 特定イベントの全参加者を取得する関数
// 戻り値: [{user_id, character_name, status}, ...]
function getVoiceDramaParticipants(eventId) {
  return db.prepare(
    'SELECT * FROM voice_drama_participants WHERE event_id = ? ORDER BY character_name, created_at'
  ).all(eventId);
}

// 特定の役に立候補している人一覧を取得する関数
function getCandidatesForCharacter(eventId, characterName) {
  return db.prepare(
    "SELECT * FROM voice_drama_participants WHERE event_id = ? AND character_name = ? AND status = 'candidate'"
  ).all(eventId, characterName);
}

// 参加者のステータスを更新する関数（candidate → confirmed / rejected）
function updateParticipantStatus(eventId, userId, characterName, status) {
  db.prepare(`
    UPDATE voice_drama_participants SET status = ?
    WHERE event_id = ? AND user_id = ? AND character_name = ?
  `).run(status, eventId, userId, characterName);
}

// 特定イベントの確定済み参加者のみ取得する関数
function getConfirmedParticipants(eventId) {
  return db.prepare(
    "SELECT * FROM voice_drama_participants WHERE event_id = ? AND status = 'confirmed'"
  ).all(eventId);
}

// ==========================================
// 4. Reverb ニュース関連の便利な関数
// ==========================================

// アップデート受信を1件記録する関数（webhook受信時に呼ばれる）
// data.isTest=true の場合は !testreverb_update 由来。21時フォールバック判定で無視される。
function recordReverbUpdate(data) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO reverb_updates
    (tool, type, title, body, link, thumbnail, message_id, posted_at, is_test)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.tool,
    data.type,
    data.title,
    data.body || null,
    data.link || null,
    data.thumbnail || null,
    data.messageId || null,
    now,
    data.isTest ? 1 : 0
  );
  return result.lastInsertRowid;
}

// 当日（JST 0時〜現在）の本番アップデート投稿件数を返す関数
// 21時の活用事例フォールバックを発動するかどうかの判定に使う。
// テスト投稿（is_test=1）は除外する。
function countReverbUpdatesToday() {
  // JST の今日0時を ISO 文字列にする
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  jstNow.setUTCHours(0, 0, 0, 0);
  const jstStartUtc = new Date(jstNow.getTime() - jstOffset).toISOString();

  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM reverb_updates
    WHERE posted_at >= ? AND is_test = 0
  `).get(jstStartUtc);
  return row.cnt || 0;
}

// ローテ履歴を記録する関数（活用事例配信後に呼ばれる）
function recordReverbRotation(personaId, toolId, messageId) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO reverb_rotation (persona_id, tool_id, posted_at, message_id)
    VALUES (?, ?, ?, ?)
  `).run(personaId, toolId, now, messageId || null);
}

// 直近 N 日に使ったペルソナ × ツールの組み合わせを取得
// 戻り値: [{ persona_id, tool_id }, ...]
function getRecentReverbRotation(daysBack = 7) {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT persona_id, tool_id FROM reverb_rotation WHERE posted_at >= ?
  `).all(since);
}

// ==========================================
// ぼいフォリオ ログインボーナス関連の関数
// ==========================================

/**
 * 今日のログインボーナス試行を1件記録する。冪等。
 * @param {string} discordUserId
 * @param {string} dateStr - 'YYYY-MM-DD' JST
 * @returns {{ isFirst: boolean }} - true なら今日初回、false なら既処理
 */
function recordDailyLoginAttempt(discordUserId, dateStr) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO daily_login_grants
    (discord_user_id, granted_date, webhook_status, attempts, created_at)
    VALUES (?, ?, 'pending', 0, ?)
  `).run(discordUserId, dateStr, new Date().toISOString());
  return { isFirst: result.changes > 0 };
}

/** ログインボーナス webhook の status を更新する */
function updateDailyLoginStatus(discordUserId, dateStr, status, errorMsg) {
  db.prepare(`
    UPDATE daily_login_grants
    SET webhook_status = ?,
        attempts = attempts + 1,
        last_error = ?
    WHERE discord_user_id = ? AND granted_date = ?
  `).run(status, errorMsg || null, discordUserId, dateStr);
}

/** 今日 no_link_dm_sent フラグが立っているか確認（過剰DM防止） */
function hasSentNoLinkDmToday(discordUserId, dateStr) {
  const row = db.prepare(`
    SELECT webhook_status FROM daily_login_grants
    WHERE discord_user_id = ? AND granted_date = ?
  `).get(discordUserId, dateStr);
  return row && row.webhook_status === 'no_link_dm_sent';
}

/** 過去に未連携DMを送ったことがあるか確認（生涯1回ルール） */
function hasEverSentNoLinkDm(discordUserId) {
  const row = db.prepare(`
    SELECT 1 FROM daily_login_grants
    WHERE discord_user_id = ? AND webhook_status = 'no_link_dm_sent'
    LIMIT 1
  `).get(discordUserId);
  return !!row;
}

/** Discord ID から Supabase user_id を cache 取得（TTL 1h） */
function getCachedLink(discordUserId, ttlSeconds = 3600) {
  const row = db.prepare(`
    SELECT supabase_user_id, cached_at FROM account_link_cache
    WHERE discord_user_id = ?
  `).get(discordUserId);
  if (!row) return null;
  const cachedMs = new Date(row.cached_at).getTime();
  if (Date.now() - cachedMs > ttlSeconds * 1000) return null;
  return row.supabase_user_id || null;  // 空文字 → 未連携キャッシュ
}

/** Discord ID → Supabase user_id を upsert キャッシュ（'' なら未連携キャッシュ） */
function setCachedLink(discordUserId, supabaseUserId) {
  db.prepare(`
    INSERT INTO account_link_cache (discord_user_id, supabase_user_id, cached_at)
    VALUES (?, ?, ?)
    ON CONFLICT(discord_user_id) DO UPDATE
      SET supabase_user_id = excluded.supabase_user_id,
          cached_at = excluded.cached_at
  `).run(discordUserId, supabaseUserId || '', new Date().toISOString());
}

// ==========================================
// アーリーアクセス（早期メンバー）関連の関数
// ==========================================

// 早期メンバーを1人記録する。冪等（既に居る場合は何もしない）。
// 戻り値: { inserted: boolean } — true なら新規追加、false なら既存
function recordEarlyMember(userId, source = 'manual') {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT OR IGNORE INTO early_members (user_id, granted_at, source)
    VALUES (?, ?, ?)
  `).run(userId, now, source);
  return { inserted: result.changes > 0 };
}

// 指定ユーザーが早期メンバー記録を持つか確認
function hasEarlyMember(userId) {
  const row = db.prepare('SELECT 1 FROM early_members WHERE user_id = ?').get(userId);
  return !!row;
}

// 全早期メンバーの user_id 一覧（VoiPokeローンチ時のDM配信用）
function getAllEarlyMembers() {
  return db.prepare(`
    SELECT user_id, granted_at, source FROM early_members ORDER BY granted_at ASC
  `).all();
}

// 早期メンバーの総数
function countEarlyMembers() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM early_members').get();
  return row.c || 0;
}

// このファイル外からも変数や関数を使えるようにエクスポート（外に出す）する
module.exports = {
  db,
  getNextDayNumber,
  saveDailyPost,
  checkSurveyCooldown,
  recordSurveyCompletion,
  // --- 声劇イベント関連 ---
  createVoiceDramaEvent,
  getVoiceDramaEvent,
  getVoiceDramaEventByMessageId,
  getActiveVoiceDramaEvents,
  updateVoiceDramaEventStatus,
  setRecruitMessageId,
  markReminderSent,
  addVoiceDramaParticipant,
  removeVoiceDramaParticipant,
  getVoiceDramaParticipants,
  getCandidatesForCharacter,
  updateParticipantStatus,
  getConfirmedParticipants,
  // --- Reverb ニュース関連 ---
  recordReverbUpdate,
  countReverbUpdatesToday,
  recordReverbRotation,
  getRecentReverbRotation,
  // --- アーリーアクセス（早期メンバー）---
  recordEarlyMember,
  hasEarlyMember,
  getAllEarlyMembers,
  countEarlyMembers,
  // --- ぼいフォリオ ログインボーナス ---
  recordDailyLoginAttempt,
  updateDailyLoginStatus,
  hasSentNoLinkDmToday,
  hasEverSentNoLinkDm,
  getCachedLink,
  setCachedLink,
  // --- 台本ループ修正用 ---
  getRecentGenresForCategory,
  getRecentSituationIdsForCategory,
  // --- ボイスサンプル提案（F2）---
  recordVoiceSampleSuggestion,
  // --- クリエイター月次お題（F1）---
  getCreatorEventForMonth,
  recordCreatorEvent,
  // --- 同期ペアリング（A案）---
  createPairInvite,
  findPairInviteByCode,
  consumePairInvite,
  createPairRelationship,
  getPairsForUser,
  // --- ダッシュボード（D案）---
  getSuggestionsReceivedByUser,
  countSuggestionsReceivedByUser,
  getStreakForUser,
  countParticipationByUser,
  // --- M-5 週次レポート ---
  getActiveUserIdsSince,
  getTopParticipantsSince,
  countParticipationSince,
  // --- M-6 グループ機能 ---
  createGroup,
  findGroupByInviteCode,
  regenerateGroupInvite,
  addGroupMember,
  leaveGroup,
  dissolveGroup,
  setGroupChannelId,
  updateVoilogGroupId,
  getGroupMembers,
  getGroupsForUser,
  getGroupById,
};
