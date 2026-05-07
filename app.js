let currentUser = null;
        let userRole = null;
        let map = null;
        let trackingMarker = null;
        let trackingInterval = null;
        let voiceRecognitionActive = false;
        let speechSocket = null;
        let speechRecognition = null;
        let speechQueue = [];
        let isSpeakingSpeechQueue = false;
        let citizenPushToTalkActive = false;
        let allIncidentReports = [];
        let alarmAudioContext = null;
        let alarmOscillator = null;
        let alarmGainNode = null;
        let alarmSweepTimer = null;
        let alarmVolumeTimer = null;
        let alarmStopTimer = null;
        let handledAlertIds = new Set();
        let citizenLiveShareInterval = null;
        let citizenLiveSharingEnabled = false;
        let latestCitizenCoordinates = null;
        let currentSosTrackerId = null;
        const policeCitizenMarkers = new Map();
        const policeCitizenPolylines = new Map();
        const policeCitizenTrackerState = new Map();
        const DEFAULT_ALERT_SETTINGS = {
            durationMinutes: 5,
            volumePercent: 55,
            pulseCycles: 3
        };
        const FRONTEND_ORIGIN = window.location.protocol.startsWith('http') ? window.location.origin : '';
        let API_BASE = '';
        let socketIoClientPromise = null;
        let authToken = localStorage.getItem('crimeAiToken') || '';

        function loadAlertSettings() {
            try {
                const raw = localStorage.getItem('crimeAiAlertSettings');
                return raw ? { ...DEFAULT_ALERT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_ALERT_SETTINGS };
            } catch (_) {
                return { ...DEFAULT_ALERT_SETTINGS };
            }
        }

        function getAlertSettings() {
            return loadAlertSettings();
        }

        function applyAlertSettingsToUI() {
            const settings = getAlertSettings();
            const durationSelect = document.getElementById('alertDurationSelect');
            const volumeRange = document.getElementById('alertVolumeRange');
            const pulseSelect = document.getElementById('alertPulseSelect');
            const volumeLabel = document.getElementById('alertVolumeLabel');

            if (durationSelect) durationSelect.value = String(settings.durationMinutes);
            if (volumeRange) volumeRange.value = String(settings.volumePercent);
            if (pulseSelect) pulseSelect.value = String(settings.pulseCycles);
            if (volumeLabel) volumeLabel.textContent = `${settings.volumePercent}%`;
            previewAlertSettings();
        }

        function previewAlertSettings() {
            const durationSelect = document.getElementById('alertDurationSelect');
            const volumeRange = document.getElementById('alertVolumeRange');
            const pulseSelect = document.getElementById('alertPulseSelect');
            const preview = document.getElementById('alertSettingsPreview');
            if (!preview) return;

            const durationMinutes = Number(durationSelect?.value || DEFAULT_ALERT_SETTINGS.durationMinutes);
            const volumePercent = Number(volumeRange?.value || DEFAULT_ALERT_SETTINGS.volumePercent);
            const pulseCycles = Number(pulseSelect?.value || DEFAULT_ALERT_SETTINGS.pulseCycles);
            preview.textContent = `Current alert mode: ${durationMinutes} minute(s), ${volumePercent}% volume, ${pulseCycles} pulse cycle(s).`;
        }

        function saveAlertSoundSettings() {
            const durationSelect = document.getElementById('alertDurationSelect');
            const volumeRange = document.getElementById('alertVolumeRange');
            const pulseSelect = document.getElementById('alertPulseSelect');

            const settings = {
                durationMinutes: Number(durationSelect?.value || DEFAULT_ALERT_SETTINGS.durationMinutes),
                volumePercent: Number(volumeRange?.value || DEFAULT_ALERT_SETTINGS.volumePercent),
                pulseCycles: Number(pulseSelect?.value || DEFAULT_ALERT_SETTINGS.pulseCycles)
            };

            localStorage.setItem('crimeAiAlertSettings', JSON.stringify(settings));
            showNotification('Alert Settings Saved', `Duration ${settings.durationMinutes} min, volume ${settings.volumePercent}%, pulses ${settings.pulseCycles}`);
            previewAlertSettings();
        }

        async function probeApiBase(candidateBase) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 1200);
                const response = await fetch(`${candidateBase}/api/alerts`, {
                    method: 'GET',
                    mode: 'cors',
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                return response.ok || response.status === 401 || response.status === 403;
            } catch (_) {
                return false;
            }
        }

        async function resolveApiBase() {
            if (API_BASE) {
                return API_BASE;
            }

            // Allow explicit override via global set by deployment or an injected script
            try {
                if (typeof window !== 'undefined' && window.__API_BASE__) {
                    API_BASE = window.__API_BASE__;
                    return API_BASE;
                }
            } catch (_) {}

            // Allow manual override via localStorage (useful for testing/deployment)
            try {
                const stored = localStorage.getItem('crimeAiApiBase');
                if (stored) {
                    API_BASE = stored;
                    return API_BASE;
                }
            } catch (_) {}

            if (FRONTEND_ORIGIN && await probeApiBase(FRONTEND_ORIGIN)) {
                API_BASE = FRONTEND_ORIGIN;
                return API_BASE;
            }

            const candidateHosts = ['http://localhost', 'http://127.0.0.1'];
            const candidatePorts = [3000, 3001, 3002, 3003, 3004, 3005];

            for (const host of candidateHosts) {
                for (const port of candidatePorts) {
                    const candidateBase = `${host}:${port}`;
                    if (await probeApiBase(candidateBase)) {
                        API_BASE = candidateBase;
                        return API_BASE;
                    }
                }
            }

            API_BASE = 'http://localhost:3000';
            return API_BASE;
        }

        async function getFallbackApiBases() {
            const bases = [];
            const candidateHosts = ['http://localhost', 'http://127.0.0.1'];
            const candidatePorts = [3000, 3001, 3002, 3003, 3004, 3005];

            for (const host of candidateHosts) {
                for (const port of candidatePorts) {
                    const candidateBase = `${host}:${port}`;
                    if (bases.includes(candidateBase)) {
                        continue;
                    }
                    if (await probeApiBase(candidateBase)) {
                        bases.push(candidateBase);
                    }
                }
            }

            return bases;
        }

        async function ensureSocketIoClient() {
            if (typeof io !== 'undefined') {
                return io;
            }

            if (!socketIoClientPromise) {
                socketIoClientPromise = resolveApiBase().then((apiBase) => new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = `${apiBase}/socket.io/socket.io.js`;
                    script.async = true;
                    script.onload = () => resolve(window.io);
                    script.onerror = () => reject(new Error('Unable to load Socket.IO client'));
                    document.head.appendChild(script);
                }));
            }

            return socketIoClientPromise;
        }

        const ROLE_FEATURES = {
            citizen: {
                label: 'Citizen',
                tabs: ['dashboard', 'sos', 'reports', 'profile']
            },
            officer: {
                label: 'Police Officer',
                tabs: ['dashboard', 'sos', 'ai-detection', 'analytics', 'reports', 'evidence', 'profile']
            },
            admin: {
                label: 'Admin',
                tabs: ['dashboard', 'sos', 'ai-detection', 'analytics', 'reports', 'evidence', 'profile', 'audit-log']
            }
        };

        async function apiRequest(endpoint, options = {}) {
            const headers = options.headers || {};
            if (authToken) {
                headers.Authorization = `Bearer ${authToken}`;
            }

            const apiBase = await resolveApiBase();

            const requestOptions = { ...options, headers };
            let response = await fetch(`${apiBase}${endpoint}`, requestOptions);

            if ((response.status === 404 || response.status === 405) && endpoint.startsWith('/api/')) {
                const fallbackBases = await getFallbackApiBases();
                for (const fallbackBase of fallbackBases) {
                    if (fallbackBase === apiBase) {
                        continue;
                    }

                    const fallbackResponse = await fetch(`${fallbackBase}${endpoint}`, requestOptions);
                    if (fallbackResponse.ok || fallbackResponse.status === 401 || fallbackResponse.status === 403) {
                        API_BASE = fallbackBase;
                        response = fallbackResponse;
                        break;
                    }
                }
            }

            const contentType = response.headers.get('content-type') || '';
            const payload = contentType.includes('application/json') ? await response.json() : null;
            if (!response.ok) {
                throw new Error(payload?.message || `Request failed with status ${response.status}`);
            }
            return payload;
        }

        // Show register overlay first
        document.getElementById('registerOverlay').style.display = 'flex';
        document.getElementById('mainLoginOverlay').style.display = 'none';
        document.getElementById('mainContainer').style.display = 'none';
        document.getElementById('mainHeader').style.display = 'none';

        // Registration/Login switching
        document.getElementById('showLoginBtn').onclick = function() {
            document.getElementById('registerOverlay').style.display = 'none';
            document.getElementById('mainLoginOverlay').style.display = 'flex';
        };

        document.getElementById('showRegisterBtn2').onclick = function() {
            document.getElementById('mainLoginOverlay').style.display = 'none';
            document.getElementById('registerOverlay').style.display = 'flex';
        };

        // Registration
        document.getElementById('registerForm').onsubmit = async function(e) {
            e.preventDefault();
            const form = e.target;
            const username = form.reg_username.value.trim();
            const password = form.reg_password.value;
            const confirm = form.reg_confirm.value;
            const role = form.reg_role.value;

            if (!username || !password || !role) {
                document.getElementById('registerErrorMsg').textContent = 'All fields are required.';
                document.getElementById('registerErrorMsg').style.display = 'block';
                return;
            }

            if (password !== confirm) {
                document.getElementById('registerErrorMsg').textContent = 'Passwords do not match.';
                document.getElementById('registerErrorMsg').style.display = 'block';
                return;
            }

            try {
                await apiRequest('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, role })
                });

                document.getElementById('registerErrorMsg').style.display = 'none';
                document.getElementById('registerSuccessMsg').textContent = 'Registration successful! You can now log in.';
                document.getElementById('registerSuccessMsg').style.display = 'block';

                setTimeout(() => {
                    document.getElementById('registerOverlay').style.display = 'none';
                    document.getElementById('mainLoginOverlay').style.display = 'flex';
                    document.getElementById('registerSuccessMsg').style.display = 'none';
                    form.reset();
                }, 1200);
            } catch (error) {
                document.getElementById('registerErrorMsg').textContent = error.message || 'Registration failed.';
                document.getElementById('registerErrorMsg').style.display = 'block';
            }
        };

        // Login
        document.getElementById('mainLoginForm').onsubmit = async function(e) {
            e.preventDefault();
            const form = e.target;
            const username = form.username.value.trim();
            const password = form.password.value;
            const role = form.role.value;

            if (!username || !password || !role) {
                document.getElementById('loginErrorMsg').textContent = 'All fields are required.';
                document.getElementById('loginErrorMsg').style.display = 'block';
                return;
            }

            try {
                const data = await apiRequest('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                if (data.role && role !== data.role) {
                    throw new Error(`Account role is ${data.role}. Please choose the correct role.`);
                }

                authToken = data.token || '';
                localStorage.setItem('crimeAiToken', authToken);
                document.getElementById('loginErrorMsg').style.display = 'none';
                showDashboardAfterLogin(username, data.role || role);
                form.reset();
            } catch (error) {
                document.getElementById('loginErrorMsg').textContent = error.message || 'Login failed.';
                document.getElementById('loginErrorMsg').style.display = 'block';
            }
        };

        function showDashboardAfterLogin(user, role) {
            currentUser = user;
            userRole = role;

            document.getElementById('mainLoginOverlay').style.display = 'none';
            document.getElementById('registerOverlay').style.display = 'none';
            document.getElementById('mainHeader').style.display = '';
            document.getElementById('mainContainer').style.display = '';
            document.getElementById('voiceIndicator').style.display = 'flex';

            const bar = document.getElementById('userDetailsBar');
            bar.style.display = '';
            let roleLabel = ROLE_FEATURES[role]?.label || 'Citizen';
            bar.innerHTML = `
                <span class="status-badge status-active">â— ${roleLabel}</span>
                <span style='color: var(--text-muted); font-size: 14px;'>${user}</span>
                <button class="btn btn-danger btn-small" onclick="logout()">Logout</button>
            `;

            applyRoleFeatures(role);
            updateCitizenSpeechFeedVisibility(role);
            updateCitizenMicVisibility(role);
            updateCitizenLiveTrackingVisibility(role);
            requestSpeechNotificationPermission(role);

            switchTab('dashboard');
            initializeMap();
            simulateRealTimeUpdates();
            refreshAlerts();
            loadContacts();
            loadReports();
            loadProfile();
            refreshAnalytics();
            applyAlertSettingsToUI();
            configureCitizenComplaintForm(role);
            connectSpeechSocket();
        }

        function logout() {
            currentUser = null;
            userRole = null;
            stopEmergencyAlarm();
            disconnectSpeechSocket();
            stopCitizenLiveSharing();
            authToken = '';
            localStorage.removeItem('crimeAiToken');
            document.getElementById('mainLoginOverlay').style.display = 'flex';
            document.getElementById('mainHeader').style.display = 'none';
            document.getElementById('mainContainer').style.display = 'none';
            document.getElementById('voiceIndicator').style.display = 'none';
            updateCitizenSpeechFeedVisibility(null);
            updateCitizenMicVisibility(null);
            updateCitizenLiveTrackingVisibility(null);
        }

        function connectSpeechSocket() {
            if (speechSocket) {
                return;
            }

            ensureSocketIoClient().then((socketIo) => {
                if (speechSocket || typeof socketIo !== 'function') {
                    return;
                }

                speechSocket = socketIo(API_BASE, {
                    auth: { token: authToken },
                    transports: ['websocket']
                });

                speechSocket.on('new-alert', (alert) => {
                    handleIncomingAlert(alert);
                });

                speechSocket.on('citizen-speech', (event) => {
                    if (!event || userRole === 'citizen') {
                        return;
                    }

                    const text = String(event.text || '').trim();
                    if (!text) {
                        return;
                    }

                    appendCitizenSpeechEntry(event);
                    showNotification(`Citizen Speech from ${event.username || 'Citizen'}`, text);
                    showSpeechNotification(event);
                    queueSpeak(`Citizen ${event.username || 'speaker'} says: ${text}`);
                });

                speechSocket.on('citizen-complaint', (event) => {
                    if (!event || (userRole !== 'officer' && userRole !== 'admin')) {
                        return;
                    }
                    handleCitizenComplaintEvent(event);
                });

                speechSocket.on('citizen-live-location', (event) => {
                    if (!event || (userRole !== 'officer' && userRole !== 'admin')) {
                        return;
                    }
                    handleCitizenLiveLocationEvent(event);
                });

                // Incoming SOS from a citizen — include profile/avatar/phone for officers/admins
                speechSocket.on('citizen-sos', (event) => {
                    if (!event || (userRole !== 'officer' && userRole !== 'admin')) return;
                    try {
                        if (Number.isFinite(Number(event.latitude)) && Number.isFinite(Number(event.longitude))) {
                            handleCitizenLiveLocationEvent({
                                ...event,
                                latitude: Number(event.latitude),
                                longitude: Number(event.longitude),
                                complaintType: 'SOS Emergency'
                            });
                        }
                        appendCitizenSosEntry(event);
                        showNotification('Citizen SOS', `${event.citizenName || event.username || 'Citizen'} triggered SOS`);
                        queueSpeak(`SOS from ${event.citizenName || event.username || 'citizen'}. Location reported.`);
                    } catch (err) {
                        console.warn('Failed to handle citizen-sos event', err);
                    }
                });

                speechSocket.on('connect_error', (error) => {
                    console.warn('Speech socket connection failed:', error.message);
                });
            }).catch((error) => {
                console.warn('Socket.IO client unavailable:', error.message);
            });
        }

        function disconnectSpeechSocket() {
            if (speechSocket) {
                speechSocket.disconnect();
                speechSocket = null;
            }
        }

        function queueSpeak(text) {
            speechQueue.push(text);
            if (!isSpeakingSpeechQueue) {
                speakNextQueuedMessage();
            }
        }

        function updateCitizenSpeechFeedVisibility(role) {
            const section = document.getElementById('citizenSpeechSection');
            if (!section) return;
            section.style.display = role === 'officer' || role === 'admin' ? '' : 'none';
        }

        function updateCitizenMicVisibility(role) {
            const section = document.getElementById('citizenMicSection');
            if (!section) return;
            section.style.display = role === 'citizen' ? '' : 'none';
        }

        function updateCitizenLiveTrackingVisibility(role) {
            const section = document.getElementById('citizenLiveTrackingSection');
            if (!section) return;
            section.style.display = role === 'officer' || role === 'admin' ? '' : 'none';
        }

        function configureCitizenComplaintForm(role) {
            const group = document.getElementById('citizenComplaintDetailsGroup');
            if (!group) return;

            if (role === 'citizen') {
                group.style.display = '';
                const detailsInput = document.getElementById('complaintCitizenDetails');
                if (detailsInput && !detailsInput.value.trim()) {
                    detailsInput.value = 'Citizen complaint submitted from mobile dashboard.';
                }
            } else {
                group.style.display = 'none';
                stopCitizenLiveSharing();
            }
        }

        function clearCitizenLiveTracker() {
            policeCitizenMarkers.forEach((marker) => {
                if (map && marker) {
                    map.removeLayer(marker);
                }
            });
            // remove polylines as well
            policeCitizenPolylines.forEach((poly) => {
                if (map && poly) map.removeLayer(poly);
            });
            policeCitizenPolylines.clear();
            policeCitizenMarkers.clear();
            policeCitizenTrackerState.clear();
            renderCitizenLiveTracker();
        }

        function toggleCitizenLiveSharing() {
            if (citizenLiveSharingEnabled) {
                stopCitizenLiveSharing();
            } else {
                startCitizenLiveSharing();
            }
        }

        function setCitizenLiveShareStatus(message, isActive) {
            const status = document.getElementById('citizenLiveShareStatus');
            const button = document.getElementById('citizenLiveShareBtn');
            if (status) status.textContent = message;
            if (button) {
                button.textContent = isActive ? 'Stop Live Location Share' : 'Start Live Location Share';
                button.className = isActive ? 'btn btn-danger btn-small' : 'btn btn-primary btn-small';
            }
        }

        function parseCoordinatesFromLocationText(rawLocation) {
            const text = String(rawLocation || '');
            const latLngPattern = /(-?\d+(?:\.\d+)?)\s*(?:\u00b0)?\s*[NS]?\s*[, ]+\s*(-?\d+(?:\.\d+)?)\s*(?:\u00b0)?\s*[EW]?/i;
            const latMatch = text.match(/lat(?:itude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i);
            const lngMatch = text.match(/lng|long(?:itude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i);

            if (latMatch && lngMatch) {
                return {
                    lat: Number(latMatch[1]),
                    lng: Number(lngMatch[1])
                };
            }

            const genericMatch = text.match(latLngPattern);
            if (genericMatch) {
                return {
                    lat: Number(genericMatch[1]),
                    lng: Number(genericMatch[2])
                };
            }

            return null;
        }

        function emitCitizenLiveLocation(extra = {}) {
            if (!speechSocket || userRole !== 'citizen' || !citizenLiveSharingEnabled) {
                return;
            }

            if (!navigator.geolocation) {
                setCitizenLiveShareStatus('Live location is not supported in this browser.', false);
                return;
            }

            navigator.geolocation.getCurrentPosition((position) => {
                const { latitude, longitude } = position.coords;
                latestCitizenCoordinates = { lat: latitude, lng: longitude };

                const latInput = document.getElementById('reportLatitude');
                const lngInput = document.getElementById('reportLongitude');
                if (latInput) latInput.value = String(latitude);
                if (lngInput) lngInput.value = String(longitude);

                speechSocket.emit('citizen-live-location', {
                    username: currentUser,
                    trackerId: currentSosTrackerId || extra.trackerId || `${currentUser || 'citizen'}-${Date.now()}`,
                    citizenName: document.getElementById('complaintCitizenName')?.value || currentUser,
                    citizenPhone: document.getElementById('complaintCitizenPhone')?.value || '',
                    locationText: document.getElementById('reportLocation')?.value || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
                    latitude,
                    longitude,
                    ...extra
                });

                setCitizenLiveShareStatus(`Live location shared at ${new Date().toLocaleTimeString()}`, true);
            }, () => {
                setCitizenLiveShareStatus('Unable to read GPS location. Please allow location permission.', false);
            });
        }

        function startCitizenLiveSharing() {
            if (userRole !== 'citizen') return;
            connectSpeechSocket();

            citizenLiveSharingEnabled = true;
            setCitizenLiveShareStatus('Starting live location share...', true);

            // Emit immediately and then start periodic updates
            emitCitizenLiveLocation({ sharingStarted: true });

            if (citizenLiveShareInterval) {
                clearInterval(citizenLiveShareInterval);
            }

            citizenLiveShareInterval = setInterval(() => {
                emitCitizenLiveLocation();
            }, 3000);
        }

        function stopCitizenLiveSharing() {
            if (citizenLiveShareInterval) {
                clearInterval(citizenLiveShareInterval);
                citizenLiveShareInterval = null;
            }
            if (speechSocket && userRole === 'citizen' && citizenLiveSharingEnabled) {
                speechSocket.emit('citizen-live-location', {
                    username: currentUser,
                    trackerId: currentSosTrackerId || undefined,
                    ended: true,
                    citizenName: document.getElementById('complaintCitizenName')?.value || currentUser,
                    citizenPhone: document.getElementById('complaintCitizenPhone')?.value || ''
                });
            }

            citizenLiveSharingEnabled = false;
            currentSosTrackerId = null;
            setCitizenLiveShareStatus('Live location sharing is off', false);
        }

        function getCitizenMarkerIcon() {
            return L.icon({
                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNSIgaGVpZ2h0PSI0MSI+PHBhdGggZmlsbD0iIzEwYjk4MSIgZD0iTTEyLjUgMEMxOS40IDAgMjUgNS42IDI1IDEyLjVjMCAxMC41LTEyLjUgMjguNS0xMi41IDI4LjVTMCAyMyAwIDEyLjVDMCA1LjYgNS42IDAgMTIuNSAweiIvPjxjaXJjbGUgZmlsbD0iI2ZmZiIgY3g9IjEyLjUiIGN5PSIxMi41IiByPSI0Ii8+PC9zdmc+',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34]
            });
        }

        function renderCitizenLiveTracker() {
            const list = document.getElementById('citizenLiveTrackerList');
            if (!list) return;

            const sorted = Array.from(policeCitizenTrackerState.values())
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            if (!sorted.length) {
                list.innerHTML = `
                    <div class="alert-item citizen-live-empty">
                        <div class="alert-content">
                            <div class="alert-type">Waiting for citizen complaint tracking</div>
                            <div class="alert-details">Live citizen location and complaint updates will appear here for police/admin tracking.</div>
                            <div class="alert-time">Live feed</div>
                        </div>
                    </div>
                `;
                return;
            }

            list.innerHTML = sorted.map((item) => `
                <div class="alert-item">
                    <div class="alert-content" style="display:flex;gap:10px;align-items:flex-start;">
                        ${item.avatar ? `<img src="${API_BASE}${item.avatar}" alt="Citizen photo" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex:0 0 auto;">` : ''}
                        <div style="flex:1;">
                            <div class="alert-type">${item.complaintType || 'Citizen Complaint'} - ${item.citizenName || item.username || 'Citizen'}</div>
                            <div class="alert-details">Phone: ${item.citizenPhone || 'N/A'} | ${item.locationText || 'Location update received'}</div>
                            <div class="alert-time">${new Date(item.timestamp || Date.now()).toLocaleTimeString()} | ID: ${item.trackerId}</div>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        function handleCitizenComplaintEvent(event) {
            const trackerId = String(event.trackerId || event.userId || event.username || Date.now());
            policeCitizenTrackerState.set(trackerId, {
                ...(policeCitizenTrackerState.get(trackerId) || {}),
                ...event,
                trackerId,
                timestamp: Date.now()
            });

            renderCitizenLiveTracker();
            showNotification('Citizen Complaint Received', `${event.citizenName || event.username || 'Citizen'} filed ${event.complaintType || 'a complaint'}`);
        }

        function handleCitizenLiveLocationEvent(event) {
            const trackerId = String(event.trackerId || event.userId || event.username || Date.now());

            if (event.ended) {
                policeCitizenTrackerState.delete(trackerId);
                const oldMarker = policeCitizenMarkers.get(trackerId);
                if (oldMarker && map) {
                    map.removeLayer(oldMarker);
                }
                policeCitizenMarkers.delete(trackerId);
                // remove polyline when sharing ends
                const oldPoly = policeCitizenPolylines.get(trackerId);
                if (oldPoly && map) map.removeLayer(oldPoly);
                policeCitizenPolylines.delete(trackerId);
                renderCitizenLiveTracker();
                return;
            }

            const lat = Number(event.latitude);
            const lng = Number(event.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                return;
            }

            const markerLabel = event.citizenName || event.username || 'Citizen';
            if (map) {
                let marker = policeCitizenMarkers.get(trackerId);
                if (!marker) {
                    marker = L.marker([lat, lng], { icon: getCitizenMarkerIcon() }).addTo(map);
                    policeCitizenMarkers.set(trackerId, marker);
                } else {
                    marker.setLatLng([lat, lng]);
                }

                marker.bindPopup(`<b>${markerLabel}</b><br>${event.locationText || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}<br>Live complaint tracking`);

                // Manage polyline (route) for this tracker
                let poly = policeCitizenPolylines.get(trackerId);
                if (!poly) {
                    poly = L.polyline([[lat, lng]], { color: '#ff6b6b', weight: 5, opacity: 0.9 }).addTo(map);
                    policeCitizenPolylines.set(trackerId, poly);
                } else {
                    const latlngs = poly.getLatLngs();
                    latlngs.push([lat, lng]);
                    poly.setLatLngs(latlngs);
                }

                // Optionally pan/fit map so officers see the moving user
                try {
                    const bounds = poly.getBounds();
                    if (bounds.isValid()) {
                        map.fitBounds(bounds.pad(0.25), { maxZoom: 17, animate: true });
                    } else {
                        map.panTo([lat, lng], { animate: true });
                    }
                } catch (err) {
                    map.panTo([lat, lng]);
                }
            }

            policeCitizenTrackerState.set(trackerId, {
                ...(policeCitizenTrackerState.get(trackerId) || {}),
                ...event,
                trackerId,
                latitude: lat,
                longitude: lng,
                timestamp: Date.now()
            });

            renderCitizenLiveTracker();
        }

        function getAlertDurationMinutes(alert = {}) {
            const alertType = String(alert.type || '').toLowerCase();
            if (alertType.includes('sos')) return 5;
            if (alertType.includes('weapon') || alertType.includes('violence')) return 3;
            return getAlertSettings().durationMinutes || 1;
        }

        function pulseAlarmVolume(cycles = 3) {
            if (!alarmGainNode || !alarmAudioContext) return;

            if (alarmVolumeTimer) {
                clearInterval(alarmVolumeTimer);
                alarmVolumeTimer = null;
            }

            const settings = getAlertSettings();
            const maxLevel = Math.max(0.12, Math.min(1, settings.volumePercent / 100));
            const levels = [0.38, 0.72, 0.5, 0.88, 0.46, 0.78].map(level => Math.min(maxLevel, level));
            let index = 0;
            alarmGainNode.gain.setValueAtTime(Math.min(maxLevel, 0.22), alarmAudioContext.currentTime);

            alarmVolumeTimer = setInterval(() => {
                if (!alarmGainNode || !alarmAudioContext) return;
                const nextLevel = levels[index % levels.length];
                alarmGainNode.gain.setTargetAtTime(nextLevel, alarmAudioContext.currentTime, 0.04);
                index += 1;

                if (index >= cycles * 2) {
                    clearInterval(alarmVolumeTimer);
                    alarmVolumeTimer = null;
                    alarmGainNode.gain.setTargetAtTime(Math.min(maxLevel, 0.55), alarmAudioContext.currentTime, 0.08);
                }
            }, 240);
        }

        function vibrateAlert(durationMinutes = 1) {
            if (!navigator.vibrate) return;

            const totalMs = Math.max(1, durationMinutes) * 60 * 1000;
            const pattern = [800, 400, 800, 400, 1200];
            let elapsed = 0;

            const vibrateOnce = () => {
                if (elapsed >= totalMs) return;
                navigator.vibrate(pattern);
                elapsed += pattern.reduce((sum, item) => sum + item, 0);
                if (elapsed < totalMs) {
                    setTimeout(vibrateOnce, 2200);
                }
            };

            vibrateOnce();
        }

        function handleIncomingAlert(alert = {}, options = {}) {
            const alertId = String(alert.id || `${alert.type || 'alert'}-${Date.now()}`);
            if (!options.force && handledAlertIds.has(alertId)) {
                return;
            }

            handledAlertIds.add(alertId);
            setTimeout(() => handledAlertIds.delete(alertId), 10 * 60 * 1000);

            const durationMinutes = options.durationMinutes || alert.durationMinutes || getAlertDurationMinutes(alert);
            const title = alert.type || 'New Alert';
            const message = alert.location ? `${alert.location}` : 'Alert received';

            showNotification(title, message);
            startEmergencyAlarm(durationMinutes);
            vibrateAlert(durationMinutes);

            if ('Notification' in window && Notification.permission === 'granted') {
                try {
                    const notification = new Notification(title, {
                        body: message,
                        tag: alertId,
                        renotify: true
                    });
                    notification.onclick = () => {
                        window.focus();
                        notification.close();
                    };
                    setTimeout(() => notification.close(), Math.min(durationMinutes * 60 * 1000, 10000));
                } catch (_) {
                    // Ignore desktop notification failures.
                }
            }
        }

        async function requestSpeechNotificationPermission(role) {
            if ((role === 'officer' || role === 'admin') && 'Notification' in window && Notification.permission === 'default') {
                try {
                    await Notification.requestPermission();
                } catch (_) {
                    // Ignore permission request failures.
                }
            }
        }

        function showSpeechNotification(event) {
            if (!('Notification' in window) || Notification.permission !== 'granted') {
                return;
            }

            const notification = new Notification(`Citizen Speech from ${event.username || 'Citizen'}`, {
                body: String(event.text || '').trim(),
                tag: 'citizen-speech',
                renotify: true
            });

            notification.onclick = () => {
                window.focus();
                notification.close();
            };

            setTimeout(() => notification.close(), 6000);
        }

        function setCitizenMicStatus(message) {
            const status = document.getElementById('citizenMicStatus');
            if (status) {
                status.textContent = message;
            }
        }

        function appendCitizenSpeechEntry(event) {
            const feed = document.getElementById('citizenSpeechFeed');
            if (!feed) return;

            if (feed.querySelector('.speech-feed-empty')) {
                feed.innerHTML = '';
            }

            const item = document.createElement('div');
            item.className = 'alert-item';
            item.innerHTML = `
                <div class="alert-content">
                    <div class="alert-type">${event.username || 'Citizen'}</div>
                    <div class="alert-details">${event.text}</div>
                    <div class="alert-time">${new Date(event.timestamp || Date.now()).toLocaleTimeString()}</div>
                </div>
            `;

            feed.prepend(item);
        }

        function appendCitizenSosEntry(event) {
            const trackerId = String(event.trackerId || event.userId || event.username || Date.now());
            policeCitizenTrackerState.set(trackerId, {
                ...(policeCitizenTrackerState.get(trackerId) || {}),
                ...event,
                trackerId,
                complaintType: event.complaintType || 'SOS Emergency',
                timestamp: Date.now()
            });

            renderCitizenLiveTracker();
        }

        function clearCitizenSpeechFeed() {
            const feed = document.getElementById('citizenSpeechFeed');
            if (!feed) return;

            feed.innerHTML = `
                <div class="alert-item speech-feed-empty">
                    <div class="alert-content">
                        <div class="alert-type">Waiting for citizen speech</div>
                        <div class="alert-details">Citizen microphone messages will appear here and be spoken aloud for officers and admins.</div>
                        <div class="alert-time">Live feed</div>
                    </div>
                </div>
            `;
        }

        function speakNextQueuedMessage() {
            if (!speechQueue.length) {
                isSpeakingSpeechQueue = false;
                return;
            }

            isSpeakingSpeechQueue = true;
            const message = speechQueue.shift();
            const utterance = new SpeechSynthesisUtterance(message);
            utterance.rate = 1;
            utterance.pitch = 1;
            utterance.volume = 1;
            utterance.onend = () => speakNextQueuedMessage();
            utterance.onerror = () => speakNextQueuedMessage();
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utterance);
        }

        function ensureSpeechRecognition() {
            if (speechRecognition) {
                return speechRecognition;
            }

            if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
                return null;
            }

            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            speechRecognition = new SpeechRecognition();
            speechRecognition.continuous = true;
            speechRecognition.interimResults = false;
            speechRecognition.lang = 'en-US';

            speechRecognition.onresult = function(event) {
                const last = event.results.length - 1;
                const transcript = event.results[last][0].transcript.trim();
                const command = transcript.toLowerCase();

                if (userRole === 'citizen' && transcript && speechSocket) {
                    const urgent = /\b(emergency|sos|help|danger|police|attack|fire|injury)\b/i.test(transcript);
                    speechSocket.emit('citizen-speech', {
                        username: currentUser,
                        text: transcript,
                        urgent
                    });
                }

                if (command.includes('emergency') || command.includes('sos')) {
                    triggerSOS();
                } else if (command.includes('dashboard')) {
                    switchTab('dashboard');
                } else if (command.includes('report')) {
                    switchTab('reports');
                }
            };

            speechRecognition.onerror = function() {
                citizenPushToTalkActive = false;
                setCitizenMicStatus('Mic stopped');
            };

            speechRecognition.onend = function() {
                if (citizenPushToTalkActive) {
                    try {
                        speechRecognition.start();
                    } catch (_) {
                        // Ignore restart failures.
                    }
                }
            };

            return speechRecognition;
        }

        function startCitizenPushToTalk() {
            if (userRole !== 'citizen') return;
            connectSpeechSocket();

            const recognition = ensureSpeechRecognition();
            if (!recognition) {
                showNotification('Mic unavailable', 'Your browser does not support speech recognition.');
                return;
            }

            citizenPushToTalkActive = true;
            setCitizenMicStatus('Listening... release to stop');

            try {
                recognition.start();
            } catch (_) {
                // Already started or blocked by browser state.
            }
        }

        function stopCitizenPushToTalk() {
            citizenPushToTalkActive = false;
            setCitizenMicStatus('Mic idle');

            if (speechRecognition) {
                try {
                    speechRecognition.stop();
                } catch (_) {
                    // Ignore stop errors.
                }
            }
        }

        function applyRoleFeatures(role) {
            const allowedTabs = new Set(ROLE_FEATURES[role]?.tabs || ROLE_FEATURES.citizen.tabs);

            // Show/hide nav tabs purely from ROLE_FEATURES â€” no hardcoded overrides
            document.querySelectorAll('.tab').forEach(tab => {
                const tabTarget = (tab.getAttribute('onclick') || '').match(/switchTab\('([^']+)'\)/)?.[1];
                if (!tabTarget) return;
                tab.style.display = allowedTabs.has(tabTarget) ? '' : 'none';
            });

            // Deactivate any panel not in this role's allowed list
            document.querySelectorAll('.tab-content').forEach(panel => {
                if (!allowedTabs.has(panel.id)) {
                    panel.classList.remove('active');
                }
            });

            // Audit-log tab button (special id, not matched by generic loop above)
            const auditTab = document.getElementById('auditLogTab');
            if (auditTab) {
                auditTab.style.display = allowedTabs.has('audit-log') ? '' : 'none';
            }

            // â”€â”€ AI Detection tab: show only role-relevant sections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            const isAdmin = role === 'admin';

            // Admin-only control panel (Camera Mgmt + Model Config + History)
            const adminAiPanel = document.getElementById('adminAiControlPanel');
            if (adminAiPanel) adminAiPanel.style.display = isAdmin ? '' : 'none';

            // Detection Capabilities grid â€” only for officer/citizen, not admin
            // (admin gets Camera Management table which covers this info)
            const capSection = document.getElementById('detectionCapabilitiesSection');
            if (capSection) capSection.style.display = isAdmin ? 'none' : '';

            // Live Detection Log panel â€” hide for citizen (they can't start detection)
            const logPanel = document.getElementById('detectionLogPanel');
            if (logPanel && role === 'citizen') logPanel.style.display = 'none';

            // Start/Stop/Export buttons â€” hide entirely for citizen
            const aiStartBtn = document.getElementById('aiStartBtn');
            const aiStopBtn  = document.getElementById('aiStopBtn');
            if (role === 'citizen') {
                if (aiStartBtn) aiStartBtn.style.display = 'none';
                if (aiStopBtn)  aiStopBtn.style.display  = 'none';
            } else {
                if (aiStartBtn) aiStartBtn.style.display = '';
                if (aiStopBtn)  aiStopBtn.style.display  = '';
            }

            // Dispatch / Intercept / Monitor buttons in detection cards
            // â€” citizen should not see these action buttons
            document.querySelectorAll('#detectionFeed .btn').forEach(btn => {
                btn.style.display = role === 'citizen' ? 'none' : '';
            });
        }

        function stopEmergencyAlarm() {
            if (alarmSweepTimer) {
                clearInterval(alarmSweepTimer);
                alarmSweepTimer = null;
            }

            if (alarmVolumeTimer) {
                clearInterval(alarmVolumeTimer);
                alarmVolumeTimer = null;
            }

            if (alarmStopTimer) {
                clearTimeout(alarmStopTimer);
                alarmStopTimer = null;
            }

            if (alarmOscillator) {
                try {
                    alarmOscillator.stop();
                } catch (_) {
                    // Ignore if oscillator already stopped.
                }
                alarmOscillator.disconnect();
                alarmOscillator = null;
            }

            if (alarmGainNode) {
                alarmGainNode.disconnect();
                alarmGainNode = null;
            }
        }

        // Starts the alarm for a bounded duration and auto-stops after 1 or 5 minutes.
        function startEmergencyAlarm(durationMinutes = 5) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;

            if (!alarmAudioContext) {
                alarmAudioContext = new AudioCtx();
            }

            if (alarmAudioContext.state === 'suspended') {
                alarmAudioContext.resume();
            }

            stopEmergencyAlarm(); // clear any previous instance

            alarmOscillator = alarmAudioContext.createOscillator();
            alarmGainNode = alarmAudioContext.createGain();

            alarmOscillator.type = 'sawtooth';
            alarmOscillator.frequency.setValueAtTime(740, alarmAudioContext.currentTime);
            alarmGainNode.gain.setValueAtTime(0.0001, alarmAudioContext.currentTime);
            alarmGainNode.gain.exponentialRampToValueAtTime(0.5, alarmAudioContext.currentTime + 0.06);

            alarmOscillator.connect(alarmGainNode);
            alarmGainNode.connect(alarmAudioContext.destination);
            alarmOscillator.start();

            pulseAlarmVolume(3);

            // Show UI stop controls so user can immediately cancel sound
            try {
                const stopBtn = document.getElementById('sosStopBtn');
                if (stopBtn) stopBtn.style.display = 'block';
                const globalStop = document.getElementById('globalStopAlarmBtn');
                if (globalStop) globalStop.style.display = 'inline-block';
            } catch (_) {
                // ignore
            }

            let highTone = false;
            alarmSweepTimer = setInterval(() => {
                if (!alarmOscillator || !alarmAudioContext) return;
                highTone = !highTone;
                const targetFrequency = highTone ? 1320 : 740;
                alarmOscillator.frequency.setTargetAtTime(targetFrequency, alarmAudioContext.currentTime, 0.05);
            }, 230);

            const alarmDurationMs = Math.max(1, durationMinutes) * 60 * 1000;
            alarmStopTimer = setTimeout(() => {
                stopEmergencyAlarm();
            }, alarmDurationMs);
        }

        // Hold-to-alarm SOS logic
        let sosActive = false;

        function startSOS(e) {
            if (e) e.preventDefault();
            if (sosActive) return;
            sosActive = true;

            const btn = document.getElementById('sosMainBtn');
            const stopBtn = document.getElementById('sosStopBtn');
            const hint = document.getElementById('sosHintText');
            if (btn) {
                btn.style.background = '#dc2626';
                btn.style.color = '#fff';
                btn.style.boxShadow = '0 0 0 12px rgba(220,38,38,0.35), 0 0 40px rgba(220,38,38,0.6)';
            }
            if (stopBtn) {
                stopBtn.style.display = 'block';
            }
            if (hint) hint.textContent = 'ðŸš¨ ALARM ACTIVE â€” Release to stop';

            triggerSOS({ source: 'manual-sos' });
        }

        function stopSOS() {
            // Allow stopSOS to stop alarms even if sosActive wasn't set locally
            sosActive = false;

            const btn = document.getElementById('sosMainBtn');
            const stopBtn = document.getElementById('sosStopBtn');
            const hint = document.getElementById('sosHintText');
            if (btn) {
                btn.style.background = '';
                btn.style.color = '';
                btn.style.boxShadow = '';
            }
            if (stopBtn) {
                stopBtn.style.display = 'none';
            }
            try {
                const globalStop = document.getElementById('globalStopAlarmBtn');
                if (globalStop) globalStop.style.display = 'none';
            } catch (_) {}
            if (hint) hint.textContent = 'ðŸ”´ Hold the SOS button to sound the alarm';

            stopEmergencyAlarm();
            // Stop sharing live location when SOS is stopped
            stopCitizenLiveSharing();
        }

        // Immediate stop handler for UI buttons which should always stop alarm sound
        function stopAlarmImmediate() {
            sosActive = false;
            const stopBtn = document.getElementById('sosStopBtn');
            const mainBtn = document.getElementById('sosMainBtn');
            const hint = document.getElementById('sosHintText');
            if (stopBtn) stopBtn.style.display = 'none';
            try {
                const globalStop = document.getElementById('globalStopAlarmBtn');
                if (globalStop) globalStop.style.display = 'none';
            } catch (_) {}
            if (mainBtn) {
                mainBtn.style.background = '';
                mainBtn.style.color = '';
                mainBtn.style.boxShadow = '';
            }
            if (hint) hint.textContent = 'ðŸ”´ Hold the SOS button to sound the alarm';

            // Ensure audio and sharing are force-stopped
            try {
                stopEmergencyAlarm();
            } catch (_) {
                // ignore
            }
            try {
                stopCitizenLiveSharing();
            } catch (_) {
                // ignore
            }
        }

        function initializeMap() {
            if (map) return;
            
            map = L.map('map').setView([19.0760, 72.8777], 12);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(map);

            const incidents = [
                { lat: 19.0596, lng: 72.8295, type: 'SOS', desc: 'Emergency Alert - Andheri West' },
                { lat: 19.0544, lng: 72.8406, type: 'Weapon', desc: 'Weapon Detected - Bandra Station' },
                { lat: 19.0760, lng: 72.8777, type: 'Suspicious', desc: 'Suspicious Activity - Marine Drive' },
                { lat: 18.9220, lng: 72.8347, type: 'Vehicle', desc: 'Stolen Vehicle - Colaba' }
            ];

            const redIcon = L.icon({
                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNSIgaGVpZ2h0PSI0MSI+PHBhdGggZmlsbD0iI2RjMjYyNiIgZD0iTTEyLjUgMEMxOS40IDAgMjUgNS42IDI1IDEyLjVjMCAxMC41LTEyLjUgMjguNS0xMi41IDI4LjVTMCAyMyAwIDEyLjVDMCA1LjYgNS42IDAgMTIuNSAweiIvPjxjaXJjbGUgZmlsbD0iI2ZmZiIgY3g9IjEyLjUiIGN5PSIxMi41IiByPSI0Ii8+PC9zdmc+',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34]
            });

            incidents.forEach(incident => {
                L.marker([incident.lat, incident.lng], { icon: redIcon })
                    .addTo(map)
                    .bindPopup(`<b>${incident.type} Alert</b><br>${incident.desc}`);
            });
        }

        function switchTab(tabName) {
            if (userRole && !ROLE_FEATURES[userRole]?.tabs.includes(tabName)) {
                showNotification('Access Restricted', 'That feature is not available for your role.');
                return;
            }

            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            const tabBtn = Array.from(document.querySelectorAll('.tab')).find(btn => 
                btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(tabName)
            );
            if (tabBtn) tabBtn.classList.add('active');

            const tabContent = document.getElementById(tabName);
            if (tabContent) tabContent.classList.add('active');

            if (tabName === 'profile') {
                loadProfile();
            } else if (tabName === 'analytics') {
                refreshAnalytics();
            } else if (tabName === 'reports') {
                loadReports();
                configureCitizenComplaintForm(userRole);
            } else if (tabName === 'audit-log' && userRole === 'admin') {
                fetchAuditLogs();
            } else if (tabName === 'evidence') {
                renderEvidenceVault();
            } else if (tabName === 'sos') {
                applyAlertSettingsToUI();
            }

            if (tabName === 'dashboard' && map) {
                setTimeout(() => map.invalidateSize(), 100);
            }
        }

        // SOS Emergency â€” dispatches the alert; alarm is managed by startSOS/stopSOS.
        async function triggerSOS(options = {}) {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(async position => {
                    const { latitude, longitude } = position.coords;
                    try {
                        const data = await apiRequest('/api/sos', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ latitude, longitude })
                        });

                        if (data?.data) {
                            handleIncomingAlert(data.data, {
                                force: true,
                                durationMinutes: getAlertDurationMinutes(data.data)
                            });
                            // If citizen triggered SOS, start live sharing with tracker id
                            if (userRole === 'citizen') {
                                currentSosTrackerId = data.data.id || `${currentUser || 'citizen'}-${Date.now()}`;
                                startCitizenLiveSharing();
                            }
                        } else {
                            handleIncomingAlert({
                                id: `SOS-${Date.now()}`,
                                type: 'SOS Emergency',
                                location: `Lat: ${latitude.toFixed(4)}, Lng: ${longitude.toFixed(4)}`
                            }, {
                                force: true,
                                durationMinutes: 5
                            });
                        }
                    } catch (error) {
                        showNotification('SOS Failed', error.message || 'Unable to send SOS alert');
                        return;
                    }

                    showNotification('SOS Alert Sent!', `Emergency alert dispatched. Location: ${latitude.toFixed(4)}Â°N, ${longitude.toFixed(4)}Â°E`);
                    
                    if (map && trackingMarker) {
                        map.removeLayer(trackingMarker);
                    }
                    
                    const redIcon = L.icon({
                        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNSIgaGVpZ2h0PSI0MSI+PHBhdGggZmlsbD0iI2RjMjYyNiIgZD0iTTEyLjUgMEMxOS40IDAgMjUgNS42IDI1IDEyLjVjMCAxMC41LTEyLjUgMjguNS0xMi41IDI4LjVTMCAyMyAwIDEyLjVDMCA1LjYgNS42IDAgMTIuNSAweiIvPjxjaXJjbGUgZmlsbD0iI2ZmZiIgY3g9IjEyLjUiIGN5PSIxMi41IiByPSI0Ii8+PC9zdmc+',
                        iconSize: [25, 41]
                    });
                    
                    trackingMarker = L.marker([latitude, longitude], { icon: redIcon })
                        .addTo(map)
                        .bindPopup('ðŸš¨ YOUR EMERGENCY ALERT<br>Live tracking active<br>Help is on the way!')
                        .openPopup();
                    
                    map.setView([latitude, longitude], 15);
                    startLiveTracking();
                    
                    const alertsDiv = document.getElementById('alertsList');
                    const newAlert = document.createElement('div');
                    newAlert.className = 'alert-item';
                    newAlert.innerHTML = `
                        <div class="alert-content">
                            <div class="alert-type">ðŸ”´ SOS Emergency Alert - YOU</div>
                            <div class="alert-details">Location: ${latitude.toFixed(4)}Â° N, ${longitude.toFixed(4)}Â° E</div>
                            <div class="alert-time">Just now</div>
                        </div>
                        <div class="alert-actions">
                            <button class="btn btn-success btn-small">Help Dispatched</button>
                        </div>
                    `;
                    alertsDiv.insertBefore(newAlert, alertsDiv.firstChild);
                    document.getElementById('activeAlerts').textContent = String(parseInt(document.getElementById('activeAlerts').textContent) + 1);
                    
                    switchTab('dashboard');
                }, error => {
                    showNotification('Location Error', 'Unable to get your location. Please enable GPS.');
                });
            } else {
                showNotification('Error', 'Geolocation is not supported by your browser.');
            }
        }

        function startLiveTracking() {
            trackingInterval = setInterval(() => {
                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(position => {
                        const { latitude, longitude } = position.coords;
                        if (trackingMarker) {
                            trackingMarker.setLatLng([latitude, longitude]);
                        }
                    });
                }
            }, 3000);
        }

        // Voice Command
        function toggleVoiceCommand() {
            const indicator = document.getElementById('voiceIndicator');
            voiceRecognitionActive = !voiceRecognitionActive;
            
            if (voiceRecognitionActive) {
                indicator.classList.add('active');
                showNotification('Voice Command Active', 'Listening for commands...');
                startVoiceRecognition();
            } else {
                indicator.classList.remove('active');
                showNotification('Voice Command Inactive', 'Voice recognition stopped');
            }
        }

        function startVoiceRecognition() {
            if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (userRole === 'citizen') {
                    connectSpeechSocket();
                }

                speechRecognition = new SpeechRecognition();
                speechRecognition.continuous = true;
                speechRecognition.interimResults = false;
                speechRecognition.lang = 'en-US';

                speechRecognition.onresult = function(event) {
                    const last = event.results.length - 1;
                    const transcript = event.results[last][0].transcript.trim();
                    const command = transcript.toLowerCase();

                    if (userRole === 'citizen' && transcript && speechSocket) {
                        speechSocket.emit('citizen-speech', {
                            username: currentUser,
                            text: transcript
                        });
                    }
                    
                    if (command.includes('emergency') || command.includes('sos')) {
                        triggerSOS();
                    } else if (command.includes('dashboard')) {
                        switchTab('dashboard');
                    } else if (command.includes('report')) {
                        switchTab('reports');
                    }
                };

                speechRecognition.start();
            } else {
                alert('Voice recognition not supported in this browser');
            }
        }

        // Notification System
        function showNotification(title, message) {
            const popup = document.getElementById('notificationPopup');
            document.getElementById('notificationTitle').textContent = title;
            document.getElementById('notificationMessage').textContent = message;
            popup.style.display = 'block';

            setTimeout(() => {
                popup.style.display = 'none';
            }, 5000);
        }

        // Real-time Updates Simulation
        function simulateRealTimeUpdates() {
            setInterval(() => {
                const alerts = parseInt(document.getElementById('activeAlerts').textContent);
                document.getElementById('activeAlerts').textContent = alerts + Math.floor(Math.random() * 3);
            }, 30000);
        }

        // Power button double-click for SOS
        let powerButtonClicks = 0;
        let powerButtonTimer = null;
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'p' || e.key === 'P') {
                powerButtonClicks++;
                
                if (powerButtonClicks === 1) {
                    powerButtonTimer = setTimeout(() => {
                        powerButtonClicks = 0;
                    }, 500);
                } else if (powerButtonClicks === 2) {
                    clearTimeout(powerButtonTimer);
                    powerButtonClicks = 0;
                    triggerSOS();
                    showNotification('Emergency SOS', 'Double power button press detected! Sending SOS...');
                }
            }
        });

        // Helper Functions
        async function refreshAlerts() {
            try {
                const data = await apiRequest('/api/alerts');
                const alerts = data.alerts || [];
                const alertsDiv = document.getElementById('alertsList');
                alertsDiv.innerHTML = '';

                alerts.forEach(alert => {
                    const item = document.createElement('div');
                    item.className = 'alert-item';
                    item.innerHTML = `
                        <div class="alert-content">
                            <div class="alert-type">${alert.type}</div>
                            <div class="alert-details">${alert.location}</div>
                            <div class="alert-time">${alert.time}</div>
                        </div>
                    `;
                    alertsDiv.appendChild(item);
                });

                document.getElementById('activeAlerts').textContent = String(alerts.length);
                showNotification('Success', 'Alerts updated successfully');
            } catch (error) {
                showNotification('Error', error.message || 'Failed to refresh alerts');
            }
        }

        function respondToAlert(alertId) {
            showNotification('Responding', `Dispatching unit for alert ${alertId}`);
        }

        function viewLocation(lat, lng) {
            if (map) {
                map.setView([lat, lng], 16);
                switchTab('dashboard');
            }
        }

        function viewDetection(detectionId) {
            showNotification('Loading', `Opening CCTV feed for ${detectionId}`);
        }

        async function loadProfile() {
            try {
                const data = await apiRequest('/api/profile');
                const profile = data.profile || {};
                const form = document.getElementById('profileForm');
                if (!form) return;

                const nameInput = form.querySelector('[name="name"]');
                const emailInput = form.querySelector('[name="email"]');
                const phoneInput = form.querySelector('[name="phone"]');
                if (nameInput) nameInput.value = profile.name || '';
                if (emailInput) emailInput.value = profile.email || '';
                if (phoneInput) phoneInput.value = profile.phone || '';

                const complaintName = document.getElementById('complaintCitizenName');
                const complaintPhone = document.getElementById('complaintCitizenPhone');
                if (complaintName && !complaintName.value) complaintName.value = profile.name || currentUser || '';
                if (complaintPhone && !complaintPhone.value) complaintPhone.value = profile.phone || '';

                const prefs = profile.notificationPreferences || {};
                const emailToggle = form.querySelector('[name="emailIncidents"]');
                const smsToggle = form.querySelector('[name="smsEmergencies"]');
                const pushToggle = form.querySelector('[name="pushNotifications"]');
                if (emailToggle) emailToggle.checked = prefs.emailIncidents !== false;
                if (smsToggle) smsToggle.checked = prefs.smsEmergencies !== false;
                if (pushToggle) pushToggle.checked = Boolean(prefs.pushNotifications);

                const avatarPreview = document.getElementById('profileAvatarPreview');
                if (avatarPreview) {
                    if (profile.avatar) {
                        avatarPreview.src = `${API_BASE}${profile.avatar}`;
                        avatarPreview.style.display = 'block';
                    } else {
                        avatarPreview.src = '';
                        avatarPreview.style.display = 'none';
                    }
                }
            } catch (_) {
                // Keep the profile tab usable even if the API request fails.
            }
        }

        async function refreshAnalytics() {
            try {
                const data = await apiRequest('/api/analytics');
                const prediction = data.prediction || {};
                const trends = data.trends || {};
                const nlp = data.nlp || {};
                const highRiskAreas = prediction.highRiskAreas || [];

                const setText = (id, value) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = value;
                };

                setText('analyticsTotalIncidents', prediction.totalIncidents ?? '0');
                setText('analyticsRiskAreaCount', highRiskAreas.length || '0');
                setText('analyticsPreventionRate', `${prediction.preventionRate ?? 0}%`);
                setText('analyticsAccuracy', `${prediction.aiAccuracy ?? 0}%`);
                setText('analyticsIncidentTrend', prediction.totalIncidents ? '-12% from last month' : 'Live data unavailable');
                setText('analyticsRiskAreaNote', highRiskAreas.length ? 'Constant monitoring' : 'No risk areas found');
                setText('analyticsPreventionTrend', prediction.preventionRate ? '+8% improvement' : 'Awaiting model data');
                setText('analyticsModelVersion', 'Model v8.2');

                const heatmapSummary = document.getElementById('analyticsHeatmapSummary');
                if (heatmapSummary && highRiskAreas.length) {
                    heatmapSummary.innerHTML = `ðŸ“Š Crime prediction model analyzing historical patterns...<br><br><strong>High-risk areas identified:</strong><br>${highRiskAreas.map(area => `ðŸ”´ ${area.area} (Risk Score: ${area.risk}%)`).join('<br>')}`;
                }

                const trendSummary = document.getElementById('analyticsTrendSummary');
                if (trendSummary) {
                    trendSummary.innerHTML = `ðŸ• Peak crime hours: ${trends.peakHours || 'N/A'}<br>ðŸ“ Most affected zones: Bandra, Andheri, Marine Drive<br>ðŸ“Š Trend: ${prediction.totalIncidents ? '-15% crime rate reduction this quarter' : 'Trend data unavailable'}<br><br><strong>Recommendation:</strong> ${trends.recommendation || 'Increase patrol units during peak hours'}`;
                }

                const socialAlerts = document.getElementById('analyticsSocialAlerts');
                if (socialAlerts && Array.isArray(nlp.socialAlerts)) {
                    socialAlerts.innerHTML = `<h3 style="margin-bottom: 12px;">ðŸ“± Recent Social Media Alerts</h3><div style="color: var(--text-muted); font-size: 14px; line-height: 1.8;">${nlp.socialAlerts.map(alert => `â€¢ ${alert}`).join('<br>')}</div>`;
                }
            } catch (error) {
                console.warn('Analytics refresh failed:', error.message);
            }
        }

        // â”€â”€ AI Detection engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        let aiDetectionInterval = null;
        const _aiLog = [];

        function _aiLogEntry(msg) {
            const ts = new Date().toLocaleTimeString();
            const entry = `[${ts}] ${msg}`;
            _aiLog.unshift(entry);

            // Mirror to the live detection log panel (always)
            const list = document.getElementById('detectionLogList');
            if (list) {
                const line = document.createElement('div');
                line.textContent = entry;
                line.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                line.style.paddingBottom = '3px';
                line.style.marginBottom = '3px';
                list.prepend(line);
                while (list.children.length > 50) list.lastChild.remove();
            }

            // Mirror to admin full detection history panel
            const hist = document.getElementById('adminDetectionHistory');
            if (hist) {
                // Remove placeholder if present
                if (hist.querySelector('div[style*="text-align:center"]')) hist.innerHTML = '';
                const hLine = document.createElement('div');
                hLine.textContent = entry;
                hLine.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:3px;margin-bottom:3px;';
                hist.prepend(hLine);
                while (hist.children.length > 200) hist.lastChild.remove();
            }

            // Bump admin detection counter
            const ctr = document.getElementById('aiDetectionsToday');
            if (ctr && msg.includes('flagged')) {
                ctr.textContent = String(parseInt(ctr.textContent || '0') + 1);
            }
        }

        function _setAiStatus(running) {
            const dot  = document.getElementById('aiStatusDot');
            const text = document.getElementById('aiStatusText');
            const startBtn = document.getElementById('aiStartBtn');
            const stopBtn  = document.getElementById('aiStopBtn');
            if (dot)  dot.style.background  = running ? '#22c55e' : '#94a3b8';
            if (text) text.textContent       = running ? 'Live' : 'Stopped';
            if (startBtn) startBtn.disabled  = running;
            if (stopBtn)  stopBtn.disabled   = !running;
        }

        function _tickDetection() {
            const now = new Date().toLocaleTimeString();
            document.getElementById('aiLastUpdated').textContent = 'Last updated: ' + now;

            // Slightly jitter confidence values to simulate live feed
            const jitter = () => (Math.random() * 4 - 2).toFixed(1);
            const clamp  = (v, min, max) => Math.min(max, Math.max(min, v));

            const c1El = document.getElementById('conf-WD024');
            if (c1El) { const v = clamp(parseFloat(c1El.textContent) + parseFloat(jitter()), 89, 99); c1El.textContent = v.toFixed(1) + '%'; }

            const c2El = document.getElementById('conf-SB015');
            const crEl = document.getElementById('crowd-SB015');
            if (c2El) { const v = clamp(parseFloat(c2El.textContent) + parseFloat(jitter()), 70, 90); c2El.textContent = v.toFixed(1) + '%'; }
            if (crEl) { crEl.textContent = Math.floor(clamp(parseInt(crEl.textContent) + Math.floor(Math.random()*10-5), 100, 160)); }

            const c3El = document.getElementById('conf-VA008');
            if (c3El) { const v = clamp(parseFloat(c3El.textContent) + parseFloat(jitter()), 82, 95); c3El.textContent = v.toFixed(1) + '%'; }

            const c4El = document.getElementById('conf-SV031');
            if (c4El) { const v = clamp(parseFloat(c4El.textContent) + parseFloat(jitter()), 92, 99); c4El.textContent = v.toFixed(1) + '%'; }

            _aiLogEntry(`Scan complete â€” 4 cameras active, 4 detections flagged`);
        }

        function startDetection() {
            if (aiDetectionInterval) return;
            _setAiStatus(true);
            document.getElementById('detectionLogPanel').style.display = '';
            _aiLogEntry('Detection engine started â€” scanning all cameras');
            _tickDetection();
            aiDetectionInterval = setInterval(_tickDetection, 3000);
            showNotification('AI Detection', 'Live detection started on all 4 cameras');
        }

        function stopDetection() {
            if (aiDetectionInterval) { clearInterval(aiDetectionInterval); aiDetectionInterval = null; }
            _setAiStatus(false);
            _aiLogEntry('Detection engine stopped by operator');
            showNotification('AI Detection', 'Detection paused');
        }

        function exportDetectionLog() {
            if (!_aiLog.length) {
                showNotification('Export', 'No log data yet â€” press Start first');
                return;
            }
            const csv = 'Timestamp,Event\n' + _aiLog.map(l => `"${l}"`).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url  = URL.createObjectURL(blob);
            const a    = Object.assign(document.createElement('a'), { href: url, download: 'ai_detection_log.csv' });
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showNotification('Export', `Downloaded ${_aiLog.length} log entries as CSV`);
        }

        // â”€â”€ Dispatch / Monitor / Intercept â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        function dispatchUnit(id, type, location) {
            const unit = ['P-101','P-102','P-103','P-104'][Math.floor(Math.random()*4)];
            const eta  = (Math.random()*4 + 1).toFixed(1);
            _aiLogEntry(`DISPATCH â€” Unit ${unit} â†’ ${location} (ETA ${eta} min)`);
            showNotification(`ðŸš¨ Unit Dispatched`, `Unit ${unit} dispatched to ${location} | ETA: ${eta} min`);

            // Update dashboard alert count
            const el = document.getElementById('activeAlerts');
            if (el) el.textContent = String(parseInt(el.textContent) + 1);

            // Add to live alerts
            const alertsDiv = document.getElementById('alertsList');
            if (alertsDiv) {
                const item = document.createElement('div');
                item.className = 'alert-item';
                item.innerHTML = `
                    <div class="alert-content">
                        <div class="alert-type">ðŸš¨ ${type} â€” Unit ${unit} Dispatched</div>
                        <div class="alert-details">Location: ${location} | Detection ID: ${id}</div>
                        <div class="alert-time">Just now &bull; ETA ${eta} min</div>
                    </div>
                    <div class="alert-actions">
                        <span class="badge badge-warning">En Route</span>
                    </div>
                `;
                alertsDiv.insertBefore(item, alertsDiv.firstChild);
            }
        }

        function monitorFeed(id, type, location) {
            _aiLogEntry(`MONITOR â€” Enhanced surveillance on ${location} (${id})`);
            showNotification(`ðŸ‘ï¸ Monitoring Active`, `Enhanced monitoring enabled for ${location}`);
        }

        function interceptVehicle(id, plate, location) {
            const unit = ['P-103','P-104'][Math.floor(Math.random()*2)];
            _aiLogEntry(`INTERCEPT â€” Unit ${unit} intercepting ${plate} at ${location}`);
            showNotification(`ðŸš“ Intercept Order Sent`, `Unit ${unit} â†’ ${plate} at ${location}`);
        }

        async function submitReport(event) {
            event.preventDefault();
            const form = event.target;
            const msgEl = document.getElementById('reportSubmitMsg');
            const type = document.getElementById('reportType').value;
            const location = document.getElementById('reportLocation').value;
            const citizenName = document.getElementById('complaintCitizenName')?.value || currentUser || 'Citizen';
            const citizenPhone = document.getElementById('complaintCitizenPhone')?.value || '';
            const citizenDetails = document.getElementById('complaintCitizenDetails')?.value || '';
            const descriptionField = form.querySelector('[name="description"]');
            if (!type || !location) {
                msgEl.textContent = 'Please fill in all required fields.';
                msgEl.style.cssText = 'display:block; color:var(--danger-color); padding:8px; background:rgba(220,38,38,0.1); border-radius:6px;';
                return;
            }
            const formData = new FormData(form);
            formData.set('type', type);
            formData.set('location', location);
            if (descriptionField) {
                formData.set('description', descriptionField.value);
            }
            formData.set('citizenName', citizenName);
            formData.set('citizenPhone', citizenPhone);
            formData.set('citizenDetails', citizenDetails);

            const parsedLocation = latestCitizenCoordinates || parseCoordinatesFromLocationText(location);
            if (parsedLocation && Number.isFinite(parsedLocation.lat) && Number.isFinite(parsedLocation.lng)) {
                formData.set('reportLatitude', String(parsedLocation.lat));
                formData.set('reportLongitude', String(parsedLocation.lng));
            }
            try {
                const data = await apiRequest('/api/report', {
                    method: 'POST',
                    body: formData
                });

                if (userRole === 'citizen' && speechSocket) {
                    const trackerId = String(data.reportId || `${currentUser || 'citizen'}-${Date.now()}`);
                    speechSocket.emit('citizen-complaint', {
                        trackerId,
                        reportId: data.reportId,
                        username: currentUser,
                        citizenName,
                        citizenPhone,
                        citizenDetails,
                        complaintType: type,
                        locationText: location,
                        description: descriptionField?.value || ''
                    });

                    if (citizenLiveSharingEnabled) {
                        emitCitizenLiveLocation({
                            trackerId,
                            complaintType: type,
                            locationText: location,
                            citizenDetails,
                            citizenPhone,
                            citizenName
                        });
                    }
                }

                msgEl.textContent = `âœ… Report submitted! ID: ${data.reportId || 'N/A'}`;
                msgEl.style.cssText = 'display:block; color:var(--success-color); padding:8px; background:rgba(22,163,74,0.1); border-radius:6px;';
                showNotification('Report Submitted', 'Your report has been filed successfully');
                form.reset();
                configureCitizenComplaintForm(userRole);
                loadReports();
            } catch (error) {
                msgEl.textContent = 'âŒ ' + (error.message || 'Unable to submit report');
                msgEl.style.cssText = 'display:block; color:var(--danger-color); padding:8px; background:rgba(220,38,38,0.1); border-radius:6px;';
            }
        }

        function getGPSLocation() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(position => {
                    const { latitude, longitude } = position.coords;
                    document.getElementById('reportLocation').value = `${latitude.toFixed(4)}Â°N, ${longitude.toFixed(4)}Â°E`;
                    const latInput = document.getElementById('reportLatitude');
                    const lngInput = document.getElementById('reportLongitude');
                    if (latInput) latInput.value = String(latitude);
                    if (lngInput) lngInput.value = String(longitude);
                    latestCitizenCoordinates = { lat: latitude, lng: longitude };
                });
            }
        }

        function filterIncidentReports() {
            const search = document.getElementById('incidentSearchInput').value.toLowerCase();
            const status = document.getElementById('incidentStatusFilter').value;
            const rows = document.querySelectorAll('#incidentReportsTableBody tr');
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                const rowStatus = row.getAttribute('data-status') || '';
                const matchesSearch = !search || text.includes(search);
                const matchesStatus = !status || rowStatus === status;
                row.style.display = matchesSearch && matchesStatus ? '' : 'none';
            });
        }

        function viewIncidentDetails(incidentId, type, location, status) {
            const report = allIncidentReports.find(item => item.id === incidentId) || {};
            document.getElementById('incidentDetailTitle').textContent = 'Incident: ' + incidentId;
            document.getElementById('incidentDetailBody').innerHTML = `
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div><strong style="color:var(--text-light);">ID:</strong><br>${incidentId}</div>
                    <div><strong style="color:var(--text-light);">Type:</strong><br>${type || 'N/A'}</div>
                    <div><strong style="color:var(--text-light);">Location:</strong><br>${location || 'N/A'}</div>
                    <div><strong style="color:var(--text-light);">Status:</strong><br>${status || 'N/A'}</div>
                    <div><strong style="color:var(--text-light);">Date:</strong><br>${report.date || 'N/A'}</div>
                    <div><strong style="color:var(--text-light);">Priority:</strong><br>${report.priority || 'Normal'}</div>
                    <div style="grid-column:1/-1;"><strong style="color:var(--text-light);">Description:</strong><br>${report.description || 'No description available.'}</div>
                    <div><strong style="color:var(--text-light);">Citizen:</strong><br>${report.citizenName || 'N/A'}</div>
                    <div><strong style="color:var(--text-light);">Citizen Phone:</strong><br>${report.citizenPhone || 'N/A'}</div>
                    <div style="grid-column:1/-1;"><strong style="color:var(--text-light);">Citizen Details:</strong><br>${report.citizenDetails || 'No extra details provided.'}</div>
                    <div><strong style="color:var(--text-light);">Evidence:</strong><br>${report.evidenceCount || 0} file(s)</div>
                    <div><strong style="color:var(--text-light);">Reported By:</strong><br>${report.reportedBy || 'Unknown'}</div>
                    <div><strong style="color:var(--text-light);">Role:</strong><br>${report.reportedByRole || 'citizen'}</div>
                </div>
            `;
            document.getElementById('incidentDetailModal').classList.add('active');
        }

        let _updateTargetId = null;
        function updateIncidentStatus(incidentId) {
            _updateTargetId = incidentId;
            document.getElementById('updateStatusId').textContent = incidentId;
            document.getElementById('updateStatusNotes').value = '';
            document.getElementById('updateStatusMsg').style.display = 'none';
            document.getElementById('updateStatusModal').classList.add('active');
        }

        function submitStatusUpdate() {
            const newStatus = document.getElementById('newStatusSelect').value;
            const notes = document.getElementById('updateStatusNotes').value;
            const msgEl = document.getElementById('updateStatusMsg');

            // Update row in table
            const rows = document.querySelectorAll('#incidentReportsTableBody tr');
            rows.forEach(row => {
                const idCell = row.querySelector('td');
                if (idCell && idCell.textContent === _updateTargetId) {
                    row.setAttribute('data-status', newStatus);
                    const badge = row.querySelector('td:nth-child(4) .badge');
                    if (badge) {
                        badge.textContent = newStatus;
                        badge.className = 'badge ' + (
                            newStatus === 'Resolved' || newStatus === 'Closed' ? 'badge-success' :
                            newStatus === 'Open' ? 'badge-danger' : 'badge-warning'
                        );
                    }
                }
            });

            msgEl.textContent = `âœ… Status updated to "${newStatus}"` + (notes ? ` â€” ${notes}` : '');
            msgEl.style.cssText = 'display:block; color:var(--success-color); padding:8px; background:rgba(22,163,74,0.1); border-radius:6px;';
            setTimeout(() => document.getElementById('updateStatusModal').classList.remove('active'), 1500);
            showNotification('Status Updated', `${_updateTargetId} â†’ ${newStatus}`);
        }

        async function addContact() {
            const name = prompt('Enter contact name:');
            const phone = prompt('Enter phone number:');
            if (name && phone) {
                try {
                    await apiRequest('/api/contacts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, relation: 'Other', phone })
                    });
                    showNotification('Contact Added', `${name} added successfully`);
                    loadContacts();
                } catch (error) {
                    showNotification('Contact Failed', error.message || 'Unable to add contact');
                }
            }
        }

        async function removeContact(phone) {
            if (confirm('Remove this contact?')) {
                try {
                    await apiRequest('/api/contacts', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone })
                    });
                    showNotification('Contact Removed', 'Emergency contact removed');
                    loadContacts();
                } catch (error) {
                    showNotification('Contact Failed', error.message || 'Unable to remove contact');
                }
            }
        }

        async function updateProfile(event) {
            // Defensive: inline handlers may not always pass `event` in some environments.
            // Ensure we have an event object and prevent the form's default submit/navigation.
            event = event || (typeof window !== 'undefined' && window.event) || null;
            if (event && typeof event.preventDefault === 'function') try { event.preventDefault(); } catch (_) {}
            const form = event.target;
            const profileData = new FormData(form);
            profileData.set('notificationPreferences', JSON.stringify({
                emailIncidents: !!form.querySelector('[name="emailIncidents"]')?.checked,
                smsEmergencies: !!form.querySelector('[name="smsEmergencies"]')?.checked,
                pushNotifications: !!form.querySelector('[name="pushNotifications"]')?.checked
            }));
            const msgEl = document.getElementById('profileMsg');
            try {
                const data = await apiRequest('/api/profile', {
                    method: 'POST',
                    body: profileData
                });
                msgEl.textContent = 'âœ… Profile updated successfully!';
                msgEl.style.cssText = 'display:block; color:var(--success-color); padding:10px; background:rgba(22,163,74,0.1); border-radius:6px;';
                showNotification('Profile Updated', 'Your profile has been updated successfully');
                if (data?.profile?.avatar) {
                    const avatarPreview = document.getElementById('profileAvatarPreview');
                    if (avatarPreview) {
                        avatarPreview.src = `${API_BASE}${data.profile.avatar}`;
                        avatarPreview.style.display = 'block';
                    }
                }
                loadProfile();
            } catch (error) {
                msgEl.textContent = 'âŒ ' + (error.message || 'Unable to update profile');
                msgEl.style.cssText = 'display:block; color:var(--danger-color); padding:10px; background:rgba(220,38,38,0.1); border-radius:6px;';
            }
        }

        async function changePassword(event) {
            event.preventDefault();
            const form = event.target;
            const msgEl = document.getElementById('passwordMsg');
            const currentPassword = form.currentPassword.value;
            const newPassword = form.newPassword.value;
            const confirmNewPassword = form.confirmNewPassword.value;

            if (newPassword !== confirmNewPassword) {
                msgEl.textContent = 'âŒ New passwords do not match.';
                msgEl.style.cssText = 'display:block; color:var(--danger-color); padding:10px; background:rgba(220,38,38,0.1); border-radius:6px;';
                return;
            }

            try {
                await apiRequest('/api/profile/password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ currentPassword, newPassword })
                });
                form.reset();
                msgEl.textContent = 'âœ… Password updated successfully!';
                msgEl.style.cssText = 'display:block; color:var(--success-color); padding:10px; background:rgba(22,163,74,0.1); border-radius:6px;';
                showNotification('Password Updated', 'Your password has been changed successfully');
            } catch (error) {
                msgEl.textContent = 'âŒ ' + (error.message || 'Unable to change password');
                msgEl.style.cssText = 'display:block; color:var(--danger-color); padding:10px; background:rgba(220,38,38,0.1); border-radius:6px;';
            }
        }

        async function fetchAuditLogs() {
            try {
                const data = await apiRequest('/api/audit-logs');
                const logs = data.logs || [];
                const tbody = document.getElementById('auditLogTableBody');
                if (tbody) {
                    tbody.innerHTML = '';
                    logs.forEach(log => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>${log.user?.username || 'Unknown'}</td>
                            <td>${log.action || '-'}</td>
                            <td>${log.details || '-'}</td>
                            <td>${log.ip || '-'}</td>
                            <td>${new Date(log.createdAt).toLocaleString()}</td>
                        `;
                        tbody.appendChild(tr);
                    });
                }
                showNotification('Loaded', 'Audit logs fetched successfully');
            } catch (error) {
                showNotification('Access Denied', error.message || 'Unable to fetch audit logs');
            }
        }

        async function loadContacts() {
            try {
                const data = await apiRequest('/api/contacts');
                const contacts = data.contacts || [];
                const tbody = document.getElementById('contactsTableBody');
                if (!tbody) return;

                tbody.innerHTML = '';
                contacts.forEach(contact => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${contact.name}</td>
                        <td>${contact.relation || 'Other'}</td>
                        <td>${contact.phone}</td>
                        <td><button class="btn btn-danger btn-small" onclick="removeContact('${contact.phone}')">Remove</button></td>
                    `;
                    tbody.appendChild(row);
                });
            } catch (_) {
                // Keep UI usable if contacts API is temporarily unavailable.
            }
        }

        async function loadReports() {
            try {
                const data = await apiRequest('/api/reports');
                allIncidentReports = data.reports || [];
                const tbody = document.getElementById('incidentReportsTableBody');
                if (!tbody) return;

                tbody.innerHTML = '';
                allIncidentReports.forEach(report => {
                    const row = document.createElement('tr');
                    row.setAttribute('data-status', report.status || '');
                    const badgeClass = report.status === 'Resolved' || report.status === 'Closed' ? 'badge-success' :
                                      report.status === 'Open' ? 'badge-danger' : 'badge-warning';
                    row.innerHTML = `
                        <td>${report.id}</td>
                        <td>${report.type}</td>
                        <td>${report.location}</td>
                        <td><span class="badge ${badgeClass}">${report.status}</span></td>
                        <td><span class="badge badge-warning">Normal</span></td>
                        <td>${report.date}</td>
                        <td>
                            <button class="btn btn-primary btn-small" onclick="viewIncidentDetails('${report.id}','${report.type}','${report.location}','${report.status}')">View</button>
                            <button class="btn btn-success btn-small" onclick="updateIncidentStatus('${report.id}')">Update</button>
                        </td>
                    `;
                    tbody.appendChild(row);
                });
                filterIncidentReports();
            } catch (_) {
                // Keep static table content when API fails.
            }
        }

        function runNLPAnalysis() {
            showNotification('NLP Analysis', 'Running sentiment analysis on social media...');
        }

        // â”€â”€ Generate Full Analysis Report â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        function generateAnalysisReport() {
            const now = new Date();
            const dateStr = now.toLocaleString();

            const activeAlerts = document.getElementById('activeAlerts')?.textContent || '23';
            const totalIncidents = document.getElementById('totalIncidents')?.textContent || '156';
            const responseTime = document.getElementById('responseTime')?.textContent || '3.2m';

            const confWD = document.getElementById('conf-WD024')?.textContent || '94.2%';
            const confSB = document.getElementById('conf-SB015')?.textContent || '78.5%';
            const confVA = document.getElementById('conf-VA008')?.textContent || '87.3%';
            const confSV = document.getElementById('conf-SV031')?.textContent || '96.1%';

            const report = `
================================================================================
       AI CRIME DETECTION & EMERGENCY RESPONSE SYSTEM
       FULL ANALYSIS REPORT
================================================================================
Generated On  : ${dateStr}
Generated By  : ${currentUser || 'System'} (${ROLE_FEATURES[userRole]?.label || userRole})
Report Period : Last 30 Days
--------------------------------------------------------------------------------

  SECTION 1: EXECUTIVE SUMMARY
--------------------------------------------------------------------------------
  Active Alerts          : ${activeAlerts}
  Total Incidents        : ${totalIncidents}
  Avg. Response Time     : ${responseTime}
  AI Model Accuracy      : 94.8%
  Incidents Resolved     : 89 / ${totalIncidents}
  Prevention Rate        : 67%

  SECTION 2: CRIME PREDICTION HEATMAP RESULTS
--------------------------------------------------------------------------------
  HIGH RISK AREAS:
    ðŸ”´ Bandra             â€” Risk Score: 92%
    ðŸ”´ Andheri            â€” Risk Score: 85%
    ðŸŸ¡ Marine Drive       â€” Risk Score: 78%
    ðŸŸ¢ Colaba             â€” Risk Score: 45%

  Peak Crime Window      : 10 PM â€“ 2 AM (weekends)
  Most Affected Zones    : Zone 2 (Bandra), Zone 4 (Andheri)
  Quarterly Trend        : -15% crime rate reduction

  SECTION 3: AI DETECTION FEED â€” LIVE CONFIDENCE SCORES
--------------------------------------------------------------------------------
  WD-024  Weapon Detection  â€” Bandra Station Platform 2     : ${confWD}
  SB-015  Suspicious Behavior â€” Marine Drive Junction        : ${confSB}
  VA-008  Violence Alert    â€” Gateway of India Area          : ${confVA}
  SV-031  Stolen Vehicle    â€” Western Express Highway        : ${confSV}

  SECTION 4: NLP & SOCIAL MEDIA ANALYSIS
--------------------------------------------------------------------------------
  â€¢ 12 mentions of suspicious activity near Bandra station
  â€¢ 5 posts about unusual crowd gathering at Marine Drive
  â€¢ 3 emergency-related keywords detected in Andheri area
  â€¢ Sentiment analysis shows increased public concern in Zone 4
  â€¢ 8 trending hashtags related to public safety concerns

  SECTION 5: PATROL DEPLOYMENT STATUS
--------------------------------------------------------------------------------
  Unit P-101  â€” Andheri West       â€” Active    â€” 3 Officers  â€” 3.5 min
  Unit P-102  â€” Bandra Station     â€” En Route  â€” 2 Officers  â€” 2.0 min
  Unit P-103  â€” Marine Drive       â€” Active    â€” 4 Officers  â€” 4.1 min
  Unit P-104  â€” Colaba             â€” Active    â€” 3 Officers  â€” 5.2 min

  SECTION 6: RECOMMENDATIONS
--------------------------------------------------------------------------------
  1. Increase patrol density in Bandra & Andheri during 10 PM â€“ 2 AM window.
  2. Deploy additional CCTV coverage at Bandra Station Platform 2.
  3. Escalate SV-031 intercept order â€” vehicle match confidence at ${confSV}.
  4. Coordinate Zone 4 community outreach to address public concern surge.
  5. Schedule AI model re-calibration to maintain >95% accuracy.

================================================================================
  END OF REPORT  |  AI Crime Detection System  |  Confidential
================================================================================
`;

            const blob = new Blob([report.trim()], { type: 'text/plain' });
            const url  = URL.createObjectURL(blob);
            const a    = Object.assign(document.createElement('a'), {
                href: url,
                download: `crime_analysis_report_${now.toISOString().slice(0,10)}.txt`
            });
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showNotification('ðŸ“„ Report Generated', 'Full analysis report downloaded successfully!');
        }

        // â”€â”€ Email Report â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        function emailReport() {
            const now = new Date().toLocaleString();
            const activeAlerts = document.getElementById('activeAlerts')?.textContent || '23';
            const totalIncidents = document.getElementById('totalIncidents')?.textContent || '156';
            const responseTime = document.getElementById('responseTime')?.textContent || '3.2m';

            const subject = encodeURIComponent(`AI Crime Detection â€” Analysis Report (${new Date().toLocaleDateString()})`);
            const body = encodeURIComponent(
`AI Crime Detection & Emergency Response System â€” Analysis Report
Generated: ${now}
Generated By: ${currentUser || 'System'} (${ROLE_FEATURES[userRole]?.label || userRole})

KEY METRICS:
- Active Alerts: ${activeAlerts}
- Total Incidents: ${totalIncidents}
- Avg Response Time: ${responseTime}
- AI Accuracy: 94.8%
- Prevention Rate: 67%

HIGH RISK AREAS:
- Bandra (92%), Andheri (85%), Marine Drive (78%)

NLP SOCIAL ALERTS:
- 12 mentions of suspicious activity near Bandra station
- 5 posts about unusual crowd gathering at Marine Drive
- 3 emergency keywords detected in Andheri area

RECOMMENDATION: Increase patrols in Bandra & Andheri during 10 PM - 2 AM.

[Report auto-generated by AI Crime Detection System]`
            );

            // Populate the email modal
            document.getElementById('emailReportTo').value = '';
            document.getElementById('emailReportSubjectDisplay').textContent = decodeURIComponent(subject);
            document.getElementById('emailReportBody').value = decodeURIComponent(body);
            document.getElementById('emailReportMailtoLink').href = `mailto:?subject=${subject}&body=${body}`;
            document.getElementById('emailReportModal').classList.add('active');
        }

        function copyEmailBody() {
            const body = document.getElementById('emailReportBody').value;
            if (!body) return;
            navigator.clipboard.writeText(body).then(() => {
                showNotification('ðŸ“‹ Copied!', 'Report body copied to clipboard.');
            }).catch(() => {
                // Fallback for browsers that block clipboard API
                const ta = document.createElement('textarea');
                ta.value = body;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                showNotification('ðŸ“‹ Copied!', 'Report body copied to clipboard.');
            });
        }

        function sendEmailReport() {
            const to = document.getElementById('emailReportTo').value.trim();
            const subject = encodeURIComponent(document.getElementById('emailReportSubjectDisplay').textContent);
            const body = encodeURIComponent(document.getElementById('emailReportBody').value);
            const mailto = to
                ? `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`
                : `mailto:?subject=${subject}&body=${body}`;
            window.location.href = mailto;
            showNotification('ðŸ“§ Email Client Opened', to ? `Sending report to ${to}` : 'Opening default email client...');
            document.getElementById('emailReportModal').classList.remove('active');
        }

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // EVIDENCE VAULT ENGINE
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

        // In-memory evidence store (seed data)
        let evidenceStore = [
            {
                id: 'EV-001',
                caseId: 'INC-2024-001',
                crimeType: 'Theft',
                type: 'photo',
                description: '3 crime scene photographs taken at Bandra West.',
                files: ['scene_001.jpg', 'scene_002.jpg', 'scene_003.jpg'],
                totalFiles: 3,
                sizeLabel: '4.2 MB',
                uploadedBy: 'officer@police.in',
                uploadedAt: '2024-03-15 10:22 AM',
                hash: '0x7a4b9c2f1e8d3b5a6f2c4e7d1a9b8c3f',
                status: 'Verified',
                objectURL: null
            },
            {
                id: 'EV-002',
                caseId: 'INC-2024-002',
                crimeType: 'Assault',
                type: 'video',
                description: 'CCTV footage of the assault incident at Andheri East.',
                files: ['cctv_footage.mp4'],
                totalFiles: 1,
                sizeLabel: '2.4 MB',
                uploadedBy: 'officer@police.in',
                uploadedAt: '2024-03-14 03:45 PM',
                hash: '0x9f2e4a7b1d5c8e3f2a6b4d7c1e9a2b5d',
                status: 'Verified',
                objectURL: null
            },
            {
                id: 'EV-003',
                caseId: 'INC-2024-003',
                crimeType: 'Fraud',
                type: 'document',
                description: 'Bank statements and transaction logs related to the fraud case.',
                files: ['statement_jan.pdf','statement_feb.pdf','transaction_log.pdf','witness_stmt.pdf','court_order.pdf'],
                totalFiles: 5,
                sizeLabel: '1.8 MB',
                uploadedBy: 'admin@system.com',
                uploadedAt: '2024-03-13 11:05 AM',
                hash: '0x3e8c1a5f2b7d4e9c6a3b8f1d5c2e7a4b',
                status: 'Verified',
                objectURL: null
            }
        ];

        // Map: evidence type â†’ emoji + gradient
        const EV_TYPE_META = {
            photo:    { icon: 'ðŸ“¸', label: 'Photo',    grad: 'linear-gradient(135deg,#1e40af,#3b82f6)' },
            video:    { icon: 'ðŸŽ¥', label: 'Video',    grad: 'linear-gradient(135deg,#dc2626,#b91c1c)' },
            document: { icon: 'ðŸ“„', label: 'Document', grad: 'linear-gradient(135deg,#16a34a,#22c55e)' },
            audio:    { icon: 'ðŸŽ™ï¸', label: 'Audio',    grad: 'linear-gradient(135deg,#7c3aed,#a78bfa)' },
            other:    { icon: 'ðŸ“', label: 'Other',    grad: 'linear-gradient(135deg,#ca8a04,#fbbf24)' }
        };

        // â”€â”€ Render all cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        function renderEvidenceVault(items) {
            items = items || evidenceStore;
            const grid  = document.getElementById('evidenceVaultGrid');
            const empty = document.getElementById('evidenceEmptyState');
            if (!grid) return;

            grid.innerHTML = '';
            if (!items.length) {
                empty.style.display = '';
                return;
            }
            empty.style.display = 'none';

            items.forEach(ev => {
                const meta = EV_TYPE_META[ev.type] || EV_TYPE_META.other;
                const statusColor = ev.status === 'Verified' ? 'var(--success-color)'
                                  : ev.status === 'Flagged'  ? 'var(--danger-color)'
                                  : 'var(--warning-color)';
                const statusIcon  = ev.status === 'Verified' ? 'âœ…' : ev.status === 'Flagged' ? 'ðŸš©' : 'â³';

                const card = document.createElement('div');
                card.className = 'detection-card';
                card.dataset.evId   = ev.id;
                card.dataset.evType = ev.type;
                card.dataset.evStatus = ev.status;
                card.innerHTML = `
                    <div class="detection-image" style="background:${meta.grad}; color:white; position:relative;">
                        <div style="text-align:center;">
                            <div style="font-size:48px; margin-bottom:8px;">${meta.icon}</div>
                            <div style="font-size:13px; font-weight:600;">${meta.label} Evidence</div>
                        </div>
                        <span style="position:absolute;top:8px;left:8px;background:rgba(0,0,0,0.4);color:#fff;font-size:10px;padding:2px 8px;border-radius:10px;">
                            ${ev.id}
                        </span>
                        <span style="position:absolute;top:8px;right:8px;font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(0,0,0,0.4);color:${statusColor};">
                            ${statusIcon} ${ev.status}
                        </span>
                    </div>
                    <div class="detection-info">
                        <div style="font-weight:600; margin-bottom:4px;">${ev.caseId} â€” ${ev.crimeType}</div>
                        <div style="color:var(--text-muted); font-size:13px; margin-bottom:10px; line-height:1.8;">
                            Files: ${ev.totalFiles} (${ev.sizeLabel})<br>
                            Uploaded: ${ev.uploadedAt}<br>
                            Hash: ${ev.hash.slice(0,18)}â€¦
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button class="btn btn-primary btn-small" style="flex:1;" onclick="viewEvidenceDetail('${ev.id}')">ðŸ” View</button>
                            <button class="btn btn-danger btn-small" onclick="deleteEvidence('${ev.id}')">ðŸ—‘ï¸</button>
                        </div>
                    </div>
                `;
                grid.appendChild(card);
            });

            updateEvidenceStats();
        }

        // â”€â”€ Update stat counters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        function updateEvidenceStats() {
            const total = evidenceStore.length;
            const photos = evidenceStore.filter(e => e.type === 'photo').length;
            const videos = evidenceStore.filter(e => e.type === 'video').length;
            const docs   = evidenceStore.filter(e => e.type === 'document').length;
            const elSet = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            elSet('evTotalCount', total);
            elSet('evPhotoCount', photos);
            elSet('evVideoCount', videos);
            elSet('evDocCount',   docs);
        }

        // â”€â”€ Search & filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        function filterEvidenceVault() {
            const q      = (document.getElementById('evSearchInput')?.value || '').toLowerCase();
            const type   = document.getElementById('evTypeFilter')?.value   || '';
            const status = document.getElementById('evStatusFilter')?.value || '';

            const filtered = evidenceStore.filter(ev => {
                const matchQ = !q || ev.caseId.toLowerCase().includes(q)
                                  || ev.crimeType.toLowerCase().includes(q)
                                  || ev.type.toLowerCase().includes(q)
                                  || ev.files.join(' ').toLowerCase().includes(q)
                                  || ev.description.toLowerCase().includes(q);
                const matchType   = !type   || ev.type   === type;
                const matchStatus = !status || ev.status === status;
                return matchQ && matchType && matchStatus;
            });
            renderEvidenceVault(filtered);
        }

        function clearEvidenceFilters() {
            const s = document.getElementById('evSearchInput');
            const t = document.getElementById('evTypeFilter');
            const f = document.getElementById('evStatusFilter');
            if (s) s.value = '';
            if (t) t.value = '';
            if (f) f.value = '';
            renderEvidenceVault();
        }

        // â”€â”€ Open upload modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        function openUploadEvidenceModal() {
            const form = document.getElementById('uploadEvidenceForm');
            if (form) form.reset();
            const msg  = document.getElementById('evUploadMsg');
            if (msg) msg.style.display = 'none';
            const prog = document.getElementById('evUploadProgressWrap');
            if (prog) prog.style.display = 'none';
            const bar  = document.getElementById('evUploadProgressBar');
            if (bar) bar.style.width = '0%';
            document.getElementById('uploadEvidenceModal').classList.add('active');
        }

        // â”€â”€ Simulate SHA-256 hash (deterministic string) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        function _fakeHash(str) {
            let h = 0;
            for (let i = 0; i < str.length; i++) {
                h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
            }
            const hex = (h >>> 0).toString(16).padStart(8, '0');
            return '0x' + hex.repeat(4) + Math.random().toString(16).slice(2, 10);
        }

        // â”€â”€ Submit upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        function submitEvidenceUpload(e) {
            e.preventDefault();
            const caseId   = document.getElementById('evCaseId').value.trim();
            const type     = document.getElementById('evUploadType').value;
            const desc     = document.getElementById('evUploadDesc').value.trim();
            const fileInput= document.getElementById('evUploadFile');
            const msgEl    = document.getElementById('evUploadMsg');
            const progWrap = document.getElementById('evUploadProgressWrap');
            const progBar  = document.getElementById('evUploadProgressBar');

            if (!caseId || !type || !fileInput.files.length) {
                msgEl.textContent = 'âš ï¸ Please fill all required fields and select at least one file.';
                msgEl.style.cssText = 'display:block; color:var(--warning-color); padding:8px; background:rgba(234,179,8,0.1); border-radius:6px;';
                return;
            }

            // Show progress animation
            progWrap.style.display = '';
            msgEl.style.display = 'none';
            let progress = 0;
            const interval = setInterval(() => {
                progress = Math.min(progress + Math.random() * 18 + 5, 95);
                progBar.style.width = progress + '%';
            }, 120);

            setTimeout(() => {
                clearInterval(interval);
                progBar.style.width = '100%';

                const files     = Array.from(fileInput.files);
                const fileNames = files.map(f => f.name);
                const totalSize = files.reduce((s, f) => s + f.size, 0);
                const sizeLabel = totalSize > 1048576
                    ? (totalSize / 1048576).toFixed(1) + ' MB'
                    : (totalSize / 1024).toFixed(0) + ' KB';

                // Generate object URL for first file (preview)
                const objURL = files[0] ? URL.createObjectURL(files[0]) : null;

                const newItem = {
                    id:         'EV-' + String(Date.now()).slice(-5),
                    caseId,
                    crimeType:  'User Upload',
                    type,
                    description: desc || 'No description provided.',
                    files:      fileNames,
                    totalFiles: files.length,
                    sizeLabel,
                    uploadedBy: currentUser || 'Unknown',
                    uploadedAt: new Date().toLocaleString(),
                    hash:       _fakeHash(caseId + type + fileNames.join('')),
                    status:     'Pending',
                    objectURL:  objURL
                };

                evidenceStore.unshift(newItem);
                renderEvidenceVault();

                progWrap.style.display = 'none';
                msgEl.textContent = `âœ… Evidence ${newItem.id} uploaded and hashed successfully! Status: Pending review.`;
                msgEl.style.cssText = 'display:block; color:var(--success-color); padding:8px; background:rgba(22,163,74,0.1); border-radius:6px;';
                showNotification('ðŸ”’ Evidence Uploaded', `${files.length} file(s) added as ${newItem.id}`);

                setTimeout(() => {
                    document.getElementById('uploadEvidenceModal').classList.remove('active');
                }, 1800);
            }, 1600);
        }

        // â”€â”€ View evidence detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        function viewEvidenceDetail(evId) {
            const ev = evidenceStore.find(e => e.id === evId);
            if (!ev) return;
            const meta = EV_TYPE_META[ev.type] || EV_TYPE_META.other;

            // Preview
            const previewEl = document.getElementById('evDetailPreview');
            if (ev.objectURL && ev.type === 'photo') {
                previewEl.innerHTML = `<img src="${ev.objectURL}" style="max-width:100%; max-height:200px; border-radius:6px; object-fit:contain;" alt="Evidence preview">`;
            } else if (ev.objectURL && ev.type === 'video') {
                previewEl.innerHTML = `<video src="${ev.objectURL}" controls style="max-width:100%; max-height:200px; border-radius:6px;"></video>`;
            } else {
                previewEl.innerHTML = `<span>${meta.icon}</span>`;
            }

            // Metadata
            document.getElementById('evDetailBody').innerHTML = `
                <div><strong style="color:var(--text-light);">Evidence ID</strong><br>${ev.id}</div>
                <div><strong style="color:var(--text-light);">Case ID</strong><br>${ev.caseId}</div>
                <div><strong style="color:var(--text-light);">Crime Type</strong><br>${ev.crimeType}</div>
                <div><strong style="color:var(--text-light);">Evidence Type</strong><br>${meta.icon} ${meta.label}</div>
                <div><strong style="color:var(--text-light);">Files (${ev.totalFiles})</strong><br><span style="font-size:12px;">${ev.files.join(', ')}</span></div>
                <div><strong style="color:var(--text-light);">Total Size</strong><br>${ev.sizeLabel}</div>
                <div><strong style="color:var(--text-light);">Uploaded By</strong><br>${ev.uploadedBy}</div>
                <div><strong style="color:var(--text-light);">Uploaded At</strong><br>${ev.uploadedAt}</div>
                <div style="grid-column:1/-1;"><strong style="color:var(--text-light);">Description</strong><br>${ev.description}</div>
                <div style="grid-column:1/-1;"><strong style="color:var(--text-light);">SHA-256 Hash</strong><br><span style="font-family:monospace; font-size:12px; color:var(--success-color); word-break:break-all;">${ev.hash}</span></div>
                <div><strong style="color:var(--text-light);">Status</strong><br>
                    <span style="color:${ev.status==='Verified'?'var(--success-color)':ev.status==='Flagged'?'var(--danger-color)':'var(--warning-color)'};">
                        ${ev.status==='Verified'?'âœ…':ev.status==='Flagged'?'ðŸš©':'â³'} ${ev.status}
                    </span>
                </div>
            `;

            // Chain of custody
            document.getElementById('evDetailCustody').innerHTML = `
                ðŸ“¥ <strong>Upload:</strong> ${ev.uploadedBy} â€” ${ev.uploadedAt}<br>
                ðŸ”’ <strong>Hashed:</strong> SHA-256 computed at upload time<br>
                âœ… <strong>Blockchain:</strong> Block #${Math.floor(Math.random()*90000+10000)} recorded on ${ev.uploadedAt}<br>
                ðŸ‘ï¸ <strong>Viewed:</strong> ${currentUser || 'Unknown'} â€” ${new Date().toLocaleString()}
            `;

            // Download button
            const dlBtn = document.getElementById('evDetailDownloadBtn');
            dlBtn.onclick = () => {
                if (ev.objectURL) {
                    const a = Object.assign(document.createElement('a'), { href: ev.objectURL, download: ev.files[0] || ev.id });
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                } else {
                    const summary = `Evidence Record: ${ev.id}\nCase ID: ${ev.caseId}\nCrime Type: ${ev.crimeType}\nEvidence Type: ${meta.label}\nFiles: ${ev.files.join(', ')}\nTotal Files: ${ev.totalFiles}\nSize: ${ev.sizeLabel}\nUploaded By: ${ev.uploadedBy}\nUploaded At: ${ev.uploadedAt}\nStatus: ${ev.status}\nHash: ${ev.hash}\nDescription: ${ev.description}\n\nThis is a generated summary for a seed record that does not have an attached local file.`;
                    const blob = new Blob([summary], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = Object.assign(document.createElement('a'), {
                        href: url,
                        download: `${ev.id.toLowerCase()}-evidence-summary.txt`
                    });
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    showNotification('â¬‡ï¸ Download', `Generated summary download for ${ev.id}.`);
                }
            };

            // Delete button
            const delBtn = document.getElementById('evDetailDeleteBtn');
            delBtn.onclick = () => {
                document.getElementById('evidenceDetailModal').classList.remove('active');
                deleteEvidence(ev.id);
            };

            document.getElementById('evidenceDetailModal').classList.add('active');
        }

        // â”€â”€ Delete evidence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        function deleteEvidence(evId) {
            if (!confirm(`Delete evidence item ${evId}? This action cannot be undone.`)) return;
            evidenceStore = evidenceStore.filter(e => e.id !== evId);
            renderEvidenceVault();
            showNotification('ðŸ—‘ï¸ Deleted', `Evidence ${evId} removed from vault.`);
        }

        // â”€â”€ Legacy stub kept for compatibility â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        function uploadEvidence() { openUploadEvidenceModal(); }

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // ADMIN AI DETECTION ENGINE
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

        let adminCameraStore = [
            { id:'CAM-024', location:'Bandra Station Platform 2',   status:'Online',  res:'1080p', mode:'Full (Weapon+Violence+Crowd)', lastPing:'Just now' },
            { id:'CAM-015', location:'Marine Drive Junction',        status:'Online',  res:'4K',   mode:'Crowd Analysis',               lastPing:'3s ago' },
            { id:'CAM-008', location:'Gateway of India Area',        status:'Online',  res:'1080p', mode:'Full (Weapon+Violence+Crowd)', lastPing:'1s ago' },
            { id:'CAM-031', location:'Western Express Highway',      status:'Online',  res:'1080p', mode:'Vehicle Tracking',             lastPing:'2s ago' },
            { id:'CAM-012', location:'Andheri West Junction',        status:'Offline', res:'720p',  mode:'Full (Weapon+Violence+Crowd)', lastPing:'18 min ago' },
            { id:'CAM-019', location:'Colaba Causeway',              status:'Online',  res:'4K',    mode:'Face Recognition',            lastPing:'Just now' }
        ];

        function renderAdminCameraTable() {
            const tbody = document.getElementById('adminCameraTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';
            adminCameraStore.forEach(cam => {
                const isOnline = cam.status === 'Online';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-family:monospace;">${cam.id}</td>
                    <td>${cam.location}</td>
                    <td><span class="badge ${isOnline ? 'badge-success' : 'badge-danger'}">${isOnline ? 'â— Online' : 'â—‹ Offline'}</span></td>
                    <td>${cam.res}</td>
                    <td style="font-size:12px;">${cam.mode}</td>
                    <td style="font-size:12px; color:var(--text-muted);">${cam.lastPing}</td>
                    <td>
                        <button class="btn btn-small ${isOnline ? 'btn-danger' : 'btn-success'}" style="margin-right:4px;"
                            onclick="adminToggleCamera('${cam.id}')">${isOnline ? 'â¸ Disable' : 'â–¶ Enable'}</button>
                        <button class="btn btn-small" style="background:rgba(255,255,255,0.08);color:var(--text-muted);"
                            onclick="adminRemoveCamera('${cam.id}')">ðŸ—‘ï¸</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            // Update cameras-online stat
            const online = adminCameraStore.filter(c => c.status === 'Online').length;
            const total  = adminCameraStore.length;
            const el = document.getElementById('aiCamerasOnline');
            const chg = document.getElementById('aiCamerasChange');
            if (el) el.textContent = online;
            if (chg) chg.textContent = `of ${total} total`;
        }

        function adminToggleCamera(camId) {
            const cam = adminCameraStore.find(c => c.id === camId);
            if (!cam) return;
            cam.status = cam.status === 'Online' ? 'Offline' : 'Online';
            cam.lastPing = cam.status === 'Online' ? 'Just now' : 'N/A';
            renderAdminCameraTable();
            showNotification(`ðŸ“¹ Camera ${camId}`, `Status changed to ${cam.status}`);
            _aiLogEntry(`ADMIN â€” Camera ${camId} set to ${cam.status}`);
        }

        function adminRemoveCamera(camId) {
            if (!confirm(`Remove camera ${camId} from the system?`)) return;
            adminCameraStore = adminCameraStore.filter(c => c.id !== camId);
            renderAdminCameraTable();
            showNotification('ðŸ—‘ï¸ Camera Removed', `${camId} removed from monitoring network`);
            _aiLogEntry(`ADMIN â€” Camera ${camId} removed from system`);
        }

        function adminAddCamera() {
            const id  = prompt('Camera ID (e.g. CAM-042):');
            if (!id) return;
            const loc = prompt('Location:');
            if (!loc) return;
            adminCameraStore.push({
                id: id.toUpperCase(),
                location: loc,
                status: 'Online',
                res: '1080p',
                mode: 'Full (Weapon+Violence+Crowd)',
                lastPing: 'Just now'
            });
            renderAdminCameraTable();
            showNotification('âž• Camera Added', `${id.toUpperCase()} added and set Online`);
            _aiLogEntry(`ADMIN â€” New camera ${id.toUpperCase()} registered at ${loc}`);
        }

        function adminRefreshCameras() {
            // Simulate minor ping jitter
            adminCameraStore.forEach(cam => {
                if (cam.status === 'Online') {
                    const secs = Math.floor(Math.random() * 5);
                    cam.lastPing = secs === 0 ? 'Just now' : `${secs}s ago`;
                }
            });
            renderAdminCameraTable();
            showNotification('ðŸ”„ Cameras Refreshed', `${adminCameraStore.length} cameras polled`);
        }

        function adminSaveModelConfig() {
            const model  = document.getElementById('adminModelSelect')?.value  || 'YOLOv8';
            const fps    = document.getElementById('adminFpsSelect')?.value    || '15 FPS';
            const mode   = document.getElementById('adminAlertMode')?.value    || 'Filtered';
            const auto   = document.getElementById('adminAutoDispatch')?.checked;
            showNotification('ðŸ’¾ Config Saved', `Model: ${model} | ${fps} | Alert: ${mode} | Auto-dispatch: ${auto ? 'ON' : 'OFF'}`);
            _aiLogEntry(`ADMIN â€” Config saved: ${model}, ${fps}, Mode=${mode}, AutoDispatch=${auto}`);
        }

        function adminResetModel() {
            if (!confirm('Reset all AI model settings to defaults?')) return;
            const s = document.getElementById('adminModelSelect'); if (s) s.selectedIndex = 0;
            const f = document.getElementById('adminFpsSelect');   if (f) f.selectedIndex = 1;
            const a = document.getElementById('adminAlertMode');   if (a) a.selectedIndex = 1;
            const d = document.getElementById('adminAutoDispatch'); if (d) d.checked = true;
            ['confWeaponVal','confViolenceVal','confSuspVal','confVehicleVal'].forEach((id, i) => {
                const el = document.getElementById(id);
                if (el) el.textContent = ['85%','80%','70%','90%'][i];
            });
            showNotification('ðŸ”„ Model Reset', 'All AI settings restored to defaults');
            _aiLogEntry('ADMIN â€” AI model configuration reset to defaults');
        }

        function adminClearHistory() {
            if (!confirm('Clear all detection history from this session?')) return;
            _aiLog.length = 0;
            const hist = document.getElementById('adminDetectionHistory');
            if (hist) hist.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px;">History cleared.</div>';
            const list = document.getElementById('detectionLogList');
            if (list) list.innerHTML = '';
            showNotification('ðŸ—‘ï¸ History Cleared', 'Detection history cleared for this session');
        }

        function deployNewUnit() {
            showNotification('Dispatch', 'Deploying new patrol unit...');
        }

        console.log('ðŸš¨ AI Crime Detection System initialized');
        console.log('ðŸ’¡ TIP: Press P key twice quickly to trigger emergency SOS');
        console.log('ðŸŽ¤ Click microphone icon for voice commands');
        console.log('âœ… All systems operational');

        // Initialize evidence vault on load
        renderEvidenceVault();

        // Initialize admin camera table on load (hidden until admin logs in)
        renderAdminCameraTable();
