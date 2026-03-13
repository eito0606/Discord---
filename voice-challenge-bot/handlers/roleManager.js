// handlers/roleManager.js — 参加日数に応じてロール（勲章）を付与する機能
// 何日続いたかをチェックし、条件に合っていればサーバー上の役職（ロール）を持たせます。

const { db } = require('../db');

// 何日継続したらどのロール名を与えるか、という対応表（辞書のようなもの）
const ROLE_MILESTONES = {
    3: '3日継続',
    7: '7日継続',
    14: '14日継続',
    30: '30日継続',
    60: '60日継続',
    100: '100日継続',
};

/**
 * ユーザーの連続参加日数を見て、新しいロールを付与するかどうかを判断し、実行する関数。
 * 
 * @param {Message} message - ユーザーが送信したメッセージの情報
 * @param {number} streak - 現在の連続参加日数
 */
async function checkAndGrantRole(message, streak) {
    // 1. 今の連続日数が「ロールをもらえる日数」のどれかに当てはまるかチェック
    const roleName = ROLE_MILESTONES[streak];

    // 当てはまらなければ（例：4日目や8日目なら）ここで終わり
    if (!roleName) return;

    // 2. データベースを確認して、既に同じロールをもらっていないかチェック
    const existingGrant = db.prepare(`
    SELECT * FROM role_grants 
    WHERE user_id = ? AND role_name = ?
  `).get(message.author.id, roleName);

    // 過去に同じ日数（例: 以前も3日継続したことがある）でもらっていたら二重で付与しない
    if (existingGrant) return;

    // 3. Discordのサーバー上から、付与すべきロールを探す
    const guild = message.guild; // サーバー情報
    let role = guild.roles.cache.find((r) => r.name === roleName);

    // もし対象のロール名がサーバーに作られていなければ、作ってあげる
    if (!role) {
        try {
            // ⚠️ セキュリティ確認ポイント：サーバーの設定（ロール）を自動で作成します
            role = await guild.roles.create({
                name: roleName,
                reason: '声優チャレンジBot：継続日数のマイルストーン達成のため自動作成',
            });
            console.log(`新しいロール「${roleName}」を作成しました`);
        } catch (error) {
            console.error(`ロール「${roleName}」の作成に失敗しました:`, error);
            return;
        }
    }

    // 4. メッセージを送ったユーザー（メンバー情報）を取得して、ロールを付与する
    try {
        const member = await guild.members.fetch(message.author.id);
        await member.roles.add(role);

        // 5. データベースに「いつ、誰に、このロールをあげました」と記録する
        const now = new Date().toISOString();
        db.prepare(`
      INSERT INTO role_grants (user_id, role_name, streak_days, granted_at)
      VALUES (?, ?, ?, ?)
    `).run(message.author.id, roleName, streak, now);

        // 6. みんなにお祝いのメッセージを投稿する
        await message.channel.send(
            `🎉 <@${message.author.id}> さんが【${roleName}】を達成しました！\n継続して声を出し続けています 💪`
        );

    } catch (error) {
        console.error(`ロール「${roleName}」の付与に失敗しました:`, error);
    }
}

// 他のファイルから関数を使えるようにする
module.exports = {
    checkAndGrantRole,
};
