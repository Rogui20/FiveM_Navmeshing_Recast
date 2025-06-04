function tofloat(v)
    return v * 1.0
end

RegisterNUICallback("pathResult", function(data)
    if data.finished then
        for _, coord in ipairs(data.path) do
            coord.x = tofloat(coord.x)
            coord.y = tofloat(coord.y)
            coord.z = tofloat(coord.z)
        end
        NavmeshQueue[data.requestID] = {true, data.path, 2}
    end
end)

-- Envia um objeto para ser adicionado à fila de navmesh
function AddNavmeshObject(mapName, modelName, pos, rot)
    SendNUIMessage({
        type = "addObjectToQueue",
        mapName = mapName,
        modelHash = modelName,
        pos = pos,
        rot = rot
    })
end

-- Envia um objeto para ser adicionado à fila de navmesh
function GenerateNavmesh(mapName, List)
    SendNUIMessage({
        type = "generateNavmesh",
        mapName = mapName,
        list = List
    })
end
-- Define os parâmetros da navmesh para o mapa atual
function SetNavmeshParams(mapName, radius, height, cellSize, AgentMaxClimb, AgentMaxSlope)
    SendNUIMessage({
        type = "defineNavmeshParams",
        mapName = mapName,
        radius = radius,
        height = height,
        cellSize = cellSize,
        agentMaxClimb = AgentMaxClimb,
        agentMaxSlope = AgentMaxSlope, -- Inclinação máxima do agente
    })
end

-- Solicita construção da navmesh (será feita automaticamente 100ms após alteração na fila)
function RequestNavmeshBuild(mapName)
    SendNUIMessage({
        type = "requestNavmeshBuild",
        map = mapName
    })
end

function RequestPath(MapName, RequestID, StartPos, GoalPos)
    SendNUIMessage({
    type = "requestPath",
    mapName = MapName,
    requestID = RequestID,
    startPos = { x = StartPos.x, y = StartPos.y, z = StartPos.z },
    targetPos = { x = GoalPos.x, y = GoalPos.y, z = GoalPos.z }
    })
end

function CheckPathResult(MapName, RequestID)
    SendNUIMessage({
        type = "checkPathResult",
        mapName = MapName,
        requestID = RequestID
    })
end

function SendOffMeshLink(MapName, List)
    SendNUIMessage({
    type = "sendOffmeshLink",
    mapName = MapName,
    list = List
	})
end
