import cron from "node-cron";
import Airtable from "airtable";

// Airtable setup (zelfde als Code.js)
const base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY,
}).base(process.env.AIRTABLE_BASE_ID);

/**
 * Elke uur:
 * - zoek ongebruikte codes
 * - waarvan purchase date >= 24 uur geleden
 * - zet status op "Gebruikt"
 */
cron.schedule("0 * * * *", async () => {
  try {
    const records = await base("Codes").select({
      filterByFormula: `
        AND(
          Status = 'Ongebruikt',
          {Purchase date} != '',
          DATETIME_DIFF(NOW(), {Purchase date}, 'hours') >= 24
        )
      `
    }).all();

    for (const record of records) {
      await base("Codes").update(record.id, {
        Status: "Gebruikt",
      });
    }

    if (records.length > 0) {
      console.log(`✅ ${records.length} code(s) automatisch op Gebruikt gezet`);
    }
  } catch (error) {
    console.error("❌ Cron job fout:", error.message);
  }
});
