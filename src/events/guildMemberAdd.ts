import { Client, Events, GuildMember, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { addParticipant } from "../utils/participantManager";

const BOOTCAMP_GUILD_ID = process.env.BOOTCAMP_GUILD_ID!;
const BOOTCAMP_INVITE_CODE = process.env.BOOTCAMP_INVITE_CODE!;
const BOOTCAMP_ROLE = process.env.BOOTCAMP_ROLE!;

export default {
    name: Events.GuildMemberAdd,
    async execute(member: GuildMember, client: Client) {
        // Only process for the bootcamp guild
        if (member.guild.id !== BOOTCAMP_GUILD_ID) return;

        try {
            // Fetch recent invites to check which one was used
            const invites = await member.guild.invites.fetch();
            const cachedInvites = client.inviteCache?.get(member.guild.id) || new Map();

            let usedInvite = null;

            for (const [code, invite] of invites) {
                const cached = cachedInvites.get(code);
                if (cached && invite.uses && invite.uses > cached.uses) {
                    usedInvite = invite;
                    break;
                }
            }

            // Update cache
            if (!client.inviteCache) {
                client.inviteCache = new Map();
            }
            const newCache = new Map();
            invites.forEach((invite) => {
                newCache.set(invite.code, { uses: invite.uses || 0 });
            });
            client.inviteCache.set(member.guild.id, newCache);

            // Check if the used invite matches our configured invite
            if (usedInvite && usedInvite.code === BOOTCAMP_INVITE_CODE) {
                // Give the bootcamp role
                await member.roles.add(BOOTCAMP_ROLE);
                console.log(`Gave bootcamp role to ${member.user.username}`);

                // Add to CSV with null theme
                await addParticipant(member.id);

                // Send the challenge embed with theme buttons
                await sendChallengeEmbed(member);
            }
        } catch (error) {
            console.error("Error handling member join:", error);
        }
    },
};

async function sendChallengeEmbed(member: GuildMember) {
    try {
        const embed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setTitle("🏆 Bootcamp Kickoff Challenge 🏆")
            .setDescription(
                "Alright teams 👀🔥\nwe're launching our **Mini Challenge**!\n\n" +
                "Each team must choose **ONE theme only** and build a simple functional mobile app based on it."
            )
            .addFields(
                {
                    name: "📱 THEME 1: Smart To-Do / Task Manager",
                    value: "**💡 Idea**\nA simple app to help users organize their daily tasks.\n\n" +
                        "**🔧 Required Functions**\n" +
                        "• User registration & login\n" +
                        "• Create a task (title + description)\n" +
                        "• Mark task as done / not done\n" +
                        "• Edit or delete a task\n" +
                        "• Display task list from Firestore",
                    inline: false
                },
                {
                    name: "🌐 THEME 2: Mini Social Wall (Anonymous Confessions / Posts)",
                    value: "**💡 Idea**\nA simple anonymous wall where students share thoughts, advice, or messages.\n\n" +
                        "**🔧 Required Functions**\n" +
                        "• Authentication\n" +
                        "• Create a post (text)\n" +
                        "• Display posts feed (Firestore)\n" +
                        "• Like a post\n" +
                        "• Delete own post",
                    inline: false
                },
                {
                    name: "📊 THEME 3: Daily Habit Tracker",
                    value: "**💡 Story**\nHelp users build good habits (study, gym, reading, water…).\n\n" +
                        "**🔧 Required Functions**\n" +
                        "• Authentication\n" +
                        "• Create a habit (name)\n" +
                        "• Mark habit as done for today\n" +
                        "• View habits list\n" +
                        "• Track how many days completed",
                    inline: false
                },
                {
                    name: "📌 Rules & Notes",
                    value: "• Each team chooses **ONE theme only**\n" +
                        "• All required functions must be implemented\n" +
                        "• Clean UI and working logic are more important than complexity\n" +
                        "• 🏅 All participants who take part in the challenge will receive a **Certificate of Participation**",
                    inline: false
                },
                {
                    name: "📅 Presentation Date",
                    value: "**12 February**",
                    inline: false
                }
            )
            .setFooter({ text: "Select your theme below ⬇️" })
            .setTimestamp();

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId("theme_1")
                    .setLabel("Theme 1: To-Do Manager")
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji("📱"),
                new ButtonBuilder()
                    .setCustomId("theme_2")
                    .setLabel("Theme 2: Social Wall")
                    .setStyle(ButtonStyle.Success)
                    .setEmoji("🌐"),
                new ButtonBuilder()
                    .setCustomId("theme_3")
                    .setLabel("Theme 3: Habit Tracker")
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji("📊")
            );

        // await member.send({
        //     embeds: [embed],
        //     components: [row]
        // });

        console.log(`Sent challenge embed to ${member.user.username}`);
    } catch (error) {
        console.error("Error sending challenge embed:", error);
    }
}
