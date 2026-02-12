/**
 * Central configuration for all 18 teams.
 * All values are read from environment variables (.env file).
 *
 * Each team has its own voice bot, voice channel, leader, roles, and channels.
 * Teams can optionally be SPLIT into Beginner + Advanced sub-groups,
 * each with their own bot and voice channel.
 *
 *   SPLIT=false → one bot, one voice channel (fallback values).
 *   SPLIT=true  → two bots, two voice channels (beginner + advanced).
 *
 * Fields:
 *   - BotId:                  The application/client ID of this team's voice bot
 *   - token:                  The bot token for this team's voice bot
 *   - TeamName:               Human-readable team name
 *   - voiceChannelID:         The voice channel the bot sits in
 *   - LeaderID:               Discord user ID of the team leader
 *   - MemberRole1ID:          "First team" role  (Team1 from teamsConfig)
 *   - MemberRole2ID:          "Second team" role  (Team2 from teamsConfig)
 *   - LeaderChatChannelID:    Text channel where the leader receives reports
 *   - GeneralAnnouncementID:  General announcement channel for the team
 */

export interface TeamConfig {
    BotId: string;
    token: string;
    TeamName: string;
    voiceChannelID: string;
    LeaderID: string;
    MemberRole1ID: string;
    MemberRole2ID: string;
    LeaderChatChannelID: string;
    GeneralAnnouncementID: string;
}

/** Single BE (back-end) user ID — shared across all teams */
export const BE_ID: string = process.env.BE_ID || "";

const env = process.env;

