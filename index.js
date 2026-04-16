// index.js – Geoptimaliseerd: Gamified AI Puzzeltocht Engine (Fase 1 t/m 5)
import express from "express";
import mongoose from "mongoose";
import session from "express-session";
import MongoStore from "connect-mongo";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import expressLayouts from "express-ejs-layouts";
import multer from "multer";
import csv from "csv-parser";
import fs from "fs";
import crypto from "crypto";

import Puzzle from "./models/Puzzle.js";
import Admin from "./models/Admin.js";
import Code from "./models/Code.js";
import Theme from "./models/Theme.js";
import Team from "./models/Team.js"; // Inclusief voor latere uitbreidingen

import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

// ------------------------------------------
// 0. LEADERBOARD SCHEMA (Inline gedefinieerd voor Fase 4)
// ------------------------------------------
const LeaderboardSchema = new mongoose.Schema({
  teamName: { type: String, required: true },
  puzzleId: { type: mongoose.Schema.Types.ObjectId, ref: "Puzzle", required: true },
  totalScore: { type: Number, default: 0 },
  totalTimeSec: { type: Number, default: 0 },
  date: { type: Date, default: Date.now }
});
const Leaderboard = mongoose.models.Leaderboard || mongoose.model("Leaderboard", LeaderboardSchema);

// ------------------------------------------
// HELPER: veilig bestand verwijderen
// ------------------------------------------
function safeUnlink(filePath) {
  fs.unlink(filePath, err => {
    if (err && err.code !== "ENOENT") {
      console.warn("⚠️ Kon bestand niet verwijderen:", filePath, err.message);
    }
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);

// ------------------------------------------
// 1. UPLOAD FOLDERS AANMAKEN
// ------------------------------------------
const uploadDir = path.join(__dirname, "public", "uploads");
const teamPhotoDir = path.join(uploadDir, "team-photos");

if (!fs.existsSync(teamPhotoDir)) fs.mkdirSync(teamPhotoDir, { recursive: true });
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ------------------------------------------
// 2. MULTER
// ------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const name = crypto.randomBytes(8).toString("hex") + ext;
    cb(null, name);
  }
});

const uploadMedia = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("audio/")) cb(null, true);
    else cb(new Error("Alleen afbeeldingen of audio toegestaan"), false);
  },
  limits: { fileSize: 25 * 1024 * 1024 }
});

const uploadTeamPhoto = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, teamPhotoDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const name = crypto.randomBytes(8).toString("hex") + ext;
      cb(null, name);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Alleen afbeeldingen toegestaan"));
  }
});

// ------------------------------------------
// 3. MONGO CONNECT
// ------------------------------------------
async function connectMongo() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI ontbreekt");
    process.exit(1);
  }
  const hasDbInUri = /mongodb(\+srv)?:\/\/[^/]+\/[^?]+/.test(uri);
  await mongoose.connect(uri, {
    dbName: hasDbInUri ? undefined : (process.env.MONGO_DBNAME || "puzzeltocht"),
    serverSelectionTimeoutMS: 15000
  });
  console.log("MongoDB connected:", mongoose.connection.name);
}
await connectMongo();

// ------------------------------------------
// 4. VIEW ENGINE & CONFIG
// ------------------------------------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------------------
// 5. SESSIE
// ------------------------------------------
app.use(session({
  secret: process.env.SESSION_SECRET || "secret",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    dbName: process.env.MONGO_DBNAME || "puzzeltocht"
  }),
  cookie: { sameSite: "lax", secure: process.env.NODE_ENV === "production" }
}));

app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

// ------------------------------------------
// 6. THEMA INLADEN
// ------------------------------------------
app.use(async (req, res, next) => {
  try {
    const theme = await Theme.findOne();
    res.locals.theme = theme || {
      primaryColor: "#2563eb", backgroundColor: "#ffffff", textColor: "#111827", borderRadius: "0.75rem", fontFamily: "Inter, sans-serif"
    };
  } catch {
    res.locals.theme = { primaryColor: "#2563eb", backgroundColor: "#ffffff", textColor: "#111827", borderRadius: "0.75rem", fontFamily: "Inter, sans-serif" };
  }
  next();
});

function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.redirect("/admin-login");
}

// ==========================================
// ADMIN & BUILDER ROUTES
// ==========================================
app.post("/admin-upload-media", requireAdmin, uploadMedia.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Geen bestand" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.get("/admin-files", requireAdmin, (req, res) => {
  const baseDir = uploadDir;
  function readFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).map(name => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, isDir: stat.isDirectory(), size: stat.isFile() ? stat.size : null };
    });
  }
  const rootFiles = readFiles(baseDir).filter(f => !f.isDir);
  const folders = readFiles(baseDir).filter(f => f.isDir).map(folder => ({
    name: folder.name, files: readFiles(path.join(baseDir, folder.name)).filter(f => !f.isDir)
  }));
  res.render("admin-files", { rootFiles, folders });
});

app.post("/admin-files/delete", requireAdmin, express.json(), (req, res) => {
  const { folder, file } = req.body;
  const filePath = path.join(uploadDir, folder, file);
  if (!filePath.startsWith(uploadDir)) return res.status(400).json({ error: "Ongeldig pad" });
  safeUnlink(filePath);
  res.json({ ok: true });
});

