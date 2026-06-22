// State Management
let state = {
    employees: [],
    jobsites: [],
    logs: [],
    currentEmployeeId: null,
    currentJobsiteId: null,
    currentLocation: {
        lat: null,
        lng: null,
        accuracy: null
    },
    gpsActive: false,
    map: null,
    userMarker: null,
    userAccuracyCircle: null,
    siteMarker: null,
    siteGeofenceCircle: null,
    pendingAction: null // Holds { actionType, timestamp } during override confirmation
};

let shiftTimerInterval = null;

// Default Sample Data
const DEFAULT_EMPLOYEES = [
    { id: "emp-1", name: "Jane Smith", role: "Supervisor" },
    { id: "emp-2", name: "Michael Johnson", role: "Cleaner" },
    { id: "emp-3", name: "Emily Rodriguez", role: "Cleaner" }
];

const DEFAULT_JOBSITES = [
    { id: "site-1", name: "Starlight Corporate Tower", lat: 40.7128, lng: -74.0060, radius: 200 },
    { id: "site-2", name: "Apex Health Plaza", lat: 34.0522, lng: -118.2437, radius: 150 },
    { id: "site-3", name: "Symphony Residential Complex", lat: 41.8781, lng: -87.6298, radius: 250 }
];

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
    initDatabase();
    initAppControls();
    initDateTime();
    initGeolocation();
    
    // Initialize Lucide icons
    if (window.lucide) {
        window.lucide.createIcons();
    }
});

// Database & LocalStorage Helper Functions
function initDatabase() {
    // Load Employees
    if (!localStorage.getItem("clean_employees")) {
        localStorage.setItem("clean_employees", JSON.stringify(DEFAULT_EMPLOYEES));
    }
    state.employees = JSON.parse(localStorage.getItem("clean_employees"));

    // Load Job Sites
    if (!localStorage.getItem("clean_jobsites")) {
        localStorage.setItem("clean_jobsites", JSON.stringify(DEFAULT_JOBSITES));
    }
    state.jobsites = JSON.parse(localStorage.getItem("clean_jobsites"));

    // Load Logs
    if (!localStorage.getItem("clean_logs")) {
        localStorage.setItem("clean_logs", JSON.stringify([]));
    }
    state.logs = JSON.parse(localStorage.getItem("clean_logs"));
}

