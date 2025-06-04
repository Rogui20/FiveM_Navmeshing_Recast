const socket = new WebSocket("ws://localhost:8081");

socket.onopen = () => {
    console.log("WebSocket conectado ao servidor Node.js");
};

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    //console.log("[WebSocket] Mensagem recebida:", data);
    //for (i in data) {
        //console.log("[WebSocket] " + i + ":", data[i]);
    //}
    if (data.type === "pathResult") {
        // browser-side JS
        fetch(`https://${GetParentResourceName()}/pathResult`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
            },
            body: JSON.stringify({
                finished: data.finished,
                requestID: data.requestID,
                path: data.path
            })
        }).then(resp => resp.json()).then(resp => console.log(resp));
    }
    //if (data.type === "navmeshBusy") {
        //console.warn("Navmesh ainda está em construção:", data.map);
    //}

};

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


window.addEventListener("message", async (event) => {
    const data = event.data;

    if (data.type === "addObjectToQueue") {
        socket.send(JSON.stringify({
            action: "addObject",
            mapName: data.mapName,
            modelHash: data.modelHash,
            pos: data.pos,
            rot: data.rot
        }));
    }

    if (data.type === "defineNavmeshParams") {
        socket.send(JSON.stringify({
            action: "defineParams",
            mapName: data.mapName,
            radius: data.radius,
            height: data.height,
            cellSize: data.cellSize,
            agentMaxClimb: data.agentMaxClimb,
            agentMaxSlope: data.agentMaxSlope
        }));
    }
    if (data.type === "generateNavmesh") {
        socket.send(JSON.stringify({
            action: "generateNavmesh",
            mapName: data.mapName,
            list: data.list
        }));
    }
    if (data.type === "checkBusyNavmesh") {
        socket.send(JSON.stringify({
            action: "checkBusy",
            map: data.map
        }));
    }
    
    if (data.type === "requestPath") {
        socket.send(JSON.stringify({
            action: "requestPath",
            mapName: data.mapName,
            requestID: data.requestID,
            startPos: data.startPos,
            targetPos: data.targetPos
        }));
    }
    if (data.type === "checkPathResult") {
        socket.send(JSON.stringify({
            action: "checkPathResult",
            mapName: data.mapName,
            requestID: data.requestID
        }));
    }
    if (data.type === "sendOffmeshLink") {
        socket.send(JSON.stringify({
            action: "sendOffmeshLink",
            mapName: data.mapName,
            list: data.list
        }));
    }
   //if (data.type === "escreverRequestPath") {
   //    const { mapName, requestID, startPos, targetPos } = data;

   //    try {
   //        const pathPoints = await requestPathAndWait(mapName, requestID, startPos, targetPos);
   //        fetch(`https://${GetParentResourceName()}/onRouteReceived`, {
   //            method: 'POST',
   //            headers: { 'Content-Type': 'application/json' },
   //            body: JSON.stringify({ requestID, path: pathPoints })
   //        });
   //    } catch (err) {
   //        fetch(`https://${GetParentResourceName()}/onRouteReceived`, {
   //            method: 'POST',
   //            headers: { 'Content-Type': 'application/json' },
   //            body: JSON.stringify({ requestID, error: err.message })
   //        });
   //    }
   //}
});
