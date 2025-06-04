// build_navmesh_cli.cpp (cache inteligente + transformação de múltiplos objetos em tempo real)
#include <iostream>
#include <fstream>
#include <vector>
#include <string>
#include <random>
#include <cmath>
#include <sstream>
#include <unordered_map>
#include <filesystem>
#include <thread>
#include <chrono>

#include "Recast.h"
#include "DetourNavMesh.h"
#include "DetourNavMeshBuilder.h"
#include "DetourNavMeshQuery.h"
#include "RecastAlloc.h"
#include "RecastAssert.h"
#include "InputGeom.h"
#include "Sample_SoloMesh.h"
#include "PathRequestHandler.h"
#include <mutex>

#define GLM_ENABLE_EXPERIMENTAL
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtx/euler_angles.hpp>
#include <array>

using Vec3 = std::array<float, 3>;

std::vector<std::pair<Vec3, Vec3>> g_offMeshConnections;

auto lastRequestTime = std::chrono::steady_clock::now();
const auto inactivityTimeout = std::chrono::minutes(10); // ajuste o tempo como quiser

namespace fs = std::filesystem;

struct Transform {
    std::string objPath;
    float pos[3];
    float rotDeg[3];  // {X, Y, Z}
};

struct NavmeshParams {
    float agentRadius = 0.6f;
    float agentHeight = 2.0f;
    float cellSize = 0.3f;
    float agentMaxClimb = 0.5f;
    float walkableSlopeAngle = 45.0f; // Ângulo máximo de inclinação
};

struct MeshData
{
    std::vector<float> verts; // x, y, z
    std::vector<int> faces;   // índices (0-based)
};
dtNavMesh* g_navMesh = nullptr;
Sample_SoloMesh* g_sample = nullptr;

void mergeAndExportTransformedOBJs(const std::vector<Transform>& entries, const std::string& outputFile)
{
    std::ofstream out(outputFile);
    if (!out.is_open()) {
        std::cerr << "[ERRO] Não foi possível abrir arquivo de saída." << std::endl;
        return;
    }

    int vertexOffset = 1;
    for (const auto& tf : entries) {
        std::ifstream in(tf.objPath);
        if (!in.is_open()) {
            std::cerr << "[ERRO] Falha ao abrir: " << tf.objPath << std::endl;
            continue;
        }

        // Converte rotação de graus para radianos
        float radX = tf.rotDeg[0] * 3.14159265f / 180.0f;
        float radY = tf.rotDeg[1] * 3.14159265f / 180.0f;
        float radZ = tf.rotDeg[2] * 3.14159265f / 180.0f;

        float cx = cosf(radX), sx = sinf(radX);
        float cy = cosf(radY), sy = sinf(radY);
        float cz = cosf(radZ), sz = sinf(radZ);

        auto rotate = [&](float x, float y, float z, float& ox, float& oy, float& oz)
        {
            glm::vec3 position(tf.pos[0], tf.pos[1], tf.pos[2]);
            glm::vec3 rotationDegrees(tf.rotDeg[0], tf.rotDeg[1], tf.rotDeg[2]);

            // Ordem ZYX: GTA usa Y (heading), Z (bank), X (pitch), então podemos tentar ZYX
            glm::mat4 transform = glm::eulerAngleYXZ(
                glm::radians(rotationDegrees[2]), // Z (roll)
                glm::radians(rotationDegrees[1]), // Y (pitch)
                glm::radians(rotationDegrees[0])  // X (yaw)
            );

            glm::vec4 input = glm::vec4(x, y, z, 1.0f);
            glm::vec4 output = transform * input;

            ox = output.x + position.x;
            oy = output.y + position.y;
            oz = output.z + position.z;
        };



        std::string line;
        int vertexCount = 0;
        std::vector<std::string> faces;

        while (std::getline(in, line)) {
            if (line.rfind("v ", 0) == 0) {
                std::istringstream ss(line);
                std::string v;
                float x, y, z;
                ss >> v >> x >> y >> z;

                float xt, yt, zt;
                rotate(x, y, z, xt, yt, zt);

                out << "v " << xt << " " << yt << " " << zt << "\n";
                vertexCount++;
            }
            else if (line.rfind("f ", 0) == 0) {
                faces.push_back(line);
            }
        }

        // Faces com offset
        for (const std::string& f : faces) {
            std::istringstream ss(f);
            std::string pre, vi;
            ss >> pre;
            out << pre;
            while (ss >> vi) {
                size_t slash = vi.find('/');
                if (slash != std::string::npos) vi = vi.substr(0, slash);
                int index = std::stoi(vi) + vertexOffset - 1;
                out << " " << index;
            }
            out << "\n";
        }

        vertexOffset += vertexCount;
    }
}



