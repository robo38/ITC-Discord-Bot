import {
    Client,
    GatewayIntentBits,
    ChannelType,
    TextChannel,
} from "discord.js";
import {
    joinVoiceChannel,
    VoiceConnection,
    VoiceConnectionStatus,
    entersState,
} from "@discordjs/voice";
import { TeamConfig } from "../data";
import { loadTeamConfigsFromDB } from "../dashboard/loadConfigs";
import { logError, logSuccess, logDebug } from "../utils/logger";
import { emitBotStatus } from "../dashboard/socketManager";

interface VoiceBotInstance {
    client: Client;
    config: TeamConfig;
    connection: VoiceConnection | null;
    /** Prevent overlapping join attempts */
    joining: boolean;
    /** Pending rejoin timer (so we can cancel duplicates) */
    rejoinTimer: ReturnType<typeof setTimeout> | null;
    /** Current backoff delay in ms */
    backoffMs: number;
    /** Track last connection error message to suppress duplicates */
    lastErrorMsg: string;
    lastErrorTime: number;
    /** Manually disconnected — don't auto-rejoin */
    disconnected: boolean;
}

const voiceBots: Map<string, VoiceBotInstance> = new Map();

const MIN_BACKOFF = 5_000;   // 5 seconds
const MAX_BACKOFF = 120_000; // 2 minutes
/** Suppress duplicate errors within this window */
const ERROR_DEDUP_MS = 30_000; // 30 seconds

// ─── Catch uncaught errors from destroyed sockets (kStateSymbol null) ──
process.on("uncaughtException", (err) => {
    const msg = err?.message || "";
    if (
        msg.includes("Cannot read properties of null") ||
        msg.includes("kStateSymbol") ||
        msg.includes("socket closed") ||
        msg.includes("IP discovery")
    ) {
        // Suppress known voice socket crash — already handled by reconnect logic
        console.error("[VoiceBot] Suppressed uncaught socket error:", msg);
        return;
    }
    // Re-throw unknown errors
    console.error("[FATAL] Uncaught exception:", err);
    // Don't exit — let the bot continue running
});

/** Safely destroy a VoiceConnection (no-op if already destroyed) */
function safeDestroy(connection: VoiceConnection | null): void {
    if (!connection) return;
    try {
        if (connection.state.status !== "destroyed") {
            connection.destroy();
        }
    } catch {
        // Already destroyed — ignore
    }
}

/**
 * Schedule a rejoin with exponential backoff.
 * If keepBackoff=true, don't cancel existing timer — just no-op if one is pending.
 */
function scheduleRejoin(instance: VoiceBotInstance, reason: string, keepBackoff = false): void {
    const tag = `[VoiceBot][${instance.config.TeamName}]`;

    // If manually disconnected, don't rejoin
    if (instance.disconnected) {
        logDebug(tag, `Skipped rejoin (manually disconnected): ${reason}`);
        return;
    }

    // If keepBackoff and a rejoin is already scheduled, don't reset it
    if (keepBackoff && instance.rejoinTimer) {
        logDebug(tag, `Rejoin already pending, ignoring: ${reason}`);
        return;
    }

    // Cancel any existing pending rejoin
    if (instance.rejoinTimer) {
        clearTimeout(instance.rejoinTimer);
        instance.rejoinTimer = null;
    }

    const delay = instance.backoffMs;
    // Increase backoff for next time (exponential with jitter)
    instance.backoffMs = Math.min(instance.backoffMs * 2 + Math.random() * 1000, MAX_BACKOFF);

    logDebug(`${tag} ${reason}`, `retrying in ${Math.round(delay / 1000)}s`);

    instance.rejoinTimer = setTimeout(() => {
        instance.rejoinTimer = null;
        joinAssignedChannel(instance);
    }, delay);
}

/**
 * Create a single voice bot client for a team.
 */
function createVoiceBotClient(): Client {
    return new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ],
    });
}

/**
 * Join the assigned voice channel for a team bot.
 */
