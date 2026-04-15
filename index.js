
// index.js – herschreven & opgeschoond
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

import { GoogleGenerativeAI } from "@google/generative-ai";

// ------------------------------------------
// HELPER: veilig bestand verwijderen
// ------------------------------------------
function safeUnlink(filePath) {
  fs.unlink(filePath, err => {
    if (err && err.code !== "ENOENT") {
      console.warn(
        "⚠️ Kon bestand niet verwijderen:",
        filePath,
        err.message
      );
    }
  });
}

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Express init
const app = express();
app.set("trust proxy", 1);

// ------------------------------------------
// 1. UPLOAD FOLDERS AANMAKEN
// ------------------------------------------
const uploadDir = path.join(__dirname, "public", "uploads");

const teamPhotoDir = path.join(uploadDir, "team-photos");

if (!fs.existsSync(teamPhotoDir)) {
  fs.mkdirSync(teamPhotoDir, { recursive: true });
  console.log("📁 Teamfoto map aangemaakt:", teamPhotoDir);
}

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log("📁 Upload map aangemaakt:", uploadDir);
}

// ------------------------------------------
// 2. MULTER (image + audio upload)
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
// 8d. AI FOTO CONTROLE (GEMINI API)
// ------------------------------------------
app.post("/api/verify-aiphoto", uploadTeamPhoto.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Geen foto ontvangen." });
    
    const prompt = req.body.prompt;
    if (!prompt) return res.status(400).json({ error: "Geen AI-opdracht (prompt) meegegeven." });

    if (!process.env.GEMINI_API_KEY) {
      console.error("CRITICAL: GEMINI_API_KEY ontbreekt in .env");
      return res.status(500).json({ error: "AI is momenteel niet beschikbaar (Geen API Key)." });
    }

    // 1. Initialiseer Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // ⭐ DE DEFINITIEVE FIX: We gebruiken de nieuwste 2.5 architectuur die door Google wordt ondersteund.
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 2. Zet de foto om in Base64 (vereist voor Gemini)
    const filePath = req.file.path;
    const fileData = fs.readFileSync(filePath);
    const imagePart = {
      inlineData: {
        data: fileData.toString("base64"),
        mimeType: req.file.mimetype
      }
    };

    // 3. De System Prompt (Super strict voor consistente JSON)
    const systemPrompt = `
      Je bent een strenge, maar eerlijke, onpartijdige scheidsrechter in een vossenjacht/puzzeltocht.
      De speler moest een foto maken van: "${prompt}".
      Controleer of de afbeelding voldoet aan de opdracht. 
      Antwoord UITSLUITEND in de volgende JSON structuur, zonder extra tekst of markdown:
      {
        "match": true, // of false
        "reason": "Korte motivatie in het Nederlands, maximaal 2 zinnen."
      }
    `;

    // 4. Stuur naar AI en wacht op antwoord
    const result = await model.generateContent([systemPrompt, imagePart]);
    const responseText = result.response.text();

    // 5. Maak de JSON schoon (Mocht Gemini toch markdown sturen)
    const cleanJson = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
    const aiResult = JSON.parse(cleanJson);

    // 6. Stuur het resultaat terug naar de speler
    res.json({
      success: true,
      match: aiResult.match,
      reason: aiResult.reason,
      url: `/uploads/team-photos/${req.file.filename}`
    });

  } catch (error) {
    console.error("AI Validatie Fout:", error);
    res.status(500).json({ error: "De AI kon de foto niet goed beoordelen. Probeer een duidelijkere foto." });
  }
});

// ------------------------------------------
// SET TEAM NAME
// ------------------------------------------
app.post("/team/name", express.json(), (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== "string" || name.length > 40) {
    return res.status(400).json({ error: "Ongeldige teamnaam" });
  }

  req.session.teamName = name.trim();
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
// 10. 404
// ------------------------------------------
app.use((req, res) => res.status(404).send("Pagina niet gevonden"));

// ------------------------------------------
// 11. START SERVER
// ------------------------------------------
const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Server gestart op poort", port));
