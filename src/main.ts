import { Client, Collection, GatewayIntentBits, REST, Routes } from "discord.js";
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { loadExistingThemes } from "./utils/participantManager";
import { connectDB } from "./database";
import { loginAllVoiceBots } from "./voice";
import { setMainClient } from "./workshop";
import { resumeActiveWorkshops } from "./workshop";
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

client.login(process.env.TOKEN);
