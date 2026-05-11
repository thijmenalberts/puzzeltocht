import mongoose from "mongoose";

const UsedCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  deviceId: { type: String, required: true },
  usedAt: { type: Date, default: Date.now }
});

export default mongoose.models.UsedCode || mongoose.model("UsedCode", UsedCodeSchema);
