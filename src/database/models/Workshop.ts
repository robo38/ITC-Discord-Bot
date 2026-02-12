import { mongoose } from "../connection";

const { Schema, model } = mongoose;

export interface IWorkshop {
    workshopId: string;
    teamName: string;
    leaderID: string;
    voiceChannelID: string;
    type: "workshop" | "formation" | "other";
    startTime: Date;
    averageDuration: number; // in minutes
    status: "scheduled" | "active" | "completed";
    stoppedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const workshopSchema = new Schema<IWorkshop>(
    {
        workshopId: { type: String, required: true, unique: true },
        teamName: { type: String, required: true },
        leaderID: { type: String, required: true },
        voiceChannelID: { type: String, required: true },
        type: {
            type: String,
            enum: ["workshop", "formation", "other"],
            required: true,
        },
        startTime: { type: Date, required: true },
        averageDuration: { type: Number, required: true },
        status: {
            type: String,
            enum: ["scheduled", "active", "completed"],
            default: "scheduled",
        },
        stoppedAt: { type: Date },
    },
    { timestamps: true }
);

// One active workshop per leader
workshopSchema.index({ leaderID: 1, status: 1 });

export const Workshop = model<IWorkshop>("Workshop", workshopSchema);
