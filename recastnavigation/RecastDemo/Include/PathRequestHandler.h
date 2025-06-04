//
// Copyright (c) 2009-2010 Mikko Mononen memon@inside.org
//
// This software is provided 'as-is', without any express or implied
// warranty.  In no event will the authors be held liable for any damages
// arising from the use of this software.
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
// 1. The origin of this software must not be misrepresented; you must not
//    claim that you wrote the original software. If you use this software
//    in a product, an acknowledgment in the product documentation would be
//    appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//    misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.
//

#pragma once

#include <string>
#include <vector>
#include <fstream>

struct OffMeshConnectionStruct {
	float start[3];
	float end[3];
	float radius;
	int area;
	int flags;
	int bidirectional;
};

class PathRequestHandler
{
	
	public: 
		
		//struct Transform {
		//	std::string objPath;
		//	float pos[3];
		//	float rotDeg[3];  // {X, Y, Z}
		//};
		//int ExecuteOperations(int argc, char** argv);
		void mainLoopMonitor(const std::string& mapName);
		//bool checkShutdownRequest(const std::string& mapName);
	private:
};
