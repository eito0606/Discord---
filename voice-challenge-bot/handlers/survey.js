// handlers/survey.js — アンケートBot機能のメインモジュール
// チャンネルにEmbed＋ボタンを設置し、ユーザーがボタンを押すとプライベートスレッドで
// 1対1のアンケートを実施する。全問回答後にGemini APIで分類し、運営チャンネルに通知する。

const {
    EmbedBuilder,       // Embed（装飾付きメッセージ）を作るための道具
    ActionRowBuilder,   // ボタンを並べる「棚」のようなもの
    ButtonBuilder,      // ボタン1つ1つを作る道具
    ButtonStyle,        // ボタンの見た目（色など）を決める定数
    ChannelType,        // チャンネルの種類を指定する定数
    ThreadAutoArchiveDuration, // スレッドの自動アーカイブまでの時間を指定する定数
} = require('discord.js');

const path = require('path');

// 質問データを外部JSONファイルから読み込む
// → これにより、質問を変えたいときはJSONを書き換えてBotを再起動するだけでOK
const surveyData = require(path.join(__dirname, '..', 'data', 'surveyQuestions.json'));

// データベース関連の関数を読み込む
const { checkSurveyCooldown, recordSurveyCompletion } = require('../db');

// Gemini APIクライアントを読み込む（既存の共用モジュール）
const { generateText } = require('./geminiClient');

// スプレッドシート記録モジュールを読み込む
const { recordToSheet } = require('./surveySheet');

// ==========================================
// 定数の定義
// ==========================================

// ボタンのカスタムID（ボタンを識別するための名前）
const SURVEY_BUTTON_ID = 'survey_start';

// 回答待ちのタイムアウト時間（5分 = 300,000ミリ秒）
const TIMEOUT_MS = 5 * 60 * 1000;

// ==========================================
// 1. Embed＋ボタン設置機能
// ==========================================

// アンケートチャンネルにEmbed（装飾付きメッセージ）とボタンを設置する関数
// !survey コマンドで呼び出される
// channel: メッセージを送りたいDiscordチャンネル
async function setupSurveyMessage(channel) {
    // Embedメッセージを作成（カード型の見やすいメッセージ）
    const embed = new EmbedBuilder()
        .setTitle('📋 ぼいラボ アンケート')
        .setDescription(
            'ぼいラボをもっと良くするために、あなたの声を聞かせてください！\n\n' +
            '全5問・所要時間は約2分です。\n' +
            '下のボタンを押すと、あなた専用のスレッドが作られて\n' +
            'Botと1対1でアンケートに回答できます。\n\n' +
            '※ 回答は運営のみが確認でき、他のメンバーには見えません。\n' +
            '※ 7日間に1回まで回答できます。'
        )
        .setColor(0x5865F2) // Discordのブランドカラー（青紫）
        .setFooter({ text: 'ぼいラボ運営チーム' });

    // ボタンを作成
    const button = new ButtonBuilder()
        .setCustomId(SURVEY_BUTTON_ID)  // ボタンを識別するためのID
        .setLabel('📋 アンケートに回答する')  // ボタンに表示する文字
        .setStyle(ButtonStyle.Primary);  // 青色のボタン

    // ボタンを「棚」に載せる（1行に並べるイメージ）
    const row = new ActionRowBuilder().addComponents(button);

    // チャンネルにEmbedとボタンを送信
    await channel.send({ embeds: [embed], components: [row] });
}

// ==========================================
// 2. ボタン押下時の処理
// ==========================================

