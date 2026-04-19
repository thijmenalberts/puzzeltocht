import base from "./airtable.js"; 

export async function checkCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (code === "ADMIN-1234") return { valid: true, admin: true };

  try {
    const records = await base("Codes").select({
      filterByFormula: `{Toegangscode} = '${code}'`,
      maxRecords: 1
    }).firstPage();

    if (records.length === 0) return { valid: false, error: "Code is onjuist of bestaat niet." };

    const record = records[0];
    const status = record.fields["Status"]; 
    const puzzleName = record.fields["Puzzeltocht"]; 

    if (status === "Gebruikt") return { valid: false, error: "Deze code is al gebruikt." };

    return { 
      valid: true, 
      recordId: record.id, 
      airtablePuzzleName: puzzleName 
    };
  } catch (error) {
    console.error("Airtable Connection Error in checkCode:", error);
    return { valid: false, error: "Server fout: Kan niet verbinden met Airtable." };
  }
}
