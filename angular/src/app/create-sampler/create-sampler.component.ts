import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { PresetsService, Preset, PresetSample, UploadResponse } from '../presets.service';
import { appendAudioFiles, buildSamplesFromUpload, buildSamplesFromUrls, validateUrlSamples } from '../preset-audio-utils';

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
    // gestion de la sélection de fichiers, 
    // on verifie qu'ils sont bien audio avant de les ajouter
    //et on limite à 16 fichiers max
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files) { return; }
    const selected: File[] = [];
    for (let i = 0; i < input.files.length; i++) {
      const f = input.files.item(i);
      if (f && f.type.startsWith('audio/')) selected.push(f);
    }

    if (!selected.length) { return; }
    const { files, truncated } = appendAudioFiles(this.files, selected, 16);
    this.files = files;
    if (truncated) {
      alert('Maximum 16 fichiers audio par preset. Les fichiers supplémentaires ont été ignorés.');
    }
  }
  // gestion du drag over pour le drop de fichiers audio
  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = true;
  }
  // gestion du drag leave pour le drop de fichiers audio
  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;
  }
  // gestion du drop de fichiers, ajout des fichiers audio avec la même logique que la sélection
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
    // gestion du drop de fichiers audio qui limite à 16 fichiers max
    if (!droppedFiles.length) { return; }
    const { files, truncated } = appendAudioFiles(this.files, droppedFiles, 16);
    this.files = files;
    if (truncated) {
      alert('Maximum 16 fichiers audio par preset. Les fichiers supplémentaires ont été ignorés.');
    }
  }
  //delete d'un fichier sélectionné
  removeFile(index: number) {
    this.files.splice(index, 1);
    this.files = [...this.files];
  }
  // création du preset
  createPreset() {
    // on recupère et valide le nom
    const rawName = (this.name || '').trim();
    if (!rawName) {
      alert('Veuillez saisir un nom de preset.');
      return;
    }
    const name = rawName;
    // on recupère les URLs une par une
    const manualUrls = (this.urlText || '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => !!l);

    this.loading = true;

    this.svc.list().subscribe({
      next: async (presets: Preset[]) => {
        //on verifie que le nom n'existe pas déjà
        const exists = (presets || []).some(p => (p.name || '').toLowerCase() === name.toLowerCase());
        if (exists) {
          alert('Un preset avec ce nom existe déjà.');
          this.loading = false;
          return;
        }

        const hasFiles = this.files && this.files.length > 0;
        const urlSamples = buildSamplesFromUrls(manualUrls);

        // Si des URLs sont fournies, on vérifie qu'elles pointent bien vers des fichiers audio accessibles
        if (urlSamples.length) {
          const invalidUrl = await validateUrlSamples(urlSamples);
          if (invalidUrl) {
            alert(`Impossible de créer le preset : l'URL "${invalidUrl}" ne pointe pas vers un fichier audio valide sur le serveur.`);
            this.loading = false;
            return;
          }
        }

        // Cas 1: vide
        // ni fichiers ni URLs
        // juste un preset vide sans samples
        if (!hasFiles && urlSamples.length === 0) {
          // on construit le preset vide
          const body: Preset = {
            name,
            type: 'Empty',
            isFactoryPresets: false,
            samples: []
          };
          // on crée le preset vide sur le back end
          this.svc.create(body).subscribe({
            next: () => {
              alert('Preset vide créé.');
              this.loading = false;
              this.router.navigate(['/']);
            },
            //gestion des erreurs
            error: (e) => {
              this.loading = false;
              alert('Erreur lors de la création: ' + (e?.error?.error || e?.message || e));
            }
          });
          return;
        }

        // Cas 2: URL seulement
        // on prend les URLs fournies qui sont celles deja presente sur le back end
        // et on crée le preset avec ces URLs
        // on limite à 16 sons max
        if (!hasFiles) {
          let samples = urlSamples;
          if (samples.length > 16) {
            samples = samples.slice(0, 16);
            alert('Maximum 16 sons par preset. Les URLs supplémentaires ont été ignorées.');
          }
          // on construit le preset complet
          const body: Preset = {
            name,
            type: 'Custom',
            isFactoryPresets: false,
            samples
          };
          // on crée le preset avec les URLs seulement
          this.svc.create(body).subscribe({
            next: () => {
              alert('Preset créé avec les URLs fournies.');
              this.loading = false;
              this.router.navigate(['/']);
            },
            //gestion des erreurs
            error: (e) => {
              this.loading = false;
              alert('Erreur lors de la création: ' + (e?.error?.error || e?.message || e));
            }
          });
          return;
        }

        // Cas 3: on a des fichiers (avec potentiellement des URL en plus)
        // on upload les fichiers audio dans un dossier portant le nom du preset
        // puis on crée le preset avec les URLs résultantes de l'upload + les URLs fournies
        // dans la limite de 16 sons max
        this.svc.upload(name, this.files).subscribe({
          next: (uploadRes) => {
            const fileSamples = buildSamplesFromUpload(name, uploadRes);
            let allSamples: PresetSample[] = [...fileSamples, ...urlSamples];
            if (allSamples.length > 16) {
              allSamples = allSamples.slice(0, 16);
              alert('Maximum 16 sons par preset. Certains sons supplémentaires ont été ignorés.');
            }
            // on construit le preset complet
            const body: Preset = {
              name,
              type: 'Custom',
              isFactoryPresets: false,
              samples: allSamples
            };
            // on crée le preset avec les fichiers audio et les URLs fournies
            this.svc.create(body).subscribe({
              next: () => {
                alert('Preset créé avec les fichiers audio et les URLs fournies.');
                this.loading = false;
                this.router.navigate(['/']);
              },
              //gestion des erreurs
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
