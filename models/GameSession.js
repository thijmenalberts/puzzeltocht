import mongoose from "mongoose";

const GameSessionSchema = new mongoose.Schema({
  globalTeamId: { type: mongoose.Schema.Types.ObjectId, ref: "GlobalTeam" },
  puzzleId: { type: mongoose.Schema.Types.ObjectId, ref: "Puzzle" },
  sessionId: { type: String, required: true, unique: true },
  sessionScore: { type: Number, default: 0 },
  logbook: { type: [String], default: [] },
  isFinished: { type: Boolean, default: false },
  // De magische TTL Index: Verwijdert het document na 86400 seconden (24 uur)
  createdAt: { type: Date, default: Date.now, expires: 86400 } 
});

export default mongoose.models.GameSession || mongoose.model("GameSession", GameSessionSchema);