app.get("/", (req, res) => res.render("index", { error: null }));
app.post("/check-code", async (req, res) => {
  const code = (req.body.code || "").trim();
  const found = await Code.findOne({ code });
  if (!found) return res.render("index", { error: "Code niet gevonden" });
  if (found.type === "admin") return res.redirect("/admin-login");
  res.redirect("/next");
});

app.get("/next", async (req, res) => {
  const puzzles = await Puzzle.find().sort({ createdAt: -1 });
  res.render("next", { puzzles });
});

app.get("/admin-login", (req, res) => res.render("admin-login", { error: null }));
app.post("/admin-login", async (req, res) => {
  const { username, password } = req.body;
  const admin = await Admin.findOne({ username });
  if (!admin || !(await bcrypt.compare(password, admin.password))) {
    return res.render("admin-login", { error: "Ongeldige gegevens" });
  }
  req.session.isAdmin = true;
  res.redirect("/admin-dashboard");
});
app.get("/admin-logout", (req, res) => req.session.destroy(() => res.redirect("/admin-login")));
app.get("/admin-dashboard", requireAdmin, (req, res) => res.render("admin-dashboard"));

app.post("/admin-add-code", requireAdmin, async (req, res) => {
  if (req.body.code) await Code.create({ code: req.body.code.trim(), type: req.body.type || "user" });
  res.redirect("/admin-dashboard");
});

app.get("/admin-theme", requireAdmin, async (req, res) => {
  const theme = await Theme.findOne() || { primaryColor: "#2563eb", backgroundColor: "#ffffff", textColor: "#111827", borderRadius: "0.75rem", fontFamily: "Inter, sans-serif" };
  res.render("admin-theme", { theme, saved: false });
});

app.post("/admin-theme", requireAdmin, async (req, res) => {
  const { primaryColor, backgroundColor, textColor, borderRadius, fontFamily } = req.body;
  await Theme.findOneAndUpdate({}, { primaryColor, backgroundColor, textColor, borderRadius, fontFamily }, { upsert: true });
  res.render("admin-theme", { theme: req.body, saved: true });
});

app.get("/admin-puzzles", requireAdmin, async (req, res) => {
  const puzzles = await Puzzle.find().sort({ createdAt: -1 });
  res.render("admin-puzzles", { puzzles });
});
app.get("/admin-puzzles/new", requireAdmin, (req, res) => res.render("admin-new-puzzle"));
app.post("/admin-puzzles/new", requireAdmin, async (req, res) => {
  const puzzle = await Puzzle.create({ name: req.body.name, pages: [{ title: "Pagina 1", showNext: true, isMap: false, modules: [] }] });
  res.redirect(`/admin-builder/${puzzle._id}`);
});
app.get("/admin-builder/:id", requireAdmin, async (req, res) => {
  const puzzle = await Puzzle.findById(req.params.id).lean();
  res.render("admin-builder", { puzzle, builderPage: true });
});
app.post("/admin-builder/:id/save-all", requireAdmin, express.json(), async (req, res) => {
  try {
    const puzzle = await Puzzle.findById(req.params.id);
    if (!puzzle) return res.status(404).send("Puzzel niet gevonden");
    puzzle.set({ pages: req.body.pages, languages: req.body.languages, defaultLanguage: req.body.defaultLanguage });
    puzzle.markModified("pages");
    puzzle.markModified("languages");
    puzzle.markModified("defaultLanguage");
    await puzzle.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("SAVE-ALL ERROR:", err);
    res.status(500).send("Server error");
  }
});

// ==========================================
// GAME ENGINE: FASE 1 & 2 (DATA, TIMERS & SCORE)
// ==========================================

// 1. Teamnaam Kiezen -> Start de Master Klok
app.post("/team/name", express.json(), (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || name.length > 40) return res.status(400).json({ error: "Ongeldige teamnaam" });

  req.session.teamName = name.trim();
  req.session.totalScore = 0;
  req.session.logbook = [];
  req.session.timers = {}; // Reset alle actieve sub-timers
  req.session.gameStartTime = Date.now(); // FASE 4: MASTER KLOK START
  
  res.json({ ok: true });
});

// 2. Server-Side Timers (Beveiligd tegen pagina-verversen)
app.post("/api/timer/start", express.json(), (req, res) => {
  const { questionId } = req.body;
  if (!req.session.timers) req.session.timers = {};
  
  // Start de klok alleen als deze nog niet liep voor deze vraag
  if (!req.session.timers[questionId]) {
    req.session.timers[questionId] = Date.now();
  }
  res.json({ success: true, startTime: req.session.timers[questionId] });
});

// 3. Standaard Puntentelling (Voor NIET-tijdsgebonden en Algemene acties)
app.post("/api/log-action", express.json(), (req, res) => {
  const { points, logMessage } = req.body;
  if (req.session.totalScore === undefined) req.session.totalScore = 0;
  if (!req.session.logbook) req.session.logbook = [];

  const earned = Number(points) || 0;
  req.session.totalScore += earned;

  if (logMessage) {
    const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    req.session.logbook.push(`[${time}] ${logMessage} (Punten toegekend: ${earned})`);
  }
  res.json({ success: true, totalScore: req.session.totalScore });
});

