import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "./app.mjs";

// ------- Helpers -------
// normalize, slugify, safePresetPath, fileExists, readJSON, writeJSON, listPresetFiles, validatePreset

// normalize a value to a string, if null or undefined returns empty string
const normalize = (s) => (s ?? "").toString();

// slugify a string to be URL-friendly: lowercase, no accents, no special chars, spaces to dashes
export const slugify = (s) => normalize(s)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-zA-Z0-9]+/g, "-")
  .replace(/(^-|-$)+/g, "")
  .toLowerCase();
// Get the full path of a preset JSON file from its name or slug. slug means a URL-friendly version of the name
export const safePresetPath = (nameOrSlug) => {
  const slug = slugify(nameOrSlug);
  return path.join(DATA_DIR, `${slug}.json`);
};
export const fileExists = async (p) => {
  try { await fs.access(p); return true; } catch { return false; }
};
// Read and parse a JSON file, returns a JS object
export const readJSON = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
// Stringify and write a JS object to a JSON file
export const writeJSON = async (filePath, data) => fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
// Returns an array of preset JSON filenames (not full path) in the DATA_DIR
export const listPresetFiles = async () => {
  console.log("Reading DATA_DIR:", DATA_DIR);

  // if DATA_DIR does not exist yet, readdir will throw
  // an error, so we catch it and return an empty array
  const items = await fs.readdir(DATA_DIR).catch((err) => {
    console.error("Error reading DATA_DIR:", err);
    return [];
  });
  console.log(items);
  // filter only .json files from the list of files
  return items.filter((f) => f.endsWith(".json"));
};
// Validate a preset object, returns an array of error messages (empty if valid)
export const validatePreset = (p, { partial = false } = {}) => {
  const errs = [];
  if (!partial || p.name !== undefined) {
    if (typeof p?.name !== "string" || !p.name.trim()) errs.push("name must be a non-empty string");
  }
  if (!partial || p.type !== undefined) {
    if (typeof p?.type !== "string" || !p.type.trim()) errs.push("type must be a non-empty string");
  }
  if (!partial || p.isFactoryPresets !== undefined) {
    if (typeof p?.isFactoryPresets !== "boolean") errs.push("isFactoryPresets must be a boolean");
  }
  if (!partial || p.samples !== undefined) {
    if (!Array.isArray(p?.samples)) errs.push("samples must be an array");
    else {
      p.samples.forEach((s, i) => {
        if (s === null) return;
        if (typeof s !== "object") errs.push(`samples[${i}] must be an object or null`);
        if (s && (typeof s.url !== "string" || typeof s.name !== "string")) {
          errs.push(`samples[${i}] must have string url and name`);
        }
      });
    }
  }
  return errs;
};
