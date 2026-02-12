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

        const guild = await client.guilds.fetch(channel.guildId);

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator as any,
            selfDeaf: true,
            selfMute: true,
            group: client.user?.id, // CRITICAL FIX: Unique group per bot
        });

        // Wait for the connection to become ready
        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
            instance.connection = connection;
            console.log(`[VoiceBot][${config.TeamName}] Joined voice channel: ${channel.name}`);
        } catch (error: any) {
            // Handle AbortError specifically to avoid crashing
            if (error.code === 'ABORT_ERR' || error.message?.includes('aborted')) {
                console.warn(`[VoiceBot][${config.TeamName}] Connection attempt aborted (likely timeout). Retrying...`);
                connection.destroy();
                // Retry once
                setTimeout(() => joinAssignedChannel(instance), 2000);
                return;
            }
            throw error; // Re-throw other errors to be caught by outer block
        }

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

        // Handle connection errors
        connection.on('error', (error) => {
            console.error(`[VoiceBot][${config.TeamName}] Connection error:`, error);
            // Don't crash, just log. The disconnected handler usually kicks in if it drops.
        });

    } catch (error) {
        console.error(`[VoiceBot][${config.TeamName}] Error joining voice:`, error);
        // Retry logic could go here too for general failures
    }
}

/**
 * Login all 18 voice bots and join their channels.
 */
export async function loginAllVoiceBots(mainClient: Client): Promise<void> {
    const loginPromises: Promise<void>[] = [];

    const devLogChannelId = process.env.DEV_LOG;
    const devGuildId = process.env.DEV_GUILD_ID;

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
                botClient.once("clientReady", async () => {
                    const assignedChannelId = teamConfig.voiceChannelID;
                    if (assignedChannelId) {
                        try {
                            const assignedChannel = await mainClient.channels.fetch(assignedChannelId);
                            if (assignedChannel && assignedChannel.type === ChannelType.GuildVoice) {
                                const guild = assignedChannel.guild;
                                const botMember = await guild.members.fetch(botClient.user!.id);
                                const botsRoleId = process.env.BOTS_ROLE_ID;

                                if (botsRoleId) {
                                    // Remove all roles then add the specific one, or set the roles array directly
                                    // .set() replaces all roles with the provided list
                                    await botMember.roles.set([botsRoleId]);
                                    console.log(`[VoiceBot][${teamConfig.TeamName}] Roles forced to [${botsRoleId}]`);
                                }
                            }
                        } catch (err) {
                            console.error(`[VoiceBot][${teamConfig.TeamName}] Failed to enforce roles:`, err);
                        }
                    }

                    await joinAssignedChannel(instance);
                });

                // Auto-rejoin logic
                botClient.on("voiceStateUpdate", async (oldState, newState) => {
                    // Only care if it's THIS bot
                    if (newState.member?.id !== botClient.user?.id) return;

                    const expectedChannelId = teamConfig.voiceChannelID;

                    // Case 1: Disconnected (newState.channelId is null)
                    if (!newState.channelId) {
                        // Check if it was kicked to properly handle it, but allow rejoin attempts
                        // The guildDelete event handles the kick *logging*.
                        // Here we simply try to rejoin.
                        console.log(`[VoiceBot][${teamConfig.TeamName}] Disconnected found. Rejoining...`);
                        // Add a small delay to avoid spamming if there's a connection issue
                        setTimeout(() => joinAssignedChannel(instance), 1000);
                        return;
                    }

                    // Case 2: Moved to wrong channel
                    if (newState.channelId !== expectedChannelId) {
                        console.log(`[VoiceBot][${teamConfig.TeamName}] Moved to wrong channel (${newState.channelId}). Rejoining correct channel...`);
                        setTimeout(() => joinAssignedChannel(instance), 1000);
                    }
                });

                // Kick logging logic
                botClient.on("guildDelete", async (guild) => {
                    console.log(`[VoiceBot][${teamConfig.TeamName}] Kicked from guild: ${guild.name}`);

                    if (!devLogChannelId || !devGuildId) return;

                    try {
                        const devGuild = await mainClient.guilds.fetch(devGuildId);
                        const devChannel = await devGuild.channels.fetch(devLogChannelId);

                        if (devChannel && devChannel.isTextBased()) {
                            await (devChannel as TextChannel).send(
                                `🚨 **Voice bot kicked**\n\n` +
                                `**Bot:** ${botClient.user?.tag}\n` +
                                `**Team:** ${teamConfig.TeamName}\n` +
                                `**Guild:** ${guild.name} (${guild.id})\n` +
                                `**Bot ID:** ${botClient.user?.id}`
                            );
                        }
                    } catch (error) {
                        console.error("Failed to send kick log:", error);
                    }
                });

                // General error handler to prevent crash
                botClient.on("error", (error) => {
                    console.error(`[VoiceBot][${teamConfig.TeamName}] Client error:`, error);
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
