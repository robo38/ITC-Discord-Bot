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
import {
    startPresenceUpdates,
    stopPresenceUpdates,
    stopAllPresenceUpdates,
    refreshPresence,
} from "./richPresence";

interface VoiceBotInstance {
    client: Client;
    config: TeamConfig;
    connection: VoiceConnection | null;
    joining: boolean;
    rejoinTimer: ReturnType<typeof setTimeout> | null;
    backoffMs: number;
    lastErrorMsg: string;
    lastErrorTime: number;
    disconnected: boolean;
}

const voiceBots: Map<string, VoiceBotInstance> = new Map();

const MIN_BACKOFF = 5_000;
const MAX_BACKOFF = 120_000;
const ERROR_DEDUP_MS = 30_000;

process.on("uncaughtException", (err) => {
    const msg = err?.message || "";
    if (
        msg.includes("Cannot read properties of null") ||
        msg.includes("kStateSymbol") ||
        msg.includes("socket closed") ||
        msg.includes("IP discovery")
    ) {
        console.error("[VoiceBot] Suppressed uncaught socket error:", msg);
        return;
    }
    console.error("[FATAL] Uncaught exception:", err);
});

function safeDestroy(connection: VoiceConnection | null): void {
    if (!connection) return;
    try {
        if (connection.state.status !== "destroyed") {
            connection.destroy();
        }
    } catch {
    }
}

function scheduleRejoin(instance: VoiceBotInstance, reason: string, keepBackoff = false): void {
    const tag = `[VoiceBot][${instance.config.TeamName}]`;

    if (instance.disconnected) {
        logDebug(tag, `Skipped rejoin (manually disconnected): ${reason}`);
        return;
    }

    if (keepBackoff && instance.rejoinTimer) {
        logDebug(tag, `Rejoin already pending, ignoring: ${reason}`);
        return;
    }

    if (instance.rejoinTimer) {
        clearTimeout(instance.rejoinTimer);
        instance.rejoinTimer = null;
    }

    const delay = instance.backoffMs;
    instance.backoffMs = Math.min(instance.backoffMs * 2 + Math.random() * 1000, MAX_BACKOFF);

    logDebug(`${tag} ${reason}`, `retrying in ${Math.round(delay / 1000)}s`);

    instance.rejoinTimer = setTimeout(() => {
        instance.rejoinTimer = null;
        joinAssignedChannel(instance);
    }, delay);
}

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

async function joinAssignedChannel(instance: VoiceBotInstance): Promise<void> {
    const { client, config } = instance;
    const tag = `[VoiceBot][${config.TeamName}]`;

    if (!config.voiceChannelID) {
        logDebug(`${tag} Skipped — no voiceChannelID`);
        return;
    }

    if (instance.joining) return;
    instance.joining = true;

    try {
        const channel = await client.channels.fetch(config.voiceChannelID);

        if (!channel || channel.type !== ChannelType.GuildVoice) {
            logError(`${tag} Invalid channel`, `${config.voiceChannelID} is not a voice channel`);
            return;
        }

        const guild = await client.guilds.fetch(channel.guildId);

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

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
            instance.connection = connection;
            instance.backoffMs = MIN_BACKOFF;
            logSuccess(`${tag} Joined voice`, channel.name);
            emitBotStatus(config.TeamName, { status: "connected", detail: channel.name });

            startPresenceUpdates(client, config);
        } catch (err: any) {
            safeDestroy(connection);
            instance.connection = null;
            emitBotStatus(config.TeamName, { status: "reconnecting", detail: "Connection failed" });
            scheduleRejoin(instance, "Connection failed");
            return;
        }

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
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

            if (
                errMsg === instance.lastErrorMsg &&
                now - instance.lastErrorTime < ERROR_DEDUP_MS
            ) {
                return;
            }
            instance.lastErrorMsg = errMsg;
            instance.lastErrorTime = now;

            logError(`${tag} Connection error`, error);

            if (
                errMsg.includes("socket closed") ||
                errMsg.includes("IP discovery") ||
                errMsg.includes("ECONNRESET")
            ) {
                safeDestroy(connection);
                if (instance.connection === connection) instance.connection = null;
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

                botClient.on("voiceStateUpdate", async (oldState, newState) => {
                    if (newState.member?.id === botClient.user?.id) return;

                    const channelId = teamConfig.voiceChannelID;
                    if (!channelId) return;

                    if (oldState.channelId === channelId || newState.channelId === channelId) {
                        await refreshPresence(teamConfig.TeamName, botClient, teamConfig);
                    }
                });

                botClient.on("guildDelete", async (guild) => {
                    logError(`${tag} Kicked from guild`, `${guild.name} (${guild.id})`);
                });

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

export async function loginSingleVoiceBot(teamConfig: TeamConfig, mainClient: Client): Promise<boolean> {
    if (!teamConfig.token) {
        logDebug(`[VoiceBot][${teamConfig.TeamName}]`, "No token — cannot connect");
        return false;
    }

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

        botClient.on("voiceStateUpdate", async (oldState, newState) => {
            if (newState.member?.id === botClient.user?.id) return;

            const channelId = teamConfig.voiceChannelID;
            if (!channelId) return;

            if (oldState.channelId === channelId || newState.channelId === channelId) {
                await refreshPresence(teamConfig.TeamName, botClient, teamConfig);
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

export function getVoiceBot(teamName: string): VoiceBotInstance | undefined {
    return voiceBots.get(teamName);
}

export function getAllVoiceBots(): Map<string, VoiceBotInstance> {
    return voiceBots;
}

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

export async function destroyAllVoiceBots(): Promise<void> {
    stopAllPresenceUpdates();

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

export function reconnectVoiceBot(teamName: string): boolean {
    const instance = voiceBots.get(teamName);
    if (!instance) return false;

    instance.disconnected = false;
    instance.backoffMs = MIN_BACKOFF;
    emitBotStatus(teamName, { status: "reconnecting", detail: "Reconnecting..." });
    joinAssignedChannel(instance);
    return true;
}

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

    stopPresenceUpdates(teamName);

    try {
        instance.client.user?.setStatus("invisible");
    } catch {}

    logSuccess(`[VoiceBot][${teamName}]`, "Deactivated (offline)");
    emitBotStatus(teamName, { status: "deactivated", detail: "Bot deactivated" });
    return true;
}

export async function activateVoiceBot(teamName: string): Promise<boolean> {
    const instance = voiceBots.get(teamName);
    if (!instance) return false;

    instance.disconnected = false;
    instance.backoffMs = MIN_BACKOFF;

    try {
        instance.client.user?.setStatus("online");
    } catch {}

    await joinAssignedChannel(instance);
    logSuccess(`[VoiceBot][${teamName}]`, "Activated (online)");
    emitBotStatus(teamName, { status: "activated", detail: "Bot activated" });
    return true;
}

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
