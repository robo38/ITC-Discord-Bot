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
import teamsData, { TeamConfig } from "../data";

interface VoiceBotInstance {
    client: Client;
    config: TeamConfig;
    connection: VoiceConnection | null;
}

const voiceBots: Map<string, VoiceBotInstance> = new Map();

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

    if (!config.voiceChannelID) {
        console.warn(`[VoiceBot][${config.TeamName}] No voiceChannelID configured — skipping join.`);
        return;
    }

    try {
        const channel = await client.channels.fetch(config.voiceChannelID);

        if (!channel || channel.type !== ChannelType.GuildVoice) {
            console.error(`[VoiceBot][${config.TeamName}] Channel ${config.voiceChannelID} is not a voice channel.`);
            return;
        }

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guildId,
            adapterCreator: channel.guild.voiceAdapterCreator as any,
            selfDeaf: true,
            selfMute: true,
        });

        // Wait for the connection to become ready
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

        instance.connection = connection;
        console.log(`[VoiceBot][${config.TeamName}] Joined voice channel: ${channel.name}`);

        // Handle disconnections — auto-rejoin
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                // Try to reconnect
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
                // Seems to be reconnecting
            } catch {
                // Fully disconnected, rejoin
                console.log(`[VoiceBot][${config.TeamName}] Disconnected, attempting rejoin...`);
                connection.destroy();
                instance.connection = null;
                setTimeout(() => joinAssignedChannel(instance), 5_000);
            }
        });
    } catch (error) {
        console.error(`[VoiceBot][${config.TeamName}] Error joining voice:`, error);
    }
}

/**
 * Login all 18 voice bots and join their channels.
 */
export async function loginAllVoiceBots(): Promise<void> {
    const loginPromises: Promise<void>[] = [];

    for (const teamConfig of teamsData) {
        if (!teamConfig.token) {
            console.warn(`[VoiceBot][${teamConfig.TeamName}] No token configured — skipping.`);
            continue;
        }

        const botClient = createVoiceBotClient();
        const instance: VoiceBotInstance = {
            client: botClient,
            config: teamConfig,
            connection: null,
        };

        voiceBots.set(teamConfig.TeamName, instance);

        const loginPromise = (async () => {
            try {
                await botClient.login(teamConfig.token);
                console.log(`[VoiceBot][${teamConfig.TeamName}] Logged in as ${botClient.user?.tag}`);

                // Wait for 'ready' then join voice
                botClient.once("ready", async () => {
                    await joinAssignedChannel(instance);
                });
            } catch (error) {
                console.error(`[VoiceBot][${teamConfig.TeamName}] Login failed:`, error);
            }
        })();

        loginPromises.push(loginPromise);
    }

    await Promise.allSettled(loginPromises);
    console.log(`[VoiceBot] All voice bots initialized (${voiceBots.size} bots).`);
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
        console.error(`[VoiceBot] No bot found for team: ${teamName}`);
        return;
    }

    try {
        const channel = await bot.client.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            if (typeof content === "string") {
                await (channel as TextChannel).send(content);
            } else {
                await (channel as TextChannel).send(content);
            }
        }
    } catch (error) {
        console.error(`[VoiceBot][${teamName}] Error sending message:`, error);
    }
}

/**
 * Destroy all voice bots (graceful shutdown).
 */
export async function destroyAllVoiceBots(): Promise<void> {
    for (const [name, instance] of voiceBots) {
        try {
            instance.connection?.destroy();
            instance.client.destroy();
            console.log(`[VoiceBot][${name}] Destroyed.`);
        } catch (error) {
            console.error(`[VoiceBot][${name}] Error during destroy:`, error);
        }
    }
    voiceBots.clear();
}