// ユーザーがボタンを押したときに呼ばれる関数
// interaction: ボタンが押されたときにDiscordから届くイベント情報
async function handleSurveyButton(interaction) {
    // このモジュールが担当するボタンかどうかを確認
    if (interaction.customId !== SURVEY_BUTTON_ID) return;

    const user = interaction.user;

    // ── クールダウンチェック（7日以内に回答済みか？） ──
    const cooldown = checkSurveyCooldown(user.id);
    if (!cooldown.canAnswer) {
        // まだクールダウン中の場合、こっそりメッセージを返す（本人にしか見えない）
        await interaction.reply({
            content: `⏳ 前回の回答から7日経っていません。あと **${cooldown.remainingDays}日** 後に再回答できます。`,
            ephemeral: true, // ephemeral = 本人にしか見えないメッセージ
        });
        return;
    }

    // ── プライベートスレッドを作成 ──
    // まず「処理中です」と返事をする（3秒以内に返事しないとDiscordがエラーになるため）
    await interaction.deferReply({ ephemeral: true });

    try {
        // ボタンが押されたチャンネルにプライベートスレッドを作成
        const thread = await interaction.channel.threads.create({
            name: `📋アンケート_${user.displayName}`,  // スレッドのタイトル
            type: ChannelType.PrivateThread,           // プライベート（参加者以外見えない）
            autoArchiveDuration: ThreadAutoArchiveDuration.OneHour, // 1時間後に自動アーカイブ
            reason: `${user.displayName} のアンケート回答用スレッド`,
        });

        // スレッドにユーザーを招待（作成者であるBotは自動的に参加済み）
        await thread.members.add(user.id);

        // 「スレッドを作りました」と返事する
        await interaction.editReply({
            content: `✅ アンケート用のスレッドを作成しました！\n👉 <#${thread.id}> で回答してください。`,
        });

        // スレッド内でアンケートを開始
        await runSurveyInThread(thread, user, interaction.client);

    } catch (error) {
        console.error('アンケートスレッド作成エラー:', error);
        await interaction.editReply({
            content: '❌ スレッドの作成中にエラーが発生しました。もう一度お試しください。',
        });
    }
}

// ==========================================
// 3. スレッド内での質問ループ
// ==========================================

// スレッド内で質問を1問ずつ投稿し、回答を集める関数
// thread: 作成したプライベートスレッド
// user: 回答するユーザー
// client: Botのクライアント（通知送信に使用）
async function runSurveyInThread(thread, user, client) {
    const questions = surveyData.questions;
    const answers = {}; // 全回答を格納するオブジェクト（箱）

    // ウェルカムメッセージ
    await thread.send(
        `こんにちは、${user.displayName} さん！🎤\n\n` +
        'ぼいラボのアンケートにご協力ありがとうございます。\n' +
        '全5問のアンケートです。1問ずつ質問しますので、メッセージで回答してください。\n' +
        '**5分以内** に回答がない場合は自動的に終了します。\n\n' +
        'それでは始めましょう！\n' +
        '━━━━━━━━━━━━━━━━━━━━'
    );

    // ── 各質問を順番に出題するループ ──
    for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        const questionNumber = i + 1;

        // 質問メッセージを作成
        let questionText = `**【${questionNumber}/${questions.length}】** ${question.text}\n\n`;

        // 選択肢がある場合は番号付きで表示
        if (question.options.length > 0) {
            const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];
            question.options.forEach((opt, idx) => {
                questionText += `${emojis[idx]} ${opt}\n`;
            });
            questionText += '\n';
        }

        // 回答方法の案内を追加
        if (question.type === 'single') {
            questionText += `→ 1〜${question.options.length}の数字で **1つ** 送ってください（全角OK）`;
        } else if (question.type === 'multiple') {
            questionText += '→ 数字だけを **連続して** 送ってください（全角OK）\n';
            questionText += '例：13 / 124 / 6\n';
            questionText += '※スペース・カンマ等の区切り不可、同じ数字の重複NG';
        } else if (question.type === 'free') {
            // 自由記述の場合は案内なし（question.text に含まれている）
        }

        await thread.send(questionText);

        // ── 回答を待つ（バリデーション付き） ──
        const answer = await collectAnswer(thread, user, question);

        // タイムアウトの場合はアンケートを中断
        if (answer === null) {
            await thread.send('⏰ 時間切れです。また回答してくださいね！');
            // スレッドをアーカイブ（閉じる）
            await thread.setArchived(true);
            return;
        }

        // 回答を保存
        answers[question.id] = answer;
    }

    // ── 全問回答完了 ──
    await thread.send(
        '━━━━━━━━━━━━━━━━━━━━\n' +
        '✅ 全ての質問に回答いただきました！ありがとうございます！ 🎉\n\n' +
        'AIがあなたの回答を分析しています...'
    );

    // 回答をクールダウンに記録（7日間は再回答不可にする）
    recordSurveyCompletion(user.id);

    // ── Gemini APIで分類 ──
    const geminiResult = await classifyWithGemini(answers);

    // ── 運営専用チャンネルに結果を通知 ──
    await sendResultEmbed(client, answers, geminiResult, user);

    // ── スプレッドシートに記録 ──
    await sendToSheet(answers, geminiResult, user);

    // 完了メッセージ
    await thread.send(
        '回答の記録が完了しました！\n' +
        'あなたの声はぼいラボの改善に役立てさせていただきます。\n' +
        'このスレッドは自動的にアーカイブされます。📁'
    );

    // スレッドをアーカイブ
    await thread.setArchived(true);
}