function saveToLocalStorage(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

// UI Controls & Navigation
function initAppControls() {
    // Navigation Tabs
    const btnEmployee = document.getElementById("btn-employee-view");
    const btnManager = document.getElementById("btn-manager-view");
    const panelEmployee = document.getElementById("panel-employee");
    const panelManager = document.getElementById("panel-manager");

    btnEmployee.addEventListener("click", () => {
        btnEmployee.classList.add("active");
        btnManager.classList.remove("active");
        panelEmployee.classList.add("active");
        panelManager.classList.remove("active");
        
        // Leaflet fix when container sizes or visibility changes
        if (state.map) {
            setTimeout(() => state.map.invalidateSize(), 100);
        }
    });

    btnManager.addEventListener("click", () => {
        btnManager.classList.add("active");
        btnEmployee.classList.remove("active");
        panelManager.classList.add("active");
        panelEmployee.classList.remove("active");
        updateManagerDashboard();
    });

    // Populate Select elements
    populateSelects();

    // Select Change Handlers
    document.getElementById("select-employee").addEventListener("change", (e) => {
        state.currentEmployeeId = e.target.value;
        updateEmployeeStatusUI();
    });

    document.getElementById("select-jobsite").addEventListener("change", (e) => {
        state.currentJobsiteId = e.target.value;
        updateSiteOnMap();
        updateGeofenceCalculation();
    });

    // Clock Actions
    document.getElementById("btn-clock-action").addEventListener("click", handleClockAction);
    
    // Recenter map button
    document.getElementById("btn-recenter-map").addEventListener("click", recenterMapOnUser);

    // Override Modal Buttons
    document.getElementById("btn-cancel-override").addEventListener("click", () => {
        toggleModal("modal-override", false);
        state.pendingAction = null;
    });

    document.getElementById("btn-confirm-override").addEventListener("click", confirmOverrideAction);

    // Manager Subtabs
    const subtabs = document.querySelectorAll(".subtab");
    subtabs.forEach(tab => {
        tab.addEventListener("click", (e) => {
            subtabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");

            // Hide all subtab contents
            document.querySelectorAll(".subtab-content").forEach(content => {
                content.classList.remove("active");
            });

            // Show active subtab content
            const tabId = tab.id.replace("btn-subtab-", "");
            document.getElementById(`manager-subtab-content-${tabId}`).classList.add("active");
        });
    });

    // Manager Actions
    document.getElementById("form-add-site").addEventListener("submit", handleAddSite);
    document.getElementById("form-add-employee").addEventListener("submit", handleAddEmployee);
    document.getElementById("btn-use-current-gps").addEventListener("click", fillCurrentGpsToForm);
    document.getElementById("btn-export-csv").addEventListener("click", exportLogsToCSV);
    document.getElementById("btn-clear-logs").addEventListener("click", clearAttendanceLogs);

    // Quick Add Actions (New Feature)
    document.getElementById("btn-quick-add-employee").addEventListener("click", () => toggleModal("modal-quick-employee", true));
    document.getElementById("btn-close-quick-employee").addEventListener("click", () => toggleModal("modal-quick-employee", false));
    document.getElementById("form-quick-add-employee").addEventListener("submit", handleQuickAddEmployee);

    document.getElementById("btn-quick-add-jobsite").addEventListener("click", () => toggleModal("modal-quick-jobsite", true));
    document.getElementById("btn-close-quick-jobsite").addEventListener("click", () => toggleModal("modal-quick-jobsite", false));
    document.getElementById("form-quick-add-jobsite").addEventListener("submit", handleQuickAddJobsite);
    document.getElementById("btn-quick-use-gps").addEventListener("click", fillCurrentGpsToQuickForm);
}

// Populate dropdowns with state data
function populateSelects() {
    const empSelect = document.getElementById("select-employee");
    const siteSelect = document.getElementById("select-jobsite");

    empSelect.innerHTML = "";
    state.employees.forEach(emp => {
        const option = document.createElement("option");
        option.value = emp.id;
        option.textContent = `${emp.name} (${emp.role})`;
        empSelect.appendChild(option);
    });

    siteSelect.innerHTML = "";
    state.jobsites.forEach(site => {
        const option = document.createElement("option");
        option.value = site.id;
        option.textContent = `${site.name} (${site.radius}m)`;
        siteSelect.appendChild(option);
    });

    // Set active defaults
    if (state.employees.length > 0) {
        state.currentEmployeeId = state.employees[0].id;
        empSelect.value = state.currentEmployeeId;
    }
    if (state.jobsites.length > 0) {
        state.currentJobsiteId = state.jobsites[0].id;
        siteSelect.value = state.currentJobsiteId;
    }

    updateEmployeeStatusUI();
}

// Live Time Tick
function initDateTime() {
    const clockDiv = document.getElementById("live-time");
    
    function tick() {
        const now = new Date();
        clockDiv.textContent = now.toLocaleTimeString([], { hour12: true });
    }
    
    tick();
    setInterval(tick, 1000);
}

// Toast Notifications
function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    
    let iconName = "info";
    if (type === "success") iconName = "check-circle";
    if (type === "error") iconName = "x-circle";
    if (type === "warning") iconName = "alert-triangle";

    toast.innerHTML = `
        <i data-lucide="${iconName}"></i>
        <div class="toast-message">${message}</div>
    `;
    
    container.appendChild(toast);
    
    if (window.lucide) {
        window.lucide.createIcons({ attrs: { class: 'toast-icon' } });
    }

    setTimeout(() => {
        toast.style.animation = "toastIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) reverse forwards";
        setTimeout(() => toast.remove(), 350);
    }, 4000);
}

// Toggle modals helper
function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    if (show) {
        modal.classList.add("active");
    } else {
        modal.classList.remove("active");
    }
}

