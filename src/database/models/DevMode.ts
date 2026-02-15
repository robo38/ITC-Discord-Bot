import { mongoose } from "../connection";

const { Schema, model } = mongoose;

export interface IDevMode {
    discordId: string;
    addedBy: string; // the real owner's discordId who granted dev mode
    addedAt: Date;
}

const devModeSchema = new Schema<IDevMode>(
    {
        discordId: { type: String, required: true, unique: true },
        addedBy: { type: String, required: true },
        addedAt: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

export const DevMode = model<IDevMode>("DevMode", devModeSchema);
