import { Workshop, Participant, Session } from "../database";
import teamsData, { TeamConfig } from "../data";
import { ActivityTracker } from "./activityTracker";
import { exportWorkshopToExcel } from "./excelExport";
import { sendMessageAsBot } from "../voice";
import {
    Client,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    TextChannel,
} from "discord.js";

// Map workshopId → ActivityTracker
const activeTrackers: Map<string, ActivityTracker> = new Map();

// Map workshopId → NodeJS.Timeout (for auto-notification)
const workshopTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

// Store reference to the main bot client
let mainBotClient: Client | null = null;

export function setMainClient(client: Client): void {
    mainBotClient = client;
}

/**
 * Find the team config for a given leader based on their roles.
 */
export function findTeamForLeader(
    leaderID: string,
    memberRoles: string[]
): TeamConfig | undefined {
    return teamsData.find((team) => {
        // Check if the leader is assigned to this team
        if (team.LeaderID === leaderID) return true;
        // Or if they have the team's member role
        return (
            memberRoles.includes(team.MemberRole1ID) ||
            memberRoles.includes(team.MemberRole2ID)
        );
    });
}

/**
 * Determine team label from member roles.
 */
export function getTeamLabel(
    memberRoles: string[],
    team: TeamConfig
): "First team" | "Second team" | "Unknown" {
    if (memberRoles.includes(team.MemberRole1ID)) return "First team";
    if (memberRoles.includes(team.MemberRole2ID)) return "Second team";
    return "Unknown";
}

/**
 * Parse duration string to minutes.
 */
export function parseDuration(duration: string): number {
    switch (duration) {
        case "1h30":
            return 90;
        case "2h":
            return 120;
        default: {
            // Try parsing custom format like "45m" or "1h" or "1h45m" or just a number (minutes)
            const hourMatch = duration.match(/(\d+)h/);
            const minMatch = duration.match(/(\d+)m/);
            let totalMinutes = 0;
            if (hourMatch) totalMinutes += parseInt(hourMatch[1]) * 60;
            if (minMatch) totalMinutes += parseInt(minMatch[1]);
            if (!hourMatch && !minMatch) {
                const num = parseInt(duration);
                if (!isNaN(num)) return num;
            }
            return totalMinutes || 90; // default 90 minutes
        }
    }
}

/**
 * Create and schedule a new workshop.
 */
export async function createWorkshop(
    leaderID: string,
    teamConfig: TeamConfig,
    type: "workshop" | "formation" | "other",
    startTime: Date,
    durationStr: string,
    mainClient: Client
): Promise<{ success: boolean; message: string; workshopId?: string }> {
    // Check if leader already has an active workshop
    const existingWorkshop = await Workshop.findOne({
        leaderID,
        status: { $in: ["scheduled", "active"] },
    });

    if (existingWorkshop) {
        return {
            success: false,
            message:
                "You already have an active workshop. Stop it first with `/stop-workshop` before creating a new one.",
        };
    }

    const workshopId = crypto.randomUUID();
    const averageDuration = parseDuration(durationStr);

    const workshop = new Workshop({
        workshopId,
        teamName: teamConfig.TeamName,
        leaderID,
        voiceChannelID: teamConfig.voiceChannelID,
        type,
        startTime,
        averageDuration,
        status: "scheduled",
    });

    await workshop.save();

    // Schedule activation at start time
    const now = Date.now();
    const startMs = startTime.getTime();
    const delay = Math.max(0, startMs - now);

    setTimeout(async () => {
        await activateWorkshop(workshopId, teamConfig, mainClient);
    }, delay);

    return {
        success: true,
        message: `Workshop scheduled for **${teamConfig.TeamName}**.\n` +
            `Type: **${type}**\n` +
            `Starts: <t:${Math.floor(startMs / 1000)}:F>\n` +
            `Duration: **${durationStr}**`,
        workshopId,
    };
}

