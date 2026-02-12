import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    Client,
} from "discord.js";
import { stopWorkshopByLeader } from "../../workshop";

export default {
    data: new SlashCommandBuilder()
        .setName("stop-workshop")
        .setDescription("Stop your currently active workshop and generate the report"),

    async run(interaction: ChatInputCommandInteraction, client: Client) {
        await interaction.deferReply({ ephemeral: true });

        const leaderID = interaction.user.id;
        const result = await stopWorkshopByLeader(leaderID, client);

        if (!result.success) {
            return interaction.editReply(`❌ ${result.message}`);
        }

        await interaction.editReply(`${result.message}`);
    },
};
