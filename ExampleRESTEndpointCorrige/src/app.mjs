// src/app.mjs — corrigé complet
import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "node:url";
import cors from "cors";  //ajout

import crypto from "crypto";
import multer from "multer";

// import utility functions from utils.mjs
import {
  slugify, safePresetPath, fileExists,
  readJSON, writeJSON, listPresetFiles, validatePreset
} from "./utils.mjs";

export const app = express();
app.use(express.json({ limit: "2mb" }));


app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow non-browser clients like curl or Postman
    const ok = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    cb(ok ? null : new Error("Not allowed by CORS"), ok);
  }, // allow all origins for testing; in production, specify allowed origins
}));


// configure multer for file uploads
// storage is diskStorage with destination and filename functions
// multer means "multipart/form-data" which is used for file uploads
// Before HTML5 it was not possible to upload files with AJAX easily
// so we use a form with enctype="multipart/form-data" and method="POST"
// The form can be submitted with JavaScript (e.g., fetch API) or directly by the browser
const upload = multer({
  storage: multer.diskStorage({
    // cb is the callback to indicate where to store the file
    destination: async (req, file, cb) => {
      const folder = req.params.folder || "";
      const destDir = path.join(DATA_DIR, folder);
      await fs.mkdir(destDir, { recursive: true }).catch(() => {});
      cb(null, destDir);
    },
    filename: (req, file, cb) => {
      // Use original filename
      cb(null, file.originalname);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 } // limit files to 10MB
});

// --------- Cross-platform paths (Mac/Linux/Windows) ---------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// PUBLIC_DIR: env var wins, else ../public (absolute path)
export const PUBLIC_DIR = process.env.PUBLIC_DIR
  ? path.resolve(process.env.PUBLIC_DIR)
  : path.resolve(__dirname, "../public");

// DATA_DIR: env var wins, else <PUBLIC_DIR>/presets
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(PUBLIC_DIR, "presets");

// No decodeURIComponent needed anymore; these are file system paths


// Defines where static files are located, for example the file 
// data/presets/Basic Kit/kick.wav
// will be accessible at http://localhost:3000/presets/Basic%20Kit/kick.wav
// The file PUBLIC_DIR/index.html will be served at http://localhost:3000/ or 
// http://localhost:3000/index.html
// app.use should use a path that works on unix and windows
app.use(express.static(PUBLIC_DIR));

// Ensure data dir exists at startup (best-effort)
await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});

// ------- Routes -------
// This is where we define the API endpoints (also called web services or routes)
// Each route has a method (get, post, put, patch, delete) and a path (e.g., /api/presets)
// The handler function takes the request (req), response (res), and next (for error handling) as parameters

// Simple health check endpoint, this is generally the first endpoint to test
app.get("/api/health", (_req, res) => res.json({ ok: true, now: new Date().toISOString() }));

// GET list/search
app.get("/api/presets", async (req, res, next) => {
  try {
    // req.query contains optional parameters: q (text search), type (filter by type), factory (true/false)
    // that appear in the URI like that : /api/presets?q=kick&type=drum&factory=true
    // the javascript syntax in the following like uses the JavaScript "destructuring" assignment
    const { q, type, factory } = req.query;
    const files = await listPresetFiles();

    // Promise.all is used to read all JSON files in parallel and in a non-blocking way
    // This improves performance when dealing with multiple files
    // The syntax of Promise.all is a bit tricky: we create an array of promises
    // by mapping each filename to a readJSON call, and then we wait for all of them to complete
    let items = await Promise.all(files.map((f) => readJSON(path.join(DATA_DIR, f))));

    // Apply filters
    if (type) {
      const t = String(type).toLowerCase();
      items = items.filter((p) => p?.type?.toLowerCase() === t);
    }
    if (factory !== undefined) {
      const want = String(factory) === "true";
      items = items.filter((p) => Boolean(p?.isFactoryPresets) === want);
    }
    if (q) {
      const needle = String(q).toLowerCase();
      items = items.filter((p) => {
        const inName = p?.name?.toLowerCase().includes(needle);
        const inSamples = Array.isArray(p?.samples) && p.samples.some((s) =>
          s && (s.name?.toLowerCase().includes(needle) || s.url?.toLowerCase().includes(needle))
        );
        return inName || inSamples;
      });
    }

    // Return the filtered list. the.json method sets the Content-Type header and stringifies the object
    res.json(items);
  } catch (e) { next(e); }
});

// GET one preset by name or slug. slug means a URL-friendly version of the name
app.get("/api/presets/:name", async (req, res, next) => {
  try {
    const file = safePresetPath(req.params.name);
    console.log("Fetching preset file:", file);
    if (!(await fileExists(file))) return res.status(404).json({ error: "Preset not found" });
    res.json(await readJSON(file));
  } catch (e) { next(e); }
});