/**
 * Activate a workshop: start tracking participants in voice channel.
 */
async function activateWorkshop(
    workshopId: string,
    teamConfig: TeamConfig,
    mainClient: Client
): Promise<void> {
    const workshop = await Workshop.findOne({ workshopId });
    if (!workshop || workshop.status === "completed") return;

    workshop.status = "active";
    await workshop.save();

    console.log(`[Workshop][${teamConfig.TeamName}] Workshop ${workshopId} is now ACTIVE.`);

    // Create activity tracker
    const tracker = new ActivityTracker(workshopId, teamConfig, mainClient);
    activeTrackers.set(workshopId, tracker);

    // Start tracking existing members in voice
    await tracker.scanExistingMembers();

    // Schedule end-time notification
    const endTimeMs = workshop.startTime.getTime() + workshop.averageDuration * 60_000;
    const remaining = Math.max(0, endTimeMs - Date.now());

    const timer = setTimeout(async () => {
        await notifyLeaderWorkshopEnded(workshopId, teamConfig, mainClient);
    }, remaining);

    workshopTimers.set(workshopId, timer);
}

/**
 * Notify the leader that the workshop's average time has ended.
 */
async function notifyLeaderWorkshopEnded(
    workshopId: string,
    teamConfig: TeamConfig,
    mainClient: Client
): Promise<void> {
    const workshop = await Workshop.findOne({ workshopId });
    if (!workshop || workshop.status !== "active") return;

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`workshop_continue_${workshopId}`)
            .setLabel("Continue")
            .setStyle(ButtonStyle.Success)
            .setEmoji("▶️"),
        new ButtonBuilder()
            .setCustomId(`workshop_stop_${workshopId}`)
            .setLabel("Stop")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("⏹️")
    );

    try {
        // Send to leader's chat channel using the team's voice bot
        if (teamConfig.LeaderChatChannelID) {
            await sendMessageAsBot(teamConfig.TeamName, teamConfig.LeaderChatChannelID, {
                content:
                    `⏰ **Workshop time ended!** — **${teamConfig.TeamName}**\n\n` +
                    `The average duration of **${workshop.averageDuration} minutes** has passed.\n` +
                    `Choose an option:`,
                files: [],
            });

            // Send button via main bot (voice bots can't handle interactions easily)
            const channel = await mainClient.channels.fetch(teamConfig.LeaderChatChannelID);
            if (channel && channel.isTextBased()) {
                await (channel as TextChannel).send({
                    content: `<@${teamConfig.LeaderID}> Your workshop time is up!`,
                    components: [row],
                });
            }
        }
    } catch (error) {
        console.error(`[Workshop][${teamConfig.TeamName}] Error notifying leader:`, error);
    }
}

/**
 * Continue a workshop (when leader clicks Continue).
 */
export async function continueWorkshop(workshopId: string): Promise<boolean> {
    const workshop = await Workshop.findOne({ workshopId, status: "active" });
    if (!workshop) return false;

    // Clear existing timer and set a new one for 30 more minutes
    const existingTimer = workshopTimers.get(workshopId);
    if (existingTimer) clearTimeout(existingTimer);

    const teamConfig = teamsData.find((t) => t.TeamName === workshop.teamName);
    if (!teamConfig) return false;

    // Extend by 30 minutes
    const timer = setTimeout(async () => {
        if (mainBotClient) {
            await notifyLeaderWorkshopEnded(workshopId, teamConfig, mainBotClient);
        }
    }, 30 * 60_000);

    workshopTimers.set(workshopId, timer);
    return true;
}

/**
 * Stop a workshop and generate the report.
 */
