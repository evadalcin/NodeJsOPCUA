const {
    OPCUAClient,
    AttributeIds,
    TimestampsToReturn,
    DataType,
    NodeClass,
} = require("node-opcua");

const endpointUrl = "opc.tcp://localhost:4334/UA/CNC";

const CNCStatusEnumValues = { 0: "Off", 1: "On", 2: "Alarm" };
const MandrinoVelocitaEnumValues = { 1: "Speed 1", 2: "Speed 2", 3: "Speed 3", 4: "Speed 4", 5: "Speed 5" };

(async () => {
    const client = OPCUAClient.create({ endpointMustExist: false });
    
    client.on("backoff", (retry, delay) =>
        console.log(`Reconnecting: retry ${retry}, next in ${delay / 1000}s`)
    );

    let globalSession = null;
    let globalCNCInstances = [];

    const readVariable = async (parentNodeId, varName) => {
        const ref = (await globalSession.browse(parentNodeId)).references.find(
            r => r.browseName.name === varName && r.nodeClass === NodeClass.Variable
        );
        if (!ref) return { value: { value: "N/A" } };
        return await globalSession.read({ nodeId: ref.nodeId, attributeId: AttributeIds.Value });
    };

    const readObject = async (parentNodeId, objName) => {
        const ref = (await globalSession.browse(parentNodeId)).references.find(
            r => r.browseName.name === objName && r.nodeClass === NodeClass.Object
        );
        return ref;
    };

    const displayAllCNCStatuses = async () => {
        if (!globalSession || globalCNCInstances.length === 0) return;

        console.log("\n--- CNC MACHINE STATUSES ---");
        for (const cnc of globalCNCInstances) {
            try {
                const status = await readVariable(cnc.nodeId, "Status");
                const utensile = await readVariable(cnc.nodeId, "Utensile");
                const pezziProdotti = await readVariable(cnc.nodeId, "PezziProdotti");
                const consumoEnergetico = await readVariable(cnc.nodeId, "ConsumoEnergetico");
                const statusAI = await readVariable(cnc.nodeId, "StatusAI");

                let mandrinoSpeed = { value: { value: "N/A" } };
                const mandrinoObj = await readObject(cnc.nodeId, "Mandrino");
                if (mandrinoObj) {
                    mandrinoSpeed = await readVariable(mandrinoObj.nodeId, "Velocita");
                }

                console.log(
                    `  ${cnc.browseName.name}: ` +
                    `Status: ${CNCStatusEnumValues[status.value.value] || "Unknown"}, ` +
                    `Utensile: ${utensile.value.value}, ` +
                    `Pezzi: ${pezziProdotti.value.value}, ` +
                    `Energia: ${consumoEnergetico.value.value} kW, ` +
                    `Mandrino: ${MandrinoVelocitaEnumValues[mandrinoSpeed.value.value] || "Unknown"}` +
                    (statusAI.value.value !== "N/A" ? `, AI: ${statusAI.value.value}` : '')
                );
            } catch (error) {
                console.error(`Error reading ${cnc.browseName.name}: ${error.message}`);
            }
        }
        console.log("---------------------------\n");
    };

    const monitorVariable = async (subscription, parentNodeId, varName, cncName, label) => {
        const ref = (await globalSession.browse(parentNodeId)).references.find(
            r => r.browseName.name === varName && r.nodeClass === NodeClass.Variable
        );
        if (!ref) return console.warn(`${varName} not found for ${cncName}`);

        const item = await subscription.monitor(
            { nodeId: ref.nodeId, attributeId: AttributeIds.Value },
            { samplingInterval: 1000, discardOldest: true, queueSize: 10 },
            TimestampsToReturn.Both
        );
        
        item.on("changed", (dataValue) => {
            const value = varName === "Status" ? CNCStatusEnumValues[dataValue.value.value] || "Unknown" :
                          varName === "Velocita" ? MandrinoVelocitaEnumValues[dataValue.value.value] || "Unknown" :
                          dataValue.value.value;
            console.log(`[${cncName} CHANGE] ${label}: ${value} at ${new Date().toLocaleTimeString()}`);
        });
    };

    const callMethod = async (objectNodeId, methodName, inputArgs = []) => {
        const methodRef = (await globalSession.browse(objectNodeId)).references.find(
            r => r.browseName.name === methodName && r.nodeClass === NodeClass.Method
        );
        if (!methodRef) return console.warn(`${methodName} method not found`);

        const callRequest = { objectId: objectNodeId, methodId: methodRef.nodeId, inputArguments: inputArgs };
        const result = await globalSession.call([callRequest]);
        return result[0]?.outputArguments[0]?.value;
    };

    await client.withSubscriptionAsync(
        endpointUrl,
        { maxNotificationsPerPublish: 1000, publishingEnabled: true, requestedPublishingInterval: 1000 },
        async (session, subscription) => {
            globalSession = session;
            try {
                const rootFolder = await session.browse("RootFolder");
                const objectsNode = rootFolder.references.find(r => r.browseName.name === "Objects");
                
                if (!objectsNode) return console.warn("Objects folder not found");

                const cncInstances = (await session.browse(objectsNode.nodeId))
                    .references.filter(r => 
                        (r.browseName.name.startsWith("CNC") || r.browseName.name.startsWith("CNCPro")) && 
                        r.nodeClass === NodeClass.Object
                    );
                
                globalCNCInstances = cncInstances;

                // Setup monitoring
                for (const cnc of cncInstances) {
                    await monitorVariable(subscription, cnc.nodeId, "Status", cnc.browseName.name, "Status");
                    await monitorVariable(subscription, cnc.nodeId, "ConsumoEnergetico", cnc.browseName.name, "Energia");
                    await monitorVariable(subscription, cnc.nodeId, "StatusAI", cnc.browseName.name, "Status AI");

                    const mandrinoObj = await readObject(cnc.nodeId, "Mandrino");
                    if (mandrinoObj) {
                        await monitorVariable(subscription, mandrinoObj.nodeId, "Velocita", cnc.browseName.name + " Mandrino", "Velocità");
                    }
                }

                await displayAllCNCStatuses();

                // Method call examples
                const cnc1 = globalCNCInstances.find(c => c.browseName.name === "CNC1");
                if (cnc1) {
                    console.log("\nCalling ChangeStatus on CNC1 to 'On'...");
                    const result = await callMethod(cnc1.nodeId, "ChangeStatus", [{ dataType: DataType.Int32, value: 1 }]);
                    console.log(`Result: ${result}`);

                    const mandrinoObj = await readObject(cnc1.nodeId, "Mandrino");
                    if (mandrinoObj) {
                        console.log("\nCalling CambiareVelocita on CNC1's Mandrino to speed 3...");
                        const speedResult = await callMethod(mandrinoObj.nodeId, "CambiareVelocita", [{ dataType: DataType.Int32, value: 3 }]);
                        console.log(`Result: ${speedResult}`);
                    }
                }

                const cncPro1 = globalCNCInstances.find(c => c.browseName.name === "CNCPro1");
                if (cncPro1) {
                    console.log("\nCalling ManutenzionePredittiva on CNCPro1...");
                    const maintResult = await callMethod(cncPro1.nodeId, "ManutenzionePredittiva");
                    console.log(`Result: ${maintResult}`);
                }

            } catch (err) {
                console.error("Error:", err.message);
            }

            console.log("\nPress CTRL+C to stop...");
            await new Promise(() => {});
        }
    );
})();