// Geolocation Handler
function initGeolocation() {
    const geoBadge = document.getElementById("geofence-badge");
    const geoStatusText = document.getElementById("geofence-status-text");
    const geoIcon = document.getElementById("geofence-icon");

    if (!navigator.geolocation) {
        setGpsUIState("error", "Geolocation is not supported by your browser");
        showToast("Geolocation is not supported by this browser.", "error");
        return;
    }

    const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    };

    // Watch position in real-time
    navigator.geolocation.watchPosition(
        (position) => {
            state.currentLocation.lat = position.coords.latitude;
            state.currentLocation.lng = position.coords.longitude;
            state.currentLocation.accuracy = Math.round(position.coords.accuracy);
            state.gpsActive = true;

            // Update GPS text details
            document.getElementById("gps-accuracy").textContent = `${state.currentLocation.accuracy}m`;
            document.getElementById("gps-coordinates").textContent = 
                `Coordinates: Lat ${state.currentLocation.lat.toFixed(5)}, Lon ${state.currentLocation.lng.toFixed(5)}`;

            // Initialise map on first successful lock
            if (!state.map) {
                initLeafletMap(state.currentLocation.lat, state.currentLocation.lng);
                
                // UX Improvement: Check if we should add a Job Site dynamically at their current location for demo purposes.
                // If there's only default sites, let's inject a "Current Location (Demo)" site so they immediately test geofencing!
                injectDemoJobSite(state.currentLocation.lat, state.currentLocation.lng);
            } else {
                updateUserMarkerOnMap();
            }

            updateGeofenceCalculation();
        },
        (error) => {
            state.gpsActive = false;
            console.error("GPS Error Code: " + error.code + " Message: " + error.message);
            
            let errMsg = "GPS signal lost or permission denied";
            if (error.code === error.PERMISSION_DENIED) {
                errMsg = "Location permission denied";
            }
            
            setGpsUIState("error", errMsg);
            document.getElementById("gps-accuracy").textContent = "--";
            document.getElementById("site-distance").textContent = "--";
        },
        options
    );
}

function setGpsUIState(type, text) {
    const geoBadge = document.getElementById("geofence-badge");
    const geoStatusText = document.getElementById("geofence-status-text");
    const geoIcon = document.getElementById("geofence-icon");

    geoBadge.className = `geo-status-indicator ${type}`;
    geoStatusText.textContent = text;

    // Change Lucide Icon
    let iconName = "circle-alert";
    if (type === "success") iconName = "check-circle-2";
    if (type === "error") iconName = "x-circle";
    if (type === "warning") iconName = "alert-triangle";
    
    geoIcon.setAttribute("data-lucide", iconName);
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Haversine Distance Formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // meters
    const phi1 = lat1 * Math.PI/180;
    const phi2 = lat2 * Math.PI/180;
    const deltaPhi = (lat2-lat1) * Math.PI/180;
    const deltaLambda = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // in meters
}

// Calculate geofence bounds
function updateGeofenceCalculation() {
    if (!state.gpsActive || !state.currentLocation.lat) return;

    const activeSite = state.jobsites.find(s => s.id === state.currentJobsiteId);
    if (!activeSite) return;

    const distance = calculateDistance(
        state.currentLocation.lat,
        state.currentLocation.lng,
        activeSite.lat,
        activeSite.lng
    );

    const roundedDistance = Math.round(distance);
    document.getElementById("site-distance").textContent = `${roundedDistance}m`;

    if (roundedDistance <= activeSite.radius) {
        setGpsUIState("success", `Within Geofence (${activeSite.name})`);
        document.getElementById("geofence-badge").classList.add("success");
    } else {
        setGpsUIState("warning", `Outside Geofence by ${roundedDistance - activeSite.radius}m`);
    }
}

// Dynamically insert a job site at user's current GPS location on first run
function injectDemoJobSite(lat, lng) {
    const hasDemo = state.jobsites.some(s => s.id === "demo-site");
    if (!hasDemo) {
        const demoSite = {
            id: "demo-site",
            name: "Current Location (Demo Site)",
            lat: lat,
            lng: lng,
            radius: 100
        };
        state.jobsites.push(demoSite);
        saveToLocalStorage("clean_jobsites", state.jobsites);
        
        // Re-populate and select it
        populateSelects();
        const siteSelect = document.getElementById("select-jobsite");
        state.currentJobsiteId = "demo-site";
        siteSelect.value = "demo-site";
        
        updateSiteOnMap();
        updateGeofenceCalculation();
        showToast("Demo site initialized at your location!", "success");
    }
}

