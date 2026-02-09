import { GuildMember } from "discord.js";
import { teams, depIDs } from "./teamsConfig";

export function resolveRoles(member: GuildMember) {
    let team1 = "";
    const team2: string[] = [];
    const deps: string[] = [];

    for (const team of teams) {
        if (!team1 && team.Team1 && member.roles.cache.has(team.Team1)) {
            team1 = team.name;
        }

        if (team.Team2 && member.roles.cache.has(team.Team2)) {
            team2.push(team.name);
        }
    }

    for (const dep of depIDs) {
        if (member.roles.cache.has(dep.id)) {
            deps.push(dep.name);
        }
    }

    return {
        team1,
        team2: team2.join(", "),
        dep: deps.join(", ")
    };
}
