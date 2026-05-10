// handlers/reverb/tool-defs.js — Reverb ニュース用ツール定義（5ツール）
//
// AIプロンプトに渡すための、各ツールの「何ができる・どう役立つ」情報。
// アップデート webhook 受信時のEmbed装飾、ペルソナ活用事例生成の両方で使う。
//
// ブランドUIは「ダークグリーンテック近未来」で統一（CLAUDE.md準拠）。

const TOOLS = [
  {
    id: 'voipoke',
    name: 'VoiPoke',
    short_description: '擬似ASMRボイス販売アプリ',
    long_description: '声優・配信者が作った擬似ASMRボイスを、リスナーが聴いて・買えるアプリ。クリエイターは収益化、リスナーは推しの声を毎日浴びる場所。',
    features: [
      '擬似ASMRボイスの試聴・購入',
      'クリエイター登録で収益化（売上 -手数料）',
      'マスター制度でファン限定特典',
      '毎日の新作通知',
    ],
    use_scenarios: [
      'バイト終わりに新作の擬似ASMRを浴びて寝る',
      '自分の声を販売してファンを増やす',
      'マスター登録で限定ボイスを月額で楽しむ',
    ],
    cta: 'VoiPoke で擬似ASMRを聴く / 売る',
    url: 'https://voipoke.app', // TODO: VoiPoke 正式公開後に実URLへ差し替え
    coming_soon: true, // 実装前のため、Embed上では「まもなく実装予定です」と表示する
    emoji: '🎧',
    accent_color: 0x1B5E3F, // ダークグリーン（深め）
  },
  {
    id: 'voilog',
    name: 'VoiLog',
    short_description: '声活専用ダッシュボード',
    long_description: 'ToDo・日記・カレンダーが一画面にまとまった、声優志望者・活動者のための毎日の相棒。続かない声活を「見える化」で支える。',
    features: [
      'ToDoで今日の練習を管理',
      '一行日記で気持ちを残す',
      'カレンダーで継続を可視化',
      '連続記録のグラフ表示',
    ],
    use_scenarios: [
      '今日の台本練習をToDoでチェック',
      '練習後に日記で気持ちを言語化',
      '3日サボっても再開しやすいUI',
      '月末にカレンダーで自分の頑張りを振り返る',
    ],
    cta: 'VoiLog で声活を見える化する',
    url: 'https://voilog.vercel.app',
    emoji: '📓',
    accent_color: 0x2A7A6E, // ティール（既存ニュースと同系）
  },
  {
    id: 'voilab',
    name: 'ぼいラボ',
    short_description: '声活専用Discordコミュニティ',
    long_description: '毎日の台本配信・AI壁打ち・声劇イベント・仲間との交流が全部詰まった、声優志望者のための「独りじゃない場所」。無料で参加できる。',
    features: [
      '毎日18時の自動台本配信（男性/女性/ナレ）',
      'AI壁打ちで演技相談',
      '声劇イベント自動運営',
      '週間ベスト発表',
    ],
    use_scenarios: [
      '夜18時の台本通知でその日の練習を始める',
      '迷ったらAI壁打ちで深夜でも相談',
      '声劇イベントで仲間とライブ感のある演技',
      '実績報告部屋で継続をシェア',
    ],
    cta: 'ぼいラボに参加する',
    url: 'https://discord.gg/dkSvcxbFwe',
    emoji: '🌿',
    accent_color: 0x0F4C3A, // ダークグリーン（最深）
  },
  {
    id: 'voiforio',
    name: 'ぼいフォリオ',
    short_description: '直感型声活ポートフォリオ生成サイト',
    long_description: '営業用のポートフォリオを、ドラッグ＆ドロップで爆速生成。声優志望者・フリーが「とりあえず送れる1枚」を手に入れる場所。',
    features: [
      'ボイスサンプルのアップロード',
      'プロフィール・実績の自動レイアウト',
      '1クリックでURL共有',
      'スマホ最適化',
    ],
    use_scenarios: [
      'オーディション応募の前にURLを準備',
      '事務所の営業先に送るリンクとして',
      'SNSのプロフィール欄に貼る',
      '同人案件の依頼者に提示',
    ],
    cta: 'ぼいフォリオで営業を爆速化する',
    url: 'https://voice-character-gen.vercel.app',
    emoji: '📇',
    accent_color: 0x2A7A6E,
  },
  {
    id: 'charavisu',
    name: 'キャラビジュ',
    short_description: 'キャラクタービジュアライザー',
    long_description: '台本のキャラクター像をAIで画像化。「この役、どんな見た目？」を即可視化して、演技の解像度を上げる。',
    features: [
      'キャラ設定からビジュアル自動生成',
      '複数バリエーション提示',
      'ぼいラボの台本と連携',
      'スマホで即生成',
    ],
    use_scenarios: [
      '台本キャラの見た目を脳内で固める',
      '練習前にキャラ画像を眺めて没入',
      '声劇イベント前のキャスト共有',
      'ポートフォリオに添えるキャライメージ',
    ],
    cta: 'キャラビジュで役の解像度を上げる',
    url: 'https://voice-character-visualizer.vercel.app',
    emoji: '🎨',
    accent_color: 0x1B5E3F,
  },
];

// ID からツール定義を取得する関数
function getToolById(id) {
  return TOOLS.find((t) => t.id === id);
}

// ツール名（部分一致もOK）からIDを逆引きする関数
// webhook で `tool: "VoiPoke"` のような表記揺れにも対応
function getToolIdByName(name) {
  if (!name) return null;
  const normalized = String(name).toLowerCase().replace(/\s/g, '');
  for (const tool of TOOLS) {
    if (tool.id === normalized) return tool.id;
    if (tool.name.toLowerCase() === normalized) return tool.id;
    // 「voipoke」「VoiPoke」「ぼいラボ」「ぼいlab」など揺らぎ吸収
    if (normalized.includes(tool.id)) return tool.id;
  }
  return null;
}

// 全ツールの ID 配列を取得
function getAllToolIds() {
  return TOOLS.map((t) => t.id);
}

module.exports = {
  TOOLS,
  getToolById,
  getToolIdByName,
  getAllToolIds,
};
