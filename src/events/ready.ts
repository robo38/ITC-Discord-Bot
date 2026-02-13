import { Client, Events } from "discord.js";
import { fetchAndExport } from "../utils/fetchAndExport";
import { syncParticipantsFromRole } from "../utils/participantManager";
import { logError, logSuccess } from "../utils/logger";
import cron from "node-cron";

export default {
    name: 'clientReady',
    once: true,
    async execute(client: Client) {
        logSuccess("Main Bot Ready", `Logged in as ${client.user?.tag}`);

        try {
            await fetchAndExport(client);
        } catch (error: any) {
            logError("Initial member export failed", error);
        }

        // Sync participants with bootcamp role to CSV
        try {
            await syncParticipantsFromRole(client);
        } catch (error: any) {
            logError("Participant sync failed", error);
        }

        cron.schedule("0 7 * * *", async () => {
            try {
                await fetchAndExport(client);
                logSuccess("Daily Export", "Member export completed");
            } catch (error: any) {
                logError("Daily export failed", error);
            }
        }, {
            timezone: "Africa/Algiers"
        });
    }
};