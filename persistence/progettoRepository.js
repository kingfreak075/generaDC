/**
 * A2 - Repository dei Progetti (Persistenza Locale)
 * Gestisce la lettura/scrittura dei file .json su una cartella scelta dall'utente.
 * Richiede File System Access API (Chrome/Edge).
 */

class ProgettoRepository {
  constructor() {
    this.dirHandle = null;
    this.DB_NAME = 'DC_App_DB';
    this.STORE_NAME = 'directory_handles';
  }

  // ==========================================
  // GESTIONE DELLA CARTELLA (IndexedDB per persistenza)
  // ==========================================

  async _getDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async salvaHandleCartella(handle) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.put(handle, 'current_dir');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async caricaHandleCartella() {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.get('current_dir');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async scegliCartella() {
    if (!window.showDirectoryPicker) {
      throw new Error("Il tuo browser non supporta la File System Access API. Usa Chrome o Edge.");
    }
    try {
      this.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await this.salvaHandleCartella(this.dirHandle);
      return this.dirHandle.name;
    } catch (err) {
      if (err.name === 'AbortError') return null; // L'utente ha annullato
      throw err;
    }
  }

  async ripristinaCartella() {
    const handle = await this.caricaHandleCartella();
    if (!handle) return null;

    // Verifica i permessi
    const options = { mode: 'readwrite' };
    if (await handle.queryPermission(options) === 'granted') {
      this.dirHandle = handle;
      return handle.name;
    }
    
    // Se i permessi non sono granted, chiediamo (richiede un gesto utente)
    if (await handle.requestPermission(options) === 'granted') {
      this.dirHandle = handle;
      return handle.name;
    }
    
    return null; // Permessi negati
  }

  // ==========================================
  // SALVATAGGIO E CARICAMENTO
  // ==========================================

  /**
   * Genera il nome file base: <uuid>_<commessa>_<data>
   */
  _generaNomeBase(record) {
    const uuid = record.uuid || crypto.randomUUID();
    const commessa = record.commessa || 'NONSPEC';
    const data = new Date().toISOString().split('T')[0];
    return `${uuid}_${commessa}_${data}`;
  }

  /**
   * Trova il prossimo numero di versione per un dato nome base.
   */
  async _trovaProssimaVersione(nomeBase) {
    let maxV = 0;
    for await (const entry of this.dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.startsWith(nomeBase + '_v')) {
        const match = entry.name.match(/_v(\d+)\.json$/);
        if (match) {
          const v = parseInt(match[1], 10);
          if (v > maxV) maxV = v;
        }
      }
    }
    return maxV + 1;
  }

  /**
   * Salva un record come nuova versione.
   * @param {Object} record - Il record da salvare.
   * @param {number} lastModifiedCheck - Timestamp opzionale per il controllo di concorrenza.
   * @returns {Object} { nomeFile, versione, timestamp }
   */
  async salvaRecord(record, lastModifiedCheck = null) {
    if (!this.dirHandle) throw new Error("Nessuna cartella selezionata.");

    // Controllo di concorrenza (se stiamo aggiornando un file esistente)
    if (record._meta && record._meta.nomeFile && lastModifiedCheck !== null) {
      try {
        const fileHandle = await this.dirHandle.getFileHandle(record._meta.nomeFile);
        const file = await fileHandle.getFile();
        if (file.lastModified > lastModifiedCheck) {
          // Il file è cambiato su disco!
          return { 
            success: false, 
            motivo: 'concorrenza', 
            messaggio: 'Il file è stato modificato da un altro utente. Salvalo come nuova versione?' 
          };
        }
      } catch (e) {
        // Il file non esiste più, procediamo con il salvataggio
      }
    }

    const nomeBase = record._meta?.nomeBase || this._generaNomeBase(record);
    const prossimaVersione = await this._trovaProssimaVersione(nomeBase);
    const nomeFile = `${nomeBase}_v${prossimaVersione}.json`;

    // Aggiorna i metadati interni al record
    record.uuid = record.uuid || crypto.randomUUID();
    record._meta = {
      ...record._meta,
      nomeBase: nomeBase,
      nomeFile: nomeFile,
      versione: prossimaVersione,
      dataSalvataggio: new Date().toISOString()
    };

    // Scrivi il file
    const fileHandle = await this.dirHandle.getFileHandle(nomeFile, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(record, null, 2));
    await writable.close();

    // Aggiorna l'indice
    await this._aggiornaIndice(record);

    return { success: true, nomeFile, versione: prossimaVersione };
  }

