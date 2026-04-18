import mongoose from "mongoose";

const GlobalTeamSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  teamName: { type: String, required: true },
  globalScore: { type: Number, default: 0 },
  permanentPhoto: { type: String },
  feedbackHistory: [{
    puzzleId: { type: mongoose.Schema.Types.ObjectId, ref: "Puzzle" },
    feedback: String,
    score: Number,
    date: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

export default mongoose.models.GlobalTeam || mongoose.model("GlobalTeam", GlobalTeamSchema);