// 4. Server-Side Timer Submit (100% Waterdicht)
app.post("/api/timer/stop", express.json(), (req, res) => {
  const { questionId, maxPts, limit, pSec, pPts, logMessage } = req.body;
  
  if (req.session.totalScore === undefined) req.session.totalScore = 0;
  if (!req.session.logbook) req.session.logbook = [];

  let earned = Number(maxPts) || 10;
  let passedSec = 0;

  // Beveiliging: Heeft de server een starttijd geregistreerd voor deze specifieke vraag?
  if (req.session.timers && req.session.timers[questionId]) {
    const startTime = req.session.timers[questionId];
    passedSec = Math.floor((Date.now() - startTime) / 1000);
    
    // Bereken strafpunten server-side
    if (passedSec > Number(limit)) {
      const penalty = Math.floor((passedSec - Number(limit)) / Number(pSec)) * Number(pPts);
      earned = Math.max(0, earned - penalty);
    }
    
    // Verwijder de timer uit het geheugen om dubbel indienen te voorkomen
    delete req.session.timers[questionId];
  } else {
    // Vangnet: Als er gecheat is of de sessie is verlopen, geef 0 punten
    earned = 0; 
  }

  req.session.totalScore += earned;

  const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  req.session.logbook.push(`[${time}] ${logMessage} (Kostte ${passedSec}s, Verdiende Punten: ${earned})`);

  res.json({ success: true, earnedPoints: earned, totalScore: req.session.totalScore, passedSec });
});

// ==========================================
// GAME ENGINE: FASE 3 (HYBRIDE HINT ENGINE)
// ==========================================
app.post("/api/get-hint", express.json(), async (req, res) => {
  const { questionText, hintType, staticHintText, secretKnowledge, userMessage, hintCost } = req.body;
  
  const cost = Number(hintCost) || 0;
  if (req.session.totalScore === undefined) req.session.totalScore = 0;
  if (!req.session.logbook) req.session.logbook = [];
  
  // Punten aftrekken
  req.session.totalScore -= cost;

  const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  const logPrefix = `[${time}] 💡 HINT GEBRUIKT bij "${(questionText||'').substring(0,20)}..." (Kosten: -${cost} pt).`;

  try {
    // 1. STATISCHE HINT (Kostenbesparend!)
    if (hintType === "static") {
      req.session.logbook.push(`${logPrefix} Type: Statisch.`);
      return res.json({ hint: staticHintText || "Kijk goed om je heen!", newScore: req.session.totalScore });
    }

    // 2. AI HINT (Gemini)
    if (!userMessage) return res.status(400).json({ error: "Geen vraag gesteld." });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // STRIKTE FIX: EXACT GEMINI-1.5-FLASH
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash", 
      systemInstruction: `Je bent de Hint-Meester. Opdracht: "${questionText}". Geheim: "${secretKnowledge}". Geef een subtiele hint op de vraag "${userMessage}". Verklap NOOIT het antwoord.`
    });

    const result = await model.generateContent(userMessage);
    const aiResponse = result.response.text();

    req.session.logbook.push(`${logPrefix} AI zei: "${aiResponse}"`);
    res.json({ hint: aiResponse, newScore: req.session.totalScore });

  } catch (e) {
    console.error("Hint Error:", e);
    // Veilige fallback bij API-failure: geef punten terug!
    req.session.totalScore += cost; 
    res.status(500).json({ error: "De Hint-Meester is even onbereikbaar. Je punten zijn teruggeboekt." });
  }
});

// ==========================================
// GAME ENGINE: AI JURY & HISTORISCHE CHAT
// ==========================================
app.post("/api/verify-aiphoto", uploadTeamPhoto.single("file"), async (req, res) => {
  let limit = 10;
  let promptStr = "Controleer deze foto.";
  
  try {
    if (!req.file) return res.status(400).json({ error: "Geen foto ontvangen." });
    promptStr = req.body.prompt || promptStr;
    limit = Number(req.body.maxPoints) || 10;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // STRIKTE FIX: EXACT GEMINI-1.5-FLASH
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const fileData = fs.readFileSync(req.file.path);
    const imagePart = { inlineData: { data: fileData.toString("base64"), mimeType: req.file.mimetype }};

    const systemPrompt = `Beoordeel de foto: "${promptStr}". Schaal 0 tot 100. Antwoord STRICT in JSON: {"match": true/false, "score": getal, "reason": "korte NL zin"}`;
    const result = await model.generateContent([systemPrompt, imagePart]);
    const aiResult = JSON.parse(result.response.text().replace(/```json/g, "").replace(/```/g, "").trim());

    const awarded = Math.round((aiResult.score / 100) * limit);
    
    if (req.session.totalScore === undefined) req.session.totalScore = 0;
    if (!req.session.logbook) req.session.logbook = [];
    req.session.totalScore += awarded;
    
    const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    req.session.logbook.push(`[${time}] AI Foto Check: "${promptStr}" -> Kreeg score ${aiResult.score}% en verdiende ${awarded} punten.`);
    
    res.json({ success: true, match: aiResult.match, score: aiResult.score, pointsAwarded: awarded, maxPoints: limit, reason: aiResult.reason, url: `/uploads/team-photos/${req.file.filename}` });
  } catch (error) {
    console.error("AI Jury Fout:", error);
    res.status(500).json({ error: "De jury kon de foto niet beoordelen." });
  }
});

