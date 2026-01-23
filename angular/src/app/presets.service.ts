import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';
import { Observable } from 'rxjs';

export interface Preset {
  name: string;
  files?: string[];
  samples?: any[];
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
}
