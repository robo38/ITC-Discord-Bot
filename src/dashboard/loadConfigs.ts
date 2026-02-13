/**
 * Load team configurations from the BotConfig collection in MongoDB.
 * Returns them in the same TeamConfig shape that the rest of the codebase expects,
 * so the voice bot manager and other consumers continue working unchanged.
 */
import { BotConfig, IBotConfig } from "../database/models/BotConfig";
import type { TeamConfig } from "../data";

/**
 * Fetch all active BotConfigs from the database and convert them
 * into TeamConfig[] that the voice bot system understands.
 *
 * Split teams are expanded into two entries (Beginner + Advanced).
 */
export async function loadTeamConfigsFromDB(): Promise<TeamConfig[]> {
    const configs: IBotConfig[] = await BotConfig.find({ isActive: true }).lean();
    const result: TeamConfig[] = [];

    for (const cfg of configs) {
        if (cfg.isSplit && cfg.splitConfig) {
            // Beginner sub-group
            result.push({
                BotId: "",
                token: cfg.splitConfig.botToken1,
                TeamName: `${cfg.teamName} (Beginner)`,
                voiceChannelID: cfg.splitConfig.voiceChannelId1,
                LeaderID: cfg.leaderRoleId || "",
                MemberRole1ID: cfg.membersRoleId,
                MemberRole2ID: cfg.additionalMembersRoleId || "",
                LeaderChatChannelID: cfg.leaderChatChannelId,
                GeneralAnnouncementID: cfg.generalAnnChannelId,
            });
            // Advanced sub-group
            result.push({
                BotId: "",
                token: cfg.splitConfig.botToken2,
                TeamName: `${cfg.teamName} (Advanced)`,
                voiceChannelID: cfg.splitConfig.voiceChannelId2,
                LeaderID: cfg.leaderRoleId || "",
                MemberRole1ID: cfg.membersRoleId,
                MemberRole2ID: cfg.additionalMembersRoleId || "",
                LeaderChatChannelID: cfg.leaderChatChannelId,
                GeneralAnnouncementID: cfg.generalAnnChannelId,
            });
        } else {
            result.push({
                BotId: cfg.botId || "",
                token: cfg.botToken || "",
                TeamName: cfg.teamName,
                voiceChannelID: cfg.voiceChannelId || "",
                LeaderID: cfg.leaderRoleId || "",
                MemberRole1ID: cfg.membersRoleId,
                MemberRole2ID: cfg.additionalMembersRoleId || "",
                LeaderChatChannelID: cfg.leaderChatChannelId,
                GeneralAnnouncementID: cfg.generalAnnChannelId,
            });
        }
    }

    return result;
}

/**
 * Convert a single BotConfig document into TeamConfig(s).
 * Returns 1 entry for normal bots, 2 entries for split bots.
 */
export function botConfigToTeamConfigs(cfg: any): TeamConfig[] {
    const result: TeamConfig[] = [];

    if (cfg.isSplit && cfg.splitConfig) {
        result.push({
            BotId: "",
            token: cfg.splitConfig.botToken1,
            TeamName: `${cfg.teamName} (Beginner)`,
            voiceChannelID: cfg.splitConfig.voiceChannelId1,
            LeaderID: cfg.leaderRoleId || "",
            MemberRole1ID: cfg.membersRoleId,
            MemberRole2ID: cfg.additionalMembersRoleId || "",
            LeaderChatChannelID: cfg.leaderChatChannelId,
            GeneralAnnouncementID: cfg.generalAnnChannelId,
        });
        result.push({
            BotId: "",
            token: cfg.splitConfig.botToken2,
            TeamName: `${cfg.teamName} (Advanced)`,
            voiceChannelID: cfg.splitConfig.voiceChannelId2,
            LeaderID: cfg.leaderRoleId || "",
            MemberRole1ID: cfg.membersRoleId,
            MemberRole2ID: cfg.additionalMembersRoleId || "",
            LeaderChatChannelID: cfg.leaderChatChannelId,
            GeneralAnnouncementID: cfg.generalAnnChannelId,
        });
    } else {
        result.push({
            BotId: cfg.botId || "",
            token: cfg.botToken || "",
            TeamName: cfg.teamName,
            voiceChannelID: cfg.voiceChannelId || "",
            LeaderID: cfg.leaderRoleId || "",
            MemberRole1ID: cfg.membersRoleId,
            MemberRole2ID: cfg.additionalMembersRoleId || "",
            LeaderChatChannelID: cfg.leaderChatChannelId,
            GeneralAnnouncementID: cfg.generalAnnChannelId,
        });
    }

    return result;
}
