import { Events, MessageFlags, Interaction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from "discord.js";
import { updateParticipantTheme, hasSelectedTheme } from "../utils/participantManager";
import { checkCommandPermission } from "../utils/permissions";
import { continueWorkshop, stopWorkshop, parseDuration } from "../workshop";
import { logError } from "../utils/logger";

const THEME1_ROLE = process.env.THEME1_ROLE!;
const THEME2_ROLE = process.env.THEME2_ROLE!;
const THEME3_ROLE = process.env.THEME3_ROLE!;

export default {
    name: Events.InteractionCreate,
    async execute(interaction : Interaction) {
        // Handle slash commands
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                logError("Unknown Command", `No command matching ${interaction.commandName}`);
                return;
            }

            // Check permissions based on folder
            const permissionCheck = await checkCommandPermission(interaction, command.folder);
            if (!permissionCheck.allowed) {
                await interaction.reply({
                    content: permissionCheck.message || "❌ You don't have permission to use this command.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            try {
                await command.run(interaction, interaction.client);
            } catch (error: any) {
                logError(`Command /${interaction.commandName} failed`, error);
                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({
                            content: 'There was an error while executing this command!',
                            flags: MessageFlags.Ephemeral,
                        });
                    } else {
                        await interaction.reply({
                            content: 'There was an error while executing this command!',
                            flags: MessageFlags.Ephemeral,
                        });
                    }
                } catch {}
            }
            return;
        }

        // Handle button interactions
        if (interaction.isButton()) {
            const customId = interaction.customId;

            if (customId.startsWith("theme_")) {
                await handleThemeSelection(interaction);
            }

            // Workshop Continue button → show modal for custom time
            if (customId.startsWith("workshop_continue_")) {
                const workshopId = customId.replace("workshop_continue_", "");

                const modal = new ModalBuilder()
                    .setCustomId(`workshop_continue_modal_${workshopId}`)
                    .setTitle("Extend Workshop");

                const durationInput = new TextInputBuilder()
                    .setCustomId("additional_duration")
                    .setLabel("Additional time (e.g. 30m, 1h, 1h30m)")
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("30m")
                    .setRequired(true);

                const row = new ActionRowBuilder<TextInputBuilder>().addComponents(durationInput);
                modal.addComponents(row);

                await interaction.showModal(modal);
            }

            if (customId.startsWith("workshop_stop_")) {
                const workshopId = customId.replace("workshop_stop_", "");
                await interaction.deferReply({ ephemeral: true });
                const result = await stopWorkshop(workshopId, interaction.client);
                await interaction.editReply(
                    result.success
                        ? `⏹️ ${result.message}`
                        : `❌ ${result.message}`
                );
                // Disable buttons
                try {
                    await interaction.message.edit({ components: [] });
                } catch {}
            }
        }

        // Handle modal submissions (workshop continue with custom time)
        if (interaction.isModalSubmit()) {
            const customId = interaction.customId;

            if (customId.startsWith("workshop_continue_modal_")) {
                const workshopId = customId.replace("workshop_continue_modal_", "");
                const durationStr = interaction.fields.getTextInputValue("additional_duration");
                const additionalMinutes = parseDuration(durationStr);

                if (additionalMinutes <= 0) {
                    await interaction.reply({
                        content: "❌ Invalid duration. Use a format like `30m`, `1h`, or `1h30m`.",
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                const success = await continueWorkshop(workshopId, additionalMinutes);
                if (success) {
                    await interaction.reply({
                        content: `▶️ Workshop extended by **${additionalMinutes} minutes**. You'll be notified again when time is up.`,
                        flags: MessageFlags.Ephemeral,
                    });
                } else {
                    await interaction.reply({
                        content: "❌ Workshop not found or already stopped.",
                        flags: MessageFlags.Ephemeral,
                    });
                }
            }
        }
    },
};

async function handleThemeSelection(interaction: any) {
    try {
        // Check if user already selected a theme
        if (hasSelectedTheme(interaction.user.id)) {
            await interaction.reply({
                content: "❌ You have already selected a theme! You can only choose one theme.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const themeNumber = interaction.customId.split("_")[1];
        let themeName = "";
        let roleId = "";

        switch (themeNumber) {
            case "1":
                themeName = "Smart To-Do / Task Manager";
                roleId = THEME1_ROLE;
                break;
            case "2":
                themeName = "Mini Social Wall";
                roleId = THEME2_ROLE;
                break;
            case "3":
                themeName = "Daily Habit Tracker";
                roleId = THEME3_ROLE;
                break;
        }

        // Update in sheet
        const result = await updateParticipantTheme(
            interaction.user.id,
            themeName
        );

        if (!result.success) {
            await interaction.reply({
                content: `❌ ${result.message}`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Give theme role if in guild
        if (interaction.guild) {
            try {
                const member = await interaction.guild.members.fetch(interaction.user.id);
                await member.roles.add(roleId);
            } catch (error: any) {
                logError("Theme role add failed", error);
            }
        }

        // Disable all buttons
        const disabledRows = interaction.message.components.map((row: any) => {
            row.components.forEach((button: any) => {
                button.data.disabled = true;
            });
            return row;
        });

        await interaction.update({
            components: disabledRows
        });

        await interaction.followUp({
            content: `✅ Great! You've selected **${themeName}**!\n\n` +
                `You now have the theme role and your selection has been saved.\n\n` +
                `Good luck with your project! 🚀`,
            flags: MessageFlags.Ephemeral,
        });

        console.log(`${interaction.user.username} selected theme ${themeNumber}`);
    } catch (error: any) {
        logError("Theme selection failed", error);
        await interaction.reply({
            content: "❌ An error occurred while processing your selection.",
            flags: MessageFlags.Ephemeral,
        });
    }
}