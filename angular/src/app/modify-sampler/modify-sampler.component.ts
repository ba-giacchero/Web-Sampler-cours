import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PresetsService, Preset, PresetSample, UploadResponse } from '../presets.service';
import { appendAudioFiles, buildSamplesFromUpload, buildSamplesFromUrls, validateUrlSamples } from '../preset-audio-utils';

@Component({
  selector: 'app-modify-sampler',
  templateUrl: './modify-sampler.component.html',
  styleUrls: ['./modify-sampler.component.css']
})
export class ModifySamplerComponent implements OnInit {
  // propriétés du composant
  // pour gérer le nom, les fichiers, les samples existants, l'état de chargement, etc.
  originalName = '';
  name = '';
  urlText = '';
  existingSamples: PresetSample[] = [];
  files: File[] = [];
  isDragOver = false;
  loading = false;
  loadedPreset: Preset | null = null;

  constructor(
    private route: ActivatedRoute,
    private svc: PresetsService,
    private router: Router
  ) {}
  // fonction d'initialisation du composant
  // s'active au chargement de la page
  ngOnInit(): void {
    const routeName = this.route.snapshot.paramMap.get('name');
    if (!routeName) {
      alert('Aucun preset spécifié.');
      this.router.navigate(['/']);
      return;
    }
    this.loadPreset(routeName);
  }
  // fonction de chargement du preset depuis le back end
  loadPreset(name: string) {
    this.loading = true;
    this.svc.getOne(name).subscribe({
      next: (p) => {
        this.loadedPreset = p;
        this.originalName = p.name;
        this.name = p.name;
        this.existingSamples = Array.isArray(p.samples) ? [...p.samples] : [];
        this.loading = false;
      },
      error: (e) => {
        console.error(e);
        alert('Impossible de charger le preset.');
        this.loading = false;
        this.router.navigate(['/']);
      }
    });
  }
 // gestion des fichiers audio sélectionnés,
 // on verefie qu'ils sont bien audio avant de les ajouter
 // et on limite à 16 fichiers max
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
  // gestion du drag and drop
  // pour les fichiers audio
  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = true;
  }
  // gestion du drag and drop
  // pour les fichiers audio
  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;
  }
  // gestion du drop de fichiers, 
  // ajout des fichiers audio avec la même logique que la sélection
  // et on limite à 16 fichiers max encore une fois
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
    const { files, truncated } = appendAudioFiles(this.files, droppedFiles, 16);
    this.files = files;
    if (truncated) {
      alert('Maximum 16 fichiers audio par preset. Les fichiers supplémentaires ont été ignorés.');
    }
  }
  // splices permet de retirer un fichier a partir de son index
  removeNewFile(index: number) {
    this.files.splice(index, 1);
    this.files = [...this.files];
  }
  // splices permet de retirer un sample existant a partir de son index
  removeExistingSample(index: number) {
    this.existingSamples.splice(index, 1);
    this.existingSamples = [...this.existingSamples];
  }
  // fonction de sauvegarde du preset modifié
  //construction du preset avec les nouveaux fichiers et URLs
  // validation des URLs
  // gestion des erreurs et alertes utilisateur
  save() {
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
    // on vérifie que le nom n'existe pas déjà (sauf si c'est le même preset)
    this.svc.list().subscribe({
      next: async (presets: Preset[]) => {
        const exists = (presets || []).some(p => (p.name || '').toLowerCase() === name.toLowerCase() && p.name !== this.originalName);
        if (exists) {
          alert('Un autre preset avec ce nom existe déjà.');
          this.loading = false;
          return;
        }
        // on vérifie si on a des fichiers à uploader
        const hasFiles = this.files && this.files.length > 0;
        const urlSamples = buildSamplesFromUrls(manualUrls);
        // on valide les URLs
        if (urlSamples.length) {
          const invalidUrl = await validateUrlSamples(urlSamples);
          if (invalidUrl) {
            alert(`Impossible de sauvegarder le preset : l'URL "${invalidUrl}" ne pointe pas vers un fichier audio valide sur le serveur.`);
            this.loading = false;
            return;
          }
        }

        const keepType = this.loadedPreset?.type || 'Custom';
        const keepFactory = this.loadedPreset?.isFactoryPresets ?? false;

        // Cas A: pas de nouveaux fichiers, on ne fait que combiner existants + URLs
        if (!hasFiles) {
          // on combine les samples existants et les nouveaux URLs
          let samples: PresetSample[] = [...this.existingSamples, ...urlSamples];
          if (samples.length > 16) {
            samples = samples.slice(0, 16);
            alert('Maximum 16 sons par preset. Certains sons supplémentaires ont été ignorés.');
          }
          // on construit le preset complet
          const body: Preset = {
            name,
            type: samples.length === 0 ? 'Empty' : keepType,
            isFactoryPresets: keepFactory,
            samples
          };
          // on envoie la mise à jour au back end  
          // avec la gestion des erreurs
          this.svc.update(this.originalName, body).subscribe({
            next: () => {
              alert('Preset mis à jour.');
              this.loading = false;
              this.router.navigate(['/']);
            },
            error: (e) => {
              this.loading = false;
              alert('Erreur lors de la mise à jour du preset: ' + (e?.error?.error || e?.message || e));
            }
          });
          return;
        }

        // Cas B: nouveaux fichiers (avec éventuellement des URLs en plus)
        const folderForUpload = this.originalName || name;
        this.svc.upload(folderForUpload, this.files).subscribe({
          next: (uploadRes) => {
            const fileSamples = buildSamplesFromUpload(folderForUpload, uploadRes);
            let allSamples: PresetSample[] = [...this.existingSamples, ...fileSamples, ...urlSamples];
            if (allSamples.length > 16) {
              allSamples = allSamples.slice(0, 16);
              alert('Maximum 16 sons par preset. Certains sons supplémentaires ont été ignorés.');
            }
            // on construit le preset complet
            const body: Preset = {
              name,
              type: allSamples.length === 0 ? 'Empty' : keepType,
              isFactoryPresets: keepFactory,
              samples: allSamples
            };
            // on envoie la mise à jour au back end  
            // avec la gestion des erreurs
            this.svc.update(this.originalName, body).subscribe({
              next: () => {
                alert('Preset mis à jour avec les nouveaux sons.');
                this.loading = false;
                this.router.navigate(['/']);
              },
              error: (e) => {
                this.loading = false;
                alert('Erreur lors de la mise à jour du preset: ' + (e?.error?.error || e?.message || e));
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