// ==========================================
// 4. 回答収集＋バリデーション
// ==========================================

// 1問分の回答を収集する関数（正しい回答が来るまで再質問する）
// thread: スレッド
// user: 回答者
// question: 現在の質問データ
// 戻り値: 正しい回答（タイムアウト時はnull）
async function collectAnswer(thread, user, question) {
    // 正しい回答が来るまで繰り返す
    while (true) {
        try {
            // ユーザーのメッセージを待つ（フィルタ付き）
            // awaitMessages: 「指定した条件に合うメッセージが来るまで待つ」機能
            const collected = await thread.awaitMessages({
                // フィルタ: Botではなく、回答者本人のメッセージだけを受け取る
                filter: (msg) => msg.author.id === user.id && !msg.author.bot,
                max: 1,              // 1件メッセージが来たら終了
                time: TIMEOUT_MS,    // 5分でタイムアウト
                errors: ['time'],    // タイムアウト時にエラーを投げる
            });

            const message = collected.first();
            let rawAnswer = message.content.trim(); // 回答テキスト（前後の空白を除去）

            // ── バリデーション（回答が正しいか検証する） ──
            const validation = validateAnswer(rawAnswer, question);

            if (validation.valid) {
                return validation.value; // 正しい回答を返す
            } else {
                // 不正な回答の場合、理由を添えて再質問
                await thread.send(`⚠️ ${validation.message}\nもう一度入力してください。`);
                // ループの先頭に戻って再度回答を待つ
            }
        } catch (error) {
            // タイムアウトの場合
            return null;
        }
    }
}

// 回答のバリデーション（正しさチェック）を行う関数
// rawAnswer: ユーザーが送った生のテキスト
// question: 質問データ（type, options を参照）
// 戻り値: { valid: true/false, value: 整形済み回答, message: エラー理由 }
function validateAnswer(rawAnswer, question) {
    // ── 前処理：全角数字を半角に変換 ──
    // 「１２３」→「123」のように変換する（日本語入力で全角数字を打ってしまう場合への対応）
    const normalized = rawAnswer.replace(/[０-９]/g, (char) => {
        return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
    });

    if (question.type === 'single') {
        // ── 単一選択の場合 ──
        const num = parseInt(normalized, 10);
        if (isNaN(num) || num < 1 || num > question.options.length) {
            return {
                valid: false,
                message: `1〜${question.options.length}の数字を1つだけ入力してください。`,
            };
        }
        // 数字が1文字かどうかもチェック（「12」のように2桁入力された場合を弾く）
        if (normalized.trim().length !== 1) {
            return {
                valid: false,
                message: `数字を **1つだけ** 入力してください。`,
            };
        }
        return { valid: true, value: num };

    } else if (question.type === 'multiple') {
        // ── 複数選択の場合 ──
        // 入力が数字だけかチェック（スペース・カンマ・スラッシュなどが含まれていたらNG）
        if (!/^\d+$/.test(normalized.trim())) {
            return {
                valid: false,
                message: '数字だけを連続して入力してください（区切り文字は不要です）。',
            };
        }

        // 1文字ずつ分割して数値の配列にする（例：「124」→ [1, 2, 4]）
        const digits = normalized.trim().split('').map(Number);

        // 範囲チェック（各数字が選択肢の範囲内か）
        for (const d of digits) {
            if (d < 1 || d > question.options.length) {
                return {
                    valid: false,
                    message: `1〜${question.options.length}の数字だけを使ってください。「${d}」は範囲外です。`,
                };
            }
        }

        // 重複チェック（同じ数字が2回以上含まれていないか）
        const uniqueDigits = new Set(digits); // Set = 重複を自動排除する入れ物
        if (uniqueDigits.size !== digits.length) {
            return {
                valid: false,
                message: '同じ数字が重複しています。重複なしで入力してください。',
            };
        }

        return { valid: true, value: digits };

    } else if (question.type === 'free') {
        // ── 自由記述の場合 ──
        if (!rawAnswer || rawAnswer.trim().length === 0) {
            return {
                valid: false,
                message: '何か入力してください。特になければ「なし」と入力してください。',
            };
        }
        return { valid: true, value: rawAnswer.trim() };
    }

    // 未知のタイプ（通常ここには来ない）
    return { valid: true, value: rawAnswer };
}

