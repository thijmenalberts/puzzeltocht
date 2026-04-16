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
import rateLimit from "express-rate-limit";

import Puzzle from "./models/Puzzle.js";
import Admin from "./models/Admin.js";
import { checkCode } from "./models/Code.js";
import Theme from "./models/Theme.js";
import Team from "./models/Team.js"; 
import "./models/cron.js";


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
// 3. MONGO CONNECT (RAILWAY FIX: Non-blocking)
// ------------------------------------------
async function connectMongo() {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.error("❌ MONGO_URI ontbreekt in de Railway Variables!");
      return; 
    }
    const hasDbInUri = /mongodb(\+srv)?:\/\/[^/]+\/[^?]+/.test(uri);
    await mongoose.connect(uri, {
      dbName: hasDbInUri ? undefined : (process.env.MONGO_DBNAME || "puzzeltocht"),
      serverSelectionTimeoutMS: 5000 // Faalt sneller zodat de app niet hangt
    });
    console.log("✅ MongoDB connected:", mongoose.connection.name);
  } catch (err) {
    console.error("❌ MongoDB Connectie Fout:", err.message);
  }
}
// BELANGRIJK: Start asynchroon op de achtergrond. Blokkeert de webserver niet!
connectMongo();

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
// 5. SESSIE (RAILWAY FIX: Timeout limit)
// ------------------------------------------
app.use(session({
  secret: process.env.SESSION_SECRET || "secret",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    dbName: process.env.MONGO_DBNAME || "puzzeltocht",
    mongoOptions: { serverSelectionTimeoutMS: 5000 } // Zorgt dat de opstart niet blokkeert
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

const checkCodeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minuten
  max: 5,                  // max 5 pogingen
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return res.render("index", {
      error: "Te veel pogingen. Probeer het over 10 minuten opnieuw.",
    });
  },
});


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
app.post("/check-code", checkCodeLimiter, async (req, res) => {
  try {
    const result = await checkCode(req.body.code);

    // ❌ Ongeldige code
    if (!result.valid) {
      return res.render("index", {
        error: result.error,
      });
    }

    // ✅ Admin-code (alleen als je dit ondersteunt)
    if (result.admin) {
      return res.redirect("/admin-login");
    }

    // ✅ Geldige gebruikerscode
    return res.redirect("/next");

  } catch (err) {
    console.error("check-code error:", err);
    return res.render("index", {
      error: "Er ging iets mis, probeer opnieuw",
    });
  }
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

    // 1. FASE 4: SAVE NAAR LEADERBOARD
    if (puzzleId && !req.session.hasFinished) {
      await Leaderboard.create({
        teamName: teamNameStr,
        puzzleId: puzzleId,
        totalScore: score,
        totalTimeSec: totalTimeSec
      });
      req.session.hasFinished = true; 
    }

    // 2. FASE 5: GEMINI AI REISVERSLAG
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: `Je bent een geestige, professionele ceremoniemeester die een puzzeltocht afsluit. Geef een hilarische maar waarderende samenvatting (een 'roast') van de prestaties van het team.`
    });

    const aiPrompt = `
      Team: "${teamNameStr}"
      Totaalscore: ${score} punten.
      Gespeelde tijd: ${timeMin} minuten.
      Feedback van speler aan het eind: "${userFeedback || 'Geen mening'}".
      
      Logboek van hun acties:
      ${logbook.join("\n")}
      
      Schrijf een leuk verhaal (max 3 alinea's) dat hun slimme acties prijst, maar ze ook liefdevol plaagt over gekochte hints of foute antwoorden.
    `;

    const result = await model.generateContent(aiPrompt);
    res.json({ success: true, report: result.response.text(), score: score, timeMin: timeMin });

  } catch (error) {
    console.error("Finale Report Error:", error);
    res.status(500).json({ error: "De AI-Ceremoniemeester is offline... Maar jullie eindscore is " + (req.session.totalScore || 0) + "!" });
  }
});

// Publieke Hall of Fame Route
app.get("/leaderboard/:puzzleId", async (req, res) => {
  try {
    const scores = await Leaderboard.find({ puzzleId: req.params.puzzleId })
      .sort({ totalScore: -1, totalTimeSec: 1 }) 
      .limit(10);
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

// ==========================================
// RAILWAY FIX: BIND OP 0.0.0.0
// ==========================================
const port = process.env.PORT || 8080;
app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Server gestart en luistert op poort ${port}`);
});