// Leaflet Map Configuration
function initLeafletMap(lat, lng) {
    const mapLoadingOverlay = document.getElementById("map-overlay-loading");
    
    // Create map centered on user
    state.map = L.map('map', {
        zoomControl: true,
        attributionControl: false
    }).setView([lat, lng], 15);

    // Load OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(state.map);

    // Custom SVGs for Markers to look premium and prevent broken images
    const userSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
            <circle cx="16" cy="16" r="12" fill="rgba(99, 102, 241, 0.2)" />
            <circle cx="16" cy="16" r="8" fill="rgba(99, 102, 241, 0.4)" />
            <circle cx="16" cy="16" r="5" fill="#6366f1" stroke="#ffffff" stroke-width="2" />
        </svg>
    `;

    const userIcon = L.divIcon({
        html: userSvg,
        className: 'user-map-marker',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });

    // Create User Marker & Accuracy Circle
    state.userMarker = L.marker([lat, lng], { icon: userIcon }).addTo(state.map);
    state.userAccuracyCircle = L.circle([lat, lng], {
        radius: state.currentLocation.accuracy,
        color: '#6366f1',
        fillColor: '#6366f1',
        fillOpacity: 0.1,
        weight: 1
    }).addTo(state.map);

    // Hide Loading Screen
    if (mapLoadingOverlay) {
        mapLoadingOverlay.classList.add("hidden");
    }

    // Set Job site on map
    updateSiteOnMap();
}

function updateUserMarkerOnMap() {
    if (!state.map || !state.userMarker) return;
    
    const latlng = [state.currentLocation.lat, state.currentLocation.lng];
    state.userMarker.setLatLng(latlng);
    state.userAccuracyCircle.setLatLng(latlng);
    state.userAccuracyCircle.setRadius(state.currentLocation.accuracy);
}

function updateSiteOnMap() {
    if (!state.map) return;

    const activeSite = state.jobsites.find(s => s.id === state.currentJobsiteId);
    if (!activeSite) return;

    // Clear old site marker and geofence
    if (state.siteMarker) state.map.removeLayer(state.siteMarker);
    if (state.siteGeofenceCircle) state.map.removeLayer(state.siteGeofenceCircle);

    // Custom Job Site Marker SVG
    const siteSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" width="32" height="40">
            <path d="M16,0 C7.164,0 0,7.164 0,16 C0,25.6 16,40 16,40 C16,40 32,25.6 32,16 C32,7.164 24.836,0 16,0 Z" fill="#10b981" stroke="#ffffff" stroke-width="2" />
            <circle cx="16" cy="16" r="6" fill="#047857" />
        </svg>
    `;

    const siteIcon = L.divIcon({
        html: siteSvg,
        className: 'site-map-marker',
        iconSize: [32, 40],
        iconAnchor: [16, 40]
    });

    // Add new site markers
    state.siteMarker = L.marker([activeSite.lat, activeSite.lng], { icon: siteIcon })
        .addTo(state.map)
        .bindPopup(`<b>${activeSite.name}</b><br>Geofence Radius: ${activeSite.radius}m`)
        .openPopup();

    state.siteGeofenceCircle = L.circle([activeSite.lat, activeSite.lng], {
        radius: activeSite.radius,
        color: '#10b981',
        fillColor: '#10b981',
        fillOpacity: 0.12,
        weight: 1.5,
        dashArray: '5, 5'
    }).addTo(state.map);

    // Zoom out map to fit both markers
    fitMapBounds();
}

function fitMapBounds() {
    if (!state.map || !state.gpsActive || !state.siteMarker) return;
    
    const bounds = L.latLngBounds([
        [state.currentLocation.lat, state.currentLocation.lng],
        state.siteMarker.getLatLng()
    ]);
    
    state.map.fitBounds(bounds, { padding: [50, 50] });
}

