const fs = require('fs');
const path = require('path');
const ws = require('./websocket_server'); // importa broadcast()

const PropHashToName = require('D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/PropHashToName.json');

const OBJECTS_FOLDER = 'D:/ExportGTA/saida';

const NavmeshDefinitions = {};
const NavmeshQueue = {};
const NavmeshWriteTimers = {}; // Novo: armazena timers pendentes

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const shutdownDir = 'D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/shutdown_requests';

if (!fs.existsSync(shutdownDir)) fs.mkdirSync(shutdownDir, { recursive: true });

const navmeshActivityTimers = {};

function updateNavmeshActivity(mapName) {
    if (navmeshActivityTimers[mapName]) {
        clearTimeout(navmeshActivityTimers[mapName]);
    }

    navmeshActivityTimers[mapName] = setTimeout(() => {
        const shutdownPath = path.join(shutdownDir, mapName + '.txt');
        fs.writeFileSync(shutdownPath, '');
        console.log(`[SHUTDOWN] Criado shutdown request para ${mapName}`);
        delete navmeshActivityTimers[mapName];
        delete NavmeshInstances[mapName];
    }, INACTIVITY_TIMEOUT_MS);
}

// Define os parâmetros da navmesh
function setNavmeshParams(mapName, radius, height, cellSize, agentMaxClimb, agentMaxSlope) {
    NavmeshDefinitions[mapName] = {
        AgentRadius: radius || 0.6,
        AgentHeight: height || 1.0,
        CellSize: cellSize || 0.3,
        AgentMaxClimb: agentMaxClimb || 0.5,
        AgentMaxSlope: agentMaxSlope || 45.0
    };
}

const { spawn } = require('child_process');
//const { exec } = require('child_process');
const NavmeshInstances = {};

function startRecastWithMap(mapName) {
    const exeFolder = 'D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug';
    const exePath = path.join(exeFolder, 'RecastDemo.exe');

    const batFileName = `start_${mapName}.bat`;
    const batFilePath = path.join(exeFolder, batFileName);

    const batContent = `
@echo off
cd /d "${exeFolder}"
start "" /min "${exePath}" ${mapName}
timeout /t 2 >nul
del "%~f0"
`;

    // Cria o .bat
    fs.writeFileSync(batFilePath, batContent.trim(), 'utf-8');

    // Executa o .bat
    spawn('cmd.exe', ['/c', batFilePath], {
        cwd: exeFolder,
        detached: true,
        stdio: 'ignore'
    }).unref();
}

function addNavmeshObject(mapName, modelHash, pos, rot) {
    //updateNavmeshActivity(mapName);

    if (!NavmeshDefinitions[mapName]) {
        console.warn(`[WARN] NavmeshDefinitions ainda não definidas para: ${mapName}`);
        return;
    }

    const modelName = PropHashToName[modelHash.toString()];
    if (!modelName) {
        console.warn(`[AVISO] Modelo não encontrado para hash ${modelHash}`);
        return;
    }
    const shutdownPath = `D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/shutdown_history/${mapName}`;
    if (fs.existsSync(shutdownPath)) {
        delete NavmeshInstances[mapName];
        fs.unlinkSync(shutdownPath); // se quiser
    }

    // Verifica se a instância já está rodando
    if (!NavmeshInstances[mapName]) {
        console.log(`[NAVMESH] Iniciando RecastDemo para: ${mapName}`);
        startRecastWithMap(mapName);
        NavmeshInstances[mapName] = true;
    }

    if (!NavmeshQueue[mapName]) NavmeshQueue[mapName] = [];

    NavmeshQueue[mapName].push({
        modelName: modelName + '.obj',
        pos: pos,
        rot: rot
    });

    scheduleNavmeshWrite(mapName);
    return true;
}


