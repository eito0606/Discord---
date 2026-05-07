// handlers/voipoke/welcome-dm.js — 新規入室者へのウェルカム DM 送信
//
// M-5: ぼいラボ Discord 自動招待化
//
// 役割:
//   discord-oauth-callback Edge Function が guilds.join 成功後に
//   この Bot の /webhook/welcome-dm に POST してくる（または直接 DM 送信のみ）。
//   ユーザーの入室経路（source）に応じて 4 種類の DM 文面を出し分ける。
//
// 押し売り率 20% 以内：3 つのアクションのうちツール訴求は最後の 1 個のみ。
// ひらがな 7 割・体言止め活用・エイトの先輩口調で統一。
//
// 仕様参照: /Users/hidehisa/【監督】/specs/M-5-community-design-2026-05-07.md C セクション

/**
 * 経路ごとのウェルカム文面を返す
 * @param {string} source - 'voilab-lp' | 'voipoke-lp' | 'diagnosis' | 'organic'
 * @param {string|null} typeName - 診断経由のタイプ表示名（例: '翠タイプ'）
 * @returns {string} DM の本文
 */
function buildWelcomeMessage(source, typeName) {
    if (source === 'voilab-lp') {
        return [
            'ぼいラボにようこそ！',
            '',
            'エイトです。声優として活動しながら、声活をもっと楽しくする',
            'ツールをつくっています。',
            '',
            'きみがここに来てくれたことが、素直にうれしい。',
            '',
            'まず 3 つだけやってほしいことがあります。',
            '',
            '1.  #自己紹介 で自己紹介を投稿してみて',
            '     「声優志望○年目、得意な役柄は〜」くらいの気軽さで OK。',
            '     リアクションで迎えに行きます。',
            '',
            '2.  今日の台本を声に出してみて',
            '     毎日 18:00 に #今日の台本 にお題が届くので、',
            '     録音したら #練習報告 に投稿してね。',
            '     1 回やるだけで、習慣が変わりはじめます。',
            '',
            '3.  ぼいフォリオで自分のタイプを知っておいて',
            '     https://voifolio.reverb-lab.com',
            '     診断 3 分でできます。自分の声の強みが言語化されます。',
            '',
            'わからないことがあったら #雑談 で気軽に聞いてください。',
            'ここは「声の練習を続けるための場所」です。気負わなくて大丈夫。',
            '',
            '── エイト',
        ].join('\n');
    }

    if (source === 'voipoke-lp') {
        return [
            'VoiPoke 先行登録、ありがとう。',
            '',
            'エイトです。VoiPoke をつくっています。',
            '',
            '先行登録してくれたきみには、リリース前から',
            'ここで声の活動を一緒にやっていきたいと思っています。',
            '',
            'まず 3 つだけやってほしいことがあります。',
            '',
            '1.  #自己紹介 で自己紹介してみて',
            '     「声優志望/声活○年目、こんな声を出したい」くらいで OK。',
            '',
            '2.  #voipoke-先行メンバー を覗いてみて',
            '     先行登録者だけが入れるチャンネルです。',
            '     VoiPoke の進捗を一番はやく見せていく場所にしていきます。',
            '',
            '3.  練習習慣をつくっておこう',
            '     毎日 18:00 に #今日の台本 に台本が届きます。',
            '     VoiPoke でボイスをリリースするとき、',
            '     練習量が積み重なっていると強い。',
            '',
            'VoiPoke のリリース、一緒に待っていてください。',
            '',
            '── エイト',
        ].join('\n');
    }

    if (source === 'diagnosis') {
        const t = typeName || 'あなた';
        return [
            '診断、お疲れさまです！',
            '',
            `エイトです。あなたの診断結果は「${t}」でした。`,
            '',
            `${t} の声が持つ力は、`,
            'きちんと磨けばほんとうに武器になります。',
            '',
            'ぼいラボに入ってもらったので、まず 3 つやってみてほしいことがあります。',
            '',
            '1.  #診断結果ルーム で結果をシェアしてみて',
            '     同じタイプの人たちが集まっています。',
            `     「私も ${t} です！」それだけでもつながりのきっかけになります。`,
            '',
            '2.  #自己紹介 で自己紹介してみて',
            '     診断タイプを書くと、話しかけてもらいやすくなります。',
            '',
            '3.  #今日の台本 で声を出してみて',
            '     毎日 18:00 に台本が届きます。',
            `     ${t} の声の特性を意識しながら読んでみると、`,
            '     自分の声のくせがつかめるようになってきます。',
            '',
            '気になること、わからないことは #雑談 にどうぞ。',
            '',
            '── エイト',
        ].join('\n');
    }

    // organic（既定）
    return [
        'ようこそ、ぼいラボへ。',
        '',
        'エイトです。声優として活動しながら、',
        '声活ツールをつくっています。',
        '',
        '誰かの紹介で来てくれたんですね。来てくれてありがとう。',
        '',
        'まず 3 つだけやってほしいことがあります。',
        '',
        '1.  #自己紹介 で自己紹介してみて',
        '     どんな声の活動をしているか、ひとこと書くだけで OK。',
        '',
        '2.  #今日の台本 に参加してみて',
        '     毎日 18:00 に台本が届きます。',
        '     投稿すると、ほぼ確実に誰かがリアクションしてくれます。',
        '',
        '3.  ぼいフォリオで自分の声タイプを知っておいて',
        '     https://voifolio.reverb-lab.com',
        '     声の強みが言語化されると、練習の方向性が変わります。',
        '',
        'ここは「一人じゃない感」を感じながら声の活動を続けられる場所です。',
        '気軽にいてください。',
        '',
        '── エイト',
    ].join('\n');
}

/**
 * 入室者に DM を送信する
 *
 * @param {Client} client - discord.js Client
 * @param {string} discordUserId - 送信先 Discord ID
 * @param {string} source - 経路（voilab-lp / voipoke-lp / diagnosis / organic）
 * @param {string|null} typeName - 診断経由のタイプ表示名（任意）
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function sendWelcomeDm(client, discordUserId, source, typeName) {
    if (!discordUserId) {
        return { ok: false, reason: 'missing_user_id' };
    }
    const validSources = ['voilab-lp', 'voipoke-lp', 'diagnosis', 'organic'];
    const safeSource = validSources.includes(source) ? source : 'organic';

    let user;
    try {
        user = await client.users.fetch(discordUserId);
    } catch (err) {
        console.error(`[welcome-dm] Failed to fetch user ${discordUserId}:`, err);
        return { ok: false, reason: 'user_not_found' };
    }

    const content = buildWelcomeMessage(safeSource, typeName);

    try {
        await user.send({ content });
        console.log(`[welcome-dm] Sent welcome DM to ${discordUserId} (source=${safeSource})`);
        return { ok: true };
    } catch (err) {
        // DM が閉じられているユーザーには送れない（50007 Cannot send messages to this user）
        if (err && err.code === 50007) {
            console.warn(`[welcome-dm] DM closed for user ${discordUserId}, skipping`);
            return { ok: false, reason: 'dm_closed' };
        }
        console.error(`[welcome-dm] Failed to send DM to ${discordUserId}:`, err);
        return { ok: false, reason: 'send_failed' };
    }
}

module.exports = {
    sendWelcomeDm,
    buildWelcomeMessage, // テスト用にエクスポート
};
