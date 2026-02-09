import { Client } from "discord.js";
import { REQUIRED_ROLE, GUILD_ID } from "./teamsConfig";
import { resolveRoles } from "./resolveRoles";
import { updateSheet } from "./sheetManager";

export async function fetchAndExport(client: Client) {
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch();

    const rows: string[][] = [];

    members.forEach(member => {
        if (member.user.bot) return;
        if (!member.roles.cache.has(REQUIRED_ROLE)) return;

        const { team1, team2, dep } = resolveRoles(member);

        rows.push([member.user.username, team1, team2, dep]);
    });

    await updateSheet(rows);
}
