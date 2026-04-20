import mongoose from "mongoose";

// 1. Blauwdruk voor een Module (Titel, Vraag, Foto, etc.)
const moduleSchema = new mongoose.Schema({
  type: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} }
});

// 2. Blauwdruk voor een Pagina
const pageSchema = new mongoose.Schema({
  title: { type: mongoose.Schema.Types.Mixed, default: {} },
  showNext: { type: Boolean, default: true },
  isMap: { type: Boolean, default: false },
  showTarget: { type: Boolean, default: true },
  autoNext: { type: Boolean, default: false },
  playSoundOnStart: { type: Boolean, default: false },
  soundUrl: { type: String, default: "" },
  targetLat: { type: Number, default: null },
  targetLng: { type: Number, default: null },
  targetRadius: { type: Number, default: 50 },
  modules: [moduleSchema]
});

// 3. Blauwdruk voor de Puzzeltocht (Inclusief het nieuwe Thema!)
const puzzleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  languages: { type: [String], default: ["nl"] },
  defaultLanguage: { type: String, default: "nl" },
  pages: [pageSchema], // Nu weet hij wél wat pageSchema is!
  
  // 🔥 Het Themasysteem:
  theme: {
    preset: { type: String, default: "standard" },
    primaryColor: { type: String, default: "#4f46e5" }
  },
  
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.Puzzle || mongoose.model("Puzzle", puzzleSchema);
