import { sheets } from "../lib/googleSheets";

const SHEET_ID = process.env.SHEET_ID!;

export async function updateSheet(rows: string[][]) {
    await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: "teams_output!A:D",
    });

    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "teams_output!A:D",
        valueInputOption: "RAW",
        requestBody: {
            values: [["Discord user", "Team 1", "Team 2", "Department"], ...rows],
        },
    });

    console.log(`Sheet updated with ${rows.length} members`);
}