const teamsData: TeamConfig[] = [
    {
        BotId: env.TEAM_AI_BOT_ID || "",
        token: env.TEAM_AI_TOKEN || "",
        TeamName: "Ai",
        voiceChannelID: env.TEAM_AI_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_AI_LEADER_ID || "",
        MemberRole1ID: "1192409709832060990",
        MemberRole2ID: "1192527047675871252",
        LeaderChatChannelID: env.TEAM_AI_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_AI_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_SECURITY_BOT_ID || "",
        token: env.TEAM_SECURITY_TOKEN || "",
        TeamName: "Security",
        voiceChannelID: env.TEAM_SECURITY_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_SECURITY_LEADER_ID || "",
        MemberRole1ID: "1192409890312962070",
        MemberRole2ID: "1192527217402585121",
        LeaderChatChannelID: env.TEAM_SECURITY_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_SECURITY_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_ROBOTIC_BOT_ID || "",
        token: env.TEAM_ROBOTIC_TOKEN || "",
        TeamName: "Robotic",
        voiceChannelID: env.TEAM_ROBOTIC_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_ROBOTIC_LEADER_ID || "",
        MemberRole1ID: "1192410144395501568",
        MemberRole2ID: "1192527377583046666",
        LeaderChatChannelID: env.TEAM_ROBOTIC_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_ROBOTIC_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_MARKETING_BOT_ID || "",
        token: env.TEAM_MARKETING_TOKEN || "",
        TeamName: "Marketing",
        voiceChannelID: env.TEAM_MARKETING_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_MARKETING_LEADER_ID || "",
        MemberRole1ID: "1192410231876091904",
        MemberRole2ID: "1192527380330336266",
        LeaderChatChannelID: env.TEAM_MARKETING_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_MARKETING_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_WEB_FRONTEND_ADV_BOT_ID || "",
        token: env.TEAM_WEB_FRONTEND_ADV_TOKEN || "",
        TeamName: "Web Frontend Advanced",
        voiceChannelID: env.TEAM_WEB_FRONTEND_ADV_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_WEB_FRONTEND_ADV_LEADER_ID || "",
        MemberRole1ID: "1192410400000594093",
        MemberRole2ID: "1192527759524757556",
        LeaderChatChannelID: env.TEAM_WEB_FRONTEND_ADV_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_WEB_FRONTEND_ADV_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_WEB_FRONTEND_BEG_BOT_ID || "",
        token: env.TEAM_WEB_FRONTEND_BEG_TOKEN || "",
        TeamName: "Web Frontend Beginner",
        voiceChannelID: env.TEAM_WEB_FRONTEND_BEG_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_WEB_FRONTEND_BEG_LEADER_ID || "",
        MemberRole1ID: "1192410479709134858",
        MemberRole2ID: "1192528087913594970",
        LeaderChatChannelID: env.TEAM_WEB_FRONTEND_BEG_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_WEB_FRONTEND_BEG_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_WEB_BACKEND_BOT_ID || "",
        token: env.TEAM_WEB_BACKEND_TOKEN || "",
        TeamName: "Web Backend",
        voiceChannelID: env.TEAM_WEB_BACKEND_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_WEB_BACKEND_LEADER_ID || "",
        MemberRole1ID: "1192410333814468678",
        MemberRole2ID: "1192527624153608303",
        LeaderChatChannelID: env.TEAM_WEB_BACKEND_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_WEB_BACKEND_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_MOBILE_DEV_BOT_ID || "",
        token: env.TEAM_MOBILE_DEV_TOKEN || "",
        TeamName: "Mobile Dev",
        voiceChannelID: env.TEAM_MOBILE_DEV_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_MOBILE_DEV_LEADER_ID || "",
        MemberRole1ID: "1192410885940068363",
        MemberRole2ID: "1192528471361060935",
        LeaderChatChannelID: env.TEAM_MOBILE_DEV_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_MOBILE_DEV_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_DESIGN_BEG_BOT_ID || "",
        token: env.TEAM_DESIGN_BEG_TOKEN || "",
        TeamName: "Design Beginner",
        voiceChannelID: env.TEAM_DESIGN_BEG_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_DESIGN_BEG_LEADER_ID || "",
        MemberRole1ID: "1192411094560546906",
        MemberRole2ID: "1192528667390251038",
        LeaderChatChannelID: env.TEAM_DESIGN_BEG_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_DESIGN_BEG_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_DESIGN_ADV_BOT_ID || "",
        token: env.TEAM_DESIGN_ADV_TOKEN || "",
        TeamName: "Design Advanced",
        voiceChannelID: env.TEAM_DESIGN_ADV_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_DESIGN_ADV_LEADER_ID || "",
        MemberRole1ID: "1192411025664905277",
        MemberRole2ID: "1192528578198380565",
        LeaderChatChannelID: env.TEAM_DESIGN_ADV_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_DESIGN_ADV_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_VIDEO_EDITING_BOT_ID || "",
        token: env.TEAM_VIDEO_EDITING_TOKEN || "",
        TeamName: "Video Editing",
        voiceChannelID: env.TEAM_VIDEO_EDITING_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_VIDEO_EDITING_LEADER_ID || "",
        MemberRole1ID: "1192411203629223936",
        MemberRole2ID: "1192528791185145956",
        LeaderChatChannelID: env.TEAM_VIDEO_EDITING_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_VIDEO_EDITING_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_NETWORKS_BOT_ID || "",
        token: env.TEAM_NETWORKS_TOKEN || "",
        TeamName: "Networks",
        voiceChannelID: env.TEAM_NETWORKS_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_NETWORKS_LEADER_ID || "",
        MemberRole1ID: "1192411302061154344",
        MemberRole2ID: "1192528876388229227",
        LeaderChatChannelID: env.TEAM_NETWORKS_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_NETWORKS_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_UI_UX_BOT_ID || "",
        token: env.TEAM_UI_UX_TOKEN || "",
        TeamName: "UI / UX",
        voiceChannelID: env.TEAM_UI_UX_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_UI_UX_LEADER_ID || "",
        MemberRole1ID: "1192411392821694516",
        MemberRole2ID: "1192528951642439700",
        LeaderChatChannelID: env.TEAM_UI_UX_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_UI_UX_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_3D_BOT_ID || "",
        token: env.TEAM_3D_TOKEN || "",
        TeamName: "3D",
        voiceChannelID: env.TEAM_3D_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_3D_LEADER_ID || "",
        MemberRole1ID: "1192411460320624741",
        MemberRole2ID: "1192529022471643176",
        LeaderChatChannelID: env.TEAM_3D_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_3D_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_GAME_DEV_BOT_ID || "",
        token: env.TEAM_GAME_DEV_TOKEN || "",
        TeamName: "Game Dev",
        voiceChannelID: env.TEAM_GAME_DEV_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_GAME_DEV_LEADER_ID || "",
        MemberRole1ID: "1192411517006659604",
        MemberRole2ID: "1192529085121970176",
        LeaderChatChannelID: env.TEAM_GAME_DEV_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_GAME_DEV_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_TRADING_BOT_ID || "",
        token: env.TEAM_TRADING_TOKEN || "",
        TeamName: "Trading",
        voiceChannelID: env.TEAM_TRADING_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_TRADING_LEADER_ID || "",
        MemberRole1ID: "1311028014825472000",
        MemberRole2ID: "1311028089894994041",
        LeaderChatChannelID: env.TEAM_TRADING_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_TRADING_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_DEV_OPS_BOT_ID || "",
        token: env.TEAM_DEV_OPS_TOKEN || "",
        TeamName: "Dev Ops",
        voiceChannelID: env.TEAM_DEV_OPS_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_DEV_OPS_LEADER_ID || "",
        MemberRole1ID: "1309990107616383007",
        MemberRole2ID: "1311028354811691112",
        LeaderChatChannelID: env.TEAM_DEV_OPS_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_DEV_OPS_GENERAL_ANNOUNCEMENT_ID || "",
    },
    {
        BotId: env.TEAM_SPONSORING_BOT_ID || "",
        token: env.TEAM_SPONSORING_TOKEN || "",
        TeamName: "Sponsoring",
        voiceChannelID: env.TEAM_SPONSORING_VOICE_CHANNEL_ID || "",
        LeaderID: env.TEAM_SPONSORING_LEADER_ID || "",
        MemberRole1ID: "",
        MemberRole2ID: "",
        LeaderChatChannelID: env.TEAM_SPONSORING_LEADER_CHAT_CHANNEL_ID || "",
        GeneralAnnouncementID: env.TEAM_SPONSORING_GENERAL_ANNOUNCEMENT_ID || "",
    },
];

