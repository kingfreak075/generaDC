// js/engine/ruleEngine.js

class RuleEngine {
    constructor(catalogo) {
        this.catalogo = catalogo;
        this.documentiGenerati = [];
        this.documentiCondizionali = [];
    }

    /**
     * Determina i documenti da generare per un intervento
     */
    determinaDocumenti(intervento) {
        const result = {
            obbligatori: [],
            condizionali: [],
            moduli: [],
            tracciabilita: []
        };

        // 1. Documenti obbligatori (sempre presenti)
        result.obbligatori = this.catalogo.documenti_obbligatori || [];

        // 2. Moduli associati all'intervento
        if (intervento.moduli && intervento.moduli.length > 0) {
            result.moduli = intervento.moduli.map(mod => ({
                codice: mod,
                nome: this.catalogo.moduli[mod]?.nome || mod,
                template: this.catalogo.moduli[mod]?.template || `${mod}.docx`
            }));
        }

        // 3. Documenti condizionali (dipendono dal questionario)
        if (intervento.moduli_condizionali && intervento.moduli_condizionali.length > 0) {
            result.condizionali = intervento.moduli_condizionali.map(flag => ({
                flag: flag,
                documento: this.catalogo.mapping_moduli_condizionali[flag] || flag,
                condizioni: this.getCondizioniPerFlag(flag)
            }));
        }

        // 4. Tracciabilità componenti di sicurezza
        if (intervento.tracciabilita) {
            result.tracciabilita = intervento.tracciabilita.split(',').map(c => c.trim());
        }

        return result;
    }

    /**
     * Ottiene le condizioni per un flag condizionale
     */
    getCondizioniPerFlag(flag) {
        // Mappa flag → domande da fare
        const condizioni = {
            'DRF': [
                { domanda: 'ha_sostituito_freno', valore_atteso: 'si' }
            ],
            'DFPT': [
                { domanda: 'ha_sostituito_tubo', valore_atteso: 'si' },
                { domanda: 'ha_sostituito_puleggia', valore_atteso: 'si' }
            ],
            'DQM': [
                { domanda: 'ha_sostituito_quadro', valore_atteso: 'si' }
            ],
            'DCR': [
                { domanda: 'ha_sostituito_ricambi', valore_atteso: 'si' }
            ],
            'DTF': [
                { domanda: 'ha_verificato_tiro_funi', valore_atteso: 'si' }
            ],
            'DM37 Quadro Manovra': [
                { domanda: 'ha_modificato_quadro', valore_atteso: 'si' }
            ]
        };
        return condizioni[flag] || [];
    }

    /**
     * Filtra i documenti condizionali in base alle risposte
     */
    filtraCondizionali(documentiCondizionali, risposte) {
        return documentiCondizionali.filter(doc => {
            const condizioni = doc.condizioni || [];
            // Se non ci sono condizioni, includi sempre
            if (condizioni.length === 0) return true;
            // Verifica che tutte le condizioni siano soddisfatte
            return condizioni.every(cond => {
                return risposte[cond.domanda] === cond.valore_atteso;
            });
        });
    }

    /**
     * Genera il set completo di documenti per un intervento
     */
    generaSetDocumenti(intervento, risposte) {
        const docs = this.determinaDocumenti(intervento);
        
        // Documenti finali da generare
        let finali = [...docs.obbligatori];

        // Aggiungi moduli
        docs.moduli.forEach(mod => {
            finali.push(mod.nome);
        });

        // Filtra condizionali in base alle risposte
        const condizionaliAttivi = this.filtraCondizionali(docs.condizionali, risposte);
        condizionaliAttivi.forEach(cond => {
            if (!finali.includes(cond.documento)) {
                finali.push(cond.documento);
            }
        });

        return {
            documenti: finali,
            moduli: docs.moduli,
            tracciabilita: docs.tracciabilita,
            condizionaliAttivi: condizionaliAttivi
        };
    }
}

export default RuleEngine;