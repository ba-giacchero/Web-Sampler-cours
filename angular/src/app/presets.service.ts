import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';
import { Observable } from 'rxjs';

// Représente un sample individuel dans un preset
export interface PresetSample {
  url: string;
  name: string;
}

// Modèle de preset côté front
export interface Preset {
  name: string;
  type?: string;
  isFactoryPresets?: boolean;
  files?: string[];
  samples?: PresetSample[];
}

// Informations sur un fichier renvoyé par l'upload
export interface UploadFileInfo {
  originalName: string;
  storedName: string;
  size: number;
  url: string;
}

// Réponse de l'endpoint d'upload
export interface UploadResponse {
  uploaded: number;
  files: UploadFileInfo[];
}

// Service centralisé pour tous les appels HTTP liés aux presets
@Injectable({ providedIn: 'root' })
export class PresetsService {
  // base de l'URL de l'API (configurée dans environment.ts)
  private base = environment.apiBase;

  constructor(private http: HttpClient) {}

  // Récupère la liste complète des presets
  list(): Observable<Preset[]> {
    return this.http.get<Preset[]>(`${this.base}/api/presets`);
  }

  // Renomme un preset existant via PATCH
  rename(oldName: string, newName: string) {
    return this.http.patch(`${this.base}/api/presets/${encodeURIComponent(oldName)}`, { name: newName });
  }

  // Crée un nouveau preset via POST
  create(preset: Preset) {
    return this.http.post(`${this.base}/api/presets`, preset);
  }

  // Supprime un preset par son nom
  delete(name: string) {
    return this.http.delete(`${this.base}/api/presets/${encodeURIComponent(name)}`);
  }

  // Récupère un preset individuel par son nom
  getOne(name: string): Observable<Preset> {
    return this.http.get<Preset>(`${this.base}/api/presets/${encodeURIComponent(name)}`);
  }

  // Remplace entièrement un preset (PUT)
  update(oldName: string, preset: Preset) {
    return this.http.put(`${this.base}/api/presets/${encodeURIComponent(oldName)}`, preset);
  }

  // Upload de fichiers audio pour un preset donné
  upload(folder: string, files: File[]): Observable<UploadResponse> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    return this.http.post<UploadResponse>(
      `${this.base}/api/upload/${encodeURIComponent(folder)}`,
      formData
    );
  }
}