// ==========================================
// 5. Gemini APIによる自動分類
// ==========================================

// 全回答をGemini APIに送り、分類結果をJSON形式で受け取る関数
// answers: { q1: 数値, q2: [数値配列], q3: 数値, q4: [数値配列], q5: 文字列 }
// 戻り値: { priority, tag, summary, action_suggestion }
async function classifyWithGemini(answers) {
    const questions = surveyData.questions;

    // 回答を人間が読めるテキストに変換する
    // q1: 数字 → 選択肢テキスト（例：1 → 「とても満足」）
    const q1Text = questions[0].options[answers.q1 - 1];
    // q2: 数字配列 → 選択肢テキスト配列（例：[1, 3] → 「どこに投稿すればいいかわからなかった, Botの使い方がわからなかった」）
    const q2Text = answers.q2.map(n => questions[1].options[n - 1]).join(', ');
    const q3Text = questions[2].options[answers.q3 - 1];
    const q4Text = answers.q4.map(n => questions[3].options[n - 1]).join(', ');
    const q5Text = answers.q5;

    // ⚠️ セキュリティ確認ポイント：
    // ここではアンケートの回答内容（選択肢テキストと自由記述）のみをGemini APIに送信します。
    // ユーザー名、ユーザーID、サーバー情報などの個人情報は送信しません。
    const prompt = `以下のアンケート回答を分析し、JSONで返してください。

満足度：${q1Text}
困った点：${q2Text}
よく使う機能：${q3Text}
追加希望機能：${q4Text}
自由記述：${q5Text}

以下の形式で返してください（JSON以外のテキストは含めないでください）：
{
  "priority": "高" or "中" or "低",
  "tag": "Bot機能" or "台本" or "UI/UX" or "案件情報" or "コミュニティ" or "その他",
  "summary": "回答全体の要約を1行で",
  "action_suggestion": "運営が取るべきアクションを1行で"
}`;

    try {
        const resultText = await generateText(prompt);

        if (!resultText) {
            throw new Error('Gemini APIからの応答が空でした');
        }

        // AIの回答からJSON部分だけを抽出する
        // （AIがJSON以外のテキストを含める場合があるため、{ } で囲まれた部分を探す）
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Gemini APIの応答からJSONを抽出できませんでした');
        }

        const parsed = JSON.parse(jsonMatch[0]);
        return {
            priority: parsed.priority || '中',
            tag: parsed.tag || 'その他',
            summary: parsed.summary || '要約なし',
            action_suggestion: parsed.action_suggestion || '提案なし',
        };
    } catch (error) {
        // Gemini APIエラー時は「未分類」として処理を続行する
        console.error('Gemini API分類エラー:', error);
        return {
            priority: '中',
            tag: '未分類',
            summary: '（AI分類に失敗しました）',
            action_suggestion: '手動で回答内容を確認してください',
        };
    }
}