export async function stopWorkshop(
    workshopId: string,
    mainClient: Client
): Promise<{ success: boolean; message: string; filePath?: string }> {
    const workshop = await Workshop.findOne({
        workshopId,
        status: "active",
    });

    if (!workshop) {
        return { success: false, message: "No active workshop found with that ID." };
    }

    // Stop the workshop
    workshop.status = "completed";
    workshop.stoppedAt = new Date();
    await workshop.save();

    // Clear timer
    const timer = workshopTimers.get(workshopId);
    if (timer) {
        clearTimeout(timer);
        workshopTimers.delete(workshopId);
    }

    // Stop tracking
    const tracker = activeTrackers.get(workshopId);
    if (tracker) {
        await tracker.finalizeAll();
        activeTrackers.delete(workshopId);
    }

    // Mark participants who are still in voice as stayed until end
    const participants = await Participant.find({ workshopId });
    const totalParticipants = participants.length;

    // Calculate averages
    let totalTime = 0;
    for (const p of participants) {
        const pTime = p.voiceSessions.reduce((sum, s) => sum + s.duration, 0);
        totalTime += pTime;
    }

    const avgAttendance = totalParticipants > 0 ? totalTime / totalParticipants : 0;
    const totalDuration = workshop.stoppedAt.getTime() - workshop.startTime.getTime();

    // Save session summary
    const session = new Session({
        workshopId,
        teamName: workshop.teamName,
        leaderID: workshop.leaderID,
        type: workshop.type,
        startTime: workshop.startTime,
        endTime: workshop.stoppedAt,
        totalDuration,
        totalParticipants,
        averageAttendanceTime: avgAttendance,
    });
    await session.save();

    // Generate Excel
    const teamConfig = teamsData.find((t) => t.TeamName === workshop.teamName);
    const filePath = await exportWorkshopToExcel(workshopId, workshop, participants);

    // Send Excel via the team's voice bot
    if (teamConfig?.LeaderChatChannelID) {
        try {
            await sendMessageAsBot(teamConfig.TeamName, teamConfig.LeaderChatChannelID, {
                content:
                    `📊 **Workshop Report — ${teamConfig.TeamName}**\n` +
                    `Type: ${workshop.type}\n` +
                    `Duration: ${Math.round(totalDuration / 60_000)} minutes\n` +
                    `Participants: ${totalParticipants}\n` +
                    `Average attendance: ${Math.round(avgAttendance / 60_000)} minutes`,
                files: [filePath],
            });
        } catch (error) {
            console.error(`[Workshop] Error sending report via voice bot:`, error);
            // Fallback: try sending via main bot
            try {
                const channel = await mainClient.channels.fetch(teamConfig.LeaderChatChannelID);
                if (channel && channel.isTextBased()) {
                    await (channel as TextChannel).send({
                        content: `📊 **Workshop Report — ${teamConfig.TeamName}**`,
                        files: [filePath],
                    });
                }
            } catch (err) {
                console.error(`[Workshop] Fallback send also failed:`, err);
            }
        }
    }

    return {
        success: true,
        message:
            `✅ Workshop stopped for **${workshop.teamName}**.\n` +
            `Total participants: **${totalParticipants}**\n` +
            `Total duration: **${Math.round(totalDuration / 60_000)} minutes**\n` +
            `Report has been sent to the leader's channel.`,
        filePath,
    };
}

/**
 * Stop workshop by leader ID (find their active workshop).
 */
export async function stopWorkshopByLeader(
    leaderID: string,
    mainClient: Client
): Promise<{ success: boolean; message: string; filePath?: string }> {
    const workshop = await Workshop.findOne({
        leaderID,
        status: "active",
    });

    if (!workshop) {
        return { success: false, message: "You don't have any active workshop." };
    }

    return stopWorkshop(workshop.workshopId, mainClient);
}

/**
 * Get the active tracker for a workshop.
 */
export function getActiveTracker(workshopId: string): ActivityTracker | undefined {
    return activeTrackers.get(workshopId);
}

/**
 * Get all active trackers (needed by voice state events).
 */
export function getAllActiveTrackers(): Map<string, ActivityTracker> {
    return activeTrackers;
}
