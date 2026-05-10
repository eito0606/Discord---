// test-webhook.js — VoiPoke Webhook サーバーの動作確認用スクリプト
// 使い方：
//   1. Bot を起動：  node index.js
//   2. このファイルを実行：  node handlers/voipoke/test-webhook.js
//   または curl コマンドを直接実行（コメント参照）
//
// 注意：実際にロール付与や Discord 投稿が走るので、テスト用のID で実行すること！

require('dotenv').config();

const PORT = process.env.VOIPOKE_WEBHOOK_PORT || 3000;
const SECRET = process.env.VOIPOKE_WEBHOOK_SECRET;
const BASE_URL = `http://localhost:${PORT}`;

if (!SECRET) {
  console.error('VOIPOKE_WEBHOOK_SECRET が未設定です。.env を確認してください。');
  process.exit(1);
}

/**
 * 共通の POST リクエスト関数
 */
async function post(path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (!opts.skipAuth) {
    headers['X-Webhook-Secret'] = opts.badSecret ? 'wrong-secret' : SECRET;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let payload;
  try { payload = await res.json(); } catch { payload = await res.text(); }
  return { status: res.status, payload };
}

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    printHelp();
    return;
  }

  if (arg === 'health') {
    console.log('▶ GET /healthz');
    const res = await fetch(`${BASE_URL}/healthz`);
    const text = await res.text();
    console.log(`  status=${res.status}`, text);
    return;
  }

  if (arg === 'auth-fail') {
    console.log('▶ POST /sync-roles （署名なし → 401 期待）');
    let r = await post('/sync-roles', { discord_user_id: 'dummy' }, { skipAuth: true });
    console.log(`  status=${r.status}`, r.payload);

    console.log('▶ POST /sync-roles （誤った署名 → 401 期待）');
    r = await post('/sync-roles', { discord_user_id: 'dummy' }, { badSecret: true });
    console.log(`  status=${r.status}`, r.payload);
    return;
  }

  if (arg === 'role-sync') {
    const userId = process.argv[3];
    if (!userId) {
      console.error('使い方: node test-webhook.js role-sync <discord_user_id>');
      process.exit(1);
    }
    console.log(`▶ POST /sync-roles （ユーザー ${userId} に CREATOR ロール付与）`);
    const r = await post('/sync-roles', {
      discord_user_id: userId,
      roles_to_add: process.env.VOIPOKE_ROLE_CREATOR ? [process.env.VOIPOKE_ROLE_CREATOR] : [],
      roles_to_remove: [],
    });
    console.log(`  status=${r.status}`, r.payload);
    return;
  }

  if (arg === 'new-voice') {
    console.log('▶ POST /new-voice （ダミー新作通知）');
    const r = await post('/new-voice', {
      voice_id: 'test-voice-123',
      title: 'テスト：朝の囁きASMR',
      creator_name: 'テスト クリエイター',
      creator_avatar_url: 'https://i.pravatar.cc/150?img=1',
      category: 'asmr',
      cover_art_url: 'https://picsum.photos/seed/voipoke/512',
      voice_url: 'voipoke://voice/test-voice-123',
    });
    console.log(`  status=${r.status}`, r.payload);
    return;
  }

  if (arg === 'new-voice-situation') {
    console.log('▶ POST /new-voice （シチュボカテゴリ）');
    const r = await post('/new-voice', {
      voice_id: 'test-voice-456',
      title: 'テスト：放課後の保健室',
      creator_name: 'テスト クリエイター',
      category: 'situation',
      cover_art_url: 'https://picsum.photos/seed/voipoke2/512',
      voice_url: 'voipoke://voice/test-voice-456',
    });
    console.log(`  status=${r.status}`, r.payload);
    return;
  }

  printHelp();
}

function printHelp() {
  console.log(`
VoiPoke Webhook テストスクリプト
================================

実行例：
  node handlers/voipoke/test-webhook.js health
    → /healthz エンドポイントの確認

  node handlers/voipoke/test-webhook.js auth-fail
    → 署名なし／誤った署名で 401 が返ることを確認

  node handlers/voipoke/test-webhook.js role-sync <discord_user_id>
    → 指定ユーザーに CREATOR ロールを付与

  node handlers/voipoke/test-webhook.js new-voice
    → ASMR カテゴリの新作通知投稿テスト

  node handlers/voipoke/test-webhook.js new-voice-situation
    → シチュボカテゴリの新作通知投稿テスト

----------------------------------------
curl で直接叩く場合の例（要：.env を読んで $VOIPOKE_WEBHOOK_SECRET を展開）
----------------------------------------

# ヘルスチェック
curl http://localhost:${PORT}/healthz

# ロール同期
curl -X POST http://localhost:${PORT}/sync-roles \\
  -H "Content-Type: application/json" \\
  -H "X-Webhook-Secret: \\$VOIPOKE_WEBHOOK_SECRET" \\
  -d '{"discord_user_id":"123456789","roles_to_add":["ROLE_ID"],"roles_to_remove":[]}'

# 新作通知
curl -X POST http://localhost:${PORT}/new-voice \\
  -H "Content-Type: application/json" \\
  -H "X-Webhook-Secret: \\$VOIPOKE_WEBHOOK_SECRET" \\
  -d '{"voice_id":"v1","title":"テスト","creator_name":"テスト","category":"asmr"}'
`);
}

main().catch(err => {
  console.error('テスト実行エラー:', err);
  process.exit(1);
});
