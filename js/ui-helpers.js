// Utilitaires pour créer des éléments DOM et gérer les popups

// Crée un bouton avec des classes CSS optionnelles
export function mkBtn(...classes) {
  const b = document.createElement('button');
  b.type = 'button';
  if (classes && classes.length) b.className = classes.join(' ');
  return b;
}

// Crée un div avec des styles optionnels
export function mkDiv(styleObj) {
  const d = document.createElement('div');
  if (styleObj) Object.assign(d.style, styleObj);
  return d;
}

// Crée un élément HTML avec tag, classes et styles optionnels
export function mkEl(tag, classNames, styleObj) {
  const e = document.createElement(tag);
  if (classNames) e.className = classNames;
  if (styleObj) Object.assign(e.style, styleObj);
  return e;
}

// Attache un listener pour détecter les clics en dehors d'un élément
// Retourne une fonction de nettoyage pour détacher le listener
export function attachOutsideClick(el, onOutside) {
  const handler = (ev) => { if (!el.contains(ev.target)) onOutside(ev); };
  const id = setTimeout(() => document.addEventListener('click', handler), 10);
  return () => { clearTimeout(id); document.removeEventListener('click', handler); };
}

// Positionne un popup près d'un élément ancre (à droite, à gauche ou en dessous)
// Ajuste automatiquement la position si le popup dépasse de la fenêtre
export function placePopupNear(anchorEl, popupEl, opts = {}) {
  const side = opts.side || 'below';
  const margin = typeof opts.margin === 'number' ? opts.margin : 6;
  document.body.appendChild(popupEl);
  // Calcule la position initiale selon le côté demandé
  const rect = anchorEl.getBoundingClientRect();
  let left, top;
  if (side === 'right') {
    left = rect.right + window.scrollX + margin;
    top = rect.top + window.scrollY;
  } else if (side === 'left') {
    left = rect.left + window.scrollX - margin;
    top = rect.top + window.scrollY;
  } else {
    left = Math.max(margin, rect.left + window.scrollX);
    top = rect.bottom + window.scrollY + margin;
  }
  popupEl.style.left = `${left}px`;
  popupEl.style.top = `${top}px`;
  // Ajuste la position si le popup dépasse de la fenêtre
  requestAnimationFrame(() => {
    const cRect = popupEl.getBoundingClientRect();
    const winW = window.innerWidth; const winH = window.innerHeight;
    let newLeft = null; let newTop = null;
    if (cRect.right > winW) {
      if (side === 'right') newLeft = Math.max(margin, rect.left + window.scrollX - cRect.width - margin);
      else newLeft = Math.max(margin, Math.min(rect.left + window.scrollX, winW - cRect.width - margin));
    }
    if (cRect.bottom > winH) newTop = Math.max(margin, rect.top + window.scrollY - cRect.height - margin);
    if (newLeft !== null) popupEl.style.left = `${newLeft}px`;
    if (newTop !== null) popupEl.style.top = `${newTop}px`;
  });
  // Attache le listener pour fermer le popup si clic en dehors
  const detach = attachOutsideClick(popupEl, () => { popupEl.remove(); });
  return { popup: popupEl, detach };
}

// Crée une ligne de liste avec un label et des boutons d'action
export function makeListRow(labelText, actions = [], opts = {}) {
  const row = mkEl('div', null, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' });
  const label = mkEl('div', null, { flex: '1', marginRight: '8px' });
  label.textContent = labelText;
  if (opts && opts.title) label.title = opts.title;
  row.appendChild(label);
  // Crée les boutons d'action
  const actionsWrap = mkEl('div');
  actions.forEach(a => {
    const btn = mkBtn(a.classNames || 'action-btn');
    btn.type = 'button';
    btn.textContent = a.text;
    if (a.style) Object.assign(btn.style, a.style);
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (typeof a.onClick === 'function') a.onClick(e); });
    actionsWrap.appendChild(btn);
  });
  row.appendChild(actionsWrap);
  return row;
}
