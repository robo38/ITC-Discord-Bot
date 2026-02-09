import fs from "fs";
import path from "path";
import { createObjectCsvWriter } from "csv-writer";

const CSV_PATH = path.join(process.cwd(), "bootcamp_participants.csv");

// Store participants in memory to check theme selection
const participantThemes = new Map<string, string>();

export interface ParticipantData {
    discordId: string;
    theme: string | null;
}

// Initialize CSV file if it doesn't exist
function initializeCSV() {
    if (!fs.existsSync(CSV_PATH)) {
        fs.writeFileSync(CSV_PATH, "discord_id,theme\n");
        console.log("Created bootcamp_participants.csv");
    }
}

export async function addParticipant(discordId: string) {
    try {
        initializeCSV();

        // Append to CSV
        const csvWriter = createObjectCsvWriter({
            path: CSV_PATH,
            header: [
                { id: "discordId", title: "discord_id" },
                { id: "theme", title: "theme" },
            ],
            append: true,
        });

        await csvWriter.writeRecords([{ discordId, theme: "null" }]);
        console.log(`Added participant ${discordId} to CSV`);
    } catch (error) {
        console.error("Error adding participant:", error);
    }
}

export async function updateParticipantTheme(userId: string, theme: string) {
    try {
        // Check if user already has a theme
        if (participantThemes.has(userId)) {
            return { success: false, message: "You have already selected a theme!" };
        }

        initializeCSV();

        // Read the CSV file
        const csvContent = fs.readFileSync(CSV_PATH, "utf-8");
        const lines = csvContent.split("\n");

        let updated = false;
        const updatedLines = lines.map((line) => {
            if (line.startsWith(userId + ",")) {
                updated = true;
                return `${userId},${theme}`;
            }
            return line;
        });

        if (!updated) {
            return { success: false, message: "User not found in CSV" };
        }

        // Write back to CSV
        fs.writeFileSync(CSV_PATH, updatedLines.join("\n"));

        // Store in memory
        participantThemes.set(userId, theme);

        console.log(`Updated theme for ${userId} to ${theme}`);
        return { success: true, message: "Theme selected successfully!" };
    } catch (error) {
        console.error("Error updating participant theme:", error);
        return { success: false, message: "Error updating theme" };
    }
}

export function hasSelectedTheme(userId: string): boolean {
    return participantThemes.has(userId);
}

// Load existing themes on startup
export async function loadExistingThemes() {
    try {
        initializeCSV();

        const csvContent = fs.readFileSync(CSV_PATH, "utf-8");
        const lines = csvContent.split("\n").slice(1); // Skip header

        let count = 0;
        for (const line of lines) {
            if (!line.trim()) continue;

            const [discordId, theme] = line.split(",");
            if (discordId && theme && theme !== "null" && theme.trim() !== "") {
                participantThemes.set(discordId.trim(), theme.trim());
                count++;
            }
        }
        console.log(`Loaded ${count} existing theme selections from CSV`);
    } catch (error) {
        console.log("No existing themes to load or CSV doesn't exist yet");
    }
}

