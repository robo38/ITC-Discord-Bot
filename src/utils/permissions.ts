import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import teamsData from "../data";
import { BE_ID } from "../data";

export const DEV_USER_ID = process.env.DEV_USER_ID || "695223884735053905";

export async function checkCommandPermission(
    interaction: ChatInputCommandInteraction,
    folder: string | undefined
): Promise<{ allowed: boolean; message?: string }> {
    // If no folder is specified or command is in general folder, allow anyone
    if (!folder || folder === "general" || folder === "test") {
        return { allowed: true };
    }

    // Check for dev folder - only owner can use
    if (folder === "dev") {
        if (interaction.user.id !== DEV_USER_ID) {
            return {
                allowed: false,
                message: "❌ This command is only available to the bot owner.",
            };
        }
        return { allowed: true };
    }

    // Check for admin folder - requires Administrator permission, BE, or dev
    if (folder === "admin") {
        // Dev and BE always have admin access
        if (interaction.user.id === DEV_USER_ID) return { allowed: true };
        if (BE_ID && interaction.user.id === BE_ID) return { allowed: true };

        const member = interaction.guild?.members.cache.get(interaction.user.id);
        if (!member) {
            return {
                allowed: false,
                message: "❌ Could not verify your permissions.",
            };
        }

        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return {
                allowed: false,
                message: "❌ This command requires Administrator permission.",
            };
        }
        return { allowed: true };
    }

    // Check for leader folder - must be a LeaderID in any team config
    if (folder === "leader") {
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        if (!member) {
            return {
                allowed: false,
                message: "❌ Could not verify your permissions.",
            };
        }

        // Check if user has any team leader role from teamsData
        const memberRoles = member.roles.cache.map((r) => r.id);
        const isLeader = teamsData.some(
            (team) => team.LeaderID && memberRoles.includes(team.LeaderID)
        );

        if (isLeader) {
            return { allowed: true };
        }

        // Also check if they have the general leader role from env
        const leaderRoleId = process.env.LEADER_ROLE_ID;
        if (leaderRoleId && member.roles.cache.has(leaderRoleId)) {
            return { allowed: true };
        }

        return {
            allowed: false,
            message: "❌ This command is only available to team leaders.",
        };
    }

    // Unknown folder - allow by default
    return { allowed: true };
}
