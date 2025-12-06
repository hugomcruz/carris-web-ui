// Internationalization support
let currentLang = 'pt';
let translations = {};

// Load language file
async function loadLanguage(lang) {
    try {
        const response = await fetch(`/lang/${lang}.json`);
        translations = await response.json();
        currentLang = lang;
        localStorage.setItem('preferredLang', lang);
        applyTranslations();
    } catch (error) {
        console.error('Error loading language file:', error);
    }
}

// Apply translations to page
function applyTranslations() {
    // Update elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[key]) {
            el.textContent = translations[key];
        }
    });
    
    // Update placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (translations[key]) {
            el.placeholder = translations[key];
        }
    });
    
    // Update titles
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (translations[key]) {
            el.title = translations[key];
        }
    });
    
    // Update detail panel if visible
    if (selectedBusId && allVehicles.length > 0) {
        const vehicle = allVehicles.find(v => v.id === selectedBusId);
        if (vehicle) {
            updateDetailPanel(vehicle);
        }
    }
}

// Get translation
function t(key) {
    return translations[key] || key;
}

// Store markers by vehicle ID
const markers = {};

// Store stop markers
const stopMarkers = L.layerGroup();

// Store current route shape layer
let currentRouteShape = null;

// Store current vehicle track layer
let currentVehicleTrack = null;

// Store current stop shapes layer group
let currentStopShapes = null;

// Track if this is the first load
let isFirstLoad = true;

// Store all vehicles for filtering
let allVehicles = [];
let activeRouteFilter = '';

// Track if buses are hidden (when one is selected)
let busesHidden = false;
let selectedBusId = null;

// Store shape points for selected bus
let selectedBusShapePoints = null;

// Store filtered route shapes
let filteredRouteShapes = null;

// Track last update time
let lastUpdateTime = null;

// User location tracking
let userLocationMarker = null;
let userLocationCircle = null;
let watchId = null;

// Backend API URL configuration
// Use injected config from container, or fallback to auto-detection
const API_URL = (window.APP_CONFIG && window.APP_CONFIG.API_URL) 
    ? window.APP_CONFIG.API_URL
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:8000' 
        : `${window.location.protocol}//${window.location.hostname}:8000`);

// Socket.io connection
const socket = io(API_URL);

// Initialize map centered on Lisbon (adjust coordinates as needed)
const map = L.map('map').setView([38.7223, -9.1393], 12);

// Add CartoDB Positron tiles (neutral, light gray map)
// Add OpenStreetMap tiles
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19
}).addTo(map);

// Add click handler to map to reset everything
map.on('click', () => {
    // Show all buses if they were hidden
    if (busesHidden) {
        Object.keys(markers).forEach(id => {
            markers[id].setOpacity(1);
        });
        busesHidden = false;
    }
    
    // Reset selection state
    selectedBusId = null;
    selectedBusShapePoints = null;
    
    // Show all stops again
    stopMarkers.eachLayer(marker => {
        marker.setStyle({ opacity: 1, fillOpacity: 1 });
    });
    
    // Remove all shapes
    if (currentRouteShape) {
        map.removeLayer(currentRouteShape);
        currentRouteShape = null;
    }
    if (currentVehicleTrack) {
        map.removeLayer(currentVehicleTrack);
        currentVehicleTrack = null;
    }
    if (currentStopShapes) {
        map.removeLayer(currentStopShapes);
        currentStopShapes = null;
    }
    
    // Close detail panel
    document.getElementById('detail-panel').classList.remove('open');
});

// Add stop markers layer to map
// Use Canvas renderer for better performance with many markers
const canvasRenderer = L.canvas();
stopMarkers.addTo(map);

// Function to get stop radius based on zoom level
function getStopRadius(zoom) {
    if (zoom < 12) return 2;
    if (zoom < 14) return 3;
    if (zoom < 16) return 4;
    return 5;
}

