import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { PresetsService, Preset, PresetSample, UploadResponse } from '../presets.service';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-create-sampler',
  templateUrl: './create-sampler.component.html',
  styleUrls: ['./create-sampler.component.css']
})
export class CreateSamplerComponent {
  name = '';
  urlText = '';
  files: File[] = [];
  isDragOver = false;
  loading = false;

  constructor(private svc: PresetsService, private router: Router) {}

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files) { return; }
    const selected: File[] = [];
    for (let i = 0; i < input.files.length; i++) {
      const f = input.files.item(i);
      if (f && f.type.startsWith('audio/')) selected.push(f);
    }

    if (!selected.length) { return; }

    const combined = [...this.files, ...selected];
    if (combined.length > 16) {
      this.files = combined.slice(0, 16);
      alert('Maximum 16 fichiers audio par preset. Les fichiers supplémentaires ont été ignorés.');
    } else {
      this.files = combined;
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;
    if (!event.dataTransfer) { return; }
    const droppedFiles: File[] = [];
    if (event.dataTransfer.files && event.dataTransfer.files.length) {
      for (let i = 0; i < event.dataTransfer.files.length; i++) {
        const f = event.dataTransfer.files.item(i);
        if (f && f.type.startsWith('audio/')) droppedFiles.push(f);
      }
    }
    if (!droppedFiles.length) { return; }

    const combined = [...this.files, ...droppedFiles];
    if (combined.length > 16) {
      this.files = combined.slice(0, 16);
      alert('Maximum 16 fichiers audio par preset. Les fichiers supplémentaires ont été ignorés.');
    } else {
      this.files = combined;
    }
  }

  removeFile(index: number) {
    this.files.splice(index, 1);
    this.files = [...this.files];
  }

  private async isValidAudioUrl(rawUrl: string): Promise<boolean> {
    let url = (rawUrl || '').trim();
    if (!url) return false;

    // Si ce n'est pas une URL absolue, on la traite comme un chemin relatif au dossier /presets du back
    if (!/^https?:\/\//i.test(url)) {
      const cleaned = url.replace(/^\.?\//, '');
      url = `${environment.apiBase}/presets/${cleaned}`;
    }

    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) return false;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      return ct.startsWith('audio/') || ct.includes('octet-stream');
    } catch {
      return false;
    }
  }

  private async validateUrlSamples(samples: PresetSample[]): Promise<string | null> {
    for (const s of samples) {
      const ok = await this.isValidAudioUrl(s.url);
      if (!ok) return s.url;
    }
    return null;
  }

  private buildSamplesFromUrls(urls: string[]): PresetSample[] {
    return urls.map(u => {
      const trimmed = u.trim();
      const baseName = trimmed.split(/[\\/]/).pop() || 'sample';
      return { name: baseName, url: trimmed };
    });
  }

  private buildSamplesFromUpload(name: string, upload: UploadResponse): PresetSample[] {
    return (upload.files || []).map(f => {
      const baseName = (f.originalName || '').split(/[\\/]/).pop() || f.storedName || 'sample';
      return {
        name: baseName,
        url: `./${name}/${f.storedName}`
      };
    });
  }

  createPreset() {
    const rawName = (this.name || '').trim();
    if (!rawName) {
      alert('Veuillez saisir un nom de preset.');
      return;
    }
    const name = rawName;

    const manualUrls = (this.urlText || '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => !!l);

    this.loading = true;

    this.svc.list().subscribe({
      next: async (presets: Preset[]) => {
        const exists = (presets || []).some(p => (p.name || '').toLowerCase() === name.toLowerCase());
        if (exists) {
          alert('Un preset avec ce nom existe déjà.');
          this.loading = false;
          return;
        }

        const hasFiles = this.files && this.files.length > 0;
        const urlSamples = this.buildSamplesFromUrls(manualUrls);

        // Si des URLs sont fournies, on vérifie qu'elles pointent bien vers des fichiers audio accessibles
        if (urlSamples.length) {
          const invalidUrl = await this.validateUrlSamples(urlSamples);
          if (invalidUrl) {
            alert(`Impossible de créer le preset : l'URL "${invalidUrl}" ne pointe pas vers un fichier audio valide sur le serveur.`);
            this.loading = false;
            return;
          }
        }

        // Cas 1: vide
        if (!hasFiles && urlSamples.length === 0) {
          const body: Preset = {
            name,
            type: 'Empty',
            isFactoryPresets: false,
            samples: []
          };

          this.svc.create(body).subscribe({
            next: () => {
              alert('Preset vide créé.');
              this.loading = false;
              this.router.navigate(['/']);
            },
            error: (e) => {
              this.loading = false;
              alert('Erreur lors de la création: ' + (e?.error?.error || e?.message || e));
            }
          });
          return;
        }

        // Cas 2: URL seulement
        if (!hasFiles) {
          let samples = urlSamples;
          if (samples.length > 16) {
            samples = samples.slice(0, 16);
            alert('Maximum 16 sons par preset. Les URLs supplémentaires ont été ignorées.');
          }

          const body: Preset = {
            name,
            type: 'Custom',
            isFactoryPresets: false,
            samples
          };

          this.svc.create(body).subscribe({
            next: () => {
              alert('Preset créé avec les URLs fournies.');
              this.loading = false;
              this.router.navigate(['/']);
            },
            error: (e) => {
              this.loading = false;
              alert('Erreur lors de la création: ' + (e?.error?.error || e?.message || e));
            }
          });
          return;
        }

        // Cas 3: on a des fichiers (avec potentiellement des URL en plus)
        this.svc.upload(name, this.files).subscribe({
          next: (uploadRes) => {
            const fileSamples = this.buildSamplesFromUpload(name, uploadRes);
            let allSamples: PresetSample[] = [...fileSamples, ...urlSamples];
            if (allSamples.length > 16) {
              allSamples = allSamples.slice(0, 16);
              alert('Maximum 16 sons par preset. Certains sons supplémentaires ont été ignorés.');
            }

            const body: Preset = {
              name,
              type: 'Custom',
              isFactoryPresets: false,
              samples: allSamples
            };

            this.svc.create(body).subscribe({
              next: () => {
                alert('Preset créé avec les fichiers audio et les URLs fournies.');
                this.loading = false;
                this.router.navigate(['/']);
              },
              error: (e) => {
                this.loading = false;
                alert('Erreur lors de la création du preset: ' + (e?.error?.error || e?.message || e));
              }
            });
          },
          error: (e) => {
            console.error(e);
            this.loading = false;
            alert('Erreur lors de l\'upload des fichiers audio: ' + (e?.error?.error || e?.message || e));
          }
        });
      },
      error: (err) => {
        console.error(err);
        this.loading = false;
        alert('Impossible de vérifier les presets existants.');
      }
    });
  }
}
