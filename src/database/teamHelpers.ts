/**
 * Helper functions that bridge BotConfig (database) → TeamConfig (legacy format).
 *
 * Commands use these helpers instead of importing the static data.ts module.
 * The TeamConfig shape is kept for backwards-compatibility with
 * workshopManager and other modules that still rely on it.
 */

import { BotConfig } from "./models/BotConfig";
import type { IBotConfig } from "./models/BotConfig";
import type { TeamConfig } from "../data";

// ─── Mapper ──────────────────────────────────────────────────────────

/**
 * Convert a single BotConfig document to the legacy TeamConfig shape.
 * For split teams pass `"beginner"` or `"advanced"` to get the correct
 * sub-group token / voice channel.
 */
export function toTeamConfig(
    config: IBotConfig,
    subGroup?: "beginner" | "advanced"
): TeamConfig {
    if (config.isSplit && subGroup) {
        return {
            BotId: "",
            token:
                subGroup === "beginner"
                    ? config.splitConfig?.botToken1 || ""
                    : config.splitConfig?.botToken2 || "",
            TeamName: `${config.teamName} (${subGroup === "beginner" ? "Beginner" : "Advanced"})`,
            voiceChannelID:
                subGroup === "beginner"
                    ? config.splitConfig?.voiceChannelId1 || ""
                    : config.splitConfig?.voiceChannelId2 || "",
            LeaderID: config.leaderRoleId,
            MemberRole1ID: config.membersRoleId,
            MemberRole2ID: config.additionalMembersRoleId || "",
            LeaderChatChannelID: config.leaderChatChannelId,
            GeneralAnnouncementID: config.generalAnnChannelId,
        };
    }

    return {
        BotId: config.botId || "",
        token: config.botToken || "",
        TeamName: config.teamName,
        voiceChannelID: config.voiceChannelId || "",
        LeaderID: config.leaderRoleId,
        MemberRole1ID: config.membersRoleId,
        MemberRole2ID: config.additionalMembersRoleId || "",
        LeaderChatChannelID: config.leaderChatChannelId,
        GeneralAnnouncementID: config.generalAnnChannelId,
    };
}

// ─── Query helpers ───────────────────────────────────────────────────

/**
 * Return every active team as a TeamConfig[].
 * Split teams are expanded into two entries (Beginner + Advanced).
 */
export async function getAllTeamConfigs(): Promise<TeamConfig[]> {
    const configs = await BotConfig.find({ isActive: true });
    const result: TeamConfig[] = [];

    for (const c of configs) {
        if (c.isSplit) {
            result.push(toTeamConfig(c, "beginner"));
            result.push(toTeamConfig(c, "advanced"));
        } else {
            result.push(toTeamConfig(c));
        }
    }

    return result;
}

/**
 * Resolve a team by its display name (supports split names like "Ai (Beginner)").
 */
export async function getTeamConfigByName(
    teamName: string
): Promise<TeamConfig | null> {
    const beginnerMatch = teamName.match(/^(.+) \(Beginner\)$/);
    const advancedMatch = teamName.match(/^(.+) \(Advanced\)$/);

    if (beginnerMatch) {
        const config = await BotConfig.findOne({
            teamName: beginnerMatch[1],
            isActive: true,
        });
        return config ? toTeamConfig(config, "beginner") : null;
    }

    if (advancedMatch) {
        const config = await BotConfig.findOne({
            teamName: advancedMatch[1],
            isActive: true,
        });
        return config ? toTeamConfig(config, "advanced") : null;
    }

    const config = await BotConfig.findOne({ teamName, isActive: true });
    return config ? toTeamConfig(config) : null;
}

/**
 * Find the team whose `leaderRoleId` appears in the given set of role IDs.
 */
export async function getTeamConfigByLeaderRole(
    memberRoles: string[]
): Promise<TeamConfig | null> {
    const config = await BotConfig.findOne({
        leaderRoleId: { $in: memberRoles },
        isActive: true,
    });
    return config ? toTeamConfig(config) : null;
}