// POST for creating a new preset
app.post("/api/presets", async (req, res, next) => {
  try {
    // explanation of ?? below: if body is null or undefined, use empty object
    const preset = req.body ?? {};

    // validate the received preset object
    const errs = validatePreset(preset);
    if (errs.length) return res.status(400).json({ errors: errs });

    // check if a preset with the same name already exists
    const file = safePresetPath(preset.name);
    if (await fileExists(file)) return res.status(409).json({ error: "A preset with this name already exists" });

    // Add metadata and save the preset in a json file
    const now = new Date().toISOString();
    const withMeta = {
      id: preset.id || crypto.randomUUID(),
      slug: slugify(preset.name),
      updatedAt: now,
      ...preset,
      name: preset.name,
    };
    await writeJSON(file, withMeta);

    // return the created preset
    res.status(201).json(withMeta);
  } catch (e) { next(e); }
});

// POST route for uploading audio sample files (.wav, .mp3 etc./) 
// This route will take as a parameter the sample/folder name where to store the file
// and the file will be available at http://localhost:3000/presets/:folder/:filename
// we can add multiple files with multer. 16 below is the max number of files accepted
// NOTE: THIS CODE IS INCOMPLETE: a folder should be created for each preset
// and the audio files should be stored in that folder.
// Here, if all files (the preset json file and the audio files) are uploaded at once, they all
// will be stored in the same folder, which is not what we want. We want:
// the preset file in the preset folder, and the audio files in a subfolder with the same name
// For example:
// public/presets/Basic Kit.json
// public/presets/Basic Kit/kick.wav
// public/presets/Basic Kit/snare.wav
// etc.
// To do that, we will need to modify later both this code and the front-end code
// We will see that in the next session
app.post("/api/upload/:folder", upload.array("files", 16), (req, res) => {
  // All files are in req.files
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No files were uploaded." });
  }

  const destinationFolder = req.params.folder || "";
  console.log(`Uploaded ${req.files.length} files to folder: ${destinationFolder}`);
  
  // Prepare response with file information
  const fileInfos = req.files.map((file) => ({
    originalName: file.originalname,
    storedName: file.filename,
    size: file.size,
    url: `/presets/${req.params.folder}/${file.filename}`
  }));

  // with the current multer setup, files are already saved in the correct folder
  // so we just return the file information
  res.status(201).json({ uploaded: fileInfos.length, files: fileInfos });
});

// PUT for replacing or renaming a preset file completely
app.put("/api/presets/:name", async (req, res, next) => {
  try {
    const oldFile = safePresetPath(req.params.name);
    if (!(await fileExists(oldFile))) return res.status(404).json({ error: "Preset not found" });

    const preset = req.body ?? {};
    const errs = validatePreset(preset);
    if (errs.length) return res.status(400).json({ errors: errs });

    const now = new Date().toISOString();
    const newFile = safePresetPath(preset.name);
    const current = await readJSON(oldFile).catch(() => ({}));
    const withMeta = {
      id: current.id || preset.id || crypto.randomUUID(),
      slug: slugify(preset.name),
      updatedAt: now,
      ...preset,
      name: preset.name,
    };
    await writeJSON(newFile, withMeta);
    if (newFile != oldFile) await fs.rm(oldFile, { force: true });
    res.json(withMeta);
  } catch (e) { next(e); }
});

// PATCH partial
app.patch("/api/presets/:name", async (req, res, next) => {
  try {
    const oldFile = safePresetPath(req.params.name);
    if (!(await fileExists(oldFile))) return res.status(404).json({ error: "Preset not found" });

    const current = await readJSON(oldFile);
    const merged = { ...current, ...req.body };
    merged.name = merged.name ?? current.name;
    const errs = validatePreset(merged, { partial: true });
    if (errs.length) return res.status(400).json({ errors: errs });

    merged.slug = slugify(merged.name);
    merged.updatedAt = new Date().toISOString();

    const newFile = safePresetPath(merged.name);
    await writeJSON(newFile, merged);
    if (newFile != oldFile) await fs.rm(oldFile, { force: true });

    res.json(merged);
  } catch (e) { next(e); }
});

// DELETE a preset by name
app.delete("/api/presets/:name", async (req, res, next) => {
  try {
    const file = safePresetPath(req.params.name);
    await fs.rm(file, { force: true });

    // We should also delete the corresponding audio files in the folder with the same name
    // get folder path and delete if exists
    const folderPath = path.join(DATA_DIR, req.params.name);
    await fs.rm(folderPath, { recursive: true, force: true }).catch(() => {});
    
    // 204 means No Content

    res.status(204).send();
  } catch (e) { next(e); }
});

// POST for seeding multiple presets at once (for testing or initial setup)
app.post("/api/presets:seed", async (req, res, next) => {
  try {
    const arr = Array.isArray(req.body) ? req.body : null;
    if (!arr) return res.status(400).json({ error: "Body must be an array of presets" });

    let created = 0; const slugs = [];
    for (const p of arr) {
      const errs = validatePreset(p);
      if (errs.length) return res.status(400).json({ errors: errs });
      const now = new Date().toISOString();
      const withMeta = { id: p.id || crypto.randomUUID(), slug: slugify(p.name), updatedAt: now, ...p, name: p.name };
      await writeJSON(safePresetPath(p.name), withMeta);
      created++; slugs.push(withMeta.slug);
    }
    res.status(201).json({ created, slugs });
  } catch (e) { next(e); }
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});
