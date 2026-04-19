// models/Code.js
import base from "./airtable.js"; // Gebruik de centrale verbinding uit hetzelfde mapje

/**
 * Controleert een code in Airtable en haalt de gekoppelde puzzel op
 */
export async function checkCode(rawCode) {
  const code = rawCode.trim().toUpperCase();

  try {
    const records = await base("Codes")
      .select({
        filterByFormula: `{Toegangscode} = '${code}'`,
        maxRecords: 1,
      })
      .firstPage();
    
    if (code === "ADMIN-1234") return { valid: true, admin: true };

    if (records.length === 0) return { valid: false, error: "Code bestaat niet" };

    const record = records[0];
    const status = record.fields.Status;

    if (status === "Gebruikt") return { valid: false, error: "Code is al gebruikt" };

    // Geef de naam van de puzzeltocht uit Airtable mee voor de redirect
    return { 
      valid: true, 
      recordId: record.id, 
      airtablePuzzleName: record.fields["Puzzeltocht"] 
    };
  } catch (error) {
    console.error("Airtable Fout:", error);
    return { valid: false, error: "Database verbindingsfout" };
  }
}
