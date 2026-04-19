import base from "./airtable.js"; // We gebruiken nu de veilige, centrale connectie!

export async function checkCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (code === "ADMIN-1234") return { valid: true, admin: true };

  try {
    const records = await base("Codes").select({
      filterByFormula: `{Toegangscode} = '${code}'`,
      maxRecords: 1
    }).firstPage();

    if (records.length === 0) return { valid: false, error: "Code bestaat niet." };

    const record = records[0];
    const status = record.fields["Status"]; 
    const puzzleName = record.fields["Puzzeltocht"]; 

    if (status === "Gebruikt") return { valid: false, error: "Deze code is al verbruikt." };

    // Code is geldig! We geven de naam mee voor de redirect-logica
    return { 
      valid: true, 
      recordId: record.id, 
      airtablePuzzleName: puzzleName 
    };
  } catch (error) {
    console.error("Airtable API Error:", error);
    return { valid: false, error: "Systeemfout: Kan niet verbinden met de database." };
  }
}
