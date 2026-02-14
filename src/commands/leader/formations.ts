import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    Client,
    EmbedBuilder,
} from "discord.js";
import { Workshop, getTeamConfigByLeaderRole } from "../../database";

export default {
    data: new SlashCommandBuilder()
        .setName("formations")
        .setDescription("List all formations/workshops for your team"),

    async run(interaction: ChatInputCommandInteraction, _client: Client) {
        await interaction.deferReply({ ephemeral: true });

        const member = interaction.guild?.members.cache.get(interaction.user.id);
        if (!member) {
            return interaction.editReply("❌ Could not fetch your member data.");
        }

        // Find which team this leader belongs to by checking leader role
        const memberRoles = member.roles.cache.map((r) => r.id);
        const teamConfig = await getTeamConfigByLeaderRole(memberRoles);

        if (!teamConfig) {
            return interaction.editReply(
                "❌ Could not identify your team. Make sure you have the correct leader role."
            );
        }

        // Fetch all workshops for this team
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
            .setDescription("Here are the formations/workshops for your team:")
            .setTimestamp();

        for (const w of workshops) {
            const startTs = Math.floor(w.startTime.getTime() / 1000);
            const totalExtensions = w.extensions?.reduce(
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