app.post("/api/chat-persona", express.json(), async (req, res) => {
  let characterNameStr = req.body.characterName || "Historisch Figuur";
  try {
    const { message, systemPrompt, history } = req.body;
    if (!message || !systemPrompt) return res.status(400).json({ error: "Bericht ontbreekt." });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // STRIKTE FIX: EXACT GEMINI-1.5-FLASH
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: `Rol: ${characterNameStr}. Achtergrond: ${systemPrompt}. Reageer altijd in karakter, kort (max 3 zinnen).`
    });

    const chat = model.startChat({ history: history || [] });
    const result = await chat.sendMessage(message);
    const responseText = result.response.text();

    if (!req.session.logbook) req.session.logbook = [];
    const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    req.session.logbook.push(`[${time}] Chat met ${characterNameStr} -> Speler: "${message}" | Reactie: "${responseText}"`);

    res.json({ reply: responseText });
  } catch (error) { 
    console.error("Chat Error:", error);
    if (error.message && error.message.includes("429")) return res.status(429).json({ error: `${characterNameStr} heeft even rust nodig.` });
    res.status(500).json({ error: `${characterNameStr} is sprakeloos... Probeer opnieuw!` });
  }
});

// ==========================================
// FASE 4 & 5: FINALE & LEADERBOARD
// ==========================================

// Slaat eindstand op in de database & genereert het AI reisverslag
app.post("/api/generate-finale-report", express.json(), async (req, res) => {
  const teamNameStr = req.session.teamName || "Het Spookteam";
  const { userFeedback, puzzleId } = req.body;

  try {
    const logbook = req.session.logbook || [];
    const score = req.session.totalScore || 0;
    
    // Bereken totale speeltijd
    const startTime = req.session.gameStartTime || Date.now();
    const totalTimeSec = Math.floor((Date.now() - startTime) / 1000);
    const timeMin = Math.floor(totalTimeSec / 60);

    // 1. FASE 4: SAVE NAAR LEADERBOARD (Hall of Fame)
    if (puzzleId && !req.session.hasFinished) {
      await Leaderboard.create({
        teamName: teamNameStr,
        puzzleId: puzzleId,
        totalScore: score,
        totalTimeSec: totalTimeSec
      });
      req.session.hasFinished = true; // Zorgt dat ze niet 100x het leaderboard spammen bij refresh
    }

    // 2. FASE 5: GEMINI AI REISVERSLAG (The Roast)
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: `Je bent een geestige, professionele ceremoniemeester die een puzzeltocht afsluit. 
      Geef een hilarische maar waarderende samenvatting (een 'roast') van de prestaties van het team.`
    });

    const aiPrompt = `
      Team: "${teamNameStr}"
      Totaalscore: ${score} punten.
      Gespeelde tijd: ${timeMin} minuten.
      Feedback van speler aan het eind: "${userFeedback || 'Geen mening'}".
      
      Hier is het ruwe logboek van wat ze hebben gedaan:
      ${logbook.join("\n")}
      
      Schrijf een leuk verhaal (max 3 alinea's) dat hun slimme acties prijst, maar ze ook liefdevol plaagt over hun gekochte hints, foute antwoorden of grappige chats. Sluit feestelijk af!
    `;

    const result = await model.generateContent(aiPrompt);
    const finaleText = result.response.text();

    res.json({ success: true, report: finaleText, score: score, timeMin: timeMin });

  } catch (error) {
    console.error("Finale Report Error:", error);
    res.status(500).json({ error: "De ceremoniemeester is de tekst kwijt... Maar jullie eindscore is " + (req.session.totalScore || 0) + "!" });
  }
});

// Publieke Hall of Fame Route
app.get("/leaderboard/:puzzleId", async (req, res) => {
  try {
    const scores = await Leaderboard.find({ puzzleId: req.params.puzzleId })
      .sort({ totalScore: -1, totalTimeSec: 1 }) // Hoogste score eerst, bij gelijkspel wint snelste tijd
      .limit(10);
      
    // (Optioneel: Je moet hier later een "leaderboard.ejs" view voor maken!)
    res.render("leaderboard", { scores }); 
  } catch(e) {
    res.status(500).send("Fout bij ophalen leaderboard.");
  }
});

// ==========================================
// PLAYER / TEAM PHOTO & TAAL
// ==========================================
app.post("/upload-photo", uploadTeamPhoto.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Geen bestand ontvangen" });
  res.json({ url: `/uploads/team-photos/${req.file.filename}` });
});

app.post("/team/profile-photo", express.json(), (req, res) => {
  const { photoUrl } = req.body;
  if (!photoUrl || !photoUrl.startsWith("/uploads/team-photos/")) return res.status(400).json({ error: "Ongeldig" });
  const oldPhotoUrl = req.session.teamProfilePhoto;
  req.session.teamProfilePhoto = photoUrl;
  if (oldPhotoUrl && oldPhotoUrl !== photoUrl && oldPhotoUrl.startsWith("/uploads/team-photos/")) {
    safeUnlink(path.join(uploadDir, "team-photos", path.basename(oldPhotoUrl)));
  }
  res.json({ ok: true });
});

app.post("/puzzle/set-language", express.urlencoded({ extended: false }), (req, res) => {
  if (typeof req.body.language === "string") req.session.language = req.body.language;
  res.redirect(req.body.redirect || "/");
});

app.get("/puzzle/:id", async (req, res) => {
  const puzzle = await Puzzle.findById(req.params.id);
  if (!puzzle) return res.status(404).send("Puzzel niet gevonden");
  res.redirect(`/puzzle/${puzzle._id}/0`);
});