function recenterMapOnUser() {
    if (!state.map || !state.gpsActive) {
        showToast("GPS location is not active.", "error");
        return;
    }
    state.map.setView([state.currentLocation.lat, state.currentLocation.lng], 16);
    showToast("Map recentered on current location.", "success");
}

// Clock Status Verification (Find last action)
function getEmployeeLastAction(empId) {
    const empLogs = state.logs.filter(l => l.employeeId === empId);
    if (empLogs.length === 0) return { action: "Clock Out", time: null, siteName: "" };
    
    // Sort logs descending to get the newest
    empLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return {
        action: empLogs[0].action,
        time: new Date(empLogs[0].timestamp),
        siteName: empLogs[0].siteName
    };
}

function updateEmployeeStatusUI() {
    const statusPulse = document.getElementById("status-pulse");
    const clockStatusText = document.getElementById("clock-status-text");
    const clockSubText = document.getElementById("clock-sub-text");
    const clockActionBtn = document.getElementById("btn-clock-action");
    const btnClockText = document.getElementById("btn-clock-text");
    const timerContainer = document.getElementById("active-shift-timer");

    // Clear existing timer interval
    if (shiftTimerInterval) {
        clearInterval(shiftTimerInterval);
        shiftTimerInterval = null;
    }

    const last = getEmployeeLastAction(state.currentEmployeeId);

    if (last.action === "Clock In") {
        // Employee is Clocked In
        statusPulse.className = "status-pulse online";
        clockStatusText.textContent = "Clocked In";
        
        const formattedTime = last.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        clockSubText.textContent = `At ${last.siteName} since ${formattedTime}`;
        
        // Prepare button for Clock Out
        clockActionBtn.className = "btn-clock clock-out";
        btnClockText.textContent = "Clock Out";

        // Start ticking timer
        timerContainer.style.display = "grid";
        const hourlyRate = 20.00; // Mock rate $20/hour
        
        function tickTimer() {
            const now = new Date();
            const elapsedMs = now - last.time;
            if (elapsedMs < 0) return;
            
            const secs = Math.floor((elapsedMs / 1000) % 60);
            const mins = Math.floor((elapsedMs / (1000 * 60)) % 60);
            const hours = Math.floor((elapsedMs / (1000 * 60 * 60)));
            
            const format = (num) => String(num).padStart(2, '0');
            document.getElementById("shift-duration").textContent = `${format(hours)}:${format(mins)}:${format(secs)}`;
            
            const elapsedHours = elapsedMs / (1000 * 60 * 60);
            const pay = elapsedHours * hourlyRate;
            document.getElementById("shift-earnings").textContent = `$${pay.toFixed(2)}`;
        }
        tickTimer();
        shiftTimerInterval = setInterval(tickTimer, 1000);
    } else {
        // Employee is Clocked Out
        statusPulse.className = "status-pulse offline";
        clockStatusText.textContent = "Clocked Out";
        clockSubText.textContent = "Ready to start shift";

        // Prepare button for Clock In
        clockActionBtn.className = "btn-clock clock-in";
        btnClockText.textContent = "Clock In";

        // Hide timer
        timerContainer.style.display = "none";
    }
}

// Handling Clock In/Out Actions
function handleClockAction() {
    const employee = state.employees.find(e => e.id === state.currentEmployeeId);
    const site = state.jobsites.find(s => s.id === state.currentJobsiteId);
    
    if (!employee || !site) {
        showToast("Please verify employee and job site are selected", "error");
        return;
    }

    const last = getEmployeeLastAction(state.currentEmployeeId);
    const actionType = last.action === "Clock In" ? "Clock Out" : "Clock In";
    const timestamp = new Date().toISOString();

    // Check Geofence status
    if (!state.gpsActive || !state.currentLocation.lat) {
        // If GPS is not active, trigger override modal forcing user explanation
        state.pendingAction = { actionType, timestamp, distance: null, override: true };
        document.getElementById("modal-distance-text").innerHTML = 
            `Unable to verify GPS status. Absolute coordinates are required for automated geofencing.`;
        document.getElementById("override-note").value = "";
        toggleModal("modal-override", true);
        return;
    }

    const distance = calculateDistance(
        state.currentLocation.lat,
        state.currentLocation.lng,
        site.lat,
        site.lng
    );

    const isWithinFence = distance <= site.radius;

    if (isWithinFence) {
        // Directly process clock action, no override required
        executeClockEvent(actionType, timestamp, Math.round(distance), false, "");
    } else {
        // Outside geofence, trigger override modal
        state.pendingAction = { actionType, timestamp, distance: Math.round(distance), override: true };
        document.getElementById("modal-distance-text").innerHTML = 
            `Your distance: <strong>${Math.round(distance)}m</strong> (Allowed Radius: ${site.radius}m). <br>You are outside the geofence boundaries.`;
        document.getElementById("override-note").value = "";
        toggleModal("modal-override", true);
    }
}

