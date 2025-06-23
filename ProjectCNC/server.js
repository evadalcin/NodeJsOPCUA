const os = require("os");
const { OPCUAServer, Variant, DataType, StatusCodes, s } = require("node-opcua");

/**
 * Funzione principale asincrona per avviare il server OPC UA.
 */
(async () => {

    // --- Configurazione e Inizializzazione del Server OPC UA ---
    // ==========================================================
    const server = new OPCUAServer({
        port: 4334, // Porta su cui il server OPC UA sarà in ascolto
        resourcePath: "/UA/CNC", // Percorso della risorsa per il server (endpoint URL)
        buildInfo: {
            productName: "CNC", // Nome del prodotto
            buildNumber: "7658", // Numero di build
            buildDate: new Date(2025, 5, 30) // Data di build
        }
    });

    console.log("Inizializzazione del server OPC UA...");
    await server.initialize();
    console.log("Server OPC UA inizializzato.");

    // Ottenere l'address space e il namespace predefinito
    const addressSpace = server.engine.addressSpace;
    const namespace = addressSpace.getOwnNamespace();

    // --- Definizione degli ObjectType ---
    // ===================================
    // Gli ObjectType sono le "classi" o "modelli" dei nostri oggetti OPC UA.
ì
    const CNCType = namespace.addObjectType({
        browseName: "MacchinaCNCType" // Nome visualizzato nel browser OPC UA
    });


    const CNCProType = namespace.addObjectType({
        browseName: "MacchinaCNCProType",
        subtypeOf: CNCType // CNCProType eredita tutte le caratteristiche di CNCType
    });

    const mandrinoType = namespace.addObjectType({
        browseName: "MandrinoType"
    });

    // --- Definizione delle Enumerazioni ---
    // ====================================

    // Enumerazione per lo stato delle macchine CNC (Off, On, Alarm)
    const CNCStatusEnumValues = {
        Off: 0,
        On: 1,
        Alarm: 2
    };

    /**
     * @type {NodeId} CNCTypeNodeId - NodeId dell'enumerazione per lo stato CNC.
     * Utilizzato come DataType per la variabile 'SystemStatus'.
     */
    const CNCTypeEnumNodeId = namespace.addEnumerationType({ // Rinominato per maggiore chiarezza
        browseName: "CNCTypeEnum",
        enumeration: [
            { displayName: "Off", value: CNCStatusEnumValues.Off },
            { displayName: "On", value: CNCStatusEnumValues.On },
            { displayName: "Alarm", value: CNCStatusEnumValues.Alarm },
        ],
    });

    // Enumerazione per la velocità del mandrino (livelli da 1 a 5)
    /**
     * @type {NodeId} MandrinoVelocitaEnumNodeId - NodeId dell'enumerazione per la velocità del mandrino.
     * Utilizzato come DataType per la variabile 'Velocita'.
     */
    const MandrinoVelocitaEnumNodeId = namespace.addEnumerationType({
        browseName: "VelocitaMandrinoEnum",
        enumeration: [
            { displayName: "1", value: 1 },
            { displayName: "2", value: 2 },
            { displayName: "3", value: 3 },
            { displayName: "4", value: 4 },
            { displayName: "5", value: 5 }
        ],
    });

    // --- Variabili e Metodi per CNCType (MacchinaCNCType) ---
    // =======================================================

    // Variabile 'SystemStatus' (Stato del sistema)
    namespace.addVariable({
        componentOf: CNCType, // Questa variabile fa parte di CNCType
        browseName: "Status", // Nome visualizzato come da diagramma
        dataType: CNCTypeEnumNodeId, // Utilizza l'enumerazione definita
        value: { dataType: DataType.Int32, value: CNCStatusEnumValues.Off }, // Valore iniziale
        modellingRule: "Mandatory" // Indica che questa variabile è obbligatoria per le istanze di CNCType
    });

    // Variabile 'Utensile'
    namespace.addVariable({
        componentOf: CNCType,
        browseName: "Utensile",
        dataType: DataType.String,
        value: { dataType: DataType.String, value: "Default Utensile" },
        modellingRule: "Mandatory"
    });

    // Variabile 'PezziProdotti'
    namespace.addVariable({
        componentOf: CNCType,
        browseName: "PezziProdotti",
        dataType: DataType.UInt32,
        value: { dataType: DataType.UInt32, value: 0 },
        modellingRule: "Mandatory"
    });

    // Variabile 'ConsumoEnergetico'
    namespace.addVariable({
        componentOf: CNCType,
        browseName: "ConsumoEnergetico",
        dataType: DataType.Double,
        value: { dataType: DataType.Double, value: 0.0 },
        modellingRule: "Mandatory"
    });

    // Metodo 'ChangeStatus' per cambiare lo stato della CNC
    const ChangeStatusCNCMethod = namespace.addMethod(CNCType, {
        browseName: "ChangeStatus", // Nome visualizzato come da diagramma
        inputArguments: [
            {
                name: "NewStatus",
                dataType: DataType.Int32,
                description: { text: "Nuovo stato per la CNC (0=Off, 1=On, 2=Alarm)" },
            },
        ],
        outputArguments: [
            {
                name: "Success",
                dataType: DataType.Boolean,
                description: { text: "Indica se l'operazione ha avuto successo" },
            },
        ],
        modellingRule: "Mandatory",
    });

    // Binding del metodo ChangeStatusCNCMethod
    ChangeStatusCNCMethod.bindMethod(async (inputArguments, context, callback) => {
        try {
            // L'istanza della CNC su cui è stato chiamato il metodo
            const CNCInstance = context.object;
            const newStatus = inputArguments[0].value;

            console.log(`Chiamato ChangeStatus su ${CNCInstance.browseName.toString()} con NewStatus: ${newStatus}`);

            // Validazione del nuovo valore di stato
            if (newStatus < 0 || newStatus > 2) {
                console.warn(`Tentativo di impostare uno stato non valido: ${newStatus}`);
                return callback(null, {
                    statusCode: StatusCodes.BadInvalidArgument,
                    outputArguments: [{ dataType: DataType.Boolean, value: false }]
                });
            }

            const systemStatusVariable = CNCInstance.getChildByName("Status"); // "Status" come da diagramma
            if (!systemStatusVariable) {
                console.error("Variabile 'Status' non trovata per l'istanza CNC.");
                return callback(null, {
                    statusCode: StatusCodes.BadInternalError,
                    outputArguments: [{ dataType: DataType.Boolean, value: false }]
                });
            }

            // Aggiorna lo stato del sistema
            systemStatusVariable.setValueFromSource({
                dataType: DataType.Int32,
                value: newStatus
            });
            console.log(`Stato di ${CNCInstance.browseName.toString()} aggiornato a: ${newStatus}`);

            // Aggiorna il consumo energetico basato sullo stato
            const consumoEnergeticoVariable = CNCInstance.getChildByName("ConsumoEnergetico");
            if (consumoEnergeticoVariable) {
                let energyConsumption = 0.0;
                switch (newStatus) {
                    case CNCStatusEnumValues.Off:
                        energyConsumption = 0.0;
                        break;
                    case CNCStatusEnumValues.On:
                        energyConsumption = 150.5; // Consumo normale in operazione
                        break;
                    case CNCStatusEnumValues.Alarm:
                        energyConsumption = 25.0; // Consumo in standby/allarme
                        break;
                }
                consumoEnergeticoVariable.setValueFromSource({
                    dataType: DataType.Double,
                    value: energyConsumption
                });
                console.log(`Consumo energetico di ${CNCInstance.browseName.toString()} aggiornato a: ${energyConsumption}`);
            }

            callback(null, {
                statusCode: StatusCodes.Good,
                outputArguments: [{ dataType: DataType.Boolean, value: true }]
            });

        } catch (error) {
            console.error("Errore nel metodo ChangeStatusCNC:", error);
            callback(null, {
                statusCode: StatusCodes.BadInternalError,
                outputArguments: [{ dataType: DataType.Boolean, value: false }]
            });
        }
    });

    // --- Variabili e Metodi per MandrinoType ---
    // =========================================

    // Variabile 'Velocita' per il mandrino
    namespace.addVariable({
        componentOf: mandrinoType,
        browseName: "Velocita", // Nome visualizzato come da diagramma
        dataType: MandrinoVelocitaEnumNodeId, // Utilizza l'enumerazione definita
        value: { dataType: DataType.Int32, value: 1 }, // Velocità iniziale
        modellingRule: "Mandatory"
    });

    // Metodo 'CambiareVelocita' per il mandrino
    const ChangeMandrinoSpeedMethod = namespace.addMethod(mandrinoType, {
        browseName: "CambiareVelocita", // Nome visualizzato come da diagramma
        inputArguments: [
            {
                name: "NewSpeed",
                dataType: DataType.Int32,
                description: { text: "Nuova velocità per il Mandrino (1-5)" },
            },
        ],
        outputArguments: [
            {
                name: "Success",
                dataType: DataType.Boolean,
                description: { text: "Indica se l'operazione ha avuto successo" },
            },
        ],
        modellingRule: "Mandatory",
    });

    // Binding del metodo ChangeMandrinoSpeedMethod
    ChangeMandrinoSpeedMethod.bindMethod(async (inputArguments, context, callback) => {
        try {
            // L'istanza del mandrino su cui è stato chiamato il metodo
            const MandrinoInstance = context.object;
            const newSpeed = inputArguments[0].value;

            // Il parent di un componente è l'oggetto che lo contiene (la CNC in questo caso)
            const parentCNC = MandrinoInstance.parent;
            if (!parentCNC) {
                console.error("Istanza CNC genitore del mandrino non trovata. Il mandrino deve essere un componente di una CNC.");
                return callback(null, {
                    statusCode: StatusCodes.BadInternalError,
                    outputArguments: [{ dataType: DataType.Boolean, value: false, description: { text: "Parent CNC not found" } }]
                });
            }

            console.log(`Chiamato CambiareVelocita su Mandrino di ${parentCNC.browseName.toString()} con NewSpeed: ${newSpeed}`);

            // Validazione del nuovo valore di velocità (1-5)
            if (newSpeed < 1 || newSpeed > 5) {
                console.warn(`Tentativo di impostare una velocità mandrino non valida: ${newSpeed}`);
                return callback(null, {
                    statusCode: StatusCodes.BadInvalidArgument,
                    outputArguments: [{ dataType: DataType.Boolean, value: false }]
                });
            }

            // Verifica se la CNC è "On" prima di cambiare la velocità del mandrino
            const systemStatusVariable = parentCNC.getChildByName("Status"); // "Status" come da diagramma
            if (systemStatusVariable) {
                const currentStatus = systemStatusVariable.readValue().value.value;
                if (currentStatus !== CNCStatusEnumValues.On) {
                    console.warn(`Impossibile cambiare velocità mandrino: la CNC ${parentCNC.browseName.toString()} non è ON (stato attuale: ${currentStatus}).`);
                    return callback(null, {
                        statusCode: StatusCodes.BadInvalidState,
                        outputArguments: [{ dataType: DataType.Boolean, value: false, description: { text: "CNC is not ON to change spindle speed" } }]
                    });
                }
            } else {
                console.error("Variabile 'Status' non trovata sulla CNC genitore.");
                return callback(null, {
                    statusCode: StatusCodes.BadInternalError,
                    outputArguments: [{ dataType: DataType.Boolean, value: false, description: { text: "SystemStatus variable not found on parent CNC" } }]
                });
            }

            const velocitaMandrinoVariable = MandrinoInstance.getChildByName("Velocita");
            if (!velocitaMandrinoVariable) {
                console.error("Variabile 'Velocita' non trovata per l'istanza del mandrino.");
                return callback(null, {
                    statusCode: StatusCodes.BadInternalError,
                    outputArguments: [{ dataType: DataType.Boolean, value: false }]
                });
            }

            // Aggiorna la velocità del mandrino
            velocitaMandrinoVariable.setValueFromSource({
                dataType: DataType.Int32,
                value: newSpeed
            });
            console.log(`Velocità di Mandrino di ${parentCNC.browseName.toString()} aggiornata a: ${newSpeed}`);


            // Aggiorna il consumo energetico della CNC genitore in base alla velocità del mandrino
            const consumoEnergeticoVariable = parentCNC.getChildByName("ConsumoEnergetico");
            if (consumoEnergeticoVariable) {
                const baseConsumption = 150.5; // Consumo base quando la CNC è ON
                const additionalConsumption = (newSpeed - 1) * 10; // Consumo aggiuntivo (10kW per livello di velocità oltre il primo)
                const totalConsumption = baseConsumption + additionalConsumption;

                consumoEnergeticoVariable.setValueFromSource({
                    dataType: DataType.Double,
                    value: totalConsumption
                });
                console.log(`Consumo energetico di ${parentCNC.browseName.toString()} (dopo cambio velocità mandrino) aggiornato a: ${totalConsumption}`);
            }

            callback(null, {
                statusCode: StatusCodes.Good,
                outputArguments: [{ dataType: DataType.Boolean, value: true }]
            });

        } catch (error) {
            console.error("Errore nel metodo ChangeMandrinoSpeed:", error);
            callback(null, {
                statusCode: StatusCodes.BadInternalError,
                outputArguments: [{ dataType: DataType.Boolean, value: false }]
            });
        }
    });

    // --- Definizione della Relazione tra CNCType e MandrinoType ---
    // ===========================================================
    // Ogni istanza di CNCType (e di CNCProType, dato che eredita) avrà un Mandrino.
    // Dobbiamo usare namespace.addObject per definire un componente Object all'interno di un ObjectType.
    namespace.addObject({
        componentOf: CNCType, // Questo oggetto è un componente di CNCType
        browseName: "Mandrino", // Nome visualizzato come da diagramma per l'istanza del mandrino
        typeDefinition: mandrinoType, // Specifica che questo componente è un'istanza di MandrinoType
        modellingRule: "Mandatory" // Ogni CNC deve avere un Mandrino
    });

    // --- Variabili e Metodi Aggiuntivi per CNCProType ---
    // ==================================================

    // Variabile 'StatusAI' per CNCProType
    namespace.addVariable({
        componentOf: CNCProType,
        browseName: "StatusAI",
        dataType: DataType.Boolean,
        value: { dataType: DataType.Boolean, value: false },
        modellingRule: "Mandatory"
    });

    // Metodo 'ManutenzionePredittiva' per CNCProType
    const ManutenzionePredittivaMethod = namespace.addMethod(CNCProType, {
        browseName: "ManutenzionePredittiva",
        modellingRule: "Mandatory",
        outputArguments: [
            {
                name: "Success",
                dataType: DataType.Boolean,
                description: { text: "Indica se l'operazione ha avuto successo" },
            },
        ],
    });
    
    // Binding del metodo ManutenzionePredittiva
    ManutenzionePredittivaMethod.bindMethod(async (inputArguments, context, callback) => {
        try {
            const CNCProInstance = context.object;
            console.log(`Chiamato ManutenzionePredittiva su ${CNCProInstance.browseName.toString()}.`);
            
            // Accede alla variabile 'StatusAI' dell'istanza CNCPro corrente
            const statusAIVariable = CNCProInstance.getChildByName("StatusAI");
            if (statusAIVariable) {
                const currentStatusAI = statusAIVariable.readValue().value.value;
                const newStatusAI = !currentStatusAI; // Inverte lo stato corrente
                
                statusAIVariable.setValueFromSource({
                    dataType: DataType.Boolean,
                    value: newStatusAI
                });
                console.log(`Variabile 'StatusAI' di ${CNCProInstance.browseName.toString()} aggiornata a: ${newStatusAI}`);
            } else {
                console.warn(`Variabile 'StatusAI' non trovata sull'istanza ${CNCProInstance.browseName.toString()}.`);
            }

            callback(null, {
                statusCode: StatusCodes.Good,
                outputArguments: [{ dataType: DataType.Boolean, value: true }]
            });

        } catch (error) {
            console.error("Errore nel metodo ManutenzionePredittiva:", error);
            callback(null, {
                statusCode: StatusCodes.BadInternalError,
                outputArguments: [{ dataType: DataType.Boolean, value: false }]
            });
        }
    });

    // --- Creazione delle Istanze degli Oggetti CNC ---
    // ================================================

    console.log("Creazione istanze delle macchine CNC...");

    // Istanza di CNCType: CNC1
    const CNC1 = CNCType.instantiate({
        browseName: "CNC1",
        nodeId: "s=CNC1", // NodeId personalizzato
        organizedBy: addressSpace.rootFolder.objects // Organizzato sotto la cartella Objects
    });
    console.log("Istanza CNC1 creata.");

    // Istanza di CNCType: CNC2
    const CNC2 = CNCType.instantiate({
        browseName: "CNC2",
        nodeId: "s=CNC2",
        organizedBy: addressSpace.rootFolder.objects
    });
    console.log("Istanza CNC2 creata.");

    // Istanza di CNCType: CNC3
    const CNC3 = CNCType.instantiate({
        browseName: "CNC3",
        nodeId: "s=CNC3",
        organizedBy: addressSpace.rootFolder.objects
    });
    console.log("Istanza CNC3 creata.");

    // Istanza di CNCProType: CNCPro1
    const CNCPro1 = CNCProType.instantiate({
        browseName: "CNCPro1",
        nodeId: "s=CNCPro1",
        organizedBy: addressSpace.rootFolder.objects
    });
    console.log("Istanza CNCPro1 creata.");


    // Esempio di accesso al Mandrino di una specifica CNC
    // Il mandrino viene automaticamente creato all'interno di ogni istanza CNC.
    const cnc1Mandrino = CNC1.getChildByName("Mandrino");
    if (cnc1Mandrino) {
        console.log(`CNC1 ha un Mandrino con browseName: ${cnc1Mandrino.browseName.toString()}`);
        const velocitaCnc1Mandrino = cnc1Mandrino.getChildByName("Velocita");
        if(velocitaCnc1Mandrino) {
            console.log(`Velocità iniziale di Mandrino di CNC1: ${velocitaCnc1Mandrino.readValue().value.value}`);
        }
    }

    // --- Avvio del Server OPC UA ---
    await server.start();
    const endpointUrl = server.endpoints[0].endpointUrl; 
    console.log(`Server OPC UA avviato e in ascolto su: ${endpointUrl}`);
    console.log("Per connettersi, utilizzare un client OPC UA e l'URL sopra indicato.");
    console.log("Per terminare, premere Ctrl+C.");

    process.once("SIGINT", async () => {
        console.log("Segnale SIGINT ricevuto. Spegnimento del server...");
        await server.shutdown();
        console.log("Server OPC UA spento.");
        process.exit(0);
    });

})().catch((error) => {
    console.error("Errore critico durante l'avvio del server OPC UA:", error);
    process.exit(1);
});