app.get("/puzzle/:id/:page", async (req, res) => {
  const puzzle = await Puzzle.findById(req.params.id).lean();
  if (!puzzle) return res.status(404).send("Puzzel niet gevonden");
  const lang = req.session.language || puzzle.defaultLanguage || "nl";
  res.render("puzzle-page", {
    puzzle,
    page: puzzle.pages[Number(req.params.page)],
    pageIndex: Number(req.params.page),
    lang,
    session: req.session
  });
});

app.use((req, res) => res.status(404).send("Pagina niet gevonden"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Server gestart op poort", port));  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const name = crypto.randomBytes(8).toString("hex") + ext;
    cb(null, name);
  }
});

const uploadMedia = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("audio/")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Alleen afbeeldingen of audio toegestaan"), false);
    }
  },
  limits: { fileSize: 25 * 1024 * 1024 } // max 25MB
});

const uploadTeamPhoto = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, teamPhotoDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const name = crypto.randomBytes(8).toString("hex") + ext;
      cb(null, name);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Alleen afbeeldingen toegestaan"));
    }
  }
});

// ------------------------------------------
// 3. MONGO CONNECT
// ------------------------------------------
async function connectMongo() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI ontbreekt");
    process.exit(1);
  }

  const hasDbInUri = /mongodb(\+srv)?:\/\/[^/]+\/[^?]+/.test(uri);

  await mongoose.connect(uri, {
    dbName: hasDbInUri ? undefined : (process.env.MONGO_DBNAME || "puzzeltocht"),
    serverSelectionTimeoutMS: 15000
  });

  console.log("MongoDB connected:", mongoose.connection.name);
}

await connectMongo();

// ------------------------------------------
// 4. VIEW ENGINE + STATIC
// ------------------------------------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------------------
// 5. SESSIE
// ------------------------------------------
app.use(session({
  secret: process.env.SESSION_SECRET || "secret",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    dbName: process.env.MONGO_DBNAME || "puzzeltocht"
  }),
  cookie: { sameSite: "lax", secure: process.env.NODE_ENV === "production" }
}));

app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

// ------------------------------------------
// 6. THEMA INLADEN
// ------------------------------------------
app.use(async (req, res, next) => {
  try {
    const theme = await Theme.findOne();
    res.locals.theme = theme || {
      primaryColor: "#2563eb",
      backgroundColor: "#ffffff",
      textColor: "#111827",
      borderRadius: "0.75rem",
      fontFamily: "Inter, sans-serif"
    };
  } catch {
    res.locals.theme = {
      primaryColor: "#2563eb",
      backgroundColor: "#ffffff",
      textColor: "#111827",
      borderRadius: "0.75rem",
      fontFamily: "Inter, sans-serif"
    };
  }
  next();
});

// ------------------------------------------
// 7. ADMIN CHECK FUNCTIE
// ------------------------------------------
function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.redirect("/admin-login");
}

// ------------------------------------------
// 8. UPLOAD ENDPOINT (image + audio)
// ------------------------------------------
app.post(
  "/admin-upload-media",
  requireAdmin,
  uploadMedia.single("file"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Geen bestand" });
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
  }
);

// ------------------------------------------
// 8b. PLAYER UPLOAD ENDPOINT (alleen images)
// ------------------------------------------
app.post(
  "/upload-photo",
  uploadTeamPhoto.single("file"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Geen bestand ontvangen" });
    }

    const url = `/uploads/team-photos/${req.file.filename}`;
    res.json({ url });
  }
);

