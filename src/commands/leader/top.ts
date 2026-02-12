import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    Client,
    EmbedBuilder,
} from "discord.js";
import { Workshop, Participant } from "../../database";

export default {
    data: new SlashCommandBuilder()
        .setName("top")
        .setDescription("View top teams by workshop/formation count")
        .addStringOption((option) =>
            option
                .setName("period")
                .setDescription("Time period to filter by")
                .setRequired(true)
                .addChoices(
                    { name: "This Week", value: "week" },
                    { name: "This Month", value: "month" }
                )
        ),

    async run(interaction: ChatInputCommandInteraction, _client: Client) {
        await interaction.deferReply({ ephemeral: false });

        const period = interaction.options.getString("period", true);

        // Calculate date range
        const now = new Date();
        let startDate: Date;

        if (period === "week") {
            // Start of current week (Monday)
            const day = now.getDay();
            const diff = day === 0 ? 6 : day - 1; // Monday = 0
            startDate = new Date(now);
            startDate.setDate(now.getDate() - diff);
            startDate.setHours(0, 0, 0, 0);
        } else {
            // Start of current month
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        // Fetch all completed/active workshops in the period
        const workshops = await Workshop.find({
            startTime: { $gte: startDate },
            status: { $in: ["active", "completed"] },
        });

        if (workshops.length === 0) {
            return interaction.editReply(
                `📊 No workshops found for **this ${period}**.`
            );
        }

        // Group by team
        const teamStats: Map<
            string,
            { count: number; workshopIds: string[] }
        > = new Map();

        for (const w of workshops) {
            const existing = teamStats.get(w.teamName) || {
                count: 0,
                workshopIds: [],
            };
            existing.count++;
            existing.workshopIds.push(w.workshopId);
            teamStats.set(w.teamName, existing);
        }

        // Fetch participant counts per workshop for average calc
        const allWorkshopIds = workshops.map((w) => w.workshopId);
        const participants = await Participant.find({
            workshopId: { $in: allWorkshopIds },
        });

        // Map workshopId → participant count
        const participantCounts: Map<string, number> = new Map();
        for (const p of participants) {
            participantCounts.set(
                p.workshopId,
                (participantCounts.get(p.workshopId) || 0) + 1
            );
        }

        // Build team ranking with average members per workshop
        const rankings: {
            teamName: string;
            workshopCount: number;
            avgMembers: number;
        }[] = [];

        for (const [teamName, stats] of teamStats) {
            let totalMembers = 0;
            for (const wId of stats.workshopIds) {
                totalMembers += participantCounts.get(wId) || 0;
            }
            const avgMembers =
                stats.count > 0
                    ? Math.round(totalMembers / stats.count)
                    : 0;

            rankings.push({
                teamName,
                workshopCount: stats.count,
                avgMembers,
            });
        }

        // Sort by workshop count descending
        rankings.sort((a, b) => b.workshopCount - a.workshopCount);

        const periodLabel = period === "week" ? "This Week" : "This Month";
        const medals = ["🥇", "🥈", "🥉"];

        const embed = new EmbedBuilder()
            .setTitle(`📊 Top Teams — ${periodLabel}`)
            .setColor(0xffd700)
            .setDescription(
                `Rankings from <t:${Math.floor(startDate.getTime() / 1000)}:D> to now`
            )
            .setTimestamp();

        for (let i = 0; i < rankings.length; i++) {
            const r = rankings[i];
            const rank = i < 3 ? medals[i] : `**#${i + 1}**`;

            embed.addFields({
                name: `${rank} ${r.teamName}`,
                value:
                    `Workshops: **${r.workshopCount}**\n` +
                    `Avg members per workshop: **${r.avgMembers}**`,
                inline: true,
            });
        }

        embed.setFooter({
            text: `Total: ${workshops.length} workshops across ${teamStats.size} teams`,
        });

        await interaction.editReply({ embeds: [embed] });
    },
};
