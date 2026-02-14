import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    Client,
} from "discord.js";
import { Workshop, Participant, Session } from "../../database";
import { DEV_USER_ID } from "../../utils/permissions";

const BE_ID = process.env.BE_ID || "";
import { logError, logSuccess } from "../../utils/logger";

export default {
    data: new SlashCommandBuilder()
        .setName("reset")
        .setDescription("Reset all workshop/formation data (BE only)")
        .addStringOption((option) =>
            option
                .setName("confirm")
                .setDescription('Type "CONFIRM" to proceed with the reset')
                .setRequired(true)
        ),

    async run(interaction: ChatInputCommandInteraction, _client: Client) {
        // Extra restriction: only BE or dev can use this
        const userId = interaction.user.id;
        if (userId !== BE_ID && userId !== DEV_USER_ID) {
            return interaction.reply({
                content: "❌ This command is restricted to the BE only.",
                ephemeral: true,
            });
        }

        const confirmation = interaction.options.getString("confirm", true);
        if (confirmation !== "CONFIRM") {
            return interaction.reply({
                content:
                    '❌ You must type `CONFIRM` (all caps) to reset all data.\n⚠️ This action **cannot be undone**.',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const [workshopResult, participantResult, sessionResult] =
                await Promise.all([
                    Workshop.deleteMany({}),
                    Participant.deleteMany({}),
                    Session.deleteMany({}),
                ]);

            await interaction.editReply(
                `✅ **All data has been reset.**\n\n` +
                    `Deleted:\n` +
                    `• **${workshopResult.deletedCount}** workshops\n` +
                    `• **${participantResult.deletedCount}** participants\n` +
                    `• **${sessionResult.deletedCount}** sessions`
            );
        } catch (error: any) {
            logError("Reset command", error);
            await interaction.editReply(
                "❌ An error occurred while resetting data. Check the logs."
            );
        }
    },
};
