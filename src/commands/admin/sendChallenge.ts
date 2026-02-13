import { ChatInputCommandInteraction, SlashCommandBuilder, ButtonStyle, ContainerBuilder, MessageFlags } from "discord.js";
import { logError } from "../../utils/logger";

const ADMIN_ROLE_ID = "964586364488253510";
const ADMIN_USER_ID = "695223884735053905";

export default {
    data: new SlashCommandBuilder()
        .setName("sendchallenge")
        .setDescription("Send the bootcamp challenge embed to a user or channel")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("The user to send the challenge to (leave empty to send in channel)")
                .setRequired(false)
        ),
    async run(interaction: ChatInputCommandInteraction) {
        // Check if user has admin role or is the specific admin user
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        const hasAdminRole = member?.roles.cache.has(ADMIN_ROLE_ID);
        const isAdminUser = interaction.user.id === ADMIN_USER_ID;

        if (!hasAdminRole && !isAdminUser) {
            return interaction.reply({
                content: "❌ You don't have permission to use this command.",
                ephemeral: true,
            });
        }

        const targetUser = interaction.options.getUser("user");

        try {
            const container = new ContainerBuilder()
                .setAccentColor(0x00AE86)
                .addTextDisplayComponents((textDisplay) =>
                    textDisplay.setContent(
                        '**BOOTCAMP MINI CHALLENGE ✨**\n\n' +
                        'Heyyyyyy teams 🔥\n' +
                        'We\'re officially launching the Mini Challenge.\n\n' +
                        'Each team must choose **ONE theme only** and build a simple, functional mobile app based on it.'
                    )
                )
                .addSeparatorComponents((separator) => separator)
                .addSectionComponents((section) =>
                    section
                        .addTextDisplayComponents((textDisplay) =>
                            textDisplay.setContent(
                                '**� THEME 1 — Smart To-Do / Task Manager**\n\n' +
                                '**Flutter Concepts Used**\n' +
                                'Forms • ListView • Cards • Checkbox • Stateful UI • Navigation\n\n' +
                                '**Required Features**\n' +
                                '1. Authentication\n' +
                                '2. Add Task Screen (Title, Description, Add Task button)\n' +
                                '3. Tasks List Screen (ListView with Cards, Title + Description, Checkbox for Done/Not Done, UI updates when checked)\n' +
                                '4. Edit Task Screen (Modify title & description, Save button)\n' +
                                '5. Filter Section (All Tasks button, Completed Tasks button)\n' +
                                '6. Delete Task'
                            )
                        )
                        .setButtonAccessory((button) =>
                            button
                                .setCustomId('theme_1')
                                .setLabel('Select Theme 1')
                                .setStyle(ButtonStyle.Primary)
                                .setEmoji({ name: '📱' })
                        )
                )
                .addSectionComponents((section) =>
                    section
                        .addTextDisplayComponents((textDisplay) =>
                            textDisplay.setContent(
                                '**📌 THEME 2 — Mini Social Wall (Anonymous Posts)**\n\n' +
                                '**Flutter Concepts Used**\n' +
                                'Feed UI • Buttons • Counters • Stateful Updates\n\n' +
                                '**Required Features**\n' +
                                '1. Authentication\n' +
                                '2. Create Post Screen (TextField for post content, Publish button)\n' +
                                '3. Feed Screen (ListView with Cards containing Text, Like button, Likes counter that updates live)\n' +
                                '4. Delete Own Post\n' +
                                '5. My Posts Screen (Shows only posts created by the user)'
                            )
                        )
                        .setButtonAccessory((button) =>
                            button
                                .setCustomId('theme_2')
                                .setLabel('Select Theme 2')
                                .setStyle(ButtonStyle.Success)
                                .setEmoji({ name: '🌐' })
                        )
                )
                .addSectionComponents((section) =>
                    section
                        .addTextDisplayComponents((textDisplay) =>
                            textDisplay.setContent(
                                '**� THEME 3 — Daily Habit Tracker**\n\n' +
                                '**Flutter Concepts Used**\n' +
                                'Checkbox • Stateful UI • Progress Display • Lists\n\n' +
                                '**Required Features**\n' +
                                '1. Authentication\n' +
                                '2. Add Habit Screen (Habit name, Add button)\n' +
                                '3. Habits List Screen (ListView of habits, Checkbox for Done today, UI updates when checked)\n' +
                                '4. Progress Section (Text: "You completed X habits today")\n' +
                                '5. Delete Habit'
                            )
                        )
                        .setButtonAccessory((button) =>
                            button
                                .setCustomId('theme_3')
                                .setLabel('Select Theme 3')
                                .setStyle(ButtonStyle.Danger)
                                .setEmoji({ name: '📊' })
                        )
                )
                .addSeparatorComponents((separator) => separator)
                .addTextDisplayComponents((textDisplay) =>
                    textDisplay.setContent(
                        '**� Rules & Notes**\n' +
                        '• Each team chooses **ONE theme only**\n' +
                        '• All required features must be implemented\n' +
                        '• Clean UI and working logic are more important than complexity\n' +
                        '• All participants will receive a **Certificate of Participation**\n' +
                        '• Each team will present their app and explain their code on the presentation day\n\n' +
                        '**Presentation Date: 12 February**'
                    )
                );

            if (targetUser) {
                // Send to user's DM
                await targetUser.send({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2,
                });

                await interaction.reply({
                    content: `✅ Successfully sent the challenge embed to ${targetUser.tag}`,
                    ephemeral: true,
                });

                console.log(`${interaction.user.username} sent challenge embed to ${targetUser.username}`);
            } else {
                // Send in the channel
                await interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2,
                });

                console.log(`${interaction.user.username} sent challenge embed in channel`);
            }
        } catch (error: any) {
            logError("Send challenge embed", error);
            await interaction.reply({
                content: `❌ Failed to send the challenge embed. ${targetUser ? "The user might have DMs disabled." : ""}`,
                ephemeral: true,
            });
        }
    },
};
