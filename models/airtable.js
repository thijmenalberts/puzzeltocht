import Airtable from "airtable";

// We gebruiken direct process.env zonder poespas
const base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY
}).base(process.env.AIRTABLE_BASE_ID);

export default base;