async function joinAssignedChannel(instance: VoiceBotInstance): Promise<void> {
    const { client, config } = instance;
    const tag = `[VoiceBot][${config.TeamName}]`;

    if (!config.voiceChannelID) {
        logDebug(`${tag} Skipped — no voiceChannelID`);
        return;
    }

    // Prevent overlapping join attempts
    if (instance.joining) return;
    instance.joining = true;

    try {
        const channel = await client.channels.fetch(config.voiceChannelID);

        if (!channel || channel.type !== ChannelType.GuildVoice) {
            logError(`${tag} Invalid channel`, `${config.voiceChannelID} is not a voice channel`);
            return;
        }

        const guild = await client.guilds.fetch(channel.guildId);

        // Destroy any stale connection before creating a new one
        safeDestroy(instance.connection);
        instance.connection = null;

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator as any,
            selfDeaf: true,
            selfMute: true,
            group: client.user?.id,
        });

        // Wait for the connection to become ready
        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
            instance.connection = connection;
            // Reset backoff on successful connection
            instance.backoffMs = MIN_BACKOFF;
            logSuccess(`${tag} Joined voice`, channel.name);
            emitBotStatus(config.TeamName, { status: "connected", detail: channel.name });
        } catch (err: any) {
            safeDestroy(connection);
            instance.connection = null;
            emitBotStatus(config.TeamName, { status: "reconnecting", detail: "Connection failed" });
            scheduleRejoin(instance, "Connection failed");
            return;
        }

        // Handle disconnections — auto-rejoin
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
                // Connection is recovering on its own — do nothing
            } catch {
                safeDestroy(connection);
                instance.connection = null;
                emitBotStatus(config.TeamName, { status: "disconnected", detail: "Voice disconnected" });
                scheduleRejoin(instance, "Disconnected");
            }
        });

        connection.on("error", (error: any) => {
            const errMsg = error?.message || String(error);
            const now = Date.now();

            // Suppress duplicate errors within dedup window
            if (
                errMsg === instance.lastErrorMsg &&
                now - instance.lastErrorTime < ERROR_DEDUP_MS
            ) {
                return; // silently skip
            }
            instance.lastErrorMsg = errMsg;
            instance.lastErrorTime = now;

            logError(`${tag} Connection error`, error);

            // If it's a socket/IP discovery error, destroy and schedule rejoin
            if (
                errMsg.includes("socket closed") ||
                errMsg.includes("IP discovery") ||
                errMsg.includes("ECONNRESET")
            ) {
                safeDestroy(connection);
                if (instance.connection === connection) instance.connection = null;
                // Use keepBackoff=true so we don't reset a pending rejoin timer
                scheduleRejoin(instance, "Socket error", true);
            }
        });
    } catch (error: any) {
        logError(`${tag} Error joining voice`, error);
        scheduleRejoin(instance, "Join error");
    } finally {
        instance.joining = false;
    }
}

/**
 * Login all voice bots from database config and join their channels.
 */
export async function loginAllVoiceBots(mainClient: Client): Promise<void> {
    const loginPromises: Promise<void>[] = [];
    const teamConfigs = await loadTeamConfigsFromDB();

    for (const teamConfig of teamConfigs) {
        if (!teamConfig.token) {
            logDebug(`[VoiceBot][${teamConfig.TeamName}]`, "No token — skipping");
            continue;
        }

        const botClient = createVoiceBotClient();
        const instance: VoiceBotInstance = {
            client: botClient,
            config: teamConfig,
            connection: null,
            joining: false,
            rejoinTimer: null,
            backoffMs: MIN_BACKOFF,
            lastErrorMsg: "",
            lastErrorTime: 0,
            disconnected: false,
        };

        voiceBots.set(teamConfig.TeamName, instance);
        const tag = `[VoiceBot][${teamConfig.TeamName}]`;

        const loginPromise = (async () => {
            try {
                await botClient.login(teamConfig.token);
                logDebug(tag, `Logged in as ${botClient.user?.tag}`);

                botClient.once("clientReady", async () => {
                    await joinAssignedChannel(instance);
                });

                // Auto-rejoin on voice-state change (only if no rejoin already pending)
                botClient.on("voiceStateUpdate", async (_oldState, newState) => {
                    if (newState.member?.id !== botClient.user?.id) return;
                    // Skip if manually disconnected
                    if (instance.disconnected) return;
                    // Skip if a rejoin is already scheduled or in progress
                    if (instance.rejoinTimer || instance.joining) return;

                    const expectedChannelId = teamConfig.voiceChannelID;

                    if (!newState.channelId) {
                        // Bot was disconnected from voice entirely
                        safeDestroy(instance.connection);
                        instance.connection = null;
                        // keepBackoff=true to preserve existing backoff progression
                        scheduleRejoin(instance, "Kicked from voice", true);
                        return;
                    }

                    if (newState.channelId !== expectedChannelId) {
                        // Bot was moved to a different channel
                        safeDestroy(instance.connection);
                        instance.connection = null;
                        scheduleRejoin(instance, `Moved to wrong channel ${newState.channelId}`, true);
                    }
                });

                // Kick logging
                botClient.on("guildDelete", async (guild) => {
                    logError(`${tag} Kicked from guild`, `${guild.name} (${guild.id})`);
                });

                // General error handler to prevent crash
                botClient.on("error", (error) => {
                    logError(`${tag} Client error`, error);
                });

            } catch (error: any) {
                logError(`${tag} Login failed`, error);
            }
        })();

        loginPromises.push(loginPromise);
    }

    await Promise.allSettled(loginPromises);
    logSuccess("Voice Bots", `All initialized (${voiceBots.size} bots)`);
}