function scheduleNavmeshWrite(mapName) {
    if (NavmeshWriteTimers[mapName]) {
        clearTimeout(NavmeshWriteTimers[mapName]);
    }

    NavmeshWriteTimers[mapName] = setTimeout(() => {
        const requestPath = path.join('D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/navmesh_requests', mapName);

        let lines = [];

        // Adiciona parâmetros extras se definidos
        const def = NavmeshDefinitions[mapName] || {};
        if (def.AgentRadius) lines.push(`AgentRadius: ${def.AgentRadius}`);
        if (def.AgentHeight) lines.push(`AgentHeight: ${def.AgentHeight}`);
        if (def.CellSize) lines.push(`CellSize: ${def.CellSize}`);
        if (def.AgentMaxClimb) lines.push(`AgentMaxClimb: ${def.AgentMaxClimb}`);
        if (def.AgentMaxClimb) lines.push(`WalkableSlopeAngle: ${def.AgentMaxSlope}`);

        // Adiciona os objetos
        const entries = NavmeshQueue[mapName] || [];
        for (const entry of entries) {
            lines.push(`ModelName: ${entry.modelName}`);
            lines.push(`PosX: ${entry.pos.x}`);
            lines.push(`PosY: ${entry.pos.y}`);
            lines.push(`PosZ: ${entry.pos.z}`);
            lines.push(`RotX: ${entry.rot.x}`);
            lines.push(`RotY: ${entry.rot.y}`);
            lines.push(`RotZ: ${entry.rot.z}`);
        }

        fs.writeFileSync(requestPath, lines.join('\n'), 'utf8');
        console.log(`[INFO] Arquivo de navmesh_request salvo: ${requestPath}`);

        NavmeshQueue[mapName] = []; // limpa fila após escrever
        delete NavmeshWriteTimers[mapName];
    }, 100);
}

function generateNavmesh(mapName, list) {
    if (!NavmeshDefinitions[mapName]) {
        return false;
    }
    const shutdownPath = `D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/shutdown_history/${mapName}`;
    if (fs.existsSync(shutdownPath)) {
        delete NavmeshInstances[mapName];
        fs.unlinkSync(shutdownPath); // se quiser
    }
       // Verifica se a instância já está rodando
    if (!NavmeshInstances[mapName]) {
        console.log(`[NAVMESH] Iniciando RecastDemo para: ${mapName}`);
        startRecastWithMap(mapName);
        NavmeshInstances[mapName] = true;
    }
    const requestPath = path.join('D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/navmesh_requests', mapName);
    let lines = [];
    // Adiciona parâmetros extras se definidos
    const def = NavmeshDefinitions[mapName] || {};
    if (def.AgentRadius) lines.push(`AgentRadius: ${def.AgentRadius}`);
    if (def.AgentHeight) lines.push(`AgentHeight: ${def.AgentHeight}`);
    if (def.CellSize) lines.push(`CellSize: ${def.CellSize}`);
    if (def.AgentMaxClimb) lines.push(`AgentMaxClimb: ${def.AgentMaxClimb}`);
    if (def.AgentMaxClimb) lines.push(`WalkableSlopeAngle: ${def.AgentMaxSlope}`);

    
    // Adiciona os objetos
    const entries = list || [];
    for (const entry of entries) {
        lines.push(`ModelName: ${PropHashToName[entry.modelHash.toString()]}.obj`);
        lines.push(`PosX: ${entry.pos.x}`);
        lines.push(`PosY: ${entry.pos.y}`);
        lines.push(`PosZ: ${entry.pos.z}`);
        lines.push(`RotX: ${entry.rot.x}`);
        lines.push(`RotY: ${entry.rot.y}`);
        lines.push(`RotZ: ${entry.rot.z}`);
    }
    fs.writeFileSync(requestPath, lines.join('\n'), 'utf8');
    console.log(`[INFO] Arquivo de navmesh_request salvo: ${requestPath}`);
    return true;
}

function isNavmeshBusy(mapName) {
    return fs.existsSync(`navmesh_requests/${mapName}`);
}