// ==========================================
// 6. 運営専用チャンネルへのEmbed通知
// ==========================================

// 運営チャンネルに分析結果をEmbed形式で送信する関数
// client: Botのクライアント
// answers: 全回答データ
// geminiResult: Geminiの分類結果
// user: 回答したユーザー
async function sendResultEmbed(client, answers, geminiResult, user) {
    const logChannelId = process.env.SURVEY_LOG_CHANNEL_ID;
    if (!logChannelId) {
        console.warn('⚠️ SURVEY_LOG_CHANNEL_IDが設定されていません。運営通知をスキップします。');
        return;
    }

    const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
    if (!logChannel) {
        console.error('❌ 運営アンケート結果チャンネルが見つかりません:', logChannelId);
        return;
    }

    const questions = surveyData.questions;

    // 回答をテキストに変換
    const q1Text = questions[0].options[answers.q1 - 1];
    const q2Text = answers.q2.map(n => questions[1].options[n - 1]).join('\n');
    const q3Text = questions[2].options[answers.q3 - 1];
    const q4Text = answers.q4.map(n => questions[3].options[n - 1]).join('\n');

    // 優先度に応じたEmbed色を決定
    // 高→赤、中→黄、低→緑（信号機のイメージ）
    const colorMap = {
        '高': 0xFF0000, // 赤
        '中': 0xFFAA00, // 黄色（オレンジ寄り）
        '低': 0x00CC00, // 緑
    };
    const embedColor = colorMap[geminiResult.priority] || 0x808080;

    const embed = new EmbedBuilder()
        .setTitle('📋 新しいアンケート回答')
        .setColor(embedColor)
        .addFields(
            { name: '👤 回答者', value: user.displayName || user.username, inline: true },
            { name: '⭐ 満足度', value: `⭐ ${answers.q1}/5（${q1Text}）`, inline: true },
            { name: '\u200b', value: '\u200b', inline: true }, // 空のフィールド（改行用）
            { name: '😣 困った点', value: q2Text || 'なし' },
            { name: '🔧 よく使う機能', value: q3Text, inline: true },
            { name: '💡 追加希望', value: q4Text || 'なし', inline: true },
            { name: '💬 自由記述', value: answers.q5 },
            { name: '🏷️ AIタグ', value: geminiResult.tag, inline: true },
            { name: '🚨 AI優先度', value: geminiResult.priority, inline: true },
            { name: '📝 AI要約', value: geminiResult.summary },
            { name: '🎯 AI推奨アクション', value: geminiResult.action_suggestion },
        )
        .setTimestamp() // 現在の日時を自動で付与
        .setFooter({ text: `ユーザーID: ${user.id}` });

    await logChannel.send({ embeds: [embed] });
}

// ==========================================
// 7. スプレッドシート記録
// ==========================================

// GAS Web Appにデータを送信してスプレッドシートに記録する関数
async function sendToSheet(answers, geminiResult, user) {
    const questions = surveyData.questions;

    // 回答をテキストに変換
    const q2Text = answers.q2.map(n => questions[1].options[n - 1]).join(', ');
    const q4Text = answers.q4.map(n => questions[3].options[n - 1]).join(', ');

    const data = {
        timestamp: new Date().toISOString(),
        userName: user.displayName || user.username,
        userId: user.id,
        q1: answers.q1,
        q2: q2Text,
        q3: questions[2].options[answers.q3 - 1],
        q4: q4Text,
        q5: answers.q5,
        priority: geminiResult.priority,
        tag: geminiResult.tag,
        summary: geminiResult.summary,
        actionSuggestion: geminiResult.action_suggestion,
        status: '未対応',
    };

    // ⚠️ セキュリティ確認ポイント：
    // ユーザー名・ユーザーID・回答内容のみをGAS Web Appに送信します。
    // Discordトークンやサーバー機密情報は送信しません。
    await recordToSheet(data);
}

// ==========================================
// エクスポート（他のファイルから使えるようにする）
// ==========================================
module.exports = {
    setupSurveyMessage,
    handleSurveyButton,
    SURVEY_BUTTON_ID,
};
