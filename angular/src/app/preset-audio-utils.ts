import { environment } from '../environments/environment';
import { PresetSample, UploadResponse } from './presets.service';
// Ajoute des fichiers audio à une liste existante, jusqu'à une limite max
export function appendAudioFiles(existing: File[], added: File[], max = 16): { files: File[]; truncated: boolean } {
  const combined = [...existing, ...added];
  if (combined.length > max) {
    return { files: combined.slice(0, max), truncated: true };
  }
  return { files: combined, truncated: false };
}
// Construit des PresetSample à partir d'une liste d'URLs
export function buildSamplesFromUrls(urls: string[]): PresetSample[] {
  return urls.map(u => {
    const trimmed = u.trim();
    const baseName = trimmed.split(/[\\/]/).pop() || 'sample';
    return { name: baseName, url: trimmed };
  });
}
// Construit des PresetSample à partir de la réponse d'upload
export function buildSamplesFromUpload(folderName: string, upload: UploadResponse): PresetSample[] {
  return (upload.files || []).map(f => {
    const baseName = (f.originalName || '').split(/[\\/]/).pop() || f.storedName || 'sample';
    return {
      name: baseName,
      url: `./${folderName}/${f.storedName}`
    };
  });
}
// Vérifie si une URL pointe vers un fichier audio valide
export async function isValidAudioUrl(rawUrl: string): Promise<boolean> {
  let url = (rawUrl || '').trim();
  if (!url) return false;
  // Si l'URL n'est pas absolue, on la complète avec la base de l'API
  if (!/^https?:\/\//i.test(url)) {
    const cleaned = url.replace(/^\.?\//, '');
    url = `${environment.apiBase}/presets/${cleaned}`;
  }
  // On fait une requête HEAD pour vérifier le type de contenu
  //si ce n'est pas ok ou pas audio on retourne false
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return false;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    return ct.startsWith('audio/') || ct.includes('octet-stream');
  } catch {
    return false;
  }
}
// Vérifie chaque URL dans les samples et retourne la première invalide ou null si toutes sont valides
export async function validateUrlSamples(samples: PresetSample[]): Promise<string | null> {
  for (const s of samples) {
    const ok = await isValidAudioUrl(s.url);
    if (!ok) return s.url;
  }
  return null;
}