// ------------------------------------------
// 8c. SET TEAM PROFILE PHOTO
// ------------------------------------------
app.post("/team/profile-photo", express.json(), (req, res) => {
  const { photoUrl } = req.body;

  // Validatie
  if (
    !photoUrl ||
    !photoUrl.startsWith("/uploads/team-photos/")
  ) {
    return res.status(400).json({ error: "Ongeldige teamfoto" });
  }

  // Oude teamfoto (indien aanwezig)
  const oldPhotoUrl = req.session.teamProfilePhoto;

  // Nieuwe teamfoto opslaan in session
  req.session.teamProfilePhoto = photoUrl;

  // ✅ AUTOMATISCHE CLEANUP
  if (
    oldPhotoUrl &&
    oldPhotoUrl !== photoUrl &&
    oldPhotoUrl.startsWith("/uploads/team-photos/")
  ) {
    const oldFilePath = path.join(
      uploadDir,
      "team-photos",
      path.basename(oldPhotoUrl)
    );

    safeUnlink(oldFilePath);
  }

  res.json({ ok: true });
});
// ------------------------------------------
// 8d. AI FOTO CONTROLE (DYNAMISCHE JURY)
// ------------------------------------------
app.post("/api/verify-aiphoto", uploadTeamPhoto.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Geen foto ontvangen." });
    
    // Pak de opdracht en de punten uit de aanvraag (meegestuurd door de speler)
    const { prompt, maxPoints } = req.body;
    const limit = Number(maxPoints) || 10;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

    const fileData = fs.readFileSync(req.file.path);
    const imagePart = {
      inlineData: {
        data: fileData.toString("base64"),
        mimeType: req.file.mimetype
      }
    };

    const systemPrompt = `
      Je bent de juryvoorzitter van een puzzeltocht. 
      De beheerder heeft de volgende opdracht gegeven: "${prompt}".
      
      Jouw taak: Beoordeel of de foto voldoet aan deze opdracht op een schaal van 0 tot 100.
      
      STRIKTE BEOORDELINGSRICHTLIJNEN:
      - 100 punten: Het gevraagde object staat duidelijk op de foto. (Geef ALTIJD 100 punten als het object volledig aanwezig is. Negeer belichting, compositie of artistieke kwaliteit).
      - 50-99 punten: Het object is aanwezig maar zeer onduidelijk, deels buiten beeld of extreem klein.
      - 0-49 punten: Het gevraagde object ontbreekt of de foto is totaal irrelevant.

      Antwoord UITSLUITEND in deze JSON structuur:
      {
        "match": true, // alleen false als score < 50
        "score": 100, 
        "reason": "Korte, enthousiaste motivatie in het Nederlands (max 2 zinnen)."
      }
    `;

    const result = await model.generateContent([systemPrompt, imagePart]);
    const aiResult = JSON.parse(result.response.text().replace(/```json/g, "").replace(/```/g, "").trim());

    // Berekening: (percentage / 100) * max punten uit de builder
    const awarded = Math.round((aiResult.score / 100) * limit);
    // --- START GAMIFICATION MEMORY ---
    if (req.session.totalScore === undefined) req.session.totalScore = 0;
    if (!req.session.logbook) req.session.logbook = [];
    
    // Voeg de punten toe aan het totaal
    req.session.totalScore += awarded;
    
    // Schrijf het op in het AI Logboek voor het eindverslag
    const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    req.session.logbook.push(`[${time}] AI Foto Check: "${prompt}" -> Kreeg score ${aiResult.score}% en verdiende ${awarded} punten.`);
    // --- EINDE GAMIFICATION MEMORY ---
    
    res.json({
      success: true,
      match: aiResult.match,
      score: aiResult.score,
      pointsAwarded: awarded,
      maxPoints: limit,
      reason: aiResult.reason,
      url: `/uploads/team-photos/${req.file.filename}`
    });

  } catch (error) {
    console.error("AI Jury Fout:", error);
    res.status(500).json({ error: "De jury kon de foto niet beoordelen." });
  }
});
// ------------------------------------------
// 8e. HISTORISCHE CHAT (LITE MODEL - 1000 REQS/DAG)
// ------------------------------------------
app.post("/api/chat-persona", express.json(), async (req, res) => {
  try {
    const { message, systemPrompt, characterName, history } = req.body;

    if (!message || !systemPrompt) {
      return res.status(400).json({ error: "Bericht of instructie ontbreekt." });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Gebruik Flash-Lite voor hogere gratis quota
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash-latest",
      systemInstruction: `Je bent het volgende personage: ${characterName}. Jouw achtergrond en gedrag: ${systemPrompt}. Reageer altijd in karakter. Houd je antwoorden kort en krachtig (max 3 zinnen).`
    });

    const chat = model.startChat({
      history: history || []
    });

    const result = await chat.sendMessage(message);
    const responseText = result.response.text();

    // --- START CHAT GEHEUGEN (VOOR DE FINALE) ---
    if (!req.session.logbook) req.session.logbook = [];
    const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    
    // We slaan exact op met WIE ze praten, WAT ze vroegen, en WAT het antwoord was
    req.session.logbook.push(`[${time}] Chat met ${characterName} -> Speler: "${message}" | Reactie: "${responseText}"`);
    // --- EINDE CHAT GEHEUGEN ---

    res.json({ reply: responseText });

  } catch (error) { 
    console.error("Chat Error:", error);

    // Als de daglimiet van Google op is (Error 429)
    if (error.message && error.message.includes("429")) {
        return res.status(429).json({ 
            error: `Oei! ${characterName} heeft vandaag al teveel gekletst en heeft even rust nodig.` 
        });
    }

    // Voor alle andere fouten
    res.status(500).json({ 
        error: `Helaas, ${characterName} is even sprakeloos... Probeer het zo nog eens!` 
    });
  }
});

// ------------------------------------------
// SET TEAM NAME & INITIALISEER LOGBOEK
// ------------------------------------------
app.post("/team/name", express.json(), (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== "string" || name.length > 40) {
    return res.status(400).json({ error: "Ongeldige teamnaam" });
  }

  req.session.teamName = name.trim();
  req.session.totalScore = 0; // Reset score
  req.session.logbook = [];   // Start een leeg logboek voor de eind-AI

  res.json({ ok: true });
});

app.post("/puzzle/set-language", express.urlencoded({ extended: false }),
  (req, res) => {
    const { language, redirect } = req.body;

    if (typeof language === "string") {
      req.session.language = language;
    }

    res.redirect(redirect || "/");
  }
);

// ------------------------------------------
// 9. ROUTES
// ------------------------------------------

// ------------------------------------------
// ADMIN: BESTANDEN OVERZICHT
// ------------------------------------------
app.get("/admin-files", requireAdmin, (req, res) => {
  const baseDir = uploadDir;

  function readFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).map(name => {
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);

      return {
        name,
        isDir: stat.isDirectory(),
        size: stat.isFile() ? stat.size : null
      };
    });
  }

  // ✅ Bestanden direct in uploads/
  const rootFiles = readFiles(baseDir).filter(f => !f.isDir);

  // ✅ Submappen (zoals team-photos/)
  const folders = readFiles(baseDir)
    .filter(f => f.isDir)
    .map(folder => ({
      name: folder.name,
      files: readFiles(path.join(baseDir, folder.name))
        .filter(f => !f.isDir)
    }));

  res.render("admin-files", {
    rootFiles,
    folders
  });
});

