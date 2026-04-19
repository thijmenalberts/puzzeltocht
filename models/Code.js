import base from "./airtable.js"; 

export async function checkCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (code === "ADMIN-1234") return { valid: true, admin: true };

  try {
    // Zoek in tabel 'Codes', kolom 'Toegangscode'
    const records = await base("Codes").select({
      filterByFormula: `{Toegangscode} = '${code}'`,
      maxRecords: 1
    }).firstPage();

    if (records.length === 0) return { valid: false, error: "Code niet gevonden in Airtable." };

    const record = records[0];
    const status = record.fields["Status"]; 
    const puzzleName = record.fields["Puzzeltocht"]; 

    if (status === "Gebruikt") return { valid: false, error: "Deze code is al verbruikt." };

    return { 
      valid: true, 
      recordId: record.id, 
      airtablePuzzleName: puzzleName 
    };
  } catch (error) {
    console.error("Airtable API Error:", error);
    return { valid: false, error: "Systeemfout: Geen verbinding met Airtable." };
  }
}