function confirmOverrideAction() {
    const note = document.getElementById("override-note").value.trim();
    
    if (!note) {
        showToast("Please enter an override reason.", "warning");
        return;
    }

    if (state.pendingAction) {
        executeClockEvent(
            state.pendingAction.actionType,
            state.pendingAction.timestamp,
            state.pendingAction.distance,
            true,
            note
        );
        toggleModal("modal-override", false);
        state.pendingAction = null;
    }
}

function executeClockEvent(action, timestamp, distance, wasOverridden, note) {
    const employee = state.employees.find(e => e.id === state.currentEmployeeId);
    const site = state.jobsites.find(s => s.id === state.currentJobsiteId);

    const logEntry = {
        id: "log-" + Date.now(),
        employeeId: employee.id,
        employeeName: employee.name,
        action: action, // "Clock In" or "Clock Out"
        timestamp: timestamp,
        siteId: site.id,
        siteName: site.name,
        lat: state.currentLocation.lat,
        lng: state.currentLocation.lng,
        distance: distance, // in meters, or null
        override: wasOverridden,
        note: note
    };

    state.logs.push(logEntry);
    saveToLocalStorage("clean_logs", state.logs);
    
    // Update Dashboard UI
    updateEmployeeStatusUI();
    showToast(`Successfully ${action === "Clock In" ? "clocked in to" : "clocked out of"} ${site.name}`, "success");
}

// Manager Dashboard Calculations
function updateManagerDashboard() {
    // 1. Stats Counter Card updates
    document.getElementById("stat-employees-count").textContent = state.employees.length;
    document.getElementById("stat-sites-count").textContent = state.jobsites.length;
    
    let activeShifts = 0;
    state.employees.forEach(emp => {
        const last = getEmployeeLastAction(emp.id);
        if (last.action === "Clock In") activeShifts++;
    });
    document.getElementById("stat-active-count").textContent = activeShifts;

    // 2. Render logs table
    renderLogsTable();

    // 3. Render setup listings
    renderJobsitesList();
    renderEmployeesList();
}