app.post("/admin-files/delete", requireAdmin, express.json(), (req, res) => {
  const { folder, file } = req.body;

  const filePath = path.join(uploadDir, folder, file);

  if (!filePath.startsWith(uploadDir)) {
    return res.status(400).json({ error: "Ongeldig pad" });
  }

  safeUnlink(filePath);
  res.json({ ok: true });
});

app.get("/", (req, res) => res.render("index", { error: null }));

app.post("/check-code", async (req, res) => {
  const code = (req.body.code || "").trim();
  const found = await Code.findOne({ code });

  if (!found) return res.render("index", { error: "Code niet gevonden" });
  if (found.type === "admin") return res.redirect("/admin-login");

  res.redirect("/next");
});

app.get("/next", async (req, res) => {
  const puzzles = await Puzzle.find().sort({ createdAt: -1 });
  res.render("next", { puzzles });
});

app.get("/admin-login", (req, res) =>
  res.render("admin-login", { error: null })
);

app.post("/admin-login", async (req, res) => {
  const { username, password } = req.body;
  const admin = await Admin.findOne({ username });

  if (!admin) return res.render("admin-login", { error: "Onbekende gebruiker" });
  const ok = await bcrypt.compare(password, admin.password);

  if (!ok) return res.render("admin-login", { error: "Wachtwoord fout" });

  req.session.isAdmin = true;
  res.redirect("/admin-dashboard");
});

app.get("/admin-logout", (req, res) =>
  req.session.destroy(() => res.redirect("/admin-login"))
);

app.get("/admin-dashboard", requireAdmin, (req, res) =>
  res.render("admin-dashboard")
);

app.post("/admin-add-code", requireAdmin, async (req, res) => {
  const { code, type } = req.body;
  if (!code) return res.redirect("/admin-dashboard");

  await Code.create({ code: code.trim(), type: type || "user" });
  res.redirect("/admin-dashboard");
});

// CSV upload
app.post("/admin-upload-csv", requireAdmin, uploadMedia.single("csvfile"), async (req, res) => {
  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", async () => {
      const codes = results.map(r => ({
        code: (r.code || "").trim(),
        type: r.type || "user"
      }));
      await Code.insertMany(codes, { ordered: false });
      fs.unlinkSync(req.file.path);
      res.redirect("/admin-dashboard");
    });
});

app.get("/admin-theme", requireAdmin, async (req, res) => {
  const theme = await Theme.findOne() || {
    primaryColor: "#2563eb",
    backgroundColor: "#ffffff",
    textColor: "#111827",
    borderRadius: "0.75rem",
    fontFamily: "Inter, sans-serif"
  };

  res.render("admin-theme", { theme, saved: false });
});

app.post("/admin-theme", requireAdmin, async (req, res) => {
  const { primaryColor, backgroundColor, textColor, borderRadius, fontFamily } =
    req.body;

  await Theme.findOneAndUpdate(
    {},
    { primaryColor, backgroundColor, textColor, borderRadius, fontFamily },
    { upsert: true }
  );

  res.render("admin-theme", { theme: req.body, saved: true });
});

// Puzzle routes
app.get("/admin-puzzles", requireAdmin, async (req, res) => {
  const puzzles = await Puzzle.find().sort({ createdAt: -1 });
  res.render("admin-puzzles", { puzzles });
});

app.get("/admin-puzzles/new", requireAdmin, (req, res) =>
  res.render("admin-new-puzzle")
);

app.post("/admin-puzzles/new", requireAdmin, async (req, res) => {
  const puzzle = await Puzzle.create({
    name: req.body.name,
    pages: [{ title: "Pagina 1", showNext: true, isMap: false, modules: [] }]
  });

  res.redirect(`/admin-builder/${puzzle._id}`);
});

// Builder
app.get("/admin-builder/:id", requireAdmin, async (req, res) => {
  const puzzle = await Puzzle.findById(req.params.id).lean();
  res.render("admin-builder", { puzzle, builderPage: true });
});

// Save pages
app.post(
  "/admin-builder/:id/save-all",
  requireAdmin,
  express.json(),
  async (req, res) => {
    try {
      const puzzle = await Puzzle.findById(req.params.id);
      if (!puzzle) {
        return res.status(404).send("Puzzel niet gevonden");
      }

      puzzle.set({
        pages: req.body.pages,
        languages: req.body.languages,
        defaultLanguage: req.body.defaultLanguage
      });

      puzzle.markModified("pages");
      puzzle.markModified("languages");
      puzzle.markModified("defaultLanguage");

      await puzzle.save();

      res.json({ ok: true });
    } catch (err) {
      console.error("SAVE-ALL ERROR:", err);
      res.status(500).send("Server error");
    }
  }
);

// ------------------------------------------
// 🌟 FASE 1 & 2: LOGBOEK & SCORE ENGINE
// ------------------------------------------

// 1. Initialiseer de score en het logboek als het team een naam kiest
app.post("/team/name", express.json(), (req, res) => {
  req.session.teamName = req.body.name;
  req.session.totalScore = 0;
  req.session.logbook = []; // Hierin slaat de AI straks alles op!
  res.json({ ok: true });
});

