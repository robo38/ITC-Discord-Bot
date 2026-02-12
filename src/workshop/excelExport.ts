import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";
import { IWorkshop } from "../database/models/Workshop";
import { IParticipant } from "../database/models/Participant";

const EXPORTS_DIR = path.join(process.cwd(), "exports");

/**
 * Format milliseconds to human-readable "Xh Ym Zs"
 */
function formatDuration(ms: number): string {
    if (ms <= 0) return "0s";
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    const s = seconds % 60;
    const m = minutes % 60;

    if (hours > 0) return `${hours}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

/**
 * Export workshop data to an Excel file.
 * Returns the file path.
 */
export async function exportWorkshopToExcel(
    workshopId: string,
    workshop: IWorkshop,
    participants: IParticipant[]
): Promise<string> {
    // Ensure exports directory exists
    if (!fs.existsSync(EXPORTS_DIR)) {
        fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    }

    const workbook = XLSX.utils.book_new();

    // ─── Sheet 1: Workshop Summary ───────────────────────────────────
    const summaryData = [
        ["Workshop Report"],
        [],
        ["Team", workshop.teamName],
        ["Type", workshop.type],
        ["Start Time", workshop.startTime.toLocaleString()],
        ["End Time", workshop.stoppedAt ? workshop.stoppedAt.toLocaleString() : "N/A"],
        [
            "Total Duration",
            workshop.stoppedAt
                ? formatDuration(workshop.stoppedAt.getTime() - workshop.startTime.getTime())
                : "N/A",
        ],
        ["Average Duration (planned)", `${workshop.averageDuration} minutes`],
        ["Total Participants", participants.length],
        [],
    ];

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    summarySheet["!cols"] = [{ wch: 25 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

    // ─── Sheet 2: Participant Details ────────────────────────────────
    const headers = [
        "Username",
        "Discord ID",
        "Team",
        "Total Voice Time",
        "Join Count",
        "Leave Count",
        "Avg Connected Time",
        "Voice Chat Messages",
        "Member Chat Messages",
        "Mic Open Time",
        "Mic Closed Time",
        "Deafened Time",
        "Undeafened Time",
        "Stayed Until End",
    ];

    const rows: any[][] = [headers];

    for (const p of participants) {
        // Voice time
        const totalVoiceMs = p.voiceSessions.reduce((sum, s) => sum + s.duration, 0);
        const joinCount = p.voiceSessions.length;
        const leaveCount = p.voiceSessions.filter((s) => s.leaveTime).length;
        const avgConnected = joinCount > 0 ? totalVoiceMs / joinCount : 0;

        // Mic time
        const totalMicOpenMs = p.micActivity.reduce((sum, m) => sum + m.duration, 0);
        const totalMicClosedMs = Math.max(0, totalVoiceMs - totalMicOpenMs);

        // Deafen time
        const totalDeafenedMs = p.deafenActivity.reduce((sum, d) => sum + d.duration, 0);
        const totalUndeafenedMs = Math.max(0, totalVoiceMs - totalDeafenedMs);

        rows.push([
            p.username,
            p.discordId,
            p.teamLabel,
            formatDuration(totalVoiceMs),
            joinCount,
            leaveCount,
            formatDuration(avgConnected),
            p.voiceChatMessages,
            p.memberChatMessages,
            formatDuration(totalMicOpenMs),
            formatDuration(totalMicClosedMs),
            formatDuration(totalDeafenedMs),
            formatDuration(totalUndeafenedMs),
            p.stayedUntilEnd ? "Yes" : "No",
        ]);
    }

    const detailSheet = XLSX.utils.aoa_to_sheet(rows);
    detailSheet["!cols"] = headers.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(workbook, detailSheet, "Participants");

    // ─── Sheet 3: Detailed Voice Sessions ────────────────────────────
    const sessionHeaders = [
        "Username",
        "Session #",
        "Join Time",
        "Leave Time",
        "Duration",
    ];
    const sessionRows: any[][] = [sessionHeaders];

    for (const p of participants) {
        p.voiceSessions.forEach((s, i) => {
            sessionRows.push([
                p.username,
                i + 1,
                s.joinTime.toLocaleString(),
                s.leaveTime ? s.leaveTime.toLocaleString() : "Still connected",
                formatDuration(s.duration),
            ]);
        });
    }

    const sessionSheet = XLSX.utils.aoa_to_sheet(sessionRows);
    sessionSheet["!cols"] = sessionHeaders.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(workbook, sessionSheet, "Voice Sessions");

    // ─── Write File ──────────────────────────────────────────────────
    const safeName = workshop.teamName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `workshop_${safeName}_${timestamp}.xlsx`;
    const filePath = path.join(EXPORTS_DIR, fileName);

    XLSX.writeFile(workbook, filePath);
    console.log(`[Excel] Report exported to: ${filePath}`);

    return filePath;
}