bool performRaycast(const float* start, const float* end)
{
    // Simulação de raycast entre os pontos (pode ser substituído por implementação real)
    // Aqui sempre retorna true (sem obstruções). Ajustar conforme necessário.
    return true;
}
std::mutex navMutex;

void loadOffMeshConnections(const std::string& filename)
{
    std::ifstream file(filename);
    if (!file.is_open()) {
        std::cerr << "[ERRO] Falha ao abrir offmesh_connections: " << filename << std::endl;
        return;
    }

    std::vector<std::pair<Vec3, Vec3>> newConnections;
    std::string line;

    while (std::getline(file, line)) {
        std::istringstream ss(line);
        float ax, ay, az, bx, by, bz;
        int bidir = 1;
        int doRay = 0;

        if (ss >> ax >> ay >> az >> bx >> by >> bz >> bidir >> doRay) {
            Vec3 a = { ax, ay, az };
            Vec3 b = { bx, by, bz };

            newConnections.emplace_back(a, b);

            if (bidir) {
                newConnections.emplace_back(b, a);
            }
        }
    }

    file.close();

    std::lock_guard<std::mutex> lock(navMutex);
    g_offMeshConnections = std::move(newConnections);
    std::cout << "[INFO] Conexões offmesh carregadas: " << g_offMeshConnections.size() << std::endl;
}