  /**
   * Carica un record dato il suo nome file.
   */
  async caricaRecord(nomeFile) {
    if (!this.dirHandle) throw new Error("Nessuna cartella selezionata.");
    try {
      const fileHandle = await this.dirHandle.getFileHandle(nomeFile);
      const file = await fileHandle.getFile();
      const testo = await file.text();
      const record = JSON.parse(testo);
      
      // Aggiungiamo il lastModified per il controllo futuro
      record._meta = record._meta || {};
      record._meta.lastModified = file.lastModified;
      
      return record;
    } catch (e) {
      console.error("Errore caricamento file:", e);
      return null;
    }
  }

  // ==========================================
  // INDICE E VISTA ELENCO
  // ==========================================

  async _aggiornaIndice(record) {
    let indice = [];
    try {
      const fileHandle = await this.dirHandle.getFileHandle('_index.json');
      const file = await fileHandle.getFile();
      indice = JSON.parse(await file.text());
    } catch (e) {
      // L'indice non esiste, lo creiamo
      indice = [];
    }

    // Rimuoviamo eventuali voci precedenti per lo stesso uuid
    indice = indice.filter(item => item.uuid !== record.uuid);
    
    // Aggiungiamo i metadati del record appena salvato
    indice.push({
      uuid: record.uuid,
      commessa: record.commessa,
      cliente: record.anagrafica?.cliente || '',
      data: record._meta.dataSalvataggio,
      versione: record._meta.versione,
      nomeFile: record._meta.nomeFile,
      stato: record.stato
    });

    const fileHandle = await this.dirHandle.getFileHandle('_index.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(indice, null, 2));
    await writable.close();
  }

  /**
   * Restituisce l'elenco dei progetti leggendo l'indice.
   * (Se l'indice non esiste, fa un fallback scansionando i file).
   */
  async elencaProgetti() {
    if (!this.dirHandle) throw new Error("Nessuna cartella selezionata.");
    try {
      const fileHandle = await this.dirHandle.getFileHandle('_index.json');
      const file = await fileHandle.getFile();
      const indice = JSON.parse(await file.text());
      // Ordiniamo per data discendente
      return indice.sort((a, b) => new Date(b.data) - new Date(a.data));
    } catch (e) {
      // Fallback: scansiona tutti i file .json (tranne _index.json)
      const progetti = [];
      for await (const entry of this.dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.json') && entry.name !== '_index.json') {
          try {
            const file = await entry.getFile();
            const record = JSON.parse(await file.text());
            progetti.push({
              uuid: record.uuid,
              commessa: record.commessa,
              cliente: record.anagrafica?.cliente || '',
              data: file.lastModified,
              versione: record._meta?.versione || 1,
              nomeFile: entry.name,
              stato: record.stato
            });
          } catch (err) { /* ignora file corrotti */ }
        }
      }
      return progetti.sort((a, b) => b.data - a.data);
    }
  }

  // ==========================================
  // ARCHIVIAZIONE
  // ==========================================

  async archiviaRecord(nomeFile) {
    if (!this.dirHandle) throw new Error("Nessuna cartella selezionata.");
    try {
      // Crea la cartella _archivio se non esiste
      const archivioHandle = await this.dirHandle.getDirectoryHandle('_archivio', { create: true });
      
      // Prendi il file originale
      const fileHandle = await this.dirHandle.getFileHandle(nomeFile);
      const file = await fileHandle.getFile();
      const testo = await file.text();
      
      // Scrivi nell'archivio
      const nuovoFileHandle = await archivioHandle.getFileHandle(nomeFile, { create: true });
      const writable = await nuovoFileHandle.createWritable();
      await writable.write(testo);
      await writable.close();
      
      // Rimuovi l'originale
      await this.dirHandle.removeEntry(nomeFile);
      
      // Aggiorna l'indice rimuovendolo (o segnandolo come archiviato)
      // Per semplicità, lo rimuoviamo dall'indice attivo.
      await this._rimuoviDaIndice(nomeFile);
      
      return true;
    } catch (e) {
      console.error("Errore archiviazione:", e);
      return false;
    }
  }

  async _rimuoviDaIndice(nomeFile) {
    try {
      const fileHandle = await this.dirHandle.getFileHandle('_index.json');
      const file = await fileHandle.getFile();
      let indice = JSON.parse(await file.text());
      indice = indice.filter(item => item.nomeFile !== nomeFile);
      
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(indice, null, 2));
      await writable.close();
    } catch (e) { /* ignore */ }
  }
}

// Esportazione
// export { ProgettoRepository };