import { Client, Events, GuildMember } from "discord.js";
import { addParticipant } from "../utils/participantManager";
import fs from "fs";
import path from "path";

const BOOTCAMP_GUILD_ID = process.env.BOOTCAMP_GUILD_ID!;
const BOOTCAMP_ROLE = process.env.BOOTCAMP_ROLE!;
const CSV_PATH = path.join(process.cwd(), "bootcamp_participants.csv");

// Helper function to check if user is already in CSV
function isUserInCSV(userId: string): boolean {
    try {
        const csvContent = fs.readFileSync(CSV_PATH, "utf-8");
        const lines = csvContent.split("\n");
        return lines.some(line => line.startsWith(userId + ","));
    } catch (error) {
        return false;
    }
}

// Helper function to remove user from CSV
function removeUserFromCSV(userId: string): void {
    try {
        const csvContent = fs.readFileSync(CSV_PATH, "utf-8");
        const lines = csvContent.split("\n");
        
        // Filter out the user's line
        const updatedLines = lines.filter(line => !line.startsWith(userId + ","));
        
        fs.writeFileSync(CSV_PATH, updatedLines.join("\n"));
        console.log(`🗑️ Removed user ${userId} from CSV`);
    } catch (error) {
        console.error("Error removing user from CSV:", error);
    }
}

export default {
    name: Events.GuildMemberUpdate,
    async execute(oldMember: GuildMember, newMember: GuildMember, client: Client) {
        // Only process for the bootcamp guild
        if (newMember.guild.id !== BOOTCAMP_GUILD_ID) return;

        // Check if the participant role was added or removed
        const hadRole = oldMember.roles.cache.has(BOOTCAMP_ROLE);
        const hasRole = newMember.roles.cache.has(BOOTCAMP_ROLE);

        if (!hadRole && hasRole) {
            // Role was just added
            console.log(`Participant role added to ${newMember.user.username} by admin`);

            // Check if user is already in CSV
            if (!isUserInCSV(newMember.id)) {
                await addParticipant(newMember.id);
                console.log(`✅ Added ${newMember.user.username} to CSV`);
            } else {
                console.log(`User ${newMember.user.username} already in CSV`);
            }
        } else if (hadRole && !hasRole) {
            // Role was just removed
            console.log(`Participant role removed from ${newMember.user.username} by admin`);
            removeUserFromCSV(newMember.id);
        }
    }
};
