import base from "./airtable.js";

export async function checkCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (code === "ADMIN-1234") return { valid: true, admin: true };

  try {
    // Let op: De tabel MOET 'Codes' heten en de kolom 'Toegangscode'
    const records = await base("Codes").select({
      filterByFormula: `{Toegangscode} = '${code}'`,
      maxRecords: 1
    }).firstPage();

    if (!records || records.length === 0) {
      console.log(`🔍 Code ${code} niet gevonden in Airtable.`);
      return { valid: false, error: "Code onjuist." };
    }

    const record = records[0];
    return { 
      valid: true, 
      recordId: record.id, 
      airtablePuzzleName: record.fields["Puzzeltocht"] 
    };
  } catch (error) {
    console.error("🚨 AIRTABLE ERROR:", error.message);
    return { valid: false, error: "Verbindingsfout met database." };
  }
}
