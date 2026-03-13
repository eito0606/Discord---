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
`);

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
function saveDailyPost(dayNumber, scriptId, messageId) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO daily_posts (day_number, script_id, message_id, posted_at)
    VALUES (?, ?, ?, ?)
  `).run(dayNumber, scriptId, messageId, now);
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

// このファイル外からも変数や関数を使えるようにエクスポート（外に出す）する
module.exports = {
  db,
  getNextDayNumber,
  saveDailyPost,
  checkSurveyCooldown,
  recordSurveyCompletion,
};