function renderLogsTable() {
    const tbody = document.getElementById("tbody-logs");
    tbody.innerHTML = "";

    if (state.logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No attendance logs recorded yet.</td></tr>`;
        return;
    }

    // Sort logs descending (newest first)
    const sortedLogs = [...state.logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    sortedLogs.forEach(log => {
        const tr = document.createElement("tr");
        
        const logDate = new Date(log.timestamp);
        const dateStr = logDate.toLocaleDateString() + " " + logDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const actionBadge = log.action === "Clock In" ? 
            `<span class="badge in">In</span>` : 
            `<span class="badge out">Out</span>`;

        let geofenceLog = `<span class="badge on-site">ON SITE</span>`;
        if (log.override) {
            geofenceLog = `<span class="badge off-site-override">OVERRIDE</span>`;
        }

        const distanceText = log.distance !== null ? `${log.distance}m` : "No GPS";

        tr.innerHTML = `
            <td style="font-weight: 600; white-space: nowrap;">${dateStr}</td>
            <td style="font-weight: 500;">${log.employeeName}</td>
            <td>${actionBadge}</td>
            <td>${log.siteName}</td>
            <td>${distanceText}</td>
            <td>${geofenceLog}</td>
            <td style="font-size: 0.75rem; color: var(--text-secondary);">${log.lat ? `${log.lat.toFixed(4)}, ${log.lng.toFixed(4)}` : 'N/A'}</td>
            <td style="font-style: italic; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${log.note || ''}">${log.note || '--'}</td>
        `;

        tbody.appendChild(tr);
    });
}

function renderJobsitesList() {
    const list = document.getElementById("list-sites");
    list.innerHTML = "";

    state.jobsites.forEach(site => {
        const item = document.createElement("div");
        item.className = "list-item";
        
        item.innerHTML = `
            <div class="item-info">
                <h4>${site.name}</h4>
                <p>Radius: ${site.radius}m | Lat: ${site.lat.toFixed(4)}, Lng: ${site.lng.toFixed(4)}</p>
            </div>
            <button class="btn-icon" onclick="deleteJobsite('${site.id}')" title="Delete job site">
                <i data-lucide="trash-2"></i>
            </button>
        `;
        list.appendChild(item);
    });
    
    if (window.lucide) window.lucide.createIcons();
}

function renderEmployeesList() {
    const list = document.getElementById("list-employees");
    list.innerHTML = "";

    state.employees.forEach(emp => {
        const item = document.createElement("div");
        item.className = "list-item";
        
        item.innerHTML = `
            <div class="item-info">
                <h4>${emp.name}</h4>
                <p>Role: ${emp.role || 'Cleaner'}</p>
            </div>
            <button class="btn-icon" onclick="deleteEmployee('${emp.id}')" title="Remove employee">
                <i data-lucide="user-minus"></i>
            </button>
        `;
        list.appendChild(item);
    });

    if (window.lucide) window.lucide.createIcons();
}

// Global functions for delete actions (since templates references them inline)
window.deleteJobsite = function(id) {
    if (state.jobsites.length <= 1) {
        showToast("You must keep at least one job site.", "warning");
        return;
    }
    
    if (confirm("Are you sure you want to delete this job site?")) {
        state.jobsites = state.jobsites.filter(s => s.id !== id);
        saveToLocalStorage("clean_jobsites", state.jobsites);
        populateSelects();
        updateManagerDashboard();
        showToast("Job site removed.", "success");
    }
};

window.deleteEmployee = function(id) {
    if (state.employees.length <= 1) {
        showToast("You must keep at least one employee in the system.", "warning");
        return;
    }

    if (confirm("Are you sure you want to remove this employee?")) {
        state.employees = state.employees.filter(e => e.id !== id);
        saveToLocalStorage("clean_employees", state.employees);
        populateSelects();
        updateManagerDashboard();
        showToast("Employee removed.", "success");
    }
};

// Form Add Jobsite
function handleAddSite(e) {
    e.preventDefault();
    const name = document.getElementById("site-name").value.trim();
    const lat = parseFloat(document.getElementById("site-lat").value);
    const lng = parseFloat(document.getElementById("site-lng").value);
    const radius = parseInt(document.getElementById("site-radius").value);

    if (isNaN(lat) || isNaN(lng) || isNaN(radius)) {
        showToast("Invalid inputs. Please verify coordinates and radius.", "error");
        return;
    }

    const newSite = {
        id: "site-" + Date.now(),
        name,
        lat,
        lng,
        radius
    };

    state.jobsites.push(newSite);
    saveToLocalStorage("clean_jobsites", state.jobsites);
    
    e.target.reset();
    populateSelects();
    updateManagerDashboard();
    
    // Auto select new site
    document.getElementById("select-jobsite").value = newSite.id;
    state.currentJobsiteId = newSite.id;
    updateSiteOnMap();
    updateGeofenceCalculation();
    
    showToast(`Job site "${name}" created successfully.`, "success");
}

// Form Add Employee
function handleAddEmployee(e) {
    e.preventDefault();
    const name = document.getElementById("employee-name").value.trim();
    const role = document.getElementById("employee-role").value.trim() || "Cleaner";

    const newEmp = {
        id: "emp-" + Date.now(),
        name,
        role
    };

    state.employees.push(newEmp);
    saveToLocalStorage("clean_employees", state.employees);

    e.target.reset();
    populateSelects();
    updateManagerDashboard();
    showToast(`Employee "${name}" added successfully.`, "success");
}

// Autofill GPS Coordinates to Form
function fillCurrentGpsToForm() {
    if (!state.gpsActive || !state.currentLocation.lat) {
        showToast("GPS is currently acquiring location. Please try again in a few seconds.", "warning");
        return;
    }

    document.getElementById("site-lat").value = state.currentLocation.lat;
    document.getElementById("site-lng").value = state.currentLocation.lng;
    showToast("Current coordinates filled.", "success");
}

// Export Shift Logs to CSV
function exportLogsToCSV() {
    if (state.logs.length === 0) {
        showToast("No logs to export.", "warning");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Timestamp,Employee ID,Employee Name,ActionType,Site ID,Site Name,Latitude,Longitude,Distance (meters),GeofenceOverride,Notes\n";

    state.logs.forEach(log => {
        const row = [
            `"${log.timestamp}"`,
            `"${log.employeeId}"`,
            `"${log.employeeName.replace(/"/g, '""')}"`,
            `"${log.action}"`,
            `"${log.siteId}"`,
            `"${log.siteName.replace(/"/g, '""')}"`,
            `"${log.lat || ''}"`,
            `"${log.lng || ''}"`,
            `"${log.distance !== null ? log.distance : ''}"`,
            `"${log.override ? 'YES' : 'NO'}"`,
            `"${(log.note || '').replace(/"/g, '""')}"`
        ];
        csvContent += row.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `CleanTrack_Attendance_Logs_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("CSV exported successfully.", "success");
}

// Clear all attendance logs
function clearAttendanceLogs() {
    if (state.logs.length === 0) {
        showToast("Attendance history is already empty.", "warning");
        return;
    }

    if (confirm("Are you sure you want to permanently clear ALL shift clock logs? This action cannot be undone.")) {
        state.logs = [];
        saveToLocalStorage("clean_logs", state.logs);
        updateManagerDashboard();
        updateEmployeeStatusUI();
        showToast("Attendance logs cleared.", "success");
    }
}

// Quick Add Handlers (New Feature)
function handleQuickAddEmployee(e) {
    e.preventDefault();
    const name = document.getElementById("quick-employee-name").value.trim();
    const role = document.getElementById("quick-employee-role").value.trim() || "Cleaner";

    const newEmp = {
        id: "emp-" + Date.now(),
        name,
        role
    };

    state.employees.push(newEmp);
    saveToLocalStorage("clean_employees", state.employees);

    e.target.reset();
    populateSelects();
    
    // Auto select the newly added employee
    document.getElementById("select-employee").value = newEmp.id;
    state.currentEmployeeId = newEmp.id;
    updateEmployeeStatusUI();

    toggleModal("modal-quick-employee", false);
    showToast(`Employee "${name}" added successfully.`, "success");
}

function handleQuickAddJobsite(e) {
    e.preventDefault();
    const name = document.getElementById("quick-site-name").value.trim();
    const lat = parseFloat(document.getElementById("quick-site-lat").value);
    const lng = parseFloat(document.getElementById("quick-site-lng").value);
    const radius = parseInt(document.getElementById("quick-site-radius").value);

    if (isNaN(lat) || isNaN(lng) || isNaN(radius)) {
        showToast("Invalid inputs. Please verify coordinates and radius.", "error");
        return;
    }

    const newSite = {
        id: "site-" + Date.now(),
        name,
        lat,
        lng,
        radius
    };

    state.jobsites.push(newSite);
    saveToLocalStorage("clean_jobsites", state.jobsites);

    e.target.reset();
    populateSelects();
    
    // Auto select the newly added job site
    document.getElementById("select-jobsite").value = newSite.id;
    state.currentJobsiteId = newSite.id;
    
    updateSiteOnMap();
    updateGeofenceCalculation();

    toggleModal("modal-quick-jobsite", false);
    showToast(`Job site "${name}" created successfully.`, "success");
}

function fillCurrentGpsToQuickForm() {
    if (!state.gpsActive || !state.currentLocation.lat) {
        showToast("GPS is currently acquiring location. Please try again in a few seconds.", "warning");
        return;
    }

    document.getElementById("quick-site-lat").value = state.currentLocation.lat;
    document.getElementById("quick-site-lng").value = state.currentLocation.lng;
    showToast("Current coordinates filled.", "success");
}
