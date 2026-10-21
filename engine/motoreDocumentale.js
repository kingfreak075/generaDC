/**
 * A4 - Motore Documentale
 * Funzione pura che deriva i documenti richiesti dalla commessa.
 * 
 * @param {Object} record - Lo stato attuale del progetto DC.
 * @param {Object} catalogo - Il catalogo completo.
 * @returns {Object} { documenti_dc: [], documenti_interni: [] }
 */
function calcolaDocumenti(record, catalogo) {
  const output = {
    documenti_dc: [],
    documenti_interni: [],
    spiegazioni: {}
  };

  // Mappe di supporto
  const interventiSceltiIds = (record.interventi_scelti || []).map(i => i.id);
  const interventiCatalogo = new Map(catalogo.interventi.map(i => [i.id, i]));

  // Funzione helper per valutare le condizioni dichiarative
  // Supporta operatori base: uguale, diverso, esiste, in, maggiore, minore, e and/or
  function valutaCondizione(cond) {
    if (!cond) return true;
    if (cond.operatore === 'and') return cond.condizioni.every(c => valutaCondizione(c));
    if (cond.operatore === 'or') return cond.condizioni.some(c => valutaCondizione(c));
    if (cond.operatore === 'not') return !valutaCondizione(cond.condizioni[0]);

    // Risoluzione del campo: prima nell'anagrafica, poi nelle risposte
    let valoreCorrente = record.anagrafica?.[cond.campo];
    if (valoreCorrente === undefined) {
      valoreCorrente = record.risposte?.[cond.campo];
    }

    switch (cond.operatore) {
      case 'esiste':
        if (cond.campo === 'materiali_tracciati') return (record.materiali || []).length > 0;
        if (cond.campo === 'interventi_scelti') return interventiSceltiIds.length > 0;
        return valoreCorrente !== undefined && valoreCorrente !== null && valoreCorrente !== '';
      case 'uguale': return valoreCorrente === cond.valore;
      case 'diverso': return valoreCorrente !== cond.valore;
      case 'in': return Array.isArray(cond.valore) && cond.valore.includes(valoreCorrente);
      case 'maggiore': return Number(valoreCorrente) > Number(cond.valore);
      case 'minore': return Number(valoreCorrente) < Number(cond.valore);
      default: return false;
    }
  }

  // 1. DERIVAZIONE DEI MODULI (documenti legati agli interventi)
  const moduliRichiesti = new Set();
  interventiSceltiIds.forEach(intId => {
    const intDef = interventiCatalogo.get(intId);
    if (!intDef) return;

    // Moduli obbligatori
    (intDef.moduli_obbligatori || []).forEach(modId => moduliRichiesti.add(modId));

    // Moduli condizionali
    (intDef.moduli_condizionali || []).forEach(condMod => {
      if (valutaCondizione(condMod.condizioni)) {
        moduliRichiesti.add(condMod.modulo_id);
      }
    });
  });

  // 2. DERIVAZIONE DEI DOCUMENTI DI COMMESSA (documenti legati agli attributi)
  const documentiCommessaRichiesti = new Set();
  (catalogo.documenti_commessa || []).forEach(docDef => {
    if (valutaCondizione(docDef.condizioni_derivazione)) {
      documentiCommessaRichiesti.add(docDef.id);
    }
  });

  // 3. COSTRUZIONE DELL'OUTPUT
  // Uniamo moduli e documenti di commessa per la verifica
  const tuttiIDocumentiRichiesti = new Set([...moduliRichiesti, ...documentiCommessaRichiesti]);

  // Mappiamo le definizioni per un rapido accesso
  const definizioniModuli = new Map((catalogo.moduli || []).map(m => [m.id, m]));
  const definizioniDocumenti = new Map((catalogo.documenti_commessa || []).map(d => [d.id, d]));

  tuttiIDocumentiRichiesti.forEach(docId => {
    const defModulo = definizioniModuli.get(docId);
    const defDocumento = definizioniDocumenti.get(docId);
    const definizione = defModulo || defDocumento;

    if (!definizione) return; // Documento non trovato nel catalogo

    // Determiniamo se è interno (es. Tracciabilità CdS) o della DC
    const isInterno = definizione.interno === true || definizione.incluso_nel_pacchetto_dc === false;
    const targetList = isInterno ? output.documenti_interni : output.documenti_dc;

    // Prepariamo i dati di compilazione
    const datiCompilazione = {
      anagrafica: record.anagrafica || {},
      tecnici: record.tecnici || {},
      commessa: { codice: record.commessa }
    };
    let completo = true;
    let campiMancanti = [];

    // Logica specifica per la Tracciabilità CdS (se derivata)
    if (docId === 'MOD_TRACCIABILITA_CDS') {
      datiCompilazione.righe = (record.materiali || []).map(m => ({
        tipologia_componente: m.tipologia_componente,
        fornitore: m.fornitore,
        serial_number: m.serial_number,
        part_number: m.part_number,
        n_pezzi: m.n_pezzi,
        produttore: m.produttore
      }));

      // Verifichiamo se i materiali inseriti hanno tutti i campi
      (record.materiali || []).forEach((m, idx) => {
        const campiObbligatori = ['tipologia_componente', 'fornitore', 'serial_number', 'part_number', 'n_pezzi', 'produttore'];
        campiObbligatori.forEach(campo => {
          if (!m[campo]) {
            completo = false;
            campiMancanti.push(`Riga ${idx + 1}: manca ${campo}`);
          }
        });
      });
    }

    // Aggiungiamo il documento all'output
    targetList.push({
      id: docId,
      nome: definizione.nome || docId,
      derivato: true,
      completo: completo,
      campi_mancanti: campiMancanti,
      dati_compilazione: datiCompilazione,
      template: definizione.template_riferimento,
      firme_richieste: definizione.firme_richieste || []
    });

    // Spiegazione per A6
    output.spiegazioni[docId] = `Questo documento è richiesto perché ${isInterno ? 'è un registro interno necessario' : 'deriva dalle regole del catalogo'} per gli interventi selezionati o per gli attributi della commessa.`;
  });

  // Ordinamento dei documenti della DC (se specificato nel catalogo)
  output.documenti_dc.sort((a, b) => {
    const ordineA = definizioniDocumenti.get(a.id)?.ordine || definizioniModuli.get(a.id)?.ordine || 99;
    const ordineB = definizioniDocumenti.get(b.id)?.ordine || definizioniModuli.get(b.id)?.ordine || 99;
    return ordineA - ordineB;
  });

  return output;
}

// Esportazione per l'uso in app.js (se usi moduli ES6)
// export { calcolaDocumenti };