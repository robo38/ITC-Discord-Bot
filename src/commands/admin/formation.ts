import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    Client,
    EmbedBuilder,
} from "discord.js";
import { Workshop } from "../../database";
import teamsData from "../../data";

export default {
    data: new SlashCommandBuilder()
        .setName("formation")
        .setDescription("View formations/workshops for any team (Admin / BE)")
        .addStringOption((option) =>
            option
                .setName("team")
                .setDescription("Select the team")
                .setRequired(true)
                .addChoices(
                    ...teamsData.map((t) => ({
                        name: t.TeamName,
                        value: t.TeamName,
                    }))
                )
        ),

    async run(interaction: ChatInputCommandInteraction, _client: Client) {
        await interaction.deferReply({ ephemeral: true });

        const teamName = interaction.options.getString("team", true);

        const teamConfig = teamsData.find((t) => t.TeamName === teamName);
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
