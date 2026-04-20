import mongoose from "mongoose";

// 1. Blauwdruk voor een Module (Titel, Vraag, Foto, etc.)
const moduleSchema = new mongoose.Schema({
  type: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} }
});

// NIEUW: Sensor en Omgings Triggers voor de Scene
const triggerSchema = new mongoose.Schema({
  type: { type: String, enum: ["gps_proximity", "orientation", "speech_match", "ambient_darkness", "camera_vision"], required: true },
  targetValue: { type: mongoose.Schema.Types.Mixed, required: true }, // Bijv: bearing in graden, of een gesproken woord
  tolerance: { type: Number, default: 10 },
  unlocksNext: { type: Boolean, default: true }
});

// 2. Blauwdruk voor een Pagina
// HERNOEMD: Dit zijn nu 'Scenes' in plaats van 'Paginas' in de Artifact Engine
const pageSchema = new mongoose.Schema({
  title: { type: mongoose.Schema.Types.Mixed, default: {} },
  showNext: { type: Boolean, default: false }, // Knoppen zijn uit den boze in het nieuwe design
  isMap: { type: Boolean, default: false },
  showTarget: { type: Boolean, default: true },
  
  // De magische triggers die de scene voltooien zonder knoppen
  triggers: [triggerSchema],
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
  finalPrompt: { type: String, default: "" },
  
  // 🔥 Het Themasysteem:
  theme: {
    preset: { type: String, default: "standard" },
    primaryColor: { type: String, default: "#4f46e5" }
  },
  
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.Puzzle || mongoose.model("Puzzle", puzzleSchema);
