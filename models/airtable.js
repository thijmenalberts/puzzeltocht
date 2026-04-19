import Airtable from "airtable";
import dotenv from "dotenv";

// 1. Forceer het laden van variabelen (Cruciaal voor Railway!)
dotenv.config();

// 2. Veiligheidscheck om crashes te loggen in plaats van de server te slopen
if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
  console.error("🚨 CRITICAL ERROR: Airtable API Keys ontbreken in Railway Variables!");
}

// 3. Bouw de verbinding
const base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY,
}).base(process.env.AIRTABLE_BASE_ID);

export default base;
