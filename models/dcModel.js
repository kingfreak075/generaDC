// js/models/dcModel.js

class DCModel {
    constructor() {
        this.id = null;
        this.data = null;
        this.stato = 'bozza';
        this.livello = 'guidato';
        
        this.anagrafica = {
            impianto: {
                codice_esa: '',
                matricola: '',
                fabbrica: '',
                cliente: '',
                proprietario: '',
                amministratore: '',
                indirizzo: '',
                tipo: '',
                portata: null,
                fermate: null,
                anno: null
            },
            tecnici: {
                responsabile: '',
                supervisore: '',
                commerciale: ''
            },
            date: {
                inizio_lavori: '',
                fine_lavori: '',
                verbale: ''
            }
        };

        this.interventi = [];
        this.risposte = {};
        this.documenti = {
            generati: [],
            moduli: [],
            allegati: []
        };
        this.normative = [];
        this.tracciabilita = [];
        this.storico = [];
    }

    /**
     * Carica i dati da un oggetto JSON
     */
    caricaDaJSON(data) {
        Object.assign(this, data);
        return this;
    }

    /**
     * Converte il modello in JSON
     */
    toJSON() {
        return {
            id: this.id,
            data: this.data,
            stato: this.stato,
            livello: this.livello,
            anagrafica: this.anagrafica,
            interventi: this.interventi,
            risposte: this.risposte,
            documenti: this.documenti,
            normative: this.normative,
            tracciabilita: this.tracciabilita,
            storico: this.storico
        };
    }

    /**
     * Aggiunge un intervento alla commessa
     */
    aggiungiIntervento(intervento) {
        if (!this.interventi.find(i => i.id === intervento.id)) {
            this.interventi.push({
                id: intervento.id,
                descrizione: intervento.descrizione,
                verbo: intervento.verbo,
                oggetto: intervento.oggetto,
                gruppo: intervento.gruppo,
                moduli: intervento.moduli || [],
                moduli_condizionali: intervento.moduli_condizionali || [],
                tracciabilita: intervento.tracciabilita || '',
                normativa: intervento.normativa || '',
                domande_template: intervento.domande_template || ''
            });
        }
        return this;
    }

    /**
     * Rimuove un intervento dalla commessa
     */
    rimuoviIntervento(id) {
        this.interventi = this.interventi.filter(i => i.id !== id);
        return this;
    }

    /**
     * Aggiorna una risposta al questionario
     */
    setRisposta(id, valore) {
        this.risposte[id] = valore;
        return this;
    }

    /**
     * Ottiene una risposta
     */
    getRisposta(id) {
        return this.risposte[id];
    }

    /**
     * Calcola i documenti da generare in base agli interventi
     */
    calcolaDocumenti(ruleEngine) {
        const tuttiDocumenti = [];
        const tuttiModuli = [];
        const tuttaTracciabilita = [];
        const tutteNormative = [];

        this.interventi.forEach(intervento => {
            // Usa il rule engine per determinare i documenti
            // (dovrai passare le risposte del questionario)
            const result = ruleEngine.generaSetDocumenti(
                intervento,
                this.risposte
            );

            result.documenti.forEach(doc => {
                if (!tuttiDocumenti.includes(doc)) {
                    tuttiDocumenti.push(doc);
                }
            });

            result.moduli.forEach(mod => {
                if (!tuttiModuli.find(m => m.codice === mod.codice)) {
                    tuttiModuli.push(mod);
                }
            });

            result.tracciabilita.forEach(c => {
                if (!tuttaTracciabilita.includes(c)) {
                    tuttaTracciabilita.push(c);
                }
            });

            if (intervento.normativa && !tutteNormative.includes(intervento.normativa)) {
                tutteNormative.push(intervento.normativa);
            }
        });

        this.documenti.generati = tuttiDocumenti;
        this.documenti.moduli = tuttiModuli;
        this.tracciabilita = tuttaTracciabilita;
        this.normative = tutteNormative;

        return this.documenti;
    }

    /**
     * Salva la commessa in un file JSON
     */
    salva() {
        const json = this.toJSON();
        const blob = new Blob([JSON.stringify(json, null, 2)], {
            type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.id || 'nuova_commessa'}_${this.data || new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        return this;
    }

    /**
     * Carica una commessa da un file JSON
     */
    static caricaDaFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    const model = new DCModel();
                    model.caricaDaJSON(data);
                    resolve(model);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }
}

export default DCModel;