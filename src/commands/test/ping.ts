import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export default {
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Replies with Pong!"),
    run: async (interaction : ChatInputCommandInteraction) => {
        await interaction.reply("Pong!");
    }
}