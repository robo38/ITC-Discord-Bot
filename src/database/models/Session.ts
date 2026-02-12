import { mongoose } from "../connection";

const { Schema, model } = mongoose;

export interface ISession {
    workshopId: string;
    teamName: string;
    leaderID: string;
    type: string;
    startTime: Date;
    endTime?: Date;
    totalDuration: number; // ms
    totalParticipants: number;
    averageAttendanceTime: number; // ms
    exportedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
    {
        workshopId: { type: String, required: true, unique: true },
        teamName: { type: String, required: true },
        leaderID: { type: String, required: true },
        type: { type: String, required: true },
        startTime: { type: Date, required: true },
        endTime: { type: Date },
        totalDuration: { type: Number, default: 0 },
        totalParticipants: { type: Number, default: 0 },
        averageAttendanceTime: { type: Number, default: 0 },
        exportedAt: { type: Date },
    },
    { timestamps: true }
);

export const Session = model<ISession>("Session", sessionSchema);
