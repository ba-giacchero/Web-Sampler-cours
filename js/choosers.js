import { mkBtn, mkEl, placePopupNear, makeListRow } from './ui-helpers.js';
// fonction de choix des enregistrements existants
// elle permet de lister les enregistrements, de les assigner à un slot, ou de les supprimer
// elle est utilisée dans index.js lors du choix de la source d'un slot de sampler
export async function showRecordingsChooser(slotIndex, anchorEl, deps) {
  const { listRecordings, getRecording, deleteRecording, assignFileToSlot, decodeFileToBuffer } = deps;
  const existing = document.getElementById('recordingsChooser');
  if (existing) existing.remove();

  const container = mkEl('div', null, { position: 'absolute', zIndex: 9999, padding: '8px', maxHeight: '220px', overflow: 'auto' });
  container.id = 'recordingsChooser';

  const res = placePopupNear(anchorEl, container, { side: 'right', margin: 6 });

  const title = mkEl('div', null, { fontWeight: '600', marginBottom: '6px' });
  title.textContent = 'Choisir une source';
  container.appendChild(title);

  const btnRow = mkEl('div', null, { display: 'flex', gap: '6px', marginBottom: '8px' });
  const localBtn = mkBtn('action-btn');
  localBtn.textContent = 'Fichier local…';
  localBtn.onclick = () => { /* caller should handle pickFileForSlot */ };
  btnRow.appendChild(localBtn);
  const savedBtn = mkBtn('action-btn');
  savedBtn.textContent = 'Enregistrements…';
  btnRow.appendChild(savedBtn);
  container.appendChild(btnRow);

  const list = mkEl('div', null, { display: 'block', fontSize: '13px', minWidth: '220px' });
  container.appendChild(list);

  async function populateRecordings() {
    list.innerHTML = '';
    try {
      const recs = await listRecordings();
      if (!recs || recs.length === 0) {
        const p = mkEl('div', null, { color: '#666' });
        p.textContent = 'Aucun enregistrement trouvé.';
        list.appendChild(p);
        return;
      }
      recs.sort((a,b) => b.created - a.created);
      recs.forEach(r => {
        const actions = [
          { text: 'Use', classNames: 'action-btn', onClick: async (e) => {
            try {
              const ent = await getRecording(r.id);
              if (!ent || !ent.blob) { alert('Impossible de récupérer l’enregistrement.'); return; }
              const file = new File([ent.blob], ent.name || `rec-${r.id}`, { type: ent.type || 'audio/webm' });
              try {
                const buf = await decodeFileToBuffer(file);
                assignFileToSlot ? assignFileToSlot(file, slotIndex) : null;
                container.remove();
                if (res && res.detach) res.detach();
              } catch (err) {
                // fallback: still call assignFileToSlot
                if (assignFileToSlot) await assignFileToSlot(file, slotIndex);
                container.remove();
                if (res && res.detach) res.detach();
              }
            } catch (err) { console.error('assign from recording error', err); }
          }},
          { text: 'Delete', classNames: 'action-btn', style: { marginLeft: '6px' }, onClick: async () => {
            try {
              if (!confirm(`Supprimer ${r.name || r.id} ?`)) return;
              await deleteRecording(r.id);
              const node = list.querySelector(`[data-rec='${r.id}']`);
              if (node) node.remove();
            } catch (err) { console.error('delete rec error', err); }
          } }
        ];
        const row = makeListRow(r.name || `rec-${r.id}`, actions, { title: new Date(r.created).toLocaleString() });
        row.dataset.rec = String(r.id);
        list.appendChild(row);
      });
    } catch (err) {
      const p = mkEl('div', null, { color: 'red' });
      p.textContent = 'Erreur en accédant aux enregistrements.';
      list.appendChild(p);
      console.error('showRecordingsChooser error', err);
    }
  }

  savedBtn.onclick = () => populateRecordings();

  // expose a simple hook for the caller to wire local file button behaviour
  return { container, res, wireLocal: (fn) => { localBtn.onclick = () => { fn(); container.remove(); if (res && res.detach) res.detach(); }; } };
}