void processPathRequests(const std::string& folder, const std::string& mapName)
{
    dtNavMesh* localNavMesh = nullptr;
    {
        std::lock_guard<std::mutex> lock(navMutex);
        localNavMesh = g_navMesh;
    }

    if (!localNavMesh || localNavMesh->getMaxTiles() == 0) {
        std::cerr << "[FATAL] NavMesh inválida ou vazia ao iniciar processPathRequests!" << std::endl;
        return;
    }

    if (!fs::exists(folder)) {
        std::cerr << "[ERRO] Pasta de solicitações não encontrada: " << folder << std::endl;
        return;
    }

    dtNavMeshQuery query;
    dtStatus status = query.init(localNavMesh, 2048);
    if (dtStatusFailed(status)) {
        std::cerr << "[FATAL] Falha ao inicializar dtNavMeshQuery." << std::endl;
        return;
    }

    dtQueryFilter filter;
    float ext[3] = {2.0f, 20.0f, 2.0f};

    for (const auto& entry : fs::directory_iterator(folder)) {
        if (!entry.is_regular_file()) continue;

        const std::string filePath = entry.path().string();
        std::cout << "[INFO] Processando arquivo: " << filePath << std::endl;

        std::ifstream in(filePath);
        if (!in.is_open()) {
            std::cerr << "[ERRO] Não foi possível abrir o arquivo: " << filePath << std::endl;
            continue;
        }

        float sx, sy, sz, ex, ey, ez;
        if (!(in >> sx >> sy >> sz >> ex >> ey >> ez)) {
            std::cerr << "[ERRO] Arquivo de rota inválido: " << filePath << std::endl;
            in.close();
            fs::remove(entry.path());
            continue;
        }
        in.close();

        float start[3] = {sx, sy, sz};
        float end[3]   = {ex, ey, ez};
        float ns[3], ne[3];
        dtPolyRef startRef = 0, endRef = 0;

        std::cout << "[DEBUG] start: " << sx << ", " << sy << ", " << sz << std::endl;
        std::cout << "[DEBUG] ext: " << ext[0] << ", " << ext[1] << ", " << ext[2] << std::endl;

        query.findNearestPoly(start, ext, &filter, &startRef, ns);
        query.findNearestPoly(end, ext, &filter, &endRef, ne);

        if (!startRef || !endRef) {
            std::cerr << "[ERRO] Ponto inicial ou final inválido: " << filePath << std::endl;
            fs::remove(entry.path());
            continue;
        }

        dtPolyRef path[256];
        int pathCount = 0;
        query.findPath(startRef, endRef, ns, ne, &filter, path, &pathCount, 256);

        if (pathCount <= 0) {
            std::cerr << "[ERRO] Nenhum caminho encontrado: " << filePath << std::endl;
            fs::remove(entry.path());
            continue;
        }

        float straightPath[256 * 3];
        unsigned char flags[256];
        dtPolyRef polys[256];
        int count = 0;
        query.findStraightPath(ns, ne, path, pathCount, straightPath, flags, polys, &count, 256, DT_STRAIGHTPATH_ALL_CROSSINGS);

        const std::string outputPath = "path_outputs\\" + mapName + "\\" + entry.path().filename().string();
        std::ofstream out(outputPath);
        if (!out.is_open()) {
            std::cerr << "[ERRO] Falha ao escrever caminho para: " << outputPath << std::endl;
            continue;
        }

        for (int i = 0; i < count; ++i) {
            out << straightPath[i * 3 + 0] << " "
                << straightPath[i * 3 + 2] << " "
                << straightPath[i * 3 + 1] << "\n";
        }
        out.close();
        fs::remove(entry.path());
    }
}