/**
 * Login and connect a single voice bot (used when adding a new bot via dashboard).
 */
export async function loginSingleVoiceBot(teamConfig: TeamConfig, mainClient: Client): Promise<boolean> {
    if (!teamConfig.token) {
        logDebug(`[VoiceBot][${teamConfig.TeamName}]`, "No token — cannot connect");
        return false;
    }

    // If already exists, skip
    if (voiceBots.has(teamConfig.TeamName)) {
        logDebug(`[VoiceBot][${teamConfig.TeamName}]`, "Already registered — skipping");
        return true;
    }

    const botClient = createVoiceBotClient();
    const instance: VoiceBotInstance = {
        client: botClient,
        config: teamConfig,
        connection: null,
        joining: false,
        rejoinTimer: null,
        backoffMs: MIN_BACKOFF,
        lastErrorMsg: "",
        lastErrorTime: 0,
        disconnected: false,
    };

    voiceBots.set(teamConfig.TeamName, instance);
    const tag = `[VoiceBot][${teamConfig.TeamName}]`;

    try {
        await botClient.login(teamConfig.token);
        logDebug(tag, `Logged in as ${botClient.user?.tag}`);

        botClient.once("clientReady", async () => {
            await joinAssignedChannel(instance);
        });

        botClient.on("voiceStateUpdate", async (_oldState, newState) => {
            if (newState.member?.id !== botClient.user?.id) return;
            if (instance.disconnected) return;
            if (instance.rejoinTimer || instance.joining) return;

            const expectedChannelId = teamConfig.voiceChannelID;
            if (!newState.channelId) {
                safeDestroy(instance.connection);
                instance.connection = null;
                scheduleRejoin(instance, "Kicked from voice", true);
                return;
            }
            if (newState.channelId !== expectedChannelId) {
                safeDestroy(instance.connection);
                instance.connection = null;
                scheduleRejoin(instance, `Moved to wrong channel ${newState.channelId}`, true);
            }
        });

        botClient.on("guildDelete", async (guild) => {
            logError(`${tag} Kicked from guild`, `${guild.name} (${guild.id})`);
        });

        botClient.on("error", (error) => {
            logError(`${tag} Client error`, error);
        });

        logSuccess(tag, "Single bot connected");
        return true;
    } catch (error: any) {
        logError(`${tag} Login failed`, error);
        voiceBots.delete(teamConfig.TeamName);
        return false;
    }
}

/**
 * Get a voice bot instance by team name.
 */
export function getVoiceBot(teamName: string): VoiceBotInstance | undefined {
    return voiceBots.get(teamName);
}

/**
 * Get all voice bot instances.
 */
export function getAllVoiceBots(): Map<string, VoiceBotInstance> {
    return voiceBots;
}

/**
 * Send a message using a team's voice bot to a specific channel.
 */
export async function sendMessageAsBot(
    teamName: string,
    channelId: string,
    content: string | { files: any[]; content?: string }
): Promise<void> {
    const bot = voiceBots.get(teamName);
    if (!bot) {
        logError(`[VoiceBot] sendMessageAsBot`, `No bot found for team: ${teamName}`);
        return;
    }

    try {
        const channel = await bot.client.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            await (channel as TextChannel).send(content as any);
        }
    } catch (error: any) {
        logError(`[VoiceBot][${teamName}] Error sending message`, error);
    }
}