// ─── Team name → env prefix mapping ──────────────────────────────────
const teamPrefixMap: Record<string, string> = {
    "Ai": "TEAM_AI",
    "Security": "TEAM_SECURITY",
    "Robotic": "TEAM_ROBOTIC",
    "Marketing": "TEAM_MARKETING",
    "Web Frontend Advanced": "TEAM_WEB_FRONTEND_ADV",
    "Web Frontend Beginner": "TEAM_WEB_FRONTEND_BEG",
    "Web Backend": "TEAM_WEB_BACKEND",
    "Mobile Dev": "TEAM_MOBILE_DEV",
    "Design Beginner": "TEAM_DESIGN_BEG",
    "Design Advanced": "TEAM_DESIGN_ADV",
    "Video Editing": "TEAM_VIDEO_EDITING",
    "Networks": "TEAM_NETWORKS",
    "UI / UX": "TEAM_UI_UX",
    "3D": "TEAM_3D",
    "Game Dev": "TEAM_GAME_DEV",
    "Trading": "TEAM_TRADING",
    "Dev Ops": "TEAM_DEV_OPS",
    "Sponsoring": "TEAM_SPONSORING",
};

/**
 * Process teams: when SPLIT=true, expand one team entry into
 * Beginner + Advanced entries with their own bots and voice channels.
 * When SPLIT=false, keep the original single entry (fallback).
 */
function processTeams(teams: TeamConfig[]): TeamConfig[] {
    const result: TeamConfig[] = [];
    for (const team of teams) {
        const prefix = teamPrefixMap[team.TeamName];
        if (!prefix) {
            result.push(team);
            continue;
        }

        const isSplit = env[`${prefix}_SPLIT`] === "true";
        if (isSplit) {
            // Beginner sub-group
            result.push({
                ...team,
                TeamName: `${team.TeamName} (Beginner)`,
                BotId: env[`${prefix}_BOT_ID_BEGINNER`] || "",
                token: env[`${prefix}_TOKEN_BEGINNER`] || "",
                voiceChannelID: env[`${prefix}_VOICE_CHANNEL_ID_BEGINNER`] || "",
            });
            // Advanced sub-group
            result.push({
                ...team,
                TeamName: `${team.TeamName} (Advanced)`,
                BotId: env[`${prefix}_BOT_ID_ADVANCED`] || "",
                token: env[`${prefix}_TOKEN_ADVANCED`] || "",
                voiceChannelID: env[`${prefix}_VOICE_CHANNEL_ID_ADVANCED`] || "",
            });
        } else {
            result.push(team);
        }
    }
    return result;
}

export default processTeams(teamsData);
