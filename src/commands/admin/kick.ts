import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    Client,
    PermissionFlagsBits,
    AttachmentBuilder,
    EmbedBuilder,
    RESTJSONErrorCodes,
} from "discord.js";
import { logError, logSuccess } from "../../utils/logger";

const CONCURRENCY = 5;

/** Strips quotes/whitespace and a leading "@" from a raw CSV cell. */
function normalizeEntry(raw: string): string {
    return raw.trim().replace(/^"|"$/g, "").trim().replace(/^@/, "");
}

function extractUserIdFromMentionOrId(cleaned: string): string | null {
    const mentionMatch = cleaned.match(/^<@!?(\d{15,20})>$/);
    if (mentionMatch) return mentionMatch[1];
    if (/^\d{15,20}$/.test(cleaned)) return cleaned;
    return null;
}

/** Parses a CSV looking for a "discord_user" column; falls back to the first column if no header matches. */
function parseCsv(text: string): string[] {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) return [];

    const header = lines[0]
        .split(",")
        .map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
    const headerIndex = header.indexOf("discord_user");

    const columnIndex = headerIndex === -1 ? 0 : headerIndex;
    const dataLines = headerIndex === -1 ? lines : lines.slice(1);

    return dataLines
        .map((line) => line.split(",")[columnIndex])
        .filter((v): v is string => Boolean(v));
}

async function processInBatches<T>(
    items: T[],
    concurrency: number,
    handler: (item: T) => Promise<void>
): Promise<void> {
    let index = 0;
    async function worker() {
        while (index < items.length) {
            const current = items[index++];
            await handler(current);
        }
    }
    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, worker)
    );
}

export default {
    data: new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Bulk kick users listed in a CSV file (column: discord_user)")
        .addAttachmentOption((option) =>
            option
                .setName("file")
                .setDescription("CSV file with a discord_user column (Discord username per row)")
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName("reason")
                .setDescription("Reason for kicking these users")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    async run(interaction: ChatInputCommandInteraction, _client: Client) {
        if (!interaction.inGuild() || !interaction.guild) {
            return interaction.reply({
                content: "❌ This command can only be used in a server.",
                ephemeral: true,
            });
        }

        const botMember = interaction.guild.members.me;
        if (!botMember?.permissions.has(PermissionFlagsBits.KickMembers)) {
            return interaction.reply({
                content: "❌ I don't have permission to kick members in this server.",
                ephemeral: true,
            });
        }

        const file = interaction.options.getAttachment("file", true);
        const reason = interaction.options.getString("reason", true);

        if (!file.name?.toLowerCase().endsWith(".csv")) {
            return interaction.reply({
                content: "❌ Please attach a `.csv` file.",
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        let text: string;
        try {
            const res = await fetch(file.url);
            text = await res.text();
        } catch (error: any) {
            logError("Bulk kick - fetch CSV", error);
            return interaction.editReply("❌ Could not download the attached CSV file.");
        }

        const entries = Array.from(
            new Set(parseCsv(text).map(normalizeEntry).filter((v) => v.length > 0))
        );

        if (entries.length === 0) {
            return interaction.editReply(
                "❌ No entries found. Make sure the CSV has a `discord_user` column containing usernames."
            );
        }

        // Fetch the full member list once so usernames can be resolved locally.
        let members;
        try {
            members = await interaction.guild.members.fetch();
        } catch (error: any) {
            logError("Bulk kick - fetch members", error);
            return interaction.editReply("❌ Could not fetch the server's member list.");
        }

        const byUsername = new Map<string, string>(); // lowercase username -> member id
        members.forEach((m) => byUsername.set(m.user.username.toLowerCase(), m.id));

        const kicked: string[] = [];
        const notFound: string[] = [];
        const otherFailed: { id: string; error: string }[] = [];

        await processInBatches(entries, CONCURRENCY, async (entry) => {
            const id = extractUserIdFromMentionOrId(entry) ?? byUsername.get(entry.toLowerCase());

            if (!id) {
                notFound.push(entry);
                return;
            }
            if (id === interaction.user.id) {
                otherFailed.push({ id: entry, error: "Cannot kick yourself" });
                return;
            }
            try {
                await interaction.guild!.members.kick(id, reason);
                kicked.push(entry);
            } catch (error: any) {
                if (error?.code === RESTJSONErrorCodes.UnknownMember) {
                    notFound.push(entry);
                } else {
                    otherFailed.push({ id: entry, error: error?.message || "Unknown error" });
                }
            }
        });

        logSuccess(
            "Bulk Kick",
            `${interaction.user.tag} kicked ${kicked.length}/${entries.length} user(s). ` +
                `Not found: ${notFound.length}, other failures: ${otherFailed.length}. Reason: ${reason}`
        );

        const formatList = (ids: string[], limit = 25) => {
            const shown = ids.slice(0, limit).join("\n");
            const rest = ids.length - limit;
            return rest > 0 ? `${shown}\n…and ${rest} more` : shown;
        };

        const embed = new EmbedBuilder()
            .setTitle("Bulk Kick Results")
            .setColor(otherFailed.length > 0 ? 0xff9500 : notFound.length > 0 ? 0xffcc00 : 0x34c759)
            .setDescription(`Reason: ${reason}`)
            .addFields(
                { name: "✅ Kicked", value: `${kicked.length} / ${entries.length}`, inline: true },
                { name: "❓ Not Found", value: `${notFound.length}`, inline: true },
                { name: "⚠️ Failed", value: `${otherFailed.length}`, inline: true }
            )
            .setTimestamp();

        if (notFound.length > 0) {
            embed.addFields({
                name: "Users not found in this server",
                value: formatList(notFound),
            });
        }

        if (otherFailed.length > 0) {
            embed.addFields({
                name: "Other failures",
                value: formatList(otherFailed.map((f) => `${f.id}: ${f.error}`)),
            });
        }

        const files: AttachmentBuilder[] = [];
        if (notFound.length > 25) {
            files.push(
                new AttachmentBuilder(Buffer.from(notFound.join("\n"), "utf-8"), {
                    name: "not-found.txt",
                })
            );
        }
        if (otherFailed.length > 25) {
            files.push(
                new AttachmentBuilder(
                    Buffer.from(otherFailed.map((f) => `${f.id}: ${f.error}`).join("\n"), "utf-8"),
                    { name: "kick-failures.txt" }
                )
            );
        }

        return interaction.editReply({ embeds: [embed], files });
    },
};