// 2. De route om punten en acties op te slaan in de sessie
app.post("/api/log-action", express.json(), (req, res) => {
  const { points, logMessage } = req.body;

  // Vangnet: als ze op een oude sessie zitten
  if (req.session.totalScore === undefined) req.session.totalScore = 0;
  if (!req.session.logbook) req.session.logbook = [];

  const earned = Number(points) || 0;
  req.session.totalScore += earned;

  // Schrijf in het verborgen logboek voor de AI Eind-evaluatie
  if (logMessage) {
    const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    req.session.logbook.push(`[${time}] ${logMessage} (Verdiende punten: ${earned})`);
  }

  res.json({ success: true, totalScore: req.session.totalScore });
});

// ------------------------------------------
// 🌟 FASE 3: DE ADAPTIEVE SOS AI (HINTS)
// ------------------------------------------
app.post("/api/get-hint", express.json(), async (req, res) => {
  try {
    const { questionText, secretKnowledge, userMessage, hintCost } = req.body;
    
    if (!userMessage) return res.status(400).json({ error: "Geen vraag gesteld." });

    // 1. Punten aftrekken & logboek updaten
    const cost = Number(hintCost) || 0;
    if (req.session.totalScore === undefined) req.session.totalScore = 0;
    if (!req.session.logbook) req.session.logbook = [];
    
    req.session.totalScore -= cost; // Strafpunten voor de hint!

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // We gebruiken Lite voor de snelheid en gratis quota
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash-latest",
      systemInstruction: `Je bent de mysterieuze en behulpzame Hint-Meester van een puzzeltocht.
      De speler is bezig met deze opdracht: "${questionText}".
      Jij weet het volgende geheim (VERKLAP DIT NOOIT DIRECT): "${secretKnowledge}".
      
      De speler loopt vast en zegt: "${userMessage}".
      
      Geef een slimme, subtiele hint op maat die de speler in de juiste richting stuurt, gebaseerd op hun vraag en jouw geheime kennis. Maximaal 2 tot 3 zinnen. Gebruik een aanmoedigende toon.`
    });

    const result = await model.generateContent(userMessage);
    const hintText = result.response.text();

    // 2. Opslaan in het grote eindverslag-geheugen
    const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    req.session.logbook.push(`[${time}] 💡 HINT GEVRAAGD bij "${questionText.substring(0,20)}...". Speler zei: "${userMessage}". AI gaf hint: "${hintText}" (Kosten: -${cost} pt)`);

    res.json({ hint: hintText, newScore: req.session.totalScore });

  } catch (error) {
    console.error("SOS Hint Error:", error);
    res.status(500).json({ error: "De Hint-Meester is even de weg kwijt..." });
  }
});


// Player
app.get("/puzzle/:id", async (req, res) => {
  const puzzle = await Puzzle.findById(req.params.id);
  if (!puzzle) return res.status(404).send("Puzzel niet gevonden");

  res.redirect(`/puzzle/${puzzle._id}/0`);
});

app.get("/puzzle/:id/:page", async (req, res) => {
  const puzzle = await Puzzle.findById(req.params.id).lean();
  if (!puzzle) return res.status(404).send("Puzzel niet gevonden");

  // ✅ ACTIVE TAAL bepalen
  const lang =
    req.session.language ||
    puzzle.defaultLanguage ||
    "nl";

 res.render("puzzle-page", {
    puzzle,
    page: puzzle.pages[Number(req.params.page)],
    pageIndex: Number(req.params.page),
    lang,              // ✅ DIT WAS DE MISSENDE SCHAKEL
    session: req.session
  });
});

// ------------------------------------------
// UNIVERSELE SCORE & LOGBOEK ROUTE
// ------------------------------------------
app.post("/api/log-action", express.json(), (req, res) => {
  const { points, logMessage } = req.body;

  if (req.session.totalScore === undefined) req.session.totalScore = 0;
  if (!req.session.logbook) req.session.logbook = [];

  const earned = Number(points) || 0;
  req.session.totalScore += earned;

  if (logMessage) {
    const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    req.session.logbook.push(`[${time}] ${logMessage} (Punten: ${earned})`);
  }

  res.json({ success: true, totalScore: req.session.totalScore });
});

// 1. Puntentelling & Logboek
app.post("/api/log-action", express.json(), (req, res) => {
  const { points, logMessage } = req.body;
  if (req.session.totalScore === undefined) req.session.totalScore = 0;
  if (!req.session.logbook) req.session.logbook = [];
  
  req.session.totalScore += Number(points) || 0;
  if (logMessage) {
    const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    req.session.logbook.push(`[${time}] ${logMessage}`);
  }
  res.json({ success: true, totalScore: req.session.totalScore });
});

// 2. Adaptieve AI Hint
app.post("/api/get-hint", express.json(), async (req, res) => {
  try {
    const { questionText, secretKnowledge, userMessage, hintCost } = req.body;
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash-latest",
      systemInstruction: `Je bent de Hint-Meester. Opdracht: "${questionText}". Geheim: "${secretKnowledge}". 
      Geef een subtiele hint op de vraag "${userMessage}". Verklap NOOIT het antwoord.`
    });

    const result = await model.generateContent(userMessage);
    req.session.totalScore -= (Number(hintCost) || 0); // Punten aftrekken
    res.json({ hint: result.response.text(), newScore: req.session.totalScore });
  } catch (e) { res.status(500).send(e.message); }
});

// ------------------------------------------
// 10. 404
// ------------------------------------------
app.use((req, res) => res.status(404).send("Pagina niet gevonden"));

// ------------------------------------------
// 11. START SERVER
// ------------------------------------------
const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Server gestart op poort", port));
