import { Client, Collection, GatewayIntentBits, REST, Routes } from "discord.js";
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { loadExistingThemes } from "./utils/participantManager";

config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites
    ]
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

        console.log(`Successfully reloaded ${data.length} commands.`);
    } catch (error) {
        console.error(error);
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

// Load existing theme selections from the sheet
await loadExistingThemes();

// Cache invites for tracking
client.once('ready', async () => {
    const bootcampGuildId = process.env.BOOTCAMP_GUILD_ID;
    if (bootcampGuildId) {
        try {
            const guild = await client.guilds.fetch(bootcampGuildId);
            const invites = await guild.invites.fetch();
            const inviteCache = new Map();
            invites.forEach((invite) => {
                inviteCache.set(invite.code, { uses: invite.uses || 0 });
            });
            client.inviteCache.set(guild.id, inviteCache);
            console.log(`Cached ${invites.size} invites for bootcamp guild`);
        } catch (error) {
            console.error("Error caching invites:", error);
        }
    }
});

client.login(process.env.TOKEN);
