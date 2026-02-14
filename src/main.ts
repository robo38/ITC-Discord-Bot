import { Client, Collection, GatewayIntentBits, REST, Routes } from "discord.js";
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { loadExistingThemes } from "./utils/participantManager";
import { connectDB } from "./database";
import { loginAllVoiceBots } from "./voice";
import { setMainClient } from "./workshop";
import { startDashboard, setDashboardClient } from "./dashboard";
import { initLogger, logError, logSuccess, logDatabase, logDebug } from "./utils/logger";
import { startCLI } from "./cli";

config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
    ]
});

// Patch discord.js WS error handler for Bun compatibility
// Bun can pass non-object errors to WebSocket onError, which crashes discord.js
client.rest.on("rateLimited", (info) => {
    logDebug("Discord Rate Limited", JSON.stringify(info));
});

client.on("error", (err) => {
    logError("Discord Client Error", err);
});

client.on("shardError", (err, shardId) => {
    logError(`Discord Shard ${shardId} WS Error`, err);
});

// Global error handling to prevent process crashes
process.on('unhandledRejection', (reason: any) => {
    logError('Unhandled Rejection', reason instanceof Error ? reason : String(reason));
});

process.on('uncaughtException', (err) => {
    logError('Uncaught Exception', err);
});

client.commands = new Collection();
client.inviteCache = new Map(); // For tracking invite usage

export async function loadCommands() {
    const foldersPath = path.join(__dirname, "commands");
    if (!fs.existsSync(foldersPath)) return;

    const commandFolders = fs.readdirSync(foldersPath);

    for (const folder of commandFolders) {
        const commandsPath = path.join(foldersPath, folder);
        if (!fs.existsSync(commandsPath)) continue;

        const commandFiles = fs
            .readdirSync(commandsPath)
            .filter((file) => file.endsWith(".ts") || file.endsWith(".js"));

        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);

            let command = require(filePath);
            command = command.default || command;

            if ("data" in command && ("run" in command || "execute" in command)) {
                // Store the folder name with the command
                command.folder = folder;
                client.commands.set(command.data.name, command);
            } else {
                console.log(
                    `[WARNING] The command at ${filePath} is missing a required "data" or "run/execute" property.`
                );
            }
        }
    }
}

export async function registerCommands() {
    const rest = new REST().setToken(process.env.TOKEN as string);

    try {
        console.log(
            `Started refreshing ${(client as any).commands.size} application (/) commands.`
        );

        const data: any = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID as string),
            {
                body: client.commands.map((cmd: any) =>
                    cmd.data.toJSON()
                )
            }
        );

        logSuccess("Commands", `Successfully reloaded ${data.length} commands`);
    } catch (error: any) {
        logError("Register commands failed", error);
    }
}

const eventsPath = path.join(__dirname, "events");

if (fs.existsSync(eventsPath)) {
    const eventFiles = fs
        .readdirSync(eventsPath)
        .filter((file) => file.endsWith(".ts") || file.endsWith(".js"));

    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);

        let event = require(filePath);
        event = event.default || event;

        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }
    }
}

await loadCommands();
await registerCommands();

// Connect to MongoDB
await connectDB();

// Start the web dashboard
const dashboardPort = parseInt(process.env.DASHBOARD_PORT || "4000");
startDashboard(dashboardPort);

// Load existing theme selections from the sheet
await loadExistingThemes();

// Cache invites for tracking
client.once('clientReady', async () => {
    // Store main client reference for workshop system
    setMainClient(client);

    // Set client for dashboard (leader lookups)
    setDashboardClient(client);

    // Initialize Discord channel logger now that the client is ready
    initLogger(client);
    logSuccess("Bot Online", `Logged in as ${client.user?.tag}`);

    // Cache members from the MAIN guild (role checks, leader lookups, dashboard auth)
    const mainGuildId = process.env.GUILD_ID;
    if (mainGuildId) {
        try {
            const mainGuild = await client.guilds.fetch(mainGuildId);
            await mainGuild.members.fetch();
            logDebug("Member Cache", `Cached ${mainGuild.members.cache.size} members from main guild`);
        } catch (error: any) {
            logError("Main guild member cache failed", error);
        }
    }

    // Cache invites from the BOOTCAMP guild (invite tracking)
    const bootcampGuildId = process.env.BOOTCAMP_GUILD_ID;
    if (bootcampGuildId) {
        try {
            const bootcampGuild = await client.guilds.fetch(bootcampGuildId);
            const invites = await bootcampGuild.invites.fetch();
            const inviteCache = new Map();
            invites.forEach((invite) => {
                inviteCache.set(invite.code, { uses: invite.uses || 0 });
            });
            client.inviteCache.set(bootcampGuild.id, inviteCache);
            logDebug("Invite Cache", `Cached ${invites.size} invites for bootcamp guild`);

            // Also cache bootcamp guild members for participant tracking
            await bootcampGuild.members.fetch();
            logDebug("Member Cache", `Cached ${bootcampGuild.members.cache.size} members from bootcamp guild`);
        } catch (error: any) {
            logError("Bootcamp guild cache failed", error);
        }
    }

    // Login all 18 voice bots after main bot is ready
    try {
        await loginAllVoiceBots(client);
    } catch (error: any) {
        logError("Voice Bots Init Failed", error);
    }

    // Start interactive CLI
    startCLI(client);
});

client.login(process.env.TOKEN);