/**
 * Destroy all voice bots (graceful shutdown).
 */
export async function destroyAllVoiceBots(): Promise<void> {
    for (const [name, instance] of voiceBots) {
        try {
            if (instance.rejoinTimer) {
                clearTimeout(instance.rejoinTimer);
                instance.rejoinTimer = null;
            }
            safeDestroy(instance.connection);
            instance.connection = null;
            instance.client.destroy();
        } catch (error: any) {
            logError(`[VoiceBot][${name}] Error during destroy`, error);
        }
    }
    voiceBots.clear();
    logSuccess("Voice Bots", "All destroyed");
}

/**
 * Manually disconnect a voice bot from its channel (no auto-rejoin).
 */
export function disconnectVoiceBot(teamName: string): boolean {
    const instance = voiceBots.get(teamName);
    if (!instance) return false;

    instance.disconnected = true;
    if (instance.rejoinTimer) {
        clearTimeout(instance.rejoinTimer);
        instance.rejoinTimer = null;
    }
    safeDestroy(instance.connection);
    instance.connection = null;
    instance.backoffMs = MIN_BACKOFF;
    logSuccess(`[VoiceBot][${teamName}]`, "Manually disconnected");
    emitBotStatus(teamName, { status: "disconnected", detail: "Manually disconnected" });
    return true;
}

/**
 * Reconnect a manually-disconnected voice bot.
 */
export function reconnectVoiceBot(teamName: string): boolean {
    const instance = voiceBots.get(teamName);
    if (!instance) return false;

    instance.disconnected = false;
    instance.backoffMs = MIN_BACKOFF;
    emitBotStatus(teamName, { status: "reconnecting", detail: "Reconnecting..." });
    joinAssignedChannel(instance);
    return true;
}

/**
 * Deactivate a voice bot — disconnect and set presence offline.
 */
export async function deactivateVoiceBot(teamName: string): Promise<boolean> {
    const instance = voiceBots.get(teamName);
    if (!instance) return false;

    instance.disconnected = true;
    if (instance.rejoinTimer) {
        clearTimeout(instance.rejoinTimer);
        instance.rejoinTimer = null;
    }
    safeDestroy(instance.connection);
    instance.connection = null;

    // Set bot presence to invisible/offline
    try {
        instance.client.user?.setStatus("invisible");
    } catch { /* ignore */ }

    logSuccess(`[VoiceBot][${teamName}]`, "Deactivated (offline)");
    emitBotStatus(teamName, { status: "deactivated", detail: "Bot deactivated" });
    return true;
}

/**
 * Activate a voice bot — set online and rejoin channel.
 */
export async function activateVoiceBot(teamName: string): Promise<boolean> {
    const instance = voiceBots.get(teamName);
    if (!instance) return false;

    instance.disconnected = false;
    instance.backoffMs = MIN_BACKOFF;

    // Set bot presence to online
    try {
        instance.client.user?.setStatus("online");
    } catch { /* ignore */ }

    await joinAssignedChannel(instance);
    logSuccess(`[VoiceBot][${teamName}]`, "Activated (online)");
    emitBotStatus(teamName, { status: "activated", detail: "Bot activated" });
    return true;
}

/**
 * Update a voice bot's Discord profile (username and/or avatar).
 */
export async function updateBotProfile(
    teamName: string,
    options: { username?: string; avatarUrl?: string }
): Promise<{ success: boolean; message: string }> {
    const instance = voiceBots.get(teamName);
    if (!instance) return { success: false, message: "Bot not found" };

    try {
        const user = instance.client.user;
        if (!user) return { success: false, message: "Bot not logged in" };

        if (options.username) {
            await user.setUsername(options.username);
        }
        if (options.avatarUrl) {
            await user.setAvatar(options.avatarUrl);
        }

        const changed = [
            options.username ? `username → ${options.username}` : "",
            options.avatarUrl ? "avatar updated" : "",
        ].filter(Boolean).join(", ");

        logSuccess(`[VoiceBot][${teamName}]`, `Profile updated: ${changed}`);
        return { success: true, message: `Profile updated: ${changed}` };
    } catch (err: any) {
        logError(`[VoiceBot][${teamName}] Profile update failed`, err);
        return { success: false, message: err.message || "Failed to update profile" };
    }
}
