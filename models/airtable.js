import Airtable from "airtable";
import dotenv from "dotenv";
dotenv.config(); // Cruciaal: laad variabelen VOORDAT de base wordt geïnitialiseerd

if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
  console.warn("⚠️ Airtable omgevingsvariabelen ontbreken!");
}

const base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY,
}).base(process.env.AIRTABLE_BASE_ID);

export default base;