void launchPathProcessor(const std::string& folder, const std::string& mapName)
{
    std::thread([folder, mapName]() {
        while (true) {
            processPathRequests(folder, mapName);
            
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }).detach();
}

void PathRequestHandler::mainLoopMonitor(const std::string& mapName)
{
    const std::string navmeshRequestDir = "navmesh_requests/";
    const std::string navmeshRequestFile = navmeshRequestDir + mapName;
    const std::string objMergedPath = "obj_merged_" + mapName + ".obj";
    const std::string shutdownFile = "shutdown_requests/" + mapName;
    const std::string pathRequestFolder = "path_requests/" + mapName;
    const std::string offmeshInjectFolder = "offmesh_inject/" + mapName + ".txt";

    Sample_SoloMesh* g_sample = nullptr;

    //launchPathProcessor(pathRequestFolder, mapName); // inicia o processamento em thread

    while (true) {
        // Encerrar aplicação externamente
        if (fs::exists(shutdownFile)) {
            std::cout << "[INFO] Encerrando aplicação por solicitação externa." << std::endl;
            fs::remove(shutdownFile);
            break;
        }

        // Se foi solicitado reconstruir a navmesh
        if (fs::exists(navmeshRequestFile)) {
            std::ifstream in(navmeshRequestFile);
            if (in.is_open()) {
                std::string line;
                std::vector<Transform> transforms;
                NavmeshParams params;
                std::string mapRead;

                while (std::getline(in, line)) {
                    if (line.find("ModelName") != std::string::npos) {
                        if (!transforms.empty() && transforms.back().objPath.empty()) {
                            transforms.pop_back(); // Remove objeto vazio anterior
                        }
                        Transform tf{};
                        tf.objPath = "D:/ExportGTA/saida/" + line.substr(line.find(":") + 2);
                        transforms.push_back(tf);
                    } else if (line.find("PosX") != std::string::npos) {
                        transforms.back().pos[0] = std::stof(line.substr(line.find(":") + 1));
                    } else if (line.find("PosY") != std::string::npos) {
                        transforms.back().pos[1] = std::stof(line.substr(line.find(":") + 1));
                    } else if (line.find("PosZ") != std::string::npos) {
                        transforms.back().pos[2] = std::stof(line.substr(line.find(":") + 1));
                    } else if (line.find("RotX") != std::string::npos) {
                        transforms.back().rotDeg[0] = std::stof(line.substr(line.find(":") + 1));
                    } else if (line.find("RotY") != std::string::npos) {
                        transforms.back().rotDeg[1] = std::stof(line.substr(line.find(":") + 1));
                    } else if (line.find("RotZ") != std::string::npos) {
                        transforms.back().rotDeg[2] = std::stof(line.substr(line.find(":") + 1));
                    } else if (line.find("AgentRadius") != std::string::npos) {
                        params.agentRadius = std::stof(line.substr(line.find(":") + 1));
                    } else if (line.find("AgentHeight") != std::string::npos) {
                        params.agentHeight = std::stof(line.substr(line.find(":") + 1));
                    } else if (line.find("CellSize") != std::string::npos) {
                        params.cellSize = std::stof(line.substr(line.find(":") + 1));
                    } else if (line.find("AgentMaxClimb") != std::string::npos) {
                        params.agentMaxClimb = std::stof(line.substr(line.find(":") + 1));
                    } else if (line.find("WalkableSlopeAngle") != std::string::npos) {
                        params.walkableSlopeAngle = std::stof(line.substr(line.find(":") + 1));
                    } else if (line.find("MapName") != std::string::npos) {
                        mapRead = line.substr(line.find(":") + 1);
                        mapRead.erase(0, mapRead.find_first_not_of(" \t\r\n")); // limpa espaços
                    }
                }
                in.close();
                lastRequestTime = std::chrono::steady_clock::now();
                // Gera .obj final com transformações aplicadas
                mergeAndExportTransformedOBJs(transforms, objMergedPath);

                // Gera navmesh a partir da geometria
                BuildContext ctx;
                InputGeom geom;
                if (!geom.load(&ctx, objMergedPath)) {
                    std::cerr << "[ERRO] Falha ao carregar geometria." << std::endl;
                    continue;
                }

                if (g_sample) {
                    delete g_sample;
                    g_sample = nullptr;
                    g_navMesh = nullptr;
                }

                g_sample = new Sample_SoloMesh();
                g_sample->setContext(&ctx);
                g_sample->applySettings(params.agentRadius, params.agentHeight, params.cellSize, params.agentMaxClimb, params.walkableSlopeAngle);

                
                
                g_sample->handleMeshChanged(&geom);
                if (g_sample && g_sample->getInputGeom()) {
                    g_sample->setOffMeshConnectionsFromFile(offmeshInjectFolder);
                    std::cout << "Offmesh Connections Set" << std::endl;
                }

                //g_sample->setOffMeshConnectionsFromFile();
                if (!g_sample->handleBuild()) {
                    std::cerr << "[ERRO] Falha ao construir navmesh." << std::endl;
                    delete g_sample;
                    g_sample = nullptr;
                    continue;
                }

                {
                    std::lock_guard<std::mutex> lock(navMutex);
                    g_navMesh = g_sample->getNavMesh();
                }

                std::cout << "[INFO] NavMesh carregada com sucesso." << std::endl;
                fs::remove(navmeshRequestFile);
            }
        }
        
        if (!std::filesystem::is_empty(pathRequestFolder)) {
            lastRequestTime = std::chrono::steady_clock::now();
        }

        if (std::chrono::steady_clock::now() - lastRequestTime > inactivityTimeout) {
            std::cout << "[INFO] Encerrando por inatividade." << std::endl;
            std::ofstream out("shutdown_history/" + mapName);
            out << "closed at: " << std::time(nullptr) << std::endl;
            break;
        }
        processPathRequests(pathRequestFolder, mapName);

        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    if (g_sample) {
        delete g_sample;
        g_sample = nullptr;
        g_navMesh = nullptr;
    }
}