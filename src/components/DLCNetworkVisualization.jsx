import React, { useState, useEffect, useRef, useMemo } from 'react';
import Papa from 'papaparse';
import * as d3 from 'd3';

const DLCNetworkVisualization = () => {
  const [darkMode, setDarkMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [regions, setRegions] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [routeToDLC, setRouteToDLC] = useState({});
  const [selectedNodeConnections, setSelectedNodeConnections] = useState([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  
  // Color scale for regions, memoized to prevent recreation on every render
  const regionColors = useMemo(() => ({
    'US': '#2563eb',
    'UK': '#059669',
    'DE': '#d97706',
    'CA': '#7c3aed',
    'FR': '#db2777',
    'CH': '#facc15',
    'AT': '#0891b2',
    'NL': '#ef4444',
    'Unknown': '#6b7280'
  }), []);
  
  // Check if mobile view
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Load and process the data
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        
        // Load route lookup data
        const routeLookupResponse = await fetch('/route_lookup.csv').then(response => response.text());
        const routeLookupData = Papa.parse(routeLookupResponse, {
          header: true,
          skipEmptyLines: true
        }).data;
        
        // Load DLC network data
        const dlcNetworkResponse = await fetch('/dlc_network.csv').then(response => response.text());
        const dlcNetworkData = Papa.parse(dlcNetworkResponse, {
          header: true,
          skipEmptyLines: true
        }).data;
        
        // Create maps
        const routeToShortName = {};
        const routeToRegion = {};
        const shortNameToRoute = {};
        const shortNameToFullName = {};
        
        routeLookupData.forEach(item => {
          if (item.Route && item["Short Name"]) {
            routeToShortName[item.Route] = item["Short Name"];
            routeToRegion[item.Route] = item.Region;
            shortNameToRoute[item["Short Name"]] = item.Route;
            shortNameToFullName[item["Short Name"]] = item.Route;
          }
        });
        
        // Process network data
        const processedNodes = [];
        const processedEdges = [];
        const nodeSet = new Set();
        const connections = {};
        const dlcMap = {};
        const shortNameToInfo = {};
        const routesWithRequiredDLCs = new Set();
        
        // Track all DLC short names first to get full info
        const allDLCShortNames = new Set();
        dlcNetworkData.forEach(item => {
          if (item["Required DLC"]) {
            const requiredDLCs = item["Required DLC"].split(',')
              .map(dlc => dlc.trim())
              .filter(Boolean);
            requiredDLCs.forEach(dlc => allDLCShortNames.add(dlc));
          }
          if (item.Route) {
            allDLCShortNames.add(item.Route.trim());
          }
        });
        
        // Create a map of all short names to their info (even those not in lookup)
        allDLCShortNames.forEach(shortName => {
          const fullName = shortNameToRoute[shortName] || null;
          const region = fullName ? routeToRegion[fullName] : "Unknown";
          
          shortNameToInfo[shortName] = {
            shortName,
            fullName,
            region,
            inLookup: !!fullName
          };
        });
        
        dlcNetworkData.forEach(item => {
          const sourceRoute = item.Route.trim();
          if (!sourceRoute) return;
          
          // Add source route if not already added AND it exists in the lookup
          if (!nodeSet.has(sourceRoute) && shortNameToInfo[sourceRoute]?.inLookup) {
            nodeSet.add(sourceRoute);
            
            processedNodes.push({
              id: sourceRoute,
              label: sourceRoute,
              region: shortNameToInfo[sourceRoute].region,
              fullName: shortNameToInfo[sourceRoute].fullName || sourceRoute
            });
          }
          
          // Track DLCs for each route
          if (!dlcMap[sourceRoute]) {
            dlcMap[sourceRoute] = [];
          }
          
          if (item["Required DLC"]) {
            const requiredDLCs = item["Required DLC"].split(',').map(dlc => dlc.trim()).filter(Boolean);
            
            // If this route has required DLCs, mark it
            if (requiredDLCs.length > 0) {
              routesWithRequiredDLCs.add(sourceRoute);
            }
            
            // Map required DLCs to their full info (trim whitespace)
            const dlcInfoList = requiredDLCs.map(dlc => {
              const trimmedDLC = dlc.trim();
              return {
                shortName: trimmedDLC,
                fullName: shortNameToInfo[trimmedDLC]?.fullName,
                region: shortNameToInfo[trimmedDLC]?.region || "Unknown",
                inLookup: !!shortNameToInfo[trimmedDLC]?.inLookup
              };
            });
            
            dlcMap[sourceRoute].push({
              loco: item.Loco,
              requiredDLCs: dlcInfoList
            });
            
            // Only add connections to the graph for DLCs in the lookup
            requiredDLCs.forEach(targetRoute => {
              if (!targetRoute || !shortNameToInfo[targetRoute]?.inLookup) return;
              
              // Add target route if not already added
              if (!nodeSet.has(targetRoute)) {
                nodeSet.add(targetRoute);
                
                processedNodes.push({
                  id: targetRoute,
                  label: targetRoute,
                  region: shortNameToInfo[targetRoute].region,
                  fullName: shortNameToInfo[targetRoute].fullName || targetRoute
                });
              }
              
              // Only create edges between nodes that are both in the lookup
              if (shortNameToInfo[sourceRoute]?.inLookup && shortNameToInfo[targetRoute]?.inLookup) {
                // Create connection key - DO NOT SORT to maintain direction
                const connectionKey = `${sourceRoute}-${targetRoute}`;
                
                // Add edge if not already added
                if (!connections[connectionKey]) {
                  connections[connectionKey] = {
                    id: connectionKey,
                    source: sourceRoute,
                    target: targetRoute,
                    locos: [item.Loco]
                  };
                } else {
                  connections[connectionKey].locos.push(item.Loco);
                }
              }
            });
          }
        });
        
        // Convert connections to edges
        Object.values(connections).forEach(conn => {
          processedEdges.push(conn);
        });
        
        // Get unique regions
        const uniqueRegions = [...new Set(processedNodes.map(node => node.region))];
        
        setNodes(processedNodes);
        setEdges(processedEdges);
        setRegions(uniqueRegions);
        setRouteToDLC(dlcMap);
        setLoading(false);
      } catch (err) {
        console.error("Error loading data:", err);
        setError("Failed to load data. Please try again.");
        setLoading(false);
      }
    };
    
    loadData();
  }, []);

  // Render the graph using D3
  useEffect(() => {
    if (loading || !nodes.length || !edges.length || !svgRef.current) return;
    
    const width = containerRef.current.clientWidth;
    const height = isMobile ? 400 : containerRef.current.clientHeight;
    
    // Clear previous SVG content
    d3.select(svgRef.current).selectAll("*").remove();
    
    // Create a zoomable container
    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height]);
      
    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
      
    svg.call(zoom);
    
    // Add a group for the graph that will be transformed by zoom
    const g = svg.append("g")
      .attr("class", "graph-container");
    
    // Create simulation
    const simulation = d3.forceSimulation(nodes)
  .force("link", d3.forceLink(edges).id(d => d.id).distance(30))
  .force("charge", d3.forceManyBody().strength(-100))
  .force("center", d3.forceCenter(width / 2, height / 2).strength(0.1))
  .force("collide", d3.forceCollide().radius(20))
  .force("x", d3.forceX(width / 2).strength(0.07))
  .force("y", d3.forceY(height / 2).strength(0.07));
    
    // Draw links
    const link = g.append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(edges)
      .enter()
      .append("line")
      .attr("class", "link")
      .attr("stroke", darkMode ? "#aaa" : "#999")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", 1);
    
    // Draw nodes
    const node = g.append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .enter()
      .append("g")
      .attr("class", "node")
      .call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended))
      .on("click", handleNodeClick);
    
    // Circle for the nodes
    node.append("circle")
      .attr("r", 12)  // Smaller node radius
      .attr("fill", d => regionColors[d.region] || "#ccc")
      .attr("stroke", darkMode ? "#fff" : "#333")
      .attr("stroke-width", 1.5);
    
    // Labels for the nodes
    node.append("text")
      .attr("dy", "0.35em")
      .attr("text-anchor", "middle")
      .attr("fill", darkMode ? "#fff" : "#000")
      .style("font-size", "10px")
      .style("font-weight", "bold")
      .text(d => d.label);
    
    // Update positions during simulation
    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);
      
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });
    
    // Double click to reset zoom
    svg.on("dblclick.zoom", () => {
      svg.transition().duration(750).call(
        zoom.transform,
        d3.zoomIdentity
      );
    });
    
    // Drag functions
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    
    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }
    
    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
    
    // Find all required DLCs for the selected node
    function findAllRequiredDLCs(routeId) {
      if (!routeToDLC[routeId]) return [];
      
      // Extract all required DLCs from all locomotives for this route
      const allRequiredDLCs = new Set();
      routeToDLC[routeId].forEach(item => {
        item.requiredDLCs.forEach(dlc => {
          allRequiredDLCs.add(dlc.shortName.trim());
        });
      });
      
      return Array.from(allRequiredDLCs);
    }
    
    // Handle node click
    function handleNodeClick(event, d) {
      // Find all required DLCs for this route
      const requiredDLCs = findAllRequiredDLCs(d.id);
      
      // Highlight the clicked node and its required DLCs
      node.select("circle")
        .attr("stroke-width", node => {
          if (node.id === d.id) return 3;
          if (requiredDLCs.includes(node.id)) return 2;
          return 1.5;
        })
        .attr("stroke", node => {
          if (node.id === d.id) return "#ff0";
          if (requiredDLCs.includes(node.id)) return "#f80";
          return darkMode ? "#fff" : "#333";
        });
      
      // Highlight edges to required DLCs
      link
        .attr("stroke", conn => {
          if (conn.source.id === d.id && requiredDLCs.includes(conn.target.id)) {
            return "#f80";
          }
          return darkMode ? "#aaa" : "#999";
        })
        .attr("stroke-width", conn => {
          if (conn.source.id === d.id && requiredDLCs.includes(conn.target.id)) {
            return 2;
          }
          return 1;
        })
        .attr("stroke-opacity", conn => {
          if (conn.source.id === d.id && requiredDLCs.includes(conn.target.id)) {
            return 1;
          }
          return 0.6;
        });
      
      setSelectedNode(d);
      setSelectedNodeConnections(requiredDLCs);
    }
    
    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [nodes, edges, darkMode, isMobile, loading, containerRef, routeToDLC, regionColors]);

  // Toggle dark mode
  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
  };

  // Render loading state
  if (loading) {
    return (
      <div className={`flex items-center justify-center h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className="text-center">
          <div className="text-3xl font-bold mb-4">Loading DLC Network Data...</div>
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className={`flex items-center justify-center h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className="text-center">
          <div className="text-3xl font-bold mb-4">Error</div>
          <div className="text-red-500">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
      {/* Header */}
      <header className={`p-4 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'} shadow`}>
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold">Train Sim World Route Layering</h1>
          <button 
            onClick={toggleDarkMode}
            className={`px-4 py-2 rounded-md ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
          >
            {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
        </div>
      </header>
      
      {/* Legend */}
      <div className={`p-2 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
        <div className="container mx-auto">
          <div className="flex flex-wrap gap-2 items-center text-sm">
            <span className="font-semibold">Regions:</span>
            {regions.map(region => (
              <div key={region} className="flex items-center">
                <div 
                  className="w-4 h-4 rounded-full mr-1" 
                  style={{ backgroundColor: regionColors[region] || '#ccc' }}
                ></div>
                <span>{region}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Main content */}
      <div 
        className={`flex ${isMobile ? 'flex-col' : 'flex-row'} flex-1 overflow-hidden`}
        ref={containerRef}
      >
        {/* Graph area */}
        <div className={`${isMobile ? 'h-96' : 'flex-1'} overflow-hidden ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
          <svg ref={svgRef} className="w-full h-full"></svg>
        </div>
        
        {/* Info panel */}
        <div className={`${isMobile ? 'h-auto' : 'w-1/3'} overflow-y-auto p-4 ${darkMode ? 'bg-gray-800' : 'bg-white'} border-l ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          {selectedNode ? (
            <div>
              <h2 className="text-xl font-bold mb-2">{selectedNode.fullName || selectedNode.label}</h2>
              <div className="mb-3">
                <span className="font-semibold">Region:</span> {selectedNode.region}
              </div>
              
              <div className="mb-4">
                <h3 className="text-lg font-semibold mb-2">Required DLCs For Additional Playable Trains</h3>
                {routeToDLC[selectedNode.id] && routeToDLC[selectedNode.id].length > 0 ? (
                  <div className={`overflow-x-auto ${darkMode ? 'bg-gray-700' : 'bg-gray-50'} rounded-md`}>
                    <table className="min-w-full divide-y divide-gray-500">
                      <thead className={darkMode ? 'bg-gray-800' : 'bg-gray-100'}>
                        <tr>
                          <th className="px-3 py-2 text-left text-sm font-medium">Locomotive</th>
                          <th className="px-3 py-2 text-left text-sm font-medium">Included in</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-300">
                        {routeToDLC[selectedNode.id].map((item, index) => (
                          <tr key={index} className={index % 2 === 0 ? (darkMode ? 'bg-gray-700' : 'bg-white') : (darkMode ? 'bg-gray-600' : 'bg-gray-50')}>
                            <td className="px-3 py-2 text-sm">{item.loco}</td>
                            <td className="px-3 py-2 text-sm">
                              <div className="flex flex-wrap gap-1">
                                {item.requiredDLCs.map((dlc, i) => (
                                  <span 
                                    key={i} 
                                    className={`inline-block px-2 py-1 rounded-md text-xs ${selectedNodeConnections.includes(dlc.shortName.trim()) ? 'font-bold' : ''}`}
                                    style={{
                                      backgroundColor: regionColors[dlc.region] || '#ccc',
                                      color: ['US', 'UK', 'CA', 'FR', 'CH', 'NL'].includes(dlc.region) ? 'black' : 'white',
                                      border: selectedNodeConnections.includes(dlc.shortName.trim()) 
                                        ? '2px solid #ff0' 
                                        : 'none'
                                    }}
                                    title={dlc.fullName || dlc.shortName.trim()}
                                  >
                                    {dlc.shortName}
                                    {dlc.fullName && (
                                      <span 
                                        className="block text-xs mt-1"
                                        style={{ 
                                          opacity: 0.85,
                                          fontWeight: 'normal'
                                        }}
                                      >
                                        {dlc.fullName}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>No DLC requirements found for {selectedNode.label}.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <p className="text-xl font-semibold mb-2">Select a node to view details</p>
              <p className="text-gray-500">Click on any DLC node in the network to see its requirements and connections</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Footer */}
      <footer className={`p-3 text-center text-sm ${darkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600'}`}>
        <p>Click on nodes to see details | updated April 2025</p>
      </footer>
    </div>
  );
};

export default DLCNetworkVisualization;