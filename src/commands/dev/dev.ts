import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

const DEV_ROLE_ID = "1470730748247019582";

export default {
    data: new SlashCommandBuilder()
        .setName("dev")
        .setDescription("Developer command"),
    async run(interaction: ChatInputCommandInteraction) {
        // Permission check is now handled by the folder system
        try {
            const member = interaction.guild?.members.cache.get(interaction.user.id);
            
            if (!member) {
                return interaction.reply({
                    content: "❌ Could not fetch member data.",
                    ephemeral: true,
                });
            }

            const hasRole = member.roles.cache.has(DEV_ROLE_ID);

            if (hasRole) {
                // Remove the role
                await member.roles.remove(DEV_ROLE_ID);
                await interaction.reply({
                    content: "✅ Dev role removed.",
                    ephemeral: true,
                });
            } else {
                // Add the role
                await member.roles.add(DEV_ROLE_ID);
                await interaction.reply({
                    content: "✅ Dev role added.",
                    ephemeral: true,
                });
            }
        } catch (error) {
            console.error("Error toggling dev role:", error);
            await interaction.reply({
                content: "❌ Failed to toggle role.",
                ephemeral: true,
            });
        }
    },
};
