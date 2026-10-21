/**
 * A3 - Motore Domande
 * Funzione pura che deriva il questionario dinamico in base agli interventi scelti.
 * 
 * @param {Object} record - Lo stato attuale del progetto DC (interventi, risposte).
 * @param {Object} catalogo - Il catalogo completo.
 * @returns {Object} { domande_visibili: [], domande_nascoste: [] }
 */
function calcolaDomande(record, catalogo) {
  const output = {
    domande_visibili: [],
    domande_nascoste: [],
    gruppi_attivi: new Set()
  };

  // Mappe di supporto
  const interventiSceltiIds = (record.interventi_scelti || []).map(i => i.id);
  const interventiCatalogo = new Map(catalogo.interventi.map(i => [i.id, i]));
  const domandeCatalogo = new Map(catalogo.domande.map(d => [d.id, d]));

  // 1. Raccogliamo tutte le domande richieste dagli interventi scelti
  const domandeRichiesteIds = new Set();
  interventiSceltiIds.forEach(intId => {
    const intDef = interventiCatalogo.get(intId);
    if (intDef && intDef.domande_richieste) {
      intDef.domande_richieste.forEach(domId => domandeRichiesteIds.add(domId));
    }
  });

  // 2. Funzione per valutare le condizioni di visibilità
  // (Stessa logica di A4, ma applicata alle domande)
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
        return valoreCorrente !== undefined && valoreCorrente !== null && valoreCorrente !== '';
      case 'uguale': return valoreCorrente === cond.valore;
      case 'diverso': return valoreCorrente !== cond.valore;
      case 'in': return Array.isArray(cond.valore) && cond.valore.includes(valoreCorrente);
      case 'maggiore': return Number(valoreCorrente) > Number(cond.valore);
      case 'minore': return Number(valoreCorrente) < Number(cond.valore);
      default: return false;
    }
  }

  // 3. Valutiamo ogni domanda richiesta
  domandeRichiesteIds.forEach(domId => {
    const domDef = domandeCatalogo.get(domId);
    if (!domDef) return; // Domanda non trovata nel catalogo

    const risposta = record.risposte?.[domId];
    const isVisibile = valutaCondizione(domDef.condizioni);

    const domandaElaborata = {
      id: domDef.id,
      testo: domDef.testo,
      tipo: domDef.tipo,
      opzioni: domDef.opzioni || null,
      gruppo: domDef.gruppo,
      obbligatoria: domDef.obbligatoria,
      risposta: risposta !== undefined ? risposta : null,
      condizioni_soddisfatte: isVisibile
    };

    if (isVisibile) {
      output.domande_visibili.push(domandaElaborata);
      if (domDef.gruppo) output.gruppi_attivi.add(domDef.gruppo);
    } else {
      output.domande_nascoste.push(domandaElaborata);
    }
  });

  // 4. Ordiniamo le domande visibili per gruppo (utile per l'UI)
  // Supponiamo che i gruppi abbiano un ordine o che l'ordine alfabetico vada bene
  output.domande_visibili.sort((a, b) => {
    if (a.gruppo === b.gruppo) return 0;
    return (a.gruppo || '').localeCompare(b.gruppo || '');
  });

  // Convertiamo il Set in Array per la serializzazione
  output.gruppi_attivi = Array.from(output.gruppi_attivi);

  return output;
}

// Esportazione per l'uso in app.js (se usi moduli ES6)
// export { calcolaDomande };