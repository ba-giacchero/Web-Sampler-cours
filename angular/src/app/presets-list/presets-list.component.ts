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

  load() {
    this.loading = true; this.error = null;
    this.svc.list().subscribe({
      next: (res) => { this.presets = res || []; this.loading = false; },
      error: (err) => { this.error = String(err?.message || err); this.loading = false; }
    });
  }

  async rename(p: Preset) {
    const n = prompt('Nouveau nom pour le preset', p.name);
    if (!n || n.trim() === '' || n === p.name) return;
    this.svc.rename(p.name, n).subscribe({ next: () => this.load(), error: (e) => alert('Erreur: '+(e?.message||e)) });
  }
}