// Fetch and display bus stops
async function loadBusStops() {
    try {
        const response = await fetch(`${API_URL}/api/stops`);
        const stops = await response.json();
        
        console.log(`Loading ${stops.length} bus stops`);
        
        const initialRadius = getStopRadius(map.getZoom());

        stops.forEach(stop => {
            const marker = L.circleMarker([stop.lat, stop.lng], {
                renderer: canvasRenderer,
                radius: initialRadius,
                fillColor: "#FFD700",
                color: "#FF8C00",
                weight: 1,
                opacity: 1,
                fillOpacity: 1
            });
            
            // Store stop ID and routes on the marker for filtering
            marker._stopId = stop.id;
            marker._routes = stop.routes || '';
            
            // Fetch details only when user clicks on the marker
            marker.on('click', async function(e) {
                // Stop event from propagating to map
                L.DomEvent.stopPropagation(e);
                
                // Close detail panel
                document.getElementById('detail-panel').classList.remove('open');
                
                try {
                    // Show all buses if they were hidden
                    if (busesHidden) {
                        Object.keys(markers).forEach(id => {
                            markers[id].setOpacity(1);
                        });
                        busesHidden = false;
                        selectedBusId = null;
                        selectedBusShapePoints = null;
                    }
                    
                    // Show all stops again
                    stopMarkers.eachLayer(marker => {
                        marker.setStyle({ opacity: 1, fillOpacity: 1 });
                    });
                    
                    // Fetch stop details
                    const response = await fetch(`${API_URL}/api/stops/${stop.id}`);
                    const details = await response.json();
                    
                    let tooltipContent = `<div style="font-weight: bold;">${details.stop_name}</div>`;
                    if (details.routes) {
                        tooltipContent += `<div style="margin-top: 5px; font-size: 11px;">${t('tooltipRoutes')}: ${details.routes}</div>`;
                    }
                    
                    marker.bindTooltip(tooltipContent, {
                        permanent: false,
                        direction: 'top'
                    }).openTooltip();
                    
                    // Remove previous stop shapes if they exist
                    if (currentStopShapes) {
                        map.removeLayer(currentStopShapes);
                    }
                    
                    // Remove vehicle route shape if it exists
                    if (currentRouteShape) {
                        map.removeLayer(currentRouteShape);
                        currentRouteShape = null;
                    }
                    
                    // Remove vehicle track if it exists
                    if (currentVehicleTrack) {
                        map.removeLayer(currentVehicleTrack);
                        currentVehicleTrack = null;
                    }
                    
                    // Fetch and display all route shapes for this stop
                    const shapesResponse = await fetch(`${API_URL}/api/shapes/stop/${stop.id}`);
                    const shapes = await shapesResponse.json();
                    
                    if (shapes.length > 0) {
                        currentStopShapes = L.layerGroup();
                        
                        shapes.forEach(shape => {
                            const polyline = L.polyline(shape.points, {
                                color: '#28a745',
                                weight: 3,
                                opacity: 0.7
                            });
                            polyline.addTo(currentStopShapes);
                        });
                        
                        currentStopShapes.addTo(map);
                        console.log(`Displayed ${shapes.length} route shapes for stop ${stop.id}`);
                    }
                } catch (error) {
                    console.error('Error fetching stop details:', error);
                }
            });
            
            stopMarkers.addLayer(marker);
        });
        
        console.log('Bus stops loaded successfully');
    } catch (error) {
        console.error('Error loading bus stops:', error);
    }
}

// Load bus stops when page loads
loadBusStops();

// Note: Marker resizing on zoom disabled for better performance
// Load bus stops when page loads
loadBusStops();

// Note: Marker resizing is now handled by CSS for better performance

// Update map zoom class for CSS scaling and update stop radii
function handleZoomEnd() {
    const zoom = map.getZoom();
    const mapContainer = document.getElementById('map');
    
    // Update CSS classes for vehicle scaling
    mapContainer.classList.remove('map-zoom-low', 'map-zoom-12', 'map-zoom-13', 'map-zoom-14', 'map-zoom-15');
    
    if (zoom < 12) {
        mapContainer.classList.add('map-zoom-low');
    } else if (zoom >= 12 && zoom < 16) {
        mapContainer.classList.add(`map-zoom-${zoom}`);
    }
    
    // Update stop marker radii (Canvas redraw is fast)
    const newRadius = getStopRadius(zoom);
    stopMarkers.eachLayer(layer => {
        if (layer.setRadius) {
            layer.setRadius(newRadius);
        }
    });
}

// Add zoom event listener
map.on('zoomend', handleZoomEnd);

// Initialize
handleZoomEnd();

// Custom bus icon
const busIcon = L.icon({
    iconUrl: 'bus-icon.svg',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16]
});

