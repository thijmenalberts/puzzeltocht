import Airtable from "airtable";

// Airtable setup
const base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY,
}).base(process.env.AIRTABLE_BASE_ID);

/**
 * Controleert een code in Airtable
 * @param {string} rawCode
 * @returns {Object} { valid: boolean, error?: string }
 */
export async function checkCode(rawCode) {
  const code = rawCode.trim().toUpperCase();

  // Code opzoeken in Airtable
  const records = await base("Codes")
    .select({
      filterByFormula: `{Code} = '${code}'`,
      maxRecords: 1,
    })
    .firstPage();

  // ❌ Code bestaat niet
  if (records.length === 0) {
    return {
      valid: false,
      error: "Code bestaat niet",
    };
  }

  const record = records[0];
  const status = record.fields.Status;

  // ❌ Code al gebruikt
  if (status === "Gebruikt") {
    return {
      valid: false,
      error: "Code is al gebruikt",
    };
  }

  // ✅ Code is geldig → purchase date zetten
  await base("Codes").update(record.id, {
    "Purchase date": new Date().toISOString(),
  });

  return {
    valid: true,
  };
}
