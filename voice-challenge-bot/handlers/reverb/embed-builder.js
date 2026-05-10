// handlers/reverb/embed-builder.js — Reverb ニュース用Embedビルダー
//
// 2タイプのEmbedを提供：
//   1. アップデート通知Embed（webhook受信時）
//   2. 活用事例Embed（21時のフォールバック配信時）
//
// ブランドUIは「ダークグリーンテック近未来」。
// 受け手が0.5秒で「あ、あのツールの話だ」と分かるよう、ツール別の色・絵文字で識別する。

const { EmbedBuilder } = require('discord.js');
const { getToolById } = require('./tool-defs');

// アップデート種別ごとの日本語ラベル＆絵文字
const UPDATE_TYPE_LABELS = {
  feature: { label: '新機能', emoji: '✨' },
  fix: { label: 'ふしぎ修正', emoji: '🛠️' },
  release: { label: 'リリース', emoji: '🚀' },
  campaign: { label: 'キャンペーン', emoji: '🎁' },
};

/**
 * アップデート通知用のEmbedを作る
 *
 * @param {object} payload - { tool, type, title, body, link, thumbnail }
 *   tool は tool-defs.js の id（"voipoke" など）または表示名（"VoiPoke"）
 * @returns {EmbedBuilder}
 */
function buildUpdateEmbed(payload) {
  const tool = getToolById(payload.tool) || {
    name: payload.tool || 'Reverb',
    emoji: '📢',
    accent_color: 0x1B5E3F,
    url: null,
  };

  const typeInfo = UPDATE_TYPE_LABELS[payload.type] || { label: 'おしらせ', emoji: '📣' };

  const embed = new EmbedBuilder()
    .setColor(tool.accent_color)
    .setAuthor({ name: `${tool.emoji} ${tool.name}｜Reverb ニュース` })
    .setTitle(`${typeInfo.emoji} ${payload.title}`)
    .setTimestamp(new Date());

  if (payload.body) {
    // Discord Embed の description は 4096 文字まで。安全に切る
    const safeBody = payload.body.length > 1900
      ? payload.body.slice(0, 1897) + '...'
      : payload.body;
    embed.setDescription(safeBody);
  }

  if (payload.link) {
    embed.setURL(payload.link);
    embed.addFields({ name: '🔗 詳細', value: payload.link, inline: false });
  } else if (tool.coming_soon) {
    // 公開前ツールはリンクを張らず、文言だけで案内
    embed.addFields({ name: '🔗 詳細', value: '⏳ まもなく実装予定です', inline: false });
  } else if (tool.url) {
    embed.setURL(tool.url);
  }

  if (payload.thumbnail) {
    embed.setThumbnail(payload.thumbnail);
  }

  embed.addFields({
    name: '📦 種別',
    value: `${typeInfo.emoji} ${typeInfo.label}`,
    inline: true,
  });

  embed.setFooter({ text: 'Reverb ニュース｜開発ツールのおしらせ' });

  return embed;
}

/**
 * 活用事例（21時フォールバック）用のEmbedを作る
 *
 * @param {object} args - { persona, tool, story }
 *   persona は persona-defs.js の1要素
 *   tool は tool-defs.js の1要素
 *   story はAIが生成した本文（300字前後）
 * @returns {EmbedBuilder}
 */
function buildUseCaseEmbed({ persona, tool, story }) {
  const embed = new EmbedBuilder()
    .setColor(tool.accent_color)
    .setAuthor({ name: `${tool.emoji} もしも声活｜Reverb ニュース` })
    .setTitle(`${persona.name}（${persona.age}歳・${persona.occupation}）の場合`)
    .setDescription(story || '（本文の生成に失敗しました）')
    .addFields(
      {
        name: '🛠️ つかったツール',
        value: `${tool.emoji} **${tool.name}** — ${tool.short_description}`,
        inline: false,
      },
      {
        name: '✨ できること',
        value: tool.features.map((f) => `・${f}`).join('\n'),
        inline: false,
      },
      {
        name: '🔗 つかってみる',
        value: tool.coming_soon
          ? '⏳ まもなく実装予定です'
          : `[${tool.cta}](${tool.url})`,
        inline: false,
      },
    )
    .setFooter({ text: 'もしもの声活｜AIがペルソナを想像してお届け' })
    .setTimestamp(new Date());

  return embed;
}

/**
 * 通知ロール設置メッセージ用のEmbed
 * 🔔リアクションでロール付与・解除
 */
function buildSubscriptionEmbed() {
  return new EmbedBuilder()
    .setColor(0x1B5E3F)
    .setTitle('🔔 Reverb ニュースの通知をうけとる')
    .setDescription(
      [
        'このメッセージに **🔔 でリアクション**すると、',
        'Reverb ニュースの投稿時にあなたへ通知が飛びます。',
        '',
        '**配信されるもの**',
        '・VoiPoke / VoiLog / ぼいラボ / ぼいフォリオ / キャラビジュ のアップデート',
        '・毎晩21時、アップデートがない日は「もしも声活」活用事例',
        '',
        'もう通知いらないときは、リアクションを外せばOK。',
      ].join('\n'),
    )
    .setFooter({ text: 'いつでも解除できる｜opt-in通知' });
}

module.exports = {
  buildUpdateEmbed,
  buildUseCaseEmbed,
  buildSubscriptionEmbed,
};
