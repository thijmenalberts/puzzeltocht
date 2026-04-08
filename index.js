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
// 9. ROUTES
// ------------------------------------------

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
  const puzzle = await Puzzle.findById(req.params.id);
  res.render("admin-builder", { puzzle, builderPage: true });
});

// Save pages
app.post("/admin-builder/:id/save-all", requireAdmin, express.json(), async (req, res) => {
  try {
    const puzzle = await Puzzle.findById(req.params.id);
    if (!puzzle) return res.status(404).send("Puzzel niet gevonden");

    puzzle.pages = req.body.pages;
    puzzle.markModified("pages");
    await puzzle.save();

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// Player
app.get("/puzzle/:id", async (req, res) => {
  const puzzle = await Puzzle.findById(req.params.id);
  if (!puzzle) return res.status(404).send("Puzzel niet gevonden");

  res.redirect(`/puzzle/${puzzle._id}/0`);
});

app.get("/puzzle/:id/:page", async (req, res) => {
  const puzzle = await Puzzle.findById(req.params.id);
  if (!puzzle) return res.status(404).send("Puzzel niet gevonden");

  const pageIndex = Number(req.params.page);
  const page = puzzle.pages[pageIndex];
  if (!page) return res.status(404).send("Pagina niet gevonden");

  res.render("puzzle-page", { puzzle, page, pageIndex });
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
