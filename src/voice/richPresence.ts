/**
 * Rich Presence Manager for Voice Bots
 *
 * Updates each team bot's Discord presence to display:
 * - Number of users currently in the voice channel
 * - Workshop status (active / scheduled / not active)
 * - ITC logo as large image when idle
 * - Leader avatar as small image when workshop is active
 */
import { Client, ActivityType, PresenceData, ChannelType } from "discord.js";
import { logDebug, logError } from "../utils/logger";
import type { TeamConfig } from "../data";

// ─── Public URL for ITC logo (served by the dashboard) ───────────────
const DASHBOARD_PORT = process.env.DASHBOARD_PORT || "4000";
const DASHBOARD_HOST = process.env.DASHBOARD_HOST || "localhost";
const ITC_LOGO_URL = process.env.ITC_LOGO_URL || `https://i.imgur.com/placeholder.png`;

// ─── Workshop state per team (set by workshopManager integration) ────
interface WorkshopState {
    status: "active" | "scheduled" | "not_active";
    type?: string;               // "workshop" | "formation" | "other"
    topicName?: string;          // custom topic name
    leaderID?: string;           // Discord user ID of the leader
    leaderAvatarURL?: string;    // Resolved avatar URL
    startTime?: Date;
    duration?: number;           // in minutes
}

const workshopStates: Map<string, WorkshopState> = new Map();

// ─── Interval timers for periodic refresh ────────────────────────────
const presenceIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
const REFRESH_INTERVAL_MS = 30_000; // Refresh every 30 seconds

/**
 * Get the current workshop state for a team.
 */
export function getWorkshopState(teamName: string): WorkshopState {
    return workshopStates.get(teamName) || { status: "not_active" };
}

/**
 * Set workshop state to active — called when a workshop starts.
 */
export function setWorkshopActive(
    teamName: string,
    leaderID: string,
    type: string,
    startTime: Date,
    duration: number,
    topicName?: string,
    leaderAvatarURL?: string,
): void {
    workshopStates.set(teamName, {
        status: "active",
        type,
        topicName,
        leaderID,
        leaderAvatarURL,
        startTime,
        duration,
    });
    logDebug("[RichPresence]", `${teamName} → Active (${type})`);
}

/**
 * Set workshop state to scheduled — called when a workshop is created but not yet started.
 */
export function setWorkshopScheduled(
    teamName: string,
    startTime: Date,
    type: string,
    topicName?: string,
): void {
    workshopStates.set(teamName, {
        status: "scheduled",
        type,
        topicName,
        startTime,
    });
    logDebug("[RichPresence]", `${teamName} → Scheduled`);
}

/**
 * Set workshop state to not active — called when a workshop ends.
 */
export function setWorkshopInactive(teamName: string): void {
    workshopStates.set(teamName, { status: "not_active" });
    logDebug("[RichPresence]", `${teamName} → Not Active`);
}

/**
 * Count the number of non-bot members in the bot's voice channel.
 */
async function getVoiceChannelMemberCount(
    client: Client,
    voiceChannelID: string,
): Promise<number> {
    if (!voiceChannelID) return 0;

    try {
        const channel = await client.channels.fetch(voiceChannelID);
        if (!channel || channel.type !== ChannelType.GuildVoice) return 0;

        // Count non-bot members (exclude the bot itself and other bots)
        let count = 0;
        for (const [, member] of channel.members) {
            if (!member.user.bot) count++;
        }
        return count;
    } catch {
        return 0;
    }
}

/**
 * Format the time remaining for a workshop.
 */
function formatTimeRemaining(startTime: Date, durationMinutes: number): string {
    const endTime = startTime.getTime() + durationMinutes * 60_000;
    const remaining = endTime - Date.now();

    if (remaining <= 0) return "0:00 left";

    const hours = Math.floor(remaining / 3_600_000);
    const minutes = Math.floor((remaining % 3_600_000) / 60_000);

    if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")} left`;
    return `${minutes}:${(Math.floor((remaining % 60_000) / 1000)).toString().padStart(2, "0")} left`;
}

/**
 * Format the time until a scheduled workshop starts.
 */
function formatTimeUntilStart(startTime: Date): string {
    const remaining = startTime.getTime() - Date.now();

    if (remaining <= 0) return "Starting now...";

    const hours = Math.floor(remaining / 3_600_000);
    const minutes = Math.floor((remaining % 3_600_000) / 60_000);

    if (hours > 0) return `Starts in ${hours}h ${minutes}m`;
    return `Starts in ${minutes}m`;
}

/**
 * Build and apply the rich presence for a voice bot.
 */
