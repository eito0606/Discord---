// role-sync.js — VoiPoke からのリクエストで Discord ロールを付与・剥奪する処理
// 例：ユーザーが VoiPoke で「プレミアリスナー」サブスクに加入
//   → VoiPoke 側がBotの /sync-roles に POST
//   → Bot がぼいラボサーバーで該当ユーザーに「プレミアリスナー」ロールを付与
//
// このファイルが扱うのは「ロールの付け外し」だけ。
// 「誰にどのロールを与えるか」の判断は VoiPoke 側で行う。Bot は実行係。

/**
 * 指定ユーザーのロールを付与・剥奪する
 *
 * @param {Client} client - discord.js の Client インスタンス
 * @param {string} discordUserId - 対象ユーザーの Discord ID
 * @param {string[]} rolesToAdd - 付与するロール ID の配列
 * @param {string[]} rolesToRemove - 剥奪するロール ID の配列
 */
async function handleRoleSync(client, discordUserId, rolesToAdd, rolesToRemove) {
  // 入力バリデーション：必須情報が欠けていれば早期に終了
  if (!discordUserId) {
    throw new Error('discordUserId is required');
  }
  if (!Array.isArray(rolesToAdd)) rolesToAdd = [];
  if (!Array.isArray(rolesToRemove)) rolesToRemove = [];

  const guildId = process.env.VOIPOKE_GUILD_ID;
  if (!guildId) {
    throw new Error('VOIPOKE_GUILD_ID is not set in environment variables');
  }

  // ぼいラボサーバー情報を取得
  let guild;
  try {
    guild = await client.guilds.fetch(guildId);
  } catch (err) {
    console.error(`[VoiPoke] Failed to fetch guild ${guildId}:`, err);
    throw new Error(`Guild ${guildId} not found or Bot has no access`);
  }

  // 対象ユーザーをサーバーから取得
  // ユーザーがサーバーに参加していない場合（10007 Unknown Member）は
  // 警告ログを出して正常終了する（VoiPoke 側でユーザーが Discord 連携前のケースなど）
  let member;
  try {
    member = await guild.members.fetch(discordUserId);
  } catch (err) {
    if (err.code === 10007) {
      console.warn(`[VoiPoke] User ${discordUserId} is not a member of guild ${guildId}. Skipping role sync.`);
      return; // 未参加ユーザーは正常終了扱い
    }
    console.error(`[VoiPoke] Failed to fetch member ${discordUserId}:`, err);
    throw err;
  }

  // ロール付与処理（既に持っていても discord.js 側で冪等に処理される）
  for (const roleId of rolesToAdd) {
    if (!roleId) continue; // 空文字や undefined はスキップ
    try {
      await member.roles.add(roleId);
      console.log(`[VoiPoke] Added role ${roleId} to user ${discordUserId}`);
    } catch (err) {
      // 個別ロール失敗は記録のみで処理を続行（一部失敗で全部止まらないように）
      console.error(`[VoiPoke] Failed to add role ${roleId} to ${discordUserId}:`, err.message);
    }
  }

  // ロール剥奪処理（持っていなければ discord.js が何もしない）
  for (const roleId of rolesToRemove) {
    if (!roleId) continue;
    try {
      await member.roles.remove(roleId);
      console.log(`[VoiPoke] Removed role ${roleId} from user ${discordUserId}`);
    } catch (err) {
      console.error(`[VoiPoke] Failed to remove role ${roleId} from ${discordUserId}:`, err.message);
    }
  }
}

module.exports = { handleRoleSync };