// fonction de choix des sons locaux (enregistrements)
// elle permet de lister les sons locaux, d'en sélectionner jusqu'à 16, et de les retourner décodés via onCreate
// elle est utilisée dans index.js lors de la création d'un nouveau preset de sampler
export async function showLocalSoundsChooser(anchorEl, onCreate, deps, onSelect, opts = {}) {
  const { listRecordings, getRecording, decodeFileToBuffer, decodedItems = [] } = deps || {};
  const existing = document.getElementById('localSoundsChooser');
  if (existing) { existing.remove(); return; }

  let recs = [];
  try { recs = await listRecordings(); } catch (err) { console.warn('Unable to list recordings', err); }

  const recordingItems = (recs || []).map(r => ({ id: `rec-${r.id}`, source: 'recording', buffer: null, blob: r.blob, name: r.name || `rec-${r.id}`, recId: r.id }));
  const items = [...(decodedItems || []), ...recordingItems];
  // include decoded items, items with blob, and recordings (even if blob not yet fetched)
  const available = items.filter(it => it.buffer || it.blob || it.source === 'recording');
  if (!available || available.length === 0) { alert('Aucun son local disponible.'); return; }

  const container = mkEl('div', null, { position: 'absolute', zIndex: '10000', padding: '10px' });
  container.id = 'localSoundsChooser';
  const res = placePopupNear(anchorEl, container, { side: 'below', margin: 8 });

  const title = mkEl('div', null, { fontWeight: '700', marginBottom: '8px' });
  title.textContent = 'Choisir jusqu’à 16 sons locaux';
  container.appendChild(title);

  const list = mkEl('div', null, { maxHeight: '320px', overflow: 'auto', marginBottom: '8px' });
  container.appendChild(list);

  // optional checkbox/select mode and per-item load button
  let selectedCount = 0;
  const checkboxes = [];
  const showCheckboxes = opts.showCheckboxes !== false;

  // Note: this basic implementation expects caller to populate decodedItems or pass them differently.
  available.forEach((it) => {
    const row = mkEl('div', null, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' });
    const left = mkEl('div', null, { display: 'flex', alignItems: 'center' });

    let cb = null;
    if (showCheckboxes) {
      cb = mkEl('input'); cb.type = 'checkbox'; cb.style.marginRight = '8px'; cb.dataset.itemId = it.id; checkboxes.push(cb);
      left.appendChild(cb);
    }

    const label = mkEl('div', null, { flex: '1' }); label.textContent = it.name; left.appendChild(label);
    row.appendChild(left);

    // optionally show a per-item "Charger" button; callers can hide it via opts.showLoadButton = false
    if (opts.showLoadButton !== false) {
      const play = mkBtn('action-btn'); play.textContent = 'Charger'; play.style.marginLeft = '8px';
      play.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          let buffer = it.buffer;
          // if we don't have a buffer yet, try to obtain a blob: either from it.blob or via getRecording
          if (!buffer) {
            let blob = it.blob;
            if (!blob && it.recId && typeof getRecording === 'function') {
              try {
                const ent = await getRecording(it.recId);
                if (ent && ent.blob) blob = ent.blob;
              } catch (err) { console.warn('getRecording failed', err); }
            }
            if (blob) {
              const file = new File([blob], it.name || 'rec.webm', { type: blob.type });
              buffer = await decodeFileToBuffer(file);
              it.buffer = buffer;
            }
          }
          // Do not auto-play here. Treat this button as "Charger" (load into top preview).
          if (buffer && typeof onSelect === 'function') {
            try { onSelect([{ buffer, name: it.name, index: it.index }]); } catch (err) { console.error('onSelect callback error', err); }
            container.remove(); if (res && res.detach) res.detach();
          }
        } catch (err) { console.error('charger action error', err); }
      });
      row.appendChild(play);
    }

    list.appendChild(row);

    if (showCheckboxes && cb) {
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (selectedCount >= 16) { cb.checked = false; alert('Limite 16 sons'); return; }
          selectedCount++;
        } else { selectedCount = Math.max(0, selectedCount - 1); }
      });
    }
  });

  const actions = mkEl('div', null, { display: 'flex', gap: '8px' });
  // only show the create button when in selection mode
  if (opts.showCreateButton !== false) {
    const createBtn = mkBtn('action-btn'); createBtn.textContent = 'Créer le sampler';
    createBtn.addEventListener('click', async () => {
      const selected = [];
      for (const cb of checkboxes) if (cb.checked) {
        const id = cb.dataset.itemId; const it = available.find(x => x.id === id); if (!it) continue;
        if (!it.buffer && it.blob) { try { const file = new File([it.blob], it.name || 'rec.webm', { type: it.blob.type }); it.buffer = await decodeFileToBuffer(file); } catch (err) { console.error('decode for create error', err); } }
        selected.push({ buffer: it.buffer, name: it.name, index: it.index });
      }
      if (selected.length === 0) { alert('Sélectionne au moins un son'); return; }
      onCreate(selected);
      container.remove(); if (res && res.detach) res.detach();
    });
    actions.appendChild(createBtn);
  }

  const cancelBtn = mkBtn('action-btn'); cancelBtn.textContent = 'Annuler'; cancelBtn.addEventListener('click', () => { container.remove(); if (res && res.detach) res.detach(); });
  actions.appendChild(cancelBtn); container.appendChild(actions);

  return { container, res };
}
