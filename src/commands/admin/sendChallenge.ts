import { ChatInputCommandInteraction, SlashCommandBuilder, ButtonStyle, ContainerBuilder, MessageFlags } from "discord.js";

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
                        '**🏆 Bootcamp Kickoff Challenge 🏆**\n\n' +
                        'Alright teams 👀🔥\nwe\'re launching our **Mini Challenge**!\n\n' +
                        'Each team must choose **ONE theme only** and build a simple functional mobile app based on it.'
                    )
                )
                .addSeparatorComponents((separator) => separator)
                .addSectionComponents((section) =>
                    section
                        .addTextDisplayComponents((textDisplay) =>
                            textDisplay.setContent(
                                '**📱 THEME 1: Smart To-Do / Task Manager**\n\n' +
                                '**💡 Idea**\n' +
                                'A simple app to help users organize their daily tasks.\n\n' +
                                '**🔧 Required Functions**\n' +
                                '• User registration & login\n' +
                                '• Create a task (title + description)\n' +
                                '• Mark task as done / not done\n' +
                                '• Edit or delete a task\n' +
                                '• Display task list from Firestore'
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
                                '**🌐 THEME 2: Mini Social Wall (Anonymous Confessions / Posts)**\n\n' +
                                '**💡 Idea**\n' +
                                'A simple anonymous wall where students share thoughts, advice, or messages.\n\n' +
                                '**🔧 Required Functions**\n' +
                                '• Authentication\n' +
                                '• Create a post (text)\n' +
                                '• Display posts feed (Firestore)\n' +
                                '• Like a post\n' +
                                '• Delete own post'
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
                                '**📊 THEME 3: Daily Habit Tracker**\n\n' +
                                '**💡 Story**\n' +
                                'Help users build good habits (study, gym, reading, water…).\n\n' +
                                '**🔧 Required Functions**\n' +
                                '• Authentication\n' +
                                '• Create a habit (name)\n' +
                                '• Mark habit as done for today\n' +
                                '• View habits list\n' +
                                '• Track how many days completed'
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
                        '**📌 Rules & Notes**\n' +
                        '• Each team chooses **ONE theme only**\n' +
                        '• All required functions must be implemented\n' +
                        '• Clean UI and working logic are more important than complexity\n' +
                        '• 🏅 All participants who take part in the challenge will receive a **Certificate of Participation**\n\n' +
                        '**📅 Presentation Date: 12 February**'
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
        } catch (error) {
            console.error("Error sending challenge embed:", error);
            await interaction.reply({
                content: `❌ Failed to send the challenge embed. ${targetUser ? "The user might have DMs disabled." : ""}`,
                ephemeral: true,
            });
        }
    },
};
