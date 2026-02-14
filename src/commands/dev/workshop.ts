import {
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    SlashCommandBuilder,
    Client,
    EmbedBuilder,
} from "discord.js";
import {
    Workshop,
    getAllTeamConfigs,
    getTeamConfigByName,
} from "../../database";

import {
    createWorkshop,
    stopWorkshop,
    getAllActiveTrackers,
} from "../../workshop";

export default {
    data: new SlashCommandBuilder()
        .setName("workshop")
        .setDescription("Dev tool — start, stop, or inspect any team's workshop")
        .addStringOption((option) =>
            option
                .setName("action")
                .setDescription("What to do")
                .setRequired(true)
                .addChoices(
                    { name: "Start", value: "start" },
                    { name: "Stop", value: "stop" },
                    { name: "State", value: "state" }
                )
        )
        .addStringOption((option) =>
            option
                .setName("team")
                .setDescription("Team name (required for start/stop)")
                .setRequired(false)
                .setAutocomplete(true)
        )
        .addStringOption((option) =>
            option
                .setName("type")
                .setDescription("Workshop type (for start)")
                .setRequired(false)
                .addChoices(
                    { name: "Workshop", value: "workshop" },
                    { name: "Formation", value: "formation" },
                    { name: "Other", value: "other" }
                )
        )
        .addStringOption((option) =>
            option
                .setName("duration")
                .setDescription("Duration (for start, e.g. 1h30, 2h, 45m). Default: 1h30")
                .setRequired(false)
        ),

    async autocomplete(interaction: AutocompleteInteraction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const teams = await getAllTeamConfigs();
        const filtered = teams
            .filter((t) => t.TeamName.toLowerCase().includes(focused))
            .slice(0, 25);
        await interaction.respond(
            filtered.map((t) => ({ name: t.TeamName, value: t.TeamName }))
        );
    },

    async run(interaction: ChatInputCommandInteraction, client: Client) {
        await interaction.deferReply({ ephemeral: true });

        const action = interaction.options.getString("action", true);
        const teamName = interaction.options.getString("team");

        // ── STATE — show all active workshops ──
        if (action === "state") {
            const activeWorkshops = await Workshop.find({
                status: { $in: ["scheduled", "active"] },
            }).sort({ startTime: -1 });

            if (activeWorkshops.length === 0) {
                return interaction.editReply("📋 No active or scheduled workshops.");
            }

            const trackers = getAllActiveTrackers();

            const embed = new EmbedBuilder()
                .setTitle("🔧 Workshop State (Dev)")
                .setColor(0xff9900)
                .setTimestamp();

            for (const w of activeWorkshops) {
                const tracker = trackers.get(w.workshopId);
                const startTs = Math.floor(w.startTime.getTime() / 1000);

                const totalExtensions =
                    w.extensions?.reduce(
                        (sum, ext) => sum + ext.additionalMinutes,
                        0
                    ) || 0;

                const endMs =
                    w.startTime.getTime() +
                    (w.averageDuration + totalExtensions) * 60_000;
                const endTs = Math.floor(endMs / 1000);

                embed.addFields({
                    name: `${w.status === "active" ? "🟢" : "🕐"} ${w.teamName} — ${w.type}`,
                    value:
                        `**ID:** \`${w.workshopId}\`\n` +
                        `**Status:** ${w.status}\n` +
                        `**Start:** <t:${startTs}:F>\n` +
                        `**Duration:** ${w.averageDuration}m` +
                        (totalExtensions > 0 ? ` (+${totalExtensions}m ext)` : "") +
                        `\n` +
                        `**Expected end:** <t:${endTs}:R>\n` +
                        `**Tracker active:** ${tracker ? "Yes" : "No"}`,
                    inline: false,
                });
            }

            return interaction.editReply({ embeds: [embed] });
        }

        // ── START / STOP require a team ──
        if (!teamName) {
            return interaction.editReply(
                "❌ You must select a **team** for start/stop."
            );
        }

        const teamConfig = await getTeamConfigByName(teamName);
        if (!teamConfig) {
            return interaction.editReply("❌ Team not found.");
        }

        // ── START ──
        if (action === "start") {
            const type =
                (interaction.options.getString("type") as
                    | "workshop"
                    | "formation"
                    | "other") || "formation";
            const durationStr =
                interaction.options.getString("duration") || "1h30";

            const result = await createWorkshop(
                interaction.user.id,
                teamConfig,
                type,
                new Date(), // start now
                durationStr,
                client
            );

            return interaction.editReply(
                result.success
                    ? `✅ ${result.message}`
                    : `❌ ${result.message}`
            );
        }

        // ── STOP ──
        if (action === "stop") {
            // Find the active workshop for this team
            const workshop = await Workshop.findOne({
                teamName: teamConfig.TeamName,
                status: "active",
            });

            if (!workshop) {
                return interaction.editReply(
                    `❌ No active workshop found for **${teamConfig.TeamName}**.`
                );
            }

            const result = await stopWorkshop(workshop.workshopId, client);

            return interaction.editReply(
                result.success
                    ? `✅ ${result.message}`
                    : `❌ ${result.message}`
            );
        }

        return interaction.editReply("❌ Unknown action.");
    },
};
