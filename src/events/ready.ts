import { Client, Events } from "discord.js";
import { fetchAndExport } from "../utils/fetchAndExport";
import { syncParticipantsFromRole } from "../utils/participantManager";
import cron from "node-cron";

export default {
    name: 'clientReady',
    once: true,
    async execute(client: Client) {
        console.log(`Logged in as ${client.user?.tag}`);

        try {
            await fetchAndExport(client);
        } catch (error) {
            console.error("Error during initial member export:", error);
        }

        // Sync participants with bootcamp role to CSV
        try {
            await syncParticipantsFromRole(client);
        } catch (error) {
            console.error("Error syncing participants:", error);
        }

        cron.schedule("0 7 * * *", async () => {
            console.log("Running daily member export...");
            await fetchAndExport(client);
        }, {
            timezone: "Africa/Algiers"
        });
    }
};