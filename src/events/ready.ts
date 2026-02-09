import { Client, Events } from "discord.js";
import { fetchAndExport } from "../utils/fetchAndExport";
import cron from "node-cron";

export default {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        console.log(`Logged in as ${client.user?.tag}`);

        try {
            await fetchAndExport(client);
        } catch (error) {
            console.error("Error during initial member export:", error);
        }

        cron.schedule("0 7 * * *", async () => {
            console.log("Running daily member export...");
            await fetchAndExport(client);
        }, {
            timezone: "Africa/Algiers"
        });
    }
};