// Create a custom div icon with route label (Fixed size, scaled via CSS)
function createBusMarkerWithLabel(route, isTram = false, bearing = 0) {
    // Base scale is always 1.0, CSS handles the visual scaling
    const scale = 1.0;
    
    const iconUrl = isTram ? 'tram-icon.svg' : 'bus-icon.svg';
    const baseIconWidth = isTram ? 96 : 32;
    const baseIconHeight = isTram ? 48 : 32;
    
    // Fixed dimensions based on scale 1.0
    const iconWidth = baseIconWidth;
    const iconHeight = baseIconHeight;
    const iconAnchorX = isTram ? 48 : 16;
    const iconAnchorY = isTram ? 48 : 32;
    const popupAnchorY = isTram ? -48 : -32;
    const labelOffset = -16;
    const fontSize = 10;
    const totalHeight = isTram ? 66 : 50;
    
    // Convert bearing to rotation (bearing is 0° = North, 90° = East, 180° = South, 270° = West)
    // The SVG arrow points right (East = 90°), so subtract 90° to align with compass bearing
    const rotation = (parseFloat(bearing) || 0) - 90;
    
    // Arrow positioned in the center of the icon with white color and shadow
    const pointerStyle = `left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(${rotation}deg);`;
    const arrowSvg = `<svg width="14" height="14" viewBox="0 0 16 16" style="display: block; filter: drop-shadow(0px 0px 2px rgba(0,0,0,0.8));"><path d="M2 8 L12 8 L8 4 M12 8 L8 12" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    
    return L.divIcon({
        html: `
            <div style="text-align: center; position: relative;">
                <div style="
                    font-size: ${fontSize}px;
                    font-weight: bold;
                    color: white;
                    white-space: nowrap;
                    position: absolute;
                    top: ${labelOffset}px;
                    left: 50%;
                    transform: translateX(-50%);
                    text-shadow: 0 0 3px black, 0 0 3px black, 0 0 3px black;
                ">${route}</div>
                <img src="${iconUrl}" style="width: ${iconWidth}px; height: ${iconHeight}px; display: block;">
                <div style="position: absolute; ${pointerStyle}">${arrowSvg}</div>
            </div>
        `,
        className: 'bus-marker-with-label',
        iconSize: [iconWidth, totalHeight],
        iconAnchor: [iconAnchorX, iconAnchorY],
        popupAnchor: [0, popupAnchorY]
    });
}

// Update connection status
function updateConnectionStatus(connected) {
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('connection-status');
    
    if (connected) {
        statusIndicator.className = 'status-indicator status-connected';
        statusText.textContent = 'Connected';
    } else {
        statusIndicator.className = 'status-indicator status-disconnected';
        statusText.textContent = 'Disconnected';
    }
}

// Format time
function formatTime() {
    const now = new Date();
    return now.toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false
    });
}

// Update current time display
function updateCurrentTime() {
    document.getElementById('current-time').textContent = formatTime();
}

// Update last update display
function updateLastUpdateDisplay() {
    if (!lastUpdateTime) {
        document.getElementById('last-update').textContent = '-';
        return;
    }
    
    const now = Date.now();
    const secondsAgo = Math.floor((now - lastUpdateTime) / 1000);
    
    if (secondsAgo < 60) {
        document.getElementById('last-update').textContent = `${secondsAgo}s ago`;
    } else {
        const minutesAgo = Math.floor(secondsAgo / 60);
        document.getElementById('last-update').textContent = `${minutesAgo}m ago`;
    }
}

// Update current time every second
setInterval(updateCurrentTime, 1000);
updateCurrentTime();

// Update last update display every second
setInterval(updateLastUpdateDisplay, 1000);
updateLastUpdateDisplay();

// Function to update route visualization for selected bus
function updateSelectedBusRoute(lat, lng) {
    if (!selectedBusShapePoints || selectedBusShapePoints.length === 0) {
        return;
    }
    
    // Find closest point on shape to current bus position
    let currentIndex = 0;
    let minDist = Infinity;
    for (let i = 0; i < selectedBusShapePoints.length; i++) {
        const dist = Math.sqrt(
            Math.pow(selectedBusShapePoints[i][0] - lat, 2) +
            Math.pow(selectedBusShapePoints[i][1] - lng, 2)
        );
        if (dist < minDist) {
            minDist = dist;
            currentIndex = i;
        }
    }
    
    // Remove existing route visualization
    if (currentVehicleTrack) {
        map.removeLayer(currentVehicleTrack);
    }
    
    currentVehicleTrack = L.layerGroup();
    
    // Draw traveled portion in red (from start to current position)
    const traveledPoints = selectedBusShapePoints.slice(0, currentIndex + 1);
    if (traveledPoints.length > 1) {
        const traveledLine = L.polyline(traveledPoints, {
            color: '#dc3545',
            weight: 5,
            opacity: 0.9
        });
        traveledLine.addTo(currentVehicleTrack);
    }
    
    // Draw remaining portion in green (from current position to end)
    const remainingPoints = selectedBusShapePoints.slice(currentIndex);
    if (remainingPoints.length > 1) {
        const remainingLine = L.polyline(remainingPoints, {
            color: '#28a745',
            weight: 5,
            opacity: 0.9
        });
        remainingLine.addTo(currentVehicleTrack);
    }
    
    currentVehicleTrack.addTo(map);
}

// Update vehicles on map
function updateVehicles(vehicles) {
    // Update last update timestamp
    lastUpdateTime = Date.now();
    updateLastUpdateDisplay();
    
    // Store all vehicles for filtering
    allVehicles = vehicles;
    
    // Apply filter if active
    let filteredVehicles = vehicles;
    if (activeRouteFilter) {
        const filterLower = activeRouteFilter.toLowerCase().trim();
        filteredVehicles = vehicles.filter(v => {
            const routeShortName = (v.rsn || '').toLowerCase();
            return routeShortName.includes(filterLower);
        });
    }
    
    document.getElementById('bus-count').textContent = filteredVehicles.length + (activeRouteFilter ? ` (of ${vehicles.length})` : '');

    // Get current map bounds with padding to avoid popping at edges
    const bounds = map.getBounds().pad(0.1);
    
    // Track which markers should be on the map
    const visibleMarkerIds = new Set();

    filteredVehicles.forEach(vehicle => {
        const lat = vehicle.lat;
        const lng = vehicle.lng;
        
        // Check if vehicle is within view
        if (!bounds.contains([lat, lng])) {
            return; // Skip if out of view
        }
        
        visibleMarkerIds.add(vehicle.id);
        
        // Determine if this is a tram (3-digit ID and no license plate)
        const isTram = vehicle.id.length === 3 && (!vehicle.lp || vehicle.lp === 'N/A' || vehicle.lp === '');

        if (markers[vehicle.id]) {
            // Update existing marker position
            const marker = markers[vehicle.id];
            const newLatLng = L.latLng(lat, lng);
            marker.setLatLng(newLatLng);
            
            // If this is the selected bus, update the route visualization
            if (busesHidden && vehicle.id === selectedBusId) {
                updateSelectedBusRoute(lat, lng);
            }
            
            // If buses are hidden, keep this marker hidden if it's not the selected one
            if (busesHidden && vehicle.id !== selectedBusId) {
                marker.setOpacity(0);
            }
            
            // Update icon with route label and bearing
            // Only update icon if the route label or bearing has changed
            const routeLabel = vehicle.rsn || 'N/A';
            const bearing = vehicle.br || '0';
            if (marker._currentRouteLabel !== routeLabel || marker._currentBearing !== bearing) {
                marker.setIcon(createBusMarkerWithLabel(routeLabel, isTram, bearing));
                marker._currentRouteLabel = routeLabel;
                marker._currentBearing = bearing;
            }
        } else {
            // Create new marker with route label and bearing
            const routeLabel = vehicle.rsn || 'N/A';
            const bearing = vehicle.br || '0';
            const marker = L.marker([lat, lng], { icon: createBusMarkerWithLabel(routeLabel, isTram, bearing) })
                .addTo(map);
            
            // If buses are hidden, hide this new marker immediately if it's not the selected one
            if (busesHidden && vehicle.id !== selectedBusId) {
                marker.setOpacity(0);
            }
            
            // Store current label and bearing to avoid unnecessary updates
            marker._currentRouteLabel = routeLabel;
            marker._currentBearing = bearing;
            
            // Add click handler to show route shape and detail panel
            marker.on('click', async (e) => {
                // If clicking the same selected bus, deselect it (and let event propagate to map)
                if (selectedBusId === vehicle.id) {
                    // Don't stop propagation - let map click handler do the cleanup
                    return;
                }
                
                // Stop event from propagating to map (only when selecting a new bus)
                L.DomEvent.stopPropagation(e);
                
                try {
                    // Fetch full vehicle details
                    const detailsResponse = await fetch(`${API_URL}/api/vehicles/${vehicle.id}`);
                    const fullVehicleData = await detailsResponse.json();
                    
                    // Calculate time drift
                    let timeDrift = '';
                    if (fullVehicleData.ts && fullVehicleData.lu) {
                        const timestamp = parseInt(fullVehicleData.ts);
                        const lastUpdated = new Date(fullVehicleData.lu).getTime() / 1000;
                        const driftSeconds = Math.abs(lastUpdated - timestamp);
                        
                        if (driftSeconds < 60) {
                            timeDrift = `${Math.round(driftSeconds)}s`;
                        } else if (driftSeconds < 3600) {
                            timeDrift = `${Math.round(driftSeconds / 60)}m`;
                        } else {
                            timeDrift = `${Math.round(driftSeconds / 3600)}h`;
                        }
                    }
                    
                    // Show detail panel with full vehicle information
                    showVehicleDetails(fullVehicleData, isTram, timeDrift);
                    
                    if (fullVehicleData.tid) {
                        // Remove previous route shape if exists
                        if (currentRouteShape) {
                            map.removeLayer(currentRouteShape);
                        }
                        
                        // Remove stop shapes if they exist
                        if (currentStopShapes) {
                            map.removeLayer(currentStopShapes);
                            currentStopShapes = null;
                        }
                        
                        // Hide all other buses
                        Object.keys(markers).forEach(id => {
                            if (id !== vehicle.id) {
                                markers[id].setOpacity(0);
                            }
                        });
                        busesHidden = true;
                        selectedBusId = vehicle.id;
                        
                        // Fetch stops for this trip and hide non-matching stops
                        const stopsResponse = await fetch(`${API_URL}/api/stops/trip/${fullVehicleData.tid}`);
                        const tripStopIds = await stopsResponse.json();
                        const tripStopIdSet = new Set(tripStopIds);
                        
                        // Hide stops not on this route
                        stopMarkers.eachLayer(marker => {
                            if (!tripStopIdSet.has(marker._stopId)) {
                                marker.setStyle({ opacity: 0, fillOpacity: 0 });
                            }
                        });
                        
                        // Fetch the route shape for this trip
                        const shapeResponse = await fetch(`${API_URL}/api/shapes/trip/${fullVehicleData.tid}`);
                        const shapePoints = await shapeResponse.json();
                        
                        // Store shape points for continuous updates
                        selectedBusShapePoints = shapePoints;
                        
                        if (shapePoints.length > 0) {
                            // Use current bus position (not track data)
                            const currentLat = fullVehicleData.lat;
                            const currentLng = fullVehicleData.lng;
                            
                            // Find closest point on shape to current bus position
                            let currentIndex = 0;
                            let minDist = Infinity;
                            for (let i = 0; i < shapePoints.length; i++) {
                                const dist = Math.sqrt(
                                    Math.pow(shapePoints[i][0] - currentLat, 2) +
                                    Math.pow(shapePoints[i][1] - currentLng, 2)
                                );
                                if (dist < minDist) {
                                    minDist = dist;
                                    currentIndex = i;
                                }
                            }
                            
                            currentVehicleTrack = L.layerGroup();
                            
                            // Draw traveled portion in red (from start to current position)
                            const traveledPoints = shapePoints.slice(0, currentIndex + 1);
                            if (traveledPoints.length > 1) {
                                const traveledLine = L.polyline(traveledPoints, {
                                    color: '#dc3545',
                                    weight: 5,
                                    opacity: 0.9
                                });
                                traveledLine.addTo(currentVehicleTrack);
                            }
                            
                            // Draw remaining portion in green (from current position to end)
                            const remainingPoints = shapePoints.slice(currentIndex);
                            if (remainingPoints.length > 1) {
                                const remainingLine = L.polyline(remainingPoints, {
                                    color: '#28a745',
                                    weight: 5,
                                    opacity: 0.9
                                });
                                remainingLine.addTo(currentVehicleTrack);
                            }
                            
                            currentVehicleTrack.addTo(map);
                            console.log(`Route split at point ${currentIndex}/${shapePoints.length}: ${traveledPoints.length} traveled (green), ${remainingPoints.length} remaining (red)`);
                        }
                    }
                } catch (error) {
                    console.error('Error fetching vehicle details or route shape:', error);
                }
            });
            
            markers[vehicle.id] = marker;
        }
    });

    // Remove markers that are no longer visible (out of bounds) or no longer active
    Object.keys(markers).forEach(vehicleId => {
        if (!visibleMarkerIds.has(vehicleId)) {
            map.removeLayer(markers[vehicleId]);
            delete markers[vehicleId];
        }
    });

    // Auto-fit bounds only on first load when we have vehicles
    if (isFirstLoad && vehicles.length > 0) {
        const bounds = L.latLngBounds(vehicles.map(v => [v.lat, v.lng]));
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
        isFirstLoad = false;
    }
}

// Update vehicles when map moves (viewport pruning)
map.on('moveend', () => {
    if (allVehicles.length > 0) {
        updateVehicles(allVehicles);
    }
});

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server');
    updateConnectionStatus(true);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateConnectionStatus(false);
});

socket.on('vehicles', (vehicles) => {
    console.log(`Received ${vehicles.length} vehicles`);
    updateVehicles(vehicles);
});

socket.on('userCount', (count) => {
    console.log(`Active users: ${count}`);
    document.getElementById('user-count').textContent = count;
});

// Initial connection status
updateConnectionStatus(false);

// Function to show vehicle details in sliding panel
function showVehicleDetails(vehicle, isTram, timeDrift) {
    const vehicleType = isTram ? 'Tram' : 'Bus';
    const detailPanel = document.getElementById('detail-panel');
    const detailContent = document.getElementById('detail-content');
    
    let html = `<h2>${t('detailPanelTitle')}: ${vehicleType} ${vehicle.id}</h2>`;
    
    if (vehicle.lp && vehicle.lp !== 'N/A') {
        html += `
            <div class="detail-row">
                <div class="detail-label">${t('detailLicensePlate')}</div>
                <div class="detail-value">${vehicle.lp}</div>
            </div>
        `;
    }
    
    html += `
        <div class="detail-row">
            <div class="detail-label">${t('detailRoute')}</div>
            <div class="detail-value">${vehicle.rsn || vehicle.r || t('detailNA')}</div>
        </div>
    `;
    
    if (vehicle.rln) {
        html += `
            <div class="detail-row">
                <div class="detail-label">Route Name</div>
                <div class="detail-value">${vehicle.rln}</div>
            </div>
        `;
    }
    
    if (vehicle.th) {
        html += `
            <div class="detail-row">
                <div class="detail-label">Headsign</div>
                <div class="detail-value">${vehicle.th}</div>
            </div>
        `;
    }
    
    if (vehicle.di !== undefined && vehicle.di !== '') {
        const directionText = vehicle.di === '0' ? 'Outbound (0)' : vehicle.di === '1' ? 'Inbound (1)' : `Direction ${vehicle.di}`;
        html += `
            <div class="detail-row">
                <div class="detail-label">${t('detailDirectionId')}</div>
                <div class="detail-value">${directionText}</div>
            </div>
        `;
    }
    
    if (vehicle.br) {
        html += `
            <div class="detail-row">
                <div class="detail-label">${t('detailBearing')}</div>
                <div class="detail-value">${Math.round(parseFloat(vehicle.br))}°</div>
            </div>
        `;
    }
    
    if (vehicle.sn) {
        html += `
            <div class="detail-row">
                <div class="detail-label">Current Stop</div>
                <div class="detail-value">${vehicle.sn}</div>
            </div>
        `;
    } else if (vehicle.s && vehicle.s !== 'N/A') {
        html += `
            <div class="detail-row">
                <div class="detail-label">Stop ID</div>
                <div class="detail-value">${vehicle.s}</div>
            </div>
        `;
    }
    
    if (vehicle.sp) {
        html += `
            <div class="detail-row">
                <div class="detail-label">${t('detailSpeed')}</div>
                <div class="detail-value">${vehicle.sp} ${t('detailKmh')}</div>
            </div>
        `;
    }
    
    if (timeDrift) {
        html += `
            <div class="detail-row">
                <div class="detail-label">Time Drift</div>
                <div class="detail-value">${timeDrift}</div>
            </div>
        `;
    }
    
    detailContent.innerHTML = html;
    detailPanel.classList.add('open');
}

// Update detail panel for selected bus
function updateDetailPanel(vehicle) {
    if (!selectedBusId || vehicle.id !== selectedBusId) return;
    
    const isTram = vehicle.id.length === 3 && (!vehicle.lp || vehicle.lp === 'N/A' || vehicle.lp === '');
    showVehicleDetails(vehicle, isTram, null);
}

// Close detail panel
document.getElementById('close-detail-btn').addEventListener('click', () => {
    // Close the panel
    document.getElementById('detail-panel').classList.remove('open');
    
    // Show all buses if they were hidden
    if (busesHidden) {
        Object.keys(markers).forEach(id => {
            markers[id].setOpacity(1);
        });
        busesHidden = false;
    }
    
    // Reset selection state
    selectedBusId = null;
    selectedBusShapePoints = null;
    
    // Show all stops again
    stopMarkers.eachLayer(marker => {
        marker.setStyle({ opacity: 1, fillOpacity: 1 });
    });
    
    // Remove all route shapes
    if (currentRouteShape) {
        map.removeLayer(currentRouteShape);
        currentRouteShape = null;
    }
    if (currentVehicleTrack) {
        map.removeLayer(currentVehicleTrack);
        currentVehicleTrack = null;
    }
    if (currentStopShapes) {
        map.removeLayer(currentStopShapes);
        currentStopShapes = null;
    }
});

// Route filter functionality
const routeFilterInput = document.getElementById('route-filter');
const clearFilterButton = document.getElementById('clear-filter');

routeFilterInput.addEventListener('input', async (e) => {
    activeRouteFilter = e.target.value;
    updateVehicles(allVehicles);
    
    // Change stop colors by route if a filter is active
    if (activeRouteFilter && activeRouteFilter.trim()) {
        const filterRoute = activeRouteFilter.trim();
        
        // Keep original color for matching stops, gray for non-matching
        stopMarkers.eachLayer(marker => {
            // Check if the marker's routes contain the filtered route
            const markerRoutes = marker._routes || '';
            const routeList = markerRoutes.split(',').map(r => r.trim());
            
            if (routeList.includes(filterRoute)) {
                marker.setStyle({ color: '#FF8C00', fillColor: '#FFD700', opacity: 1, fillOpacity: 1 });
            } else {
                marker.setStyle({ color: '#888888', fillColor: '#888888', opacity: 0.5, fillOpacity: 0.5 });
            }
        });
        
        // Fetch and display route shapes in light blue (outbound) and light green (inbound)
        try {
            const response = await fetch(`${API_URL}/api/shapes/route/${encodeURIComponent(filterRoute)}`);
            const shapes = await response.json();
            
            // Remove existing filtered route shapes
            if (filteredRouteShapes) {
                map.removeLayer(filteredRouteShapes);
            }
            
            // Create layer group for all route shapes
            filteredRouteShapes = L.layerGroup();
            
            // Add each shape as a polyline with color based on direction
            // direction 0 = outbound (light blue), direction 1 = inbound (light green)
            shapes.forEach(shape => {
                if (shape.points && shape.points.length > 0) {
                    const color = shape.direction === '1' || shape.direction === 1 ? '#90EE90' : '#87CEEB';
                    const polyline = L.polyline(shape.points, {
                        color: color,
                        weight: 4,
                        opacity: 0.7
                    });
                    polyline.addTo(filteredRouteShapes);
                }
            });
            
            filteredRouteShapes.addTo(map);
        } catch (error) {
            console.error('Error fetching route shapes:', error);
        }
    } else {
        // No filter - reset all stops to default yellow/gold color
        stopMarkers.eachLayer(marker => {
            marker.setStyle({ color: '#FF8C00', fillColor: '#FFD700', opacity: 1, fillOpacity: 1 });
        });
        
        // Remove filtered route shapes
        if (filteredRouteShapes) {
            map.removeLayer(filteredRouteShapes);
            filteredRouteShapes = null;
        }
    }
});

clearFilterButton.addEventListener('click', () => {
    routeFilterInput.value = '';
    activeRouteFilter = '';
    updateVehicles(allVehicles);
    
    // Reset all stops to default yellow/gold color when filter is cleared
    stopMarkers.eachLayer(marker => {
        marker.setStyle({ color: '#FF8C00', fillColor: '#FFD700', opacity: 1, fillOpacity: 1 });
    });
    
    // Remove filtered route shapes
    if (filteredRouteShapes) {
        map.removeLayer(filteredRouteShapes);
        filteredRouteShapes = null;
    }
});

// Bus stops toggle functionality
const toggleStopsCheckbox = document.getElementById('toggle-stops');

toggleStopsCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
        map.addLayer(stopMarkers);
    } else {
        map.removeLayer(stopMarkers);
    }
});

// Info modal functionality
const infoIcon = document.getElementById('info-icon');
const infoModal = document.getElementById('info-modal');
const modalClose = document.getElementById('modal-close');

infoIcon.addEventListener('click', () => {
    infoModal.classList.add('open');
});

modalClose.addEventListener('click', () => {
    infoModal.classList.remove('open');
});

// Close modal when clicking outside
infoModal.addEventListener('click', (e) => {
    if (e.target === infoModal) {
        infoModal.classList.remove('open');
    }
});

// Language selector functionality
const languageSelector = document.getElementById('language-selector');

languageSelector.addEventListener('change', (e) => {
    loadLanguage(e.target.value);
});

// Initialize language on page load
(async function initLanguage() {
    const savedLang = localStorage.getItem('preferredLang') || 'pt';
    languageSelector.value = savedLang;
    await loadLanguage(savedLang);
})();

// User location tracking (mobile only)
function startLocationTracking() {
    // Check if geolocation is available
    if (!navigator.geolocation) {
        console.log('Geolocation not supported');
        return;
    }
    
    // Only enable on mobile devices
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) {
        console.log('Location tracking disabled on desktop');
        return;
    }
    
    console.log('Starting location tracking on mobile (protocol:', window.location.protocol + ')');
    console.log('User agent:', navigator.userAgent);
    
    // Detect iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    if (isIOS) {
        console.log('iOS device detected - using optimized settings');
    }
    
    // Options for geolocation - iOS-optimized
    const geoOptions = {
        enableHighAccuracy: true,
        maximumAge: isIOS ? 5000 : 30000, // iOS: 5s cache, Android: 30s
        timeout: isIOS ? 10000 : 27000 // iOS: 10s timeout, Android: 27s
    };
    
    // Function to update location marker
    function updateLocationMarker(position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        
        console.log(`✓ Location: ${lat.toFixed(6)}, ${lng.toFixed(6)} (±${Math.round(accuracy)}m)`);
        
        // Create or update location marker
        if (!userLocationMarker) {
            // Create blue circle marker for user location
            userLocationMarker = L.circleMarker([lat, lng], {
                radius: 8,
                fillColor: '#007bff',
                color: 'white',
                weight: 3,
                opacity: 1,
                fillOpacity: 1,
                className: 'user-location-marker',
                pane: 'markerPane',
                zIndexOffset: 1000
            }).addTo(map);
            
            // Create accuracy circle
            userLocationCircle = L.circle([lat, lng], {
                radius: accuracy,
                fillColor: '#007bff',
                fillOpacity: 0.1,
                color: '#007bff',
                weight: 2,
                opacity: 0.3,
                className: 'user-location-accuracy'
            }).addTo(map);
            
            console.log('✓ Location marker created');
        } else {
            // Update existing markers
            userLocationMarker.setLatLng([lat, lng]);
            userLocationCircle.setLatLng([lat, lng]);
            userLocationCircle.setRadius(accuracy);
        }
    }
    
    // Function to handle errors
    function handleLocationError(error) {
        const errorMessages = {
            1: 'Permission denied',
            2: 'Position unavailable', 
            3: 'Timeout'
        };
        const errorMsg = errorMessages[error.code] || 'Unknown error';
        
        console.error(`✗ Geolocation error: ${errorMsg} (code ${error.code})`);
        console.error('  Details:', error.message);
        
        // Stop trying if permission denied
        if (error.code === 1) {
            console.log('Location permission denied - stopping tracking');
            stopLocationTracking();
        }
    }
    
    // iOS: Try getCurrentPosition first, then watchPosition
    if (isIOS) {
        console.log('Getting initial position...');
        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('✓ Initial position obtained');
                updateLocationMarker(position);
                
                // Now start watching
                console.log('Starting continuous watch...');
                watchId = navigator.geolocation.watchPosition(
                    updateLocationMarker,
                    handleLocationError,
                    geoOptions
                );
            },
            (error) => {
                console.error('✗ Failed to get initial position');
                handleLocationError(error);
            },
            geoOptions
        );
    } else {
        // Android: Direct watchPosition works fine
        console.log('Starting continuous watch...');
        watchId = navigator.geolocation.watchPosition(
            updateLocationMarker,
            handleLocationError,
            geoOptions
        );
    }
}

// Stop location tracking
function stopLocationTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    
    if (userLocationMarker) {
        map.removeLayer(userLocationMarker);
        userLocationMarker = null;
    }
    
    if (userLocationCircle) {
        map.removeLayer(userLocationCircle);
        userLocationCircle = null;
    }
}

// Start tracking on mobile
startLocationTracking();

// Handle window resize to stop/start tracking
window.addEventListener('resize', () => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile && watchId === null) {
        startLocationTracking();
    } else if (!isMobile && watchId !== null) {
        stopLocationTracking();
    }
    
    // Show/hide locate button based on screen size
    const locateButton = document.getElementById('locate-button');
    if (locateButton) {
        locateButton.style.display = isMobile ? 'flex' : 'none';
    }
});

// Locate button functionality
const locateButton = document.getElementById('locate-button');
if (locateButton) {
    // Show button on mobile only
    const isMobile = window.innerWidth <= 768;
    locateButton.style.display = isMobile ? 'flex' : 'none';
    
    // Center map on user location when clicked
    locateButton.addEventListener('click', (e) => {
        // Prevent any default behavior
        e.preventDefault();
        e.stopPropagation();
        
        console.log('Locate button clicked, userLocationMarker:', !!userLocationMarker);
        
        if (userLocationMarker) {
            try {
                const userLatLng = userLocationMarker.getLatLng();
                console.log('Centering on:', userLatLng);
                map.setView(userLatLng, 16, {
                    animate: true,
                    duration: 0.5
                });
                console.log('✓ Map centered on user location');
            } catch (err) {
                console.error('Error centering map:', err);
            }
        } else {
            console.log('User location not available - requesting location');
            
            // For iOS, directly request current position with optimized settings
            if (navigator.geolocation) {
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                
                const geoOptions = {
                    enableHighAccuracy: true,
                    maximumAge: 0, // Force fresh location
                    timeout: 10000
                };
                
                console.log('Getting current position for locate button...');
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const lat = position.coords.latitude;
                        const lng = position.coords.longitude;
                        console.log(`✓ Got position: ${lat}, ${lng}`);
                        
                        // Center map on location
                        map.setView([lat, lng], 16, {
                            animate: true,
                            duration: 0.5
                        });
                        
                        // Ensure tracking is running
                        if (watchId === null) {
                            startLocationTracking();
                        }
                    },
                    (error) => {
                        console.error('✗ Failed to get location for button:', error.message);
                        alert('Could not get your location. Please ensure location permissions are enabled.');
                    },
                    geoOptions
                );
            }
        }
    });
}
