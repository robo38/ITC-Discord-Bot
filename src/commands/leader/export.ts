import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    Client,
    AttachmentBuilder,
} from "discord.js";
import { Workshop, Participant } from "../../database";
import { exportWorkshopToExcel } from "../../workshop";
import teamsData, { BE_ID } from "../../data";
import { DEV_USER_ID } from "../../utils/permissions";

export default {
    data: new SlashCommandBuilder()
        .setName("export")
        .setDescription("Export a formation/workshop report by its ID")
        .addStringOption((option) =>
            option
                .setName("workshop-id")
                .setDescription("The workshop/formation ID (use /formations to find it)")
                .setRequired(true)
        ),

    async run(interaction: ChatInputCommandInteraction, _client: Client) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const isBEorDev = userId === BE_ID || userId === DEV_USER_ID;

        const workshopId = interaction.options.getString("workshop-id", true);

        // Find the workshop
        const workshop = await Workshop.findOne({ workshopId });

        if (!workshop) {
            return interaction.editReply(
                "❌ No workshop found with that ID. Use `/formations` to see your formation IDs."
            );
        }

        // If not BE/dev, verify the workshop belongs to this leader's team
        if (!isBEorDev) {
            const member = interaction.guild?.members.cache.get(userId);
            if (!member) {
                return interaction.editReply("❌ Could not fetch your member data.");
            }

            const memberRoles = member.roles.cache.map((r) => r.id);
            const teamConfig = teamsData.find((team) => {
                return team.LeaderID && memberRoles.includes(team.LeaderID);
            });

            if (!teamConfig) {
                return interaction.editReply(
                    "❌ Could not identify your team. Make sure you have the correct leader role."
                );
            }

            if (workshop.teamName !== teamConfig.TeamName) {
                return interaction.editReply(
                    "❌ This workshop does not belong to your team."
                );
            }
        }

        // Get participants
        const participants = await Participant.find({ workshopId });

        if (participants.length === 0) {
            return interaction.editReply(
                "❌ No participant data found for this workshop."
            );
        }

        // Generate Excel
        const filePath = await exportWorkshopToExcel(workshopId, workshop, participants);

        const attachment = new AttachmentBuilder(filePath);

        const totalDuration = workshop.stoppedAt
            ? Math.round((workshop.stoppedAt.getTime() - workshop.startTime.getTime()) / 60_000)
            : "N/A";

        const totalExtensions = workshop.extensions?.reduce(
            (sum, ext) => sum + ext.additionalMinutes,
            0
        ) || 0;

        await interaction.editReply({
            content:
                `📊 **Export — ${workshop.teamName}**\n` +
                `Type: **${workshop.type}**\n` +
                `Date: <t:${Math.floor(workshop.startTime.getTime() / 1000)}:F>\n` +
                `Duration: **${totalDuration} minutes**` +
                (totalExtensions > 0 ? ` (including ${totalExtensions}m extensions)` : "") + `\n` +
                `Participants: **${participants.length}**`,
            files: [attachment],
        });
    },
};
