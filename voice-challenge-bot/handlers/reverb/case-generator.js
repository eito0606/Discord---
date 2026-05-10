// handlers/reverb/case-generator.js — ペルソナ活用事例の生成エンジン
//
// 担当：
//   1. ペルソナ × ツールの組み合わせをローテーション選択（直近7日と被らない）
//   2. Geminiにプロンプトを投げて、300字前後のショートストーリーを生成
//   3. AI生成失敗時はフォールバックJSONから1本拾う
//
// アンチAI-slop方針（CLAUDE.md準拠）：
//   - ひらがな7割
//   - 体温のある独白調
//   - 「〜してくれた」「〜と感じた」など人間味のある表現
//   - キャッチコピー的な広告文体は禁止

const fs = require('fs');
const path = require('path');
const { generateText } = require('../geminiClient');
const { PERSONAS, getPersonaById } = require('./persona-defs');
const { TOOLS, getToolById } = require('./tool-defs');
const { getRecentReverbRotation } = require('../../db');

const FALLBACK_PATH = path.join(__dirname, '../../data/reverb-fallback-cases.json');

/**
 * 直近7日に使ったペルソナ×ツールの組み合わせを除外し、
 * 残りからランダムに1組選ぶ。
 *
 * 全組み合わせ（20×5=100）から、直近の組み合わせを差し引くので、
 * 多少使い込んでも常に十分な選択肢が残る。
 *
 * @returns {{ persona, tool }} 選ばれた組み合わせ
 */
function pickRotation() {
  const recent = getRecentReverbRotation(7);
  // 「persona_id|tool_id」で検索しやすい Set を作る
  const recentSet = new Set(recent.map((r) => `${r.persona_id}|${r.tool_id}`));

  // 全組み合わせを生成し、直近7日と被らないものだけ残す
  const candidates = [];
  for (const persona of PERSONAS) {
    for (const tool of TOOLS) {
      const key = `${persona.id}|${tool.id}`;
      if (!recentSet.has(key)) {
        candidates.push({ persona, tool });
      }
    }
  }

  // 万が一すべて使い切った場合（100組以上配信）は recent をリセットして全候補から選ぶ
  const pool = candidates.length > 0
    ? candidates
    : PERSONAS.flatMap((p) => TOOLS.map((t) => ({ persona: p, tool: t })));

  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

/**
 * Gemini向けのプロンプトを組み立てる
 * AIがペルソナの1日のショートストーリーを書くための材料一式
 */
function buildPrompt(persona, tool) {
  return [
    'あなたは声優志望者の日常を300字前後で描く小説家です。',
    '',
    '【ペルソナ情報】',
    `- 名前: ${persona.name}（${persona.age}歳）`,
    `- 一人称: ${persona.pronoun}`,
    `- 立場: ${persona.occupation}`,
    `- 背景: ${persona.background}`,
    `- 心の悩み: ${persona.pain_points.join(' / ')}`,
    `- 心理トリガー: ${persona.triggers.join(' / ')}`,
    `- 文体イメージ: ${persona.voice_tone}`,
    '',
    '【ツール情報】',
    `- 名前: ${tool.name}（${tool.short_description}）`,
    `- 詳細: ${tool.long_description}`,
    `- 機能: ${tool.features.join(' / ')}`,
    `- 想定シーン: ${tool.use_scenarios.join(' / ')}`,
    '',
    '【お願い】',
    `${persona.name}（${persona.age}歳）が今日 ${tool.name} を使った1日の、ショートストーリーを書いてください。`,
    '',
    '【条件】',
    '1. 300字前後（必ず250〜350字に収める）',
    '2. 漢字とひらがなのバランスは自然な日本語で。読み手がスッと読める比率（ひらがなに偏らせすぎない／漢字も普通に使う）',
    '3. 体温のある独白調。一人称で書く',
    '4. 場面を1つだけ具体的に切り取る（時間・場所・行動が見える）',
    '5. ツールが「ペルソナの悩み」にやさしく寄り添う流れ',
    '6. 最後の一文で、ツールがくれた小さな気づきを残す',
    '7. 広告くさいキャッチコピーや「使ってみよう！」みたいな煽り文句は禁止',
    '8. 「AI」「ツール」のような事務的な単語の連呼は避ける',
    '9. 絵文字は使ってもよいが多くても2個まで',
    '',
    '本文のみを出力してください（タイトルや前置き不要）。',
  ].join('\n');
}

/**
 * AIで活用事例ストーリーを生成する。失敗時はnullを返す。
 *
 * @param {object} args - { persona, tool }
 * @returns {Promise<string|null>}
 */
async function generateUseCase({ persona, tool }) {
  const prompt = buildPrompt(persona, tool);
  const text = await generateText(prompt);
  if (!text) return null;
  return text.trim();
}

/**
 * フォールバック用の静的活用事例を1本取得する
 * AI生成が失敗したり、API残量が尽きたりしたときの最終防衛線
 *
 * @param {string} toolId - 'voipoke' など
 * @returns {string|null}
 */
function pickFallbackCase(toolId) {
  try {
    const raw = fs.readFileSync(FALLBACK_PATH, 'utf8');
    const cases = JSON.parse(raw);
    const matched = cases.filter((c) => c.tool_id === toolId);
    const pool = matched.length > 0 ? matched : cases;
    if (pool.length === 0) return null;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return pick.story;
  } catch (err) {
    console.error('[Reverb] フォールバック事例の読み込みに失敗:', err);
    return null;
  }
}

module.exports = {
  pickRotation,
  generateUseCase,
  pickFallbackCase,
  buildPrompt, // テスト用に公開
};
