import {
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    SlashCommandBuilder,
    Client,
    EmbedBuilder,
} from "discord.js";
import { Workshop, getAllTeamConfigs, getTeamConfigByName } from "../../database";

export default {
    data: new SlashCommandBuilder()
        .setName("formation")
        .setDescription("View formations/workshops for any team (Admin / BE)")
        .addStringOption((option) =>
            option
                .setName("team")
                .setDescription("Select the team")
                .setRequired(true)
                .setAutocomplete(true)
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

    async run(interaction: ChatInputCommandInteraction, _client: Client) {
        await interaction.deferReply({ ephemeral: true });

        const teamName = interaction.options.getString("team", true);

        const teamConfig = await getTeamConfigByName(teamName);
        if (!teamConfig) {
            return interaction.editReply("❌ Team not found.");
        }

        // Fetch all workshops for the selected team
        const workshops = await Workshop.find({ teamName: teamConfig.TeamName })
            .sort({ createdAt: -1 })
            .limit(25);

        if (workshops.length === 0) {
            return interaction.editReply(
                `📋 No formations or workshops found for **${teamConfig.TeamName}**.`
            );
        }

        const embed = new EmbedBuilder()
            .setTitle(`📋 Formations — ${teamConfig.TeamName}`)
            .setColor(0x5865f2)
            .setDescription("Here are the formations/workshops for this team:")
            .setTimestamp();

        for (const w of workshops) {
            const startTs = Math.floor(w.startTime.getTime() / 1000);
            const totalExtensions =
                w.extensions?.reduce(
                    (sum, ext) => sum + ext.additionalMinutes,
                    0
                ) || 0;
            const durationInfo =
                totalExtensions > 0
                    ? `${w.averageDuration}m (+${totalExtensions}m extended)`
                    : `${w.averageDuration}m`;

            const statusEmoji =
                w.status === "completed"
                    ? "✅"
                    : w.status === "active"
                    ? "🟢"
                    : "🕐";

            embed.addFields({
                name: `${statusEmoji} ${w.type.toUpperCase()} — ${w.status}`,
                value:
                    `**ID:** \`${w.workshopId}\`\n` +
                    `**Date:** <t:${startTs}:F>\n` +
                    `**Duration:** ${durationInfo}\n` +
                    `${w.stoppedAt ? `**Ended:** <t:${Math.floor(w.stoppedAt.getTime() / 1000)}:F>` : ""}`,
                inline: false,
            });
        }

        await interaction.editReply({ embeds: [embed] });
    },
};
