// websocket_server.js
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8081 });

const {
    setNavmeshParams,
    addNavmeshObject,
    isNavmeshBusy,
    sendPathRequest,
    requestPathAndWait,
    generateNavmesh,
    sendOffmeshLink
} = require('./navmesh_handler');

//function requestPathAndWait(mapName, requestID, startPos, targetPos) {
//    return new Promise((resolve, reject) => {
//        const ws = new WebSocket("ws://localhost:8081"); // ajuste a URL se necessário
//
//        ws.onopen = () => {
//            // Envia o pedido de rota
//            ws.send(JSON.stringify({
//                action: "requestPath",
//                mapName,
//                requestID,
//                startPos,
//                targetPos
//            }));
//
//            // Começa a checar a resposta a cada 250ms
//            const interval = setInterval(() => {
//                ws.send(JSON.stringify({
//                    action: "checkPathResult",
//                    mapName,
//                    requestID
//                }));
//            }, 250);
//
//            // Quando receber resposta...
//            ws.onmessage = (event) => {
//                const msg = JSON.parse(event.data);
//                if (msg.type === "pathResult" && msg.requestID === requestID) {
//                    if (msg.finished) {
//                        clearInterval(interval);
//                        ws.close();
//                        resolve(msg.path);
//                    }
//                }
//            };
//        };
//
//        ws.onerror = (err) => {
//            reject(new Error("WebSocket error: " + err.message));
//        };
//
//        ws.onclose = () => {
//            // Se fechar antes de resposta, rejeita
//            reject(new Error("WebSocket closed before response."));
//        };
//    });
//}


const ensureFloat = n => (Number.isInteger(n) ? n + 0.0 : n);

wss.on('connection', socket => {
    socket.on('message', async data => {
        try {
            const msg = JSON.parse(data);
            const { action, mapName, args, radius, height, cellSize, agentMaxClimb, agentMaxSlope } = msg;

            if (action === "defineParams") {
                setNavmeshParams(mapName, radius, height, cellSize, agentMaxClimb, agentMaxSlope);
                socket.send(JSON.stringify({ success: true }));
            } else if (action === "addObject") {
                const { modelHash, pos, rot } = msg;
                const added = addNavmeshObject(mapName, modelHash, pos, rot);
                socket.send(JSON.stringify({ success: added }));
            } else if (action === "generateNavmesh") {
                const { mapName, list } = msg;
                const added = generateNavmesh(mapName, list);
                socket.send(JSON.stringify({ success: added }));
            } else if (action === "checkBusy") {
                const busy = isNavmeshBusy(mapName);
                socket.send(JSON.stringify({ busy }));
            } else if (action === "requestPath") {
                const { mapName, requestID, startPos, targetPos } = msg;
                //const filePath = path.join("D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/path_requests", mapName, `${requestID}.txt`);
                //const content = `${startPos.x} ${startPos.z} ${startPos.y} ${targetPos.x} ${targetPos.z} ${targetPos.y}`;

                //fs.mkdirSync(path.dirname(filePath), { recursive: true });
                //fs.writeFileSync(filePath, content);
                //console.log(`[WS] Pedido de rota salvo: ${filePath}`);
                sendPathRequest(mapName, requestID, startPos, targetPos);
                const filePath = path.join("D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/path_outputs", mapName, `${requestID}.txt`);

                if (fs.existsSync(filePath)) {
                    const raw = fs.readFileSync(filePath, "utf-8").trim();
                    const nodes = raw.split("\n").map(line => {
                        const [x, y, z] = line.trim().split(" ").map(v => parseFloat(v)); // <-- aqui
                        return {
                            x: parseFloat(x.toFixed(6)),
                            y: parseFloat(y.toFixed(6)),
                            z: parseFloat(z.toFixed(6))
                        };
                    });

                    fs.unlinkSync(filePath); // limpa após leitura

                    socket.send(JSON.stringify({
                        type: "pathResult",
                        requestID,
                        finished: true,
                        path: nodes
                    }));
                } else {
                    socket.send(JSON.stringify({
                        type: "pathResult",
                        requestID,
                        finished: false
                    }));
                }
            }

            else if (action === "checkPathResult") {
                const { mapName, requestID } = msg;
                const filePath = path.join("D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/path_outputs", mapName, `${requestID}.txt`);

                if (fs.existsSync(filePath)) {
                    const raw = fs.readFileSync(filePath, "utf-8").trim();
                    const nodes = raw.split("\n").map(line => {
                        const [x, y, z] = line.trim().split(" ").map(v => parseFloat(v)); // <-- aqui
                        return {
                            x: parseFloat(x.toFixed(6)),
                            y: parseFloat(y.toFixed(6)),
                            z: parseFloat(z.toFixed(6))
                        };
                    });

                    fs.unlinkSync(filePath); // limpa após leitura

                    socket.send(JSON.stringify({
                        type: "pathResult",
                        requestID,
                        finished: true,
                        path: nodes
                    }));
                } else {
                    socket.send(JSON.stringify({
                        type: "pathResult",
                        requestID,
                        finished: false
                    }));
                }
            }
            else if (action === "requestPathAndWait") {
                const { mapName, requestID, startPos, targetPos } = msg;
                try {
                    const path = await requestPathAndWait(mapName, requestID, startPos, targetPos);
                    socket.send(JSON.stringify({
                        type: "pathResult",
                        requestID,
                        finished: true,
                        path
                    }));
                } catch (err) {
                    socket.send(JSON.stringify({
                        type: "pathResult",
                        requestID,
                        finished: false,
                        error: err.message
                    }));
                }
            } else if (action === "sendOffmeshLink") {
                const { mapName, list } = msg;
                sendOffmeshLink(mapName, list);
                socket.send(JSON.stringify({ success: true }));
            } 
            else {
                console.warn("[WS] Ação desconhecida:", action);
            }
           

        } catch (err) {
            console.error("[WS ERROR]", err);
        }
    });
});

console.log("[WebSocket] Server listening on ws://localhost:8081");