export async function updatePresence(
    client: Client,
    teamConfig: TeamConfig,
): Promise<void> {
    if (!client.user) return;

    const teamName = teamConfig.TeamName;
    const wsState = getWorkshopState(teamName);
    const memberCount = await getVoiceChannelMemberCount(client, teamConfig.voiceChannelID);

    try {
        const presence = buildPresenceData(teamName, wsState, memberCount);
        client.user.setPresence(presence);
    } catch (error: any) {
        logError(`[RichPresence][${teamName}]`, error);
    }
}

/**
 * Build the PresenceData object based on current state.
 */
function buildPresenceData(
    teamName: string,
    wsState: WorkshopState,
    memberCount: number,
): PresenceData {
    switch (wsState.status) {
        case "active": {
            const displayType = wsState.type === "other" && wsState.topicName
                ? wsState.topicName
                : wsState.type || "Workshop";

            const capitalizedType = displayType.charAt(0).toUpperCase() + displayType.slice(1);
            const timeLeft = wsState.startTime && wsState.duration
                ? formatTimeRemaining(wsState.startTime, wsState.duration)
                : "";

            return {
                status: "online",
                activities: [{
                    name: `${capitalizedType}`,
                    type: ActivityType.Competing,
                    state: `👥 ${memberCount} member${memberCount !== 1 ? "s" : ""} in voice | ⏱️ ${timeLeft}`,
                }],
            };
        }

        case "scheduled": {
            const displayType = wsState.type === "other" && wsState.topicName
                ? wsState.topicName
                : wsState.type || "Workshop";

            const capitalizedType = displayType.charAt(0).toUpperCase() + displayType.slice(1);
            const timeUntil = wsState.startTime
                ? formatTimeUntilStart(wsState.startTime)
                : "Soon";

            return {
                status: "idle",
                activities: [{
                    name: `📅 ${capitalizedType} Scheduled`,
                    type: ActivityType.Playing,
                    state: `${timeUntil} | 👥 ${memberCount} in voice`,
                }],
            };
        }

        case "not_active":
        default: {
            if (memberCount > 0) {
                return {
                    status: "online",
                    activities: [{
                        name: `${teamName}`,
                        type: ActivityType.Watching,
                        state: `👥 ${memberCount} member${memberCount !== 1 ? "s" : ""} in voice`,
                    }],
                };
            }

            return {
                status: "online",
                activities: [{
                    name: `ITC | ${teamName}`,
                    type: ActivityType.Watching,
                    state: "No active session",
                }],
            };
        }
    }
}

/**
 * Start periodic presence updates for a voice bot.
 * Called after the bot logs in and joins its channel.
 */
export function startPresenceUpdates(client: Client, teamConfig: TeamConfig): void {
    const teamName = teamConfig.TeamName;

    // Clear any existing interval for this team
    stopPresenceUpdates(teamName);

    // Do an immediate update
    updatePresence(client, teamConfig);

    // Set up periodic refresh
    const interval = setInterval(() => {
        updatePresence(client, teamConfig);
    }, REFRESH_INTERVAL_MS);

    presenceIntervals.set(teamName, interval);
    logDebug("[RichPresence]", `Started updates for ${teamName}`);
}

/**
 * Stop periodic presence updates for a voice bot.
 */
export function stopPresenceUpdates(teamName: string): void {
    const existing = presenceIntervals.get(teamName);
    if (existing) {
        clearInterval(existing);
        presenceIntervals.delete(teamName);
    }
}

/**
 * Trigger an immediate presence refresh for a specific team.
 * Useful after voice state changes or workshop status changes.
 */
export async function refreshPresence(teamName: string, client: Client, teamConfig: TeamConfig): Promise<void> {
    await updatePresence(client, teamConfig);
}

/**
 * Stop all presence update intervals (for graceful shutdown).
 */
export function stopAllPresenceUpdates(): void {
    for (const [name, interval] of presenceIntervals) {
        clearInterval(interval);
    }
    presenceIntervals.clear();
    logDebug("[RichPresence]", "All presence updates stopped");
}

/**
 * Resolve a leader's avatar URL from their Discord user ID.
 */
export async function resolveLeaderAvatar(
    client: Client,
    leaderRoleID: string,
    guildId: string,
): Promise<string | undefined> {
    try {
        const guild = await client.guilds.fetch(guildId);
        if (!guild) return undefined;

        // LeaderID is a role ID — find a member with that role
        const role = guild.roles.cache.get(leaderRoleID);
        if (!role) return undefined;

        // Get the first member with this role (the leader)
        const members = role.members;
        const leader = members.first();
        if (!leader) return undefined;

        return leader.user.displayAvatarURL({ size: 128 });
    } catch {
        return undefined;
    }
}
