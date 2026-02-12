import {
    ChatInputCommandInteraction,
    Client,
    Collection,
    StringSelectMenuInteraction,
} from "discord.js";

export interface CommandType {
    data: any;
    run: (interaction: ChatInputCommandInteraction, client: Client) => Promise<any>;
    access?: boolean;
    folder?: string; // Track which folder the command is from (admin, dev, general, leader)
}

declare module "discord.js" {
    export interface Client {
        commands: Collection<string, CommandType>;
        inviteCache: Map<string, Map<string, { uses: number }>>;
    }
}