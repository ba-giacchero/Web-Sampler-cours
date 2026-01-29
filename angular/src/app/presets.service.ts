import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';
import { Observable } from 'rxjs';

export interface PresetSample {
  url: string;
  name: string;
}

export interface Preset {
  name: string;
  type?: string;
  isFactoryPresets?: boolean;
  files?: string[];
  samples?: PresetSample[];
}

export interface UploadFileInfo {
  originalName: string;
  storedName: string;
  size: number;
  url: string;
}

export interface UploadResponse {
  uploaded: number;
  files: UploadFileInfo[];
}

@Injectable({ providedIn: 'root' })
export class PresetsService {
  private base = environment.apiBase;
  constructor(private http: HttpClient) {}

  list(): Observable<Preset[]> {
    return this.http.get<Preset[]>(`${this.base}/api/presets`);
  }

  rename(oldName: string, newName: string) {
    return this.http.patch(`${this.base}/api/presets/${encodeURIComponent(oldName)}`, { name: newName });
  }

  create(preset: Preset) {
    return this.http.post(`${this.base}/api/presets`, preset);
  }

  delete(name: string) {
    return this.http.delete(`${this.base}/api/presets/${encodeURIComponent(name)}`);
  }

  getOne(name: string): Observable<Preset> {
    return this.http.get<Preset>(`${this.base}/api/presets/${encodeURIComponent(name)}`);
  }

  update(oldName: string, preset: Preset) {
    return this.http.put(`${this.base}/api/presets/${encodeURIComponent(oldName)}`, preset);
  }

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
