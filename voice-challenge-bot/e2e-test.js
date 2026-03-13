// e2e-test.js
// 開発者が自動で全機能のエラーチェックを行うための通しテスト用スクリプトです。

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { postDailyScript } = require('./handlers/dailyPost');
const { handleAudioSubmission } = require('./handlers/participation');
const { announceWeeklyBest } = require('./handlers/weeklyBest');
const { checkAndPost } = require('./handlers/newsCollector');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('ready', async () => {
    console.log(`🤖 Botがオンラインになりました（テストモード: ${client.user.tag}）\n`);

    try {
        // --- Step 1. 機能A（毎日のお題投稿）のテスト ---
        console.log('▶️ 機能A: お題投稿のテストを開始します...');
        await postDailyScript(client);
        console.log('✅ 機能A: 完了\n');

        // --- Step 2. 機能B（参加検知・ロール付与）のテスト ---
        console.log('▶️ 機能B: 音声アップロード検知のテストを開始します...');

        const enjoyChannelId = process.env.ENJOY_CHANNEL_ID;
        const channel = await client.channels.fetch(enjoyChannelId).catch(() => null);

        if (channel) {
            // ユーザーが送信したメッセージのように振る舞う「偽物のメッセージ」を作ってプログラムに渡す
            const mockMessage = {
                id: 'dummy_msg_' + Date.now(),
                channelId: enjoyChannelId,
                author: {
                    id: '123456789012345678', // 架空のユーザーID
                    username: 'テスト・ユーザー',
                    bot: false
                },
                attachments: new Map([
                    ['dummy_attach', { name: 'test_voice.mp3' }] // 音声ファイルが添付されているフリ
                ]),
                react: async (emoji) => {
                    console.log(`　💬 [リアクション検知]: ${emoji}`);
                },
                channel: channel,
                // ロール付与テストのために必要なサーバー（Guild）情報のモック
                guild: {
                    roles: {
                        cache: [],
                        create: async (data) => {
                            console.log(`　⚙️ [ロール作成モック]: ${data.name}`);
                            return { name: data.name, id: 'role_dummy' };
                        }
                    },
                    members: {
                        fetch: async (id) => {
                            return {
                                id: id,
                                roles: {
                                    add: async (role) => { console.log(`　🏅 [ロール付与モック]: ${role.name} を付与`); }
                                }
                            };
                        }
                    }
                },
            };

            await handleAudioSubmission(mockMessage);
            console.log('✅ 機能B: 完了\n');
        } else {
            console.log('⚠️ エンジョイチャンネルが見つからないため、機能Bのテストをスキップします。\n');
        }

        // --- Step 3. 機能C（週間ベスト）のテスト ---
        console.log('▶️ 機能C: 週間ベスト集計のテストを開始します...');
        await announceWeeklyBest(client);
        console.log('✅ 機能C: 完了\n');

        // --- Step 4. 追加機能（ニュース取得）のテスト ---
        console.log('▶️ 機能追加: 声優ニュース取得のテストを開始します...');
        await checkAndPost(client);
        console.log('✅ 機能追加: 完了\n');

        console.log('🎉 すべての通しテスト（エラーチェック）が完了しました！');

    } catch (error) {
        console.error('❌ テスト中にエラーが発生しました:', error);
    } finally {
        // テストが終わったらBotを終了する
        process.exit(0);
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
