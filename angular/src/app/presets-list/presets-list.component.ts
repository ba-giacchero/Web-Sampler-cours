import { Component, OnInit } from '@angular/core';
import { PresetsService, Preset } from '../presets.service';

@Component({
  selector: 'app-presets-list',
  templateUrl: './presets-list.component.html',
  styleUrls: ['./presets-list.component.css']
})
export class PresetsListComponent implements OnInit {
  presets: Preset[] = [];
  loading = false;
  error: string | null = null;

  constructor(private svc: PresetsService) {}

  ngOnInit(): void {
    this.load();
  }
  // fonction de chargement de la liste des presets depuis le back end
  // appelé lors de l'initialisation du composant et après chaque modification
  load() {
    this.loading = true; this.error = null;
    this.svc.list().subscribe({
      next: (res) => { this.presets = res || []; this.loading = false; },
      error: (err) => { this.error = String(err?.message || err); this.loading = false; }
    });
  }
  // fonction de renommage de preset
  async rename(p: Preset) {
    const n = prompt('Nouveau nom pour le preset', p.name);
    if (!n || n.trim() === '' || n === p.name) return;
    this.svc.rename(p.name, n).subscribe({ next: () => this.load(), error: (e) => alert('Erreur: '+(e?.message||e)) });
  }
  // fonction de suppression de preset avec confirmation
  delete(p: Preset) {
    if (!confirm(`Supprimer le preset "${p.name}" ?`)) return;
    this.svc.delete(p.name).subscribe({
      next: () => this.load(),
      error: (e) => alert('Erreur lors de la suppression: ' + (e?.message || e))
    });
  }
}
