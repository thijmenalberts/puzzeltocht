// models/Puzzle.js
import mongoose from "mongoose";

/*
|--------------------------------------------------------------------------
| Module Schema (zoals je nu al gebruikt)
|--------------------------------------------------------------------------
*/
const ModuleSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

/*
|--------------------------------------------------------------------------
| Page Schema  — volledig uitgebreid
|--------------------------------------------------------------------------
|
| Jij hebt aangegeven:
| - Instellingen moeten per pagina zijn  (JA)
| - Builder moet toggles krijgen        (komt in volgende scripts)
| - Server moet alles opslaan           (komt bij letter B)
| - Audio moet uploadbaar zijn          (komt bij letter E)
|
| Hier worden alle velden gezet, zodat Mongoose ze bewaart.
|--------------------------------------------------------------------------
*/

const PageSchema = new mongoose.Schema(
  {
    title: {
      type: mongoose.Schema.Types.Mixed,
      default: "Pagina"
    },

    showNext: { type: Boolean, default: true },
    isMap:    { type: Boolean, default: false },

    // Coordinates
    targetLat:    { type: Number, default: null },
    targetLng:    { type: Number, default: null },
    targetRadius: { type: Number, default: 50 },

    // ⭐ Nieuwe opties
    showTarget:       { type: Boolean, default: true },
    autoNext:         { type: Boolean, default: false },
    playSoundOnStart: { type: Boolean, default: false },
    soundUrl:         { type: String,  default: "", trim: true },

    modules: { type: [ModuleSchema], default: [] },
  },
  { _id: false }
);

/*
|--------------------------------------------------------------------------
| Puzzle Schema
|--------------------------------------------------------------------------
*/

const PuzzleSchema = new mongoose.Schema(
  {
    name:  { type: String, required: true, trim: true },
    pages: { type: [PageSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = ret._id?.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

// Index — jouw huidige code
PuzzleSchema.index({ updatedAt: -1, createdAt: -1 });

export default mongoose.model("Puzzle", PuzzleSchema);
