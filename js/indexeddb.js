// indexeddb.js
// Module de stockage persistant : sauvegarde les enregistrements audio dans IndexedDB

// Configuration de la base de données
const DB_NAME = 'websampler-db';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

// Ouvre la base de données IndexedDB, crée le store s'il n'existe pas
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Sauvegarde un enregistrement audio (blob) avec métadonnées (nom, date, taille)
async function saveRecording(blob, name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    // Crée un objet enregistrement avec blob, nom, timestamp et taille
    const entry = { name: name || `recording-${Date.now()}`, blob, created: Date.now(), size: blob.size, type: blob.type };
    const req = store.add(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Récupère la liste de tous les enregistrements sauvegardés
async function listRecordings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Récupère un enregistrement spécifique par son ID
async function getRecording(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Supprime un enregistrement par son ID
async function deleteRecording(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Exporte les fonctions d'accès au stockage persistant
export { saveRecording, listRecordings, getRecording, deleteRecording };
