import mongoose from "mongoose";
import UsedCode from "./models/UsedCode.js";

async function test() {
  await mongoose.connect("mongodb://localhost:27017/dummy");
  console.log("Connected");

  await UsedCode.create({ code: "TEST", deviceId: "123" });
  console.log("Created code");

  const found = await UsedCode.findOne({ code: "TEST" });
  console.log("Found:", found);

  process.exit(0);
}

test().catch(console.error);
