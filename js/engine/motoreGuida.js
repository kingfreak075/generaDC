/**
 * A6 - Motore di Guida
 * Funzione pura per guidare l'utente nella compilazione della DC.
 * 
 * @param {Object} record - Lo stato attuale del progetto DC (anagrafica, interventi, risposte, materiali, stato).
 * @param {Object} catalogo - Il catalogo completo (con anagrafica_schema, interventi, incompatibilita, ecc.).
 * @param {Object} outputA3 - Output del motore domande (domande_visibili con risposte).
 * @param {Object} outputA4 - Output del motore documentale (documenti_dc, documenti_interni).
 * @returns {Object} L'oggetto di guida con stato, bloccanti, avvisi, incoerenze, prossimo_passo, spiegazioni.
 */
function calcolaGuida(record, catalogo, outputA3, outputA4) {
  const guida = {
    stato: 'incompleto',
    bloccanti: [],
    avvisi: [],
    incoerenze: [],
    consigli: [],
    prossimo_passo: null,
    spiegazioni: {},
    riepilogo: {
      anagrafica_completa: true,
      interventi_scelti: record.interventi_scelti?.length || 0,
      risposte_obbligatorie_mancanti: 0,
      materiali_tracciati: record.materiali?.length || 0,
      materiali_mancanti: 0,
      documenti_dc: outputA4?.documenti_dc?.length || 0,
      documenti_interni: outputA4?.documenti_interni?.length || 0,
      bloccanti_totali: 0,
      avvisi_totali: 0
    }
  };

  // Mappe di supporto
  const interventiCatalogo = new Map(catalogo.interventi.map(i => [i.id, i]));
  const domandeCatalogo = new Map(catalogo.domande.map(d => [d.id, d]));
  const interventiSceltiIds = new Set((record.interventi_scelti || []).map(i => i.id));

  // ==========================================
  // FASE 1: COERENZA (Incoerenze)
  // ==========================================

  // R1: Incompatibilità tra interventi
  catalogo.incompatibilita?.forEach(inc => {
    if (interventiSceltiIds.has(inc.intervento_a) && interventiSceltiIds.has(inc.intervento_b)) {
      guida.incoerenze.push({
        tipo: 'incompatibilita',
        interventi_coinvolti: [inc.intervento_a, inc.intervento_b],
        messaggio: `Gli interventi "${inc.intervento_a}" e "${inc.intervento_b}" non possono coesistere.`,
        suggerimento: inc.suggerimento_alternativo || null,
        riferimento_normativo: inc.riferimento_normativo || null
      });
      guida.spiegazioni[`incoerenza:${inc.intervento_a}:${inc.intervento_b}`] = inc.motivo;
    }
  });

  // R2 e R3: Materiali orfani o duplicati
  const materialiKeys = new Set();
  (record.materiali || []).forEach((mat, index) => {
    if (!interventiSceltiIds.has(mat.intervento_id)) {
      guida.incoerenze.push({
        tipo: 'materiale_orfano',
        messaggio: `Il materiale "${mat.tipologia_componente} ${mat.serial_number || ''}" è associato a un intervento non selezionato.`,
        suggerimento: 'Rimuovi il materiale o seleziona l\'intervento corrispondente.',
        riferimento_normativo: null
      });
    }
    
    // Controllo duplicati (stesso seriale e part number per lo stesso intervento)
    const key = `${mat.intervento_id}-${mat.part_number}-${mat.serial_number}`;
    if (mat.serial_number && materialiKeys.has(key)) {
      guida.incoerenze.push({
        tipo: 'materiale_duplicato',
        messaggio: `Il materiale con seriale ${mat.serial_number} sembra inserito due volte.`,
        suggerimento: 'Controlla e rimuovi il duplicato.',
        riferimento_normativo: null
      });
    }
    if (mat.serial_number) materialiKeys.add(key);
  });

  // R4: Intervento richiede materiali ma non ne ha
  interventiSceltiIds.forEach(intId => {
    const intDef = interventiCatalogo.get(intId);
    if (intDef?.materiali_richiesti?.some(m => m.obbligatorio)) {
      const haMateriali = (record.materiali || []).some(m => m.intervento_id === intId);
      if (!haMateriali) {
        guida.incoerenze.push({
          tipo: 'intervento_senza_materiali',
          messaggio: `L'intervento "${intDef.descrizione}" richiede la tracciatura di componenti di sicurezza.`,
          suggerimento: 'Inserisci i dati del CdS nella sezione Materiali.',
          riferimento_normativo: null
        });
      }
    }
  });

  // R5: Documento derivato ma incompleto
  outputA4?.documenti_dc?.forEach(doc => {
    if (!doc.completo) {
      guida.bloccanti.push({
        sezione: 'documenti',
        campo: doc.id,
        messaggio: `Il documento "${doc.id}" non è completo. Mancano: ${doc.campi_mancanti?.join(', ')}.`,
        azione: 'Completa i dati del documento.',
        riferimento_normativo: null
      });
    }
  });

  // ==========================================
  // FASE 2: MANCANZE (Bloccanti)
  // ==========================================

  // R6: Anagrafica incompleta
  const targetStato = record.stato === 'bozza' ? 'bozza' : 'completa';
  catalogo.anagrafica_schema?.forEach(campo => {
    if (campo.obbligatorio_in.includes(targetStato)) {
      const val = record.anagrafica?.[campo.id];
      if (val === undefined || val === null || val === '') {
        guida.bloccanti.push({
          sezione: 'anagrafica',
          campo: campo.id,
          messaggio: `Manca il dato: ${campo.nome}.`,
          azione: 'Compila l\'anagrafica.',
          riferimento_normativo: null
        });
        guida.spiegazioni[`bloccante:anagrafica:${campo.id}`] = `Il campo "${campo.nome}" è obbligatorio per salvare la commessa in stato "${targetStato}".`;
      }
    }
  });

  // R7: Interventi mancanti
  if (interventiSceltiIds.size === 0) {
    guida.bloccanti.push({
      sezione: 'interventi',
      campo: 'lista',
      messaggio: 'Nessun intervento selezionato.',
      azione: 'Scegli almeno un intervento.',
      riferimento_normativo: null
    });
    guida.spiegazioni['bloccante:interventi:lista'] = 'Una DC deve dichiarare almeno un intervento eseguito.';
  }

  // R8: Risposte obbligatorie mancanti (da A3)
  outputA3?.domande_visibili?.forEach(dom => {
    const domDef = domandeCatalogo.get(dom.id);
    if (domDef?.obbligatoria && (dom.risposta === null || dom.risposta === undefined || dom.risposta === '')) {
      guida.bloccanti.push({
        sezione: 'risposte',
        campo: dom.id,
        messaggio: `Risposta mancante per: "${domDef.testo}".`,
        azione: 'Rispondi alla domanda.',
        riferimento_normativo: null
      });
      guida.spiegazioni[`bloccante:risposte:${dom.id}`] = `Questa domanda è obbligatoria perché serve a determinare la corretta derivazione dei documenti o a compilare i moduli.`;
    }
  });

  // R9 e R10: Materiali mancanti o campi materiali mancanti
  interventiSceltiIds.forEach(intId => {
    const intDef = interventiCatalogo.get(intId);
    intDef?.materiali_richiesti?.forEach(matReq => {
      if (matReq.obbligatorio) {
        // Semplificazione: verifichiamo se esiste almeno un materiale con la stessa tipologia
        const trovato = (record.materiali || []).some(m => 
          m.intervento_id === intId && m.tipologia_componente === matReq.descrizione
        );
        if (!trovato) {
          guida.bloccanti.push({
            sezione: 'materiali',
            campo: `${intId}-${matReq.descrizione}`,
            messaggio: `Manca la tracciatura per il CdS: "${matReq.descrizione}".`,
            azione: 'Inserisci i dati del componente.',
            riferimento_normativo: null
          });
          guida.spiegazioni[`bloccante:materiali:${intId}-${matReq.descrizione}`] = `L'intervento richiede la tracciatura di questo componente di sicurezza.`;
        }
      }
    });
  });

  (record.materiali || []).forEach((mat, index) => {
    const campiObbligatori = ['tipologia_componente', 'fornitore', 'serial_number', 'part_number', 'n_pezzi', 'produttore'];
    campiObbligatori.forEach(campo => {
      if (mat[campo] === undefined || mat[campo] === null || mat[campo] === '') {
        guida.bloccanti.push({
          sezione: 'materiali',
          campo: `${mat.intervento_id}-${campo}-${index}`,
          messaggio: `Manca il campo "${campo}" per il materiale "${mat.tipologia_componente || 'Sconosciuto'}".`,
          azione: 'Completa i dati del materiale.',
          riferimento_normativo: null
        });
      }
    });
  });

  // ==========================================
  // FASE 3: AVVISI E CONSIGLI
  // ==========================================

  // R11: Flag certificato (una volta per tipo)
  const certificatiAvvisati = new Set();
  interventiSceltiIds.forEach(intId => {
    const intDef = interventiCatalogo.get(intId);
    intDef?.materiali_richiesti?.forEach(matReq => {
      if (matReq.richiede_certificato && !certificatiAvvisati.has(matReq.descrizione)) {
        const haMateriale = (record.materiali || []).some(m => m.intervento_id === intId && m.tipologia_componente === matReq.descrizione);
        if (haMateriale) {
          guida.avvisi.push({
            sezione: 'materiali',
            campo: matReq.descrizione,
            messaggio: `Il CdS "${matReq.descrizione}" richiede un certificato.`,
            azione: 'Assicurati di conservare il certificato nel DMS aziendale.',
            tipo: 'certificato'
          });
          guida.spiegazioni[`avviso:certificato:${matReq.descrizione}`] = 'La normativa richiede che i componenti di sicurezza abbiano un certificato. L\'app non gestisce i file, ma ti ricorda di conservarli.';
          certificatiAvvisati.add(matReq.descrizione);
        }
      }
    });
  });

  // R13/R14: Consigli (dal catalogo e derivati)
  interventiSceltiIds.forEach(intId => {
    const intDef = interventiCatalogo.get(intId);
    if (intDef?.consigli) {
      intDef.consigli.forEach(c => {
        guida.consigli.push({ sezione: 'interventi', messaggio: c, azione: null, fonte: 'catalogo' });
      });
    }
  });

  // ==========================================
  // FASE 4: STATO E PROSSIMO PASSO
  // ==========================================

  guida.riepilogo.bloccanti_totali = guida.bloccanti.length;
  guida.riepilogo.avvisi_totali = guida.avvisi.length;

  if (guida.incoerenze.length > 0) {
    guida.stato = 'incoerente';
    guida.prossimo_passo = {
      sezione: 'riepilogo',
      azione: 'Risolvi le incoerenze',
      motivo: guida.incoerenze[0].messaggio,
      priorità: 1
    };
  } else if (guida.bloccanti.length > 0) {
    guida.stato = 'incompleto';
    // Scegliamo il primo bloccante in base all'ordine di importanza
    const prioritaSezioni = ['anagrafica', 'interventi', 'risposte', 'materiali', 'documenti'];
    let primoBloccante = null;
    for (const sez of prioritaSezioni) {
      primoBloccante = guida.bloccanti.find(b => b.sezione === sez);
      if (primoBloccante) break;
    }
    
    guida.prossimo_passo = {
      sezione: primoBloccante?.sezione || 'riepilogo',
      azione: primoBloccante?.azione || 'Completa i dati mancanti',
      motivo: primoBloccante?.messaggio || 'Ci sono dati incompleti.',
      priorità: 1
    };
  } else if (guida.avvisi.length > 0) {
    guida.stato = 'completo';
    guida.prossimo_passo = {
      sezione: 'riepilogo',
      azione: 'Rivedi gli avvisi',
      motivo: 'La DC è completa, ma ci sono avvisi da controllare prima dell\'emissione.',
      priorità: 1
    };
  } else {
    guida.stato = 'pronto_per_emissione';
    guida.prossimo_passo = {
      sezione: 'riepilogo',
      azione: 'Emetti la DC',
      motivo: 'Tutti i dati sono completi e coerenti. La DC è pronta per essere generata ed emessa.',
      priorità: 1
    };
  }

  // Controllo anagrafica completa per il riepilogo
  guida.riepilogo.anagrafica_completa = !guida.bloccanti.some(b => b.sezione === 'anagrafica');
  guida.riepilogo.risposte_obbligatorie_mancanti = guida.bloccanti.filter(b => b.sezione === 'risposte').length;

  return guida;
}

// Esportazione per l'uso in app.js (se usi moduli ES6)
// export { calcolaGuida };