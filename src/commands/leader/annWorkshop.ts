import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    Client,
} from "discord.js";
import { createWorkshop, findTeamForLeader } from "../../workshop";
import { getTeamConfigByLeaderRole } from "../../database";

export default {
    data: new SlashCommandBuilder()
        .setName("ann-workshop")
        .setDescription("Announce and schedule a workshop for your team")
        .addStringOption((option) =>
            option
                .setName("type")
                .setDescription("The type of workshop")
                .setRequired(true)
                .addChoices(
                    { name: "Workshop", value: "workshop" },
                    { name: "Formation", value: "formation" },
                    { name: "Other", value: "other" }
                )
        )
        .addStringOption((option) =>
            option
                .setName("start-time")
                .setDescription("Start time (format: YYYY-MM-DD HH:MM or 'now' for immediate)")
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName("duration")
                .setDescription("Average duration of the workshop")
                .setRequired(true)
                .addChoices(
                    { name: "1 hour 30 minutes", value: "1h30" },
                    { name: "2 hours", value: "2h" },
                    { name: "Custom (type in minutes, e.g. 45m or 1h15m)", value: "custom" }
                )
        )
        .addStringOption((option) =>
            option
                .setName("custom-duration")
                .setDescription("Custom duration (e.g. 45m, 1h, 1h30m). Only if duration = Custom")
                .setRequired(false)
        )
        .addStringOption((option) =>
            option
                .setName("topic")
                .setDescription("Topic name (required when type is Other)")
                .setRequired(false)
        )
        .addStringOption((option) =>
            option
                .setName("dm")
                .setDescription("DM notification to team members (default: send)")
                .setRequired(false)
                .addChoices(
                    { name: "Send default message", value: "send" },
                    { name: "Custom message", value: "custom" },
                    { name: "Don't send", value: "none" }
                )
        )
        .addStringOption((option) =>
            option
                .setName("dm-message")
                .setDescription("Custom DM message (only if dm = Custom message)")
                .setRequired(false)
        ),

    async run(interaction: ChatInputCommandInteraction, client: Client) {
        await interaction.deferReply({ ephemeral: true });

        const leaderID = interaction.user.id;
        const member = interaction.guild?.members.cache.get(leaderID);

        if (!member) {
            return interaction.editReply("❌ Could not fetch your member data.");
        }

        // Find which team this leader belongs to by checking leader role
        const memberRoles = member.roles.cache.map((r) => r.id);
        const teamConfig = await getTeamConfigByLeaderRole(memberRoles);

        if (!teamConfig) {
            return interaction.editReply(
                "❌ Could not identify your team. Make sure you have the correct team role."
            );
        }

        if (!teamConfig.voiceChannelID) {
            return interaction.editReply(
                "❌ Your team does not have a voice channel configured."
            );
        }

        // Parse options
        const type = interaction.options.getString("type", true) as "workshop" | "formation" | "other";
        const startTimeStr = interaction.options.getString("start-time", true);
        const durationChoice = interaction.options.getString("duration", true);
        const customDuration = interaction.options.getString("custom-duration");
        const topicName = interaction.options.getString("topic");
        const dmMode = (interaction.options.getString("dm") || "send") as "send" | "custom" | "none";
        const dmMessage = interaction.options.getString("dm-message");

        // Validate: "other" type requires a topic name
        if (type === "other" && !topicName) {
            return interaction.editReply(
                "❌ You must provide a **topic** name when the type is **Other**."
            );
        }

        // Validate: custom DM mode requires a message
        if (dmMode === "custom" && !dmMessage) {
            return interaction.editReply(
                "❌ You chose **Custom message** for DM but didn't provide a message. Use the `dm-message` option."
            );
        }

        // Parse start time
        let startTime: Date;
        if (startTimeStr.toLowerCase() === "now") {
            startTime = new Date();
        } else {
            startTime = new Date(startTimeStr);
            if (isNaN(startTime.getTime())) {
                return interaction.editReply(
                    "❌ Invalid start time format. Use `YYYY-MM-DD HH:MM` or `now`."
                );
            }
        }

        // Parse duration
        let durationStr: string;
        if (durationChoice === "custom") {
            if (!customDuration) {
                return interaction.editReply(
                    "❌ You chose custom duration but didn't provide a value. Use the `custom-duration` option."
                );
            }
            durationStr = customDuration;
        } else {
            durationStr = durationChoice;
        }

        // Create workshop
        const result = await createWorkshop(
            leaderID,
            teamConfig,
            type,
            startTime,
            durationStr,
            client,
            {
                topicName: topicName || undefined,
                dmMode,
                dmMessage: dmMessage || undefined,
            }
        );

        if (!result.success) {
            return interaction.editReply(`❌ ${result.message}`);
        }

        await interaction.editReply(`✅ ${result.message}`);
    },
};