function sendPathRequest(mapName, requestID, startPos, targetPos) {
    //updateNavmeshActivity(mapName);
    const requestPath = path.join("D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/path_requests", mapName, `${requestID}.txt`);
    //if (fs.existsSync(requestPath)) {
    //    return;
    //}
    
    const content = `${startPos.x} ${startPos.z} ${startPos.y} ${targetPos.x} ${targetPos.z} ${targetPos.y}`;
    
    fs.mkdirSync(path.dirname(requestPath), { recursive: true });
    
    fs.mkdirSync(path.join("D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/path_outputs", mapName), { recursive: true });
    fs.writeFileSync(requestPath, content);
    
    console.log(`[INFO] Pedido de rota enviado para ${mapName} com ID ${requestID}`);
}

function sendOffmeshLink(mapName, list) {
    //updateNavmeshActivity(mapName);
    const offmeshConnectionsPath = path.join("D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/offmesh_inject", `${mapName}.txt`);
    //if (fs.existsSync(requestPath)) {
    //    return;
    //}
    //startX startY startZ endX endY endZ radius bidir area flags

    let content = "";
    for (const entry of list) {
        content = content + `${entry.startPos.x} ${entry.startPos.z} ${entry.startPos.y} ${entry.endPos.x} ${entry.endPos.z} ${entry.endPos.y} ${entry.radius} ${entry.bidir ? 1 : 0} ${entry.area || 63} ${entry.flags || 1}\n`;
    }
    
    fs.mkdirSync(path.dirname(offmeshConnectionsPath), { recursive: true });
    fs.writeFileSync(offmeshConnectionsPath, content);
    
    console.log(`[INFO] Pedido de offmesh connection enviado para ${mapName}`);
}

function checkPathResult(mapName, requestID) {
    //updateNavmeshActivity(mapName);
    const outputPath = path.join("D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/path_outputs", mapName, `${requestID}.txt`);

    if (fs.existsSync(outputPath)) {
        const content = fs.readFileSync(outputPath, "utf-8");
        const lines = content.trim().split("\n").map(line => {
            const [x, y, z] = line.trim().split(" ").map(v => parseFloat(v)); // <-- aqui
            return {
                x: parseFloat(x.toFixed(6)),
                y: parseFloat(y.toFixed(6)),
                z: parseFloat(z.toFixed(6))
            };
        });

        fs.unlinkSync(outputPath); // Limpa após leitura
        return { finished: true, path: lines };
    }

    return { finished: false };
}

function requestPathAndWait(mapName, requestID, startPos, targetPos, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const requestsDir = 'D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/path_requests/' + mapName;
        const outputsDir = 'D:/Program Files/Blender Foundation/Blender 4.3/scripts/navmesh_server/recast/recastnavigation/build/RecastDemo/Debug/path_outputs/';
        const fileName = `${requestID}.txt`;
        const requestFile = path.join(requestsDir, fileName);
        const outputFile = path.join(outputsDir, fileName);

        // 1. Cria o diretório de requests se não existir
        fs.mkdirSync(requestsDir, { recursive: true });

        // 2. Escreve o pedido
        const content = `${startPos.x} ${startPos.z} ${startPos.y} ${targetPos.x} ${targetPos.z} ${targetPos.y}`;
        fs.writeFileSync(requestFile, content);

        // 3. Espera pela resposta
        const startTime = Date.now();
        const interval = setInterval(() => {
            if (fs.existsSync(outputFile)) {
                clearInterval(interval);
                const lines = fs.readFileSync(outputFile, 'utf-8').trim().split('\n');
                const pathPoints = lines.map(line => {
                    const [x, y, z] = line.split(' ').map(Number);
                    return { x, y, z };
                });

                fs.unlinkSync(outputFile); // Limpa após leitura
                resolve(pathPoints);
            } else if (Date.now() - startTime > timeoutMs) {
                clearInterval(interval);
                reject(new Error(`[TIMEOUT] Resposta não recebida para rota ${fileName}`));
            }
        }, 100);
    });
}


module.exports = {
    setNavmeshParams,
    addNavmeshObject,
    generateNavmesh,
    isNavmeshBusy,
    sendPathRequest,
    checkPathResult,
    requestPathAndWait,
    sendOffmeshLink
};