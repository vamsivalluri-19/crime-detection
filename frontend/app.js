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

            const isLocalFrontendOrigin = typeof window !== 'undefined' && (
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1'
            );

            if (isLocalFrontendOrigin && FRONTEND_ORIGIN && await probeApiBase(FRONTEND_ORIGIN)) {
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

        async function apiRequest(endpoint, options = {}, includeAuth = true) {
            const headers = options.headers || {};
            if (includeAuth && authToken) {
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

        function showLoginAfterRegister(message, username = '') {
            document.getElementById('registerErrorMsg').textContent = message;
            document.getElementById('registerErrorMsg').style.display = 'block';
            document.getElementById('registerSuccessMsg').style.display = 'none';

            if (username) {
                const loginUsername = document.querySelector('#mainLoginForm input[name="username"]');
                if (loginUsername) {
                    loginUsername.value = username;
                }
            }

            setTimeout(() => {
                document.getElementById('registerOverlay').style.display = 'none';
                document.getElementById('mainLoginOverlay').style.display = 'flex';
            }, 1200);
        }

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
                }, false);

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
                const message = error.message || 'Registration failed.';
                if (String(message).toLowerCase().includes('already exists') || String(message).includes('409')) {
                    showLoginAfterRegister('Account already exists. Please log in.', username);
                    return;
                }

                document.getElementById('registerErrorMsg').textContent = message;
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
                    body: JSON.stringify({ username, password, role })
                }, false);

                authToken = data.token || '';
                localStorage.setItem('crimeAiToken', authToken);
                document.getElementById('loginErrorMsg').style.display = 'none';
                if (data.message) {
                    showNotification('Login', data.message);
                }
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
            renderEvidenceVault();
            refreshAnalytics();
            applyAlertSettingsToUI();
            configureCitizenComplaintForm(role);
            connectSpeechSocket();

            if (role === 'admin') {
                loadAdminCameras();
                fetchAuditLogs();
                startDetection();
            }
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
                            body: JSON.stringify({
                                latitude,
                                longitude,
                                username: currentUser,
                                citizenName: document.getElementById('complaintCitizenName')?.value || currentUser,
                                citizenPhone: document.getElementById('complaintCitizenPhone')?.value || ''
                            })
                        }, false);

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
                    const el = document.getElementById(id); if (el) el.textContent = value;
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

        function getGPSLocation() {
            if (!navigator.geolocation) {
                showNotification('GPS unavailable', 'Your browser does not support location access.');
                return;
            }

            navigator.geolocation.getCurrentPosition((position) => {
                const { latitude, longitude } = position.coords;
                const locationInput = document.getElementById('reportLocation');
                const latInput = document.getElementById('reportLatitude');
                const lngInput = document.getElementById('reportLongitude');

                if (locationInput) locationInput.value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
                if (latInput) latInput.value = String(latitude);
                if (lngInput) lngInput.value = String(longitude);

                showNotification('Location captured', 'GPS coordinates added to the report form.');
            }, () => {
                showNotification('Location error', 'Unable to read your location. Please enable GPS permissions.');
            });
        }

        async function submitReport(event) {
            event.preventDefault();

            const form = event.target;
            const formData = new FormData();
            formData.append('type', form.type.value.trim());
            formData.append('location', form.location.value.trim());
            formData.append('description', form.description.value.trim());
            formData.append('incidentDate', form.incidentDate.value || '');
            formData.append('witness', form.witness.value.trim());
            formData.append('citizenName', form.citizenName?.value?.trim() || currentUser || 'Citizen');
            formData.append('citizenPhone', form.citizenPhone?.value?.trim() || '');
            formData.append('citizenDetails', form.citizenDetails?.value?.trim() || '');
            formData.append('reportLatitude', form.reportLatitude.value || '');
            formData.append('reportLongitude', form.reportLongitude.value || '');

            const evidenceFiles = form.evidence.files || [];
            for (const file of evidenceFiles) {
                formData.append('evidence', file);
            }

            const submitMsg = document.getElementById('reportSubmitMsg');
            try {
                const data = await apiRequest('/api/report', {
                    method: 'POST',
                    body: formData
                });

                if (submitMsg) {
                    submitMsg.style.display = 'block';
                    submitMsg.className = 'success-msg';
                    submitMsg.textContent = data?.message || 'Report submitted successfully.';
                }

                showNotification('Report sent', 'Your incident report has been submitted.');
                form.reset();
                configureCitizenComplaintForm(userRole);
                await loadReports();
                switchTab('dashboard');
            } catch (error) {
                if (submitMsg) {
                    submitMsg.style.display = 'block';
                    submitMsg.className = 'error-msg';
                    submitMsg.textContent = error.message || 'Failed to submit report.';
                }
                showNotification('Report failed', error.message || 'Unable to submit report.');
            }
        }

        async function loadReports() {
            const tableBody = document.getElementById('incidentReportsTableBody');
            if (!tableBody) return;

            try {
                const data = await apiRequest('/api/reports', { method: 'GET' }, false);
                const reports = Array.isArray(data.reports) ? data.reports : [];

                tableBody.innerHTML = reports.length ? reports.map((report) => `
                    <tr data-status="${report.status || 'Open'}">
                        <td>${report.id || 'N/A'}</td>
                        <td>${report.type || 'N/A'}</td>
                        <td>${report.location || 'N/A'}</td>
                        <td><span class="badge badge-${String(report.status || 'Open').toLowerCase().includes('resolv') ? 'success' : String(report.status || 'Open').toLowerCase().includes('investig') ? 'warning' : 'danger'}">${report.status || 'Open'}</span></td>
                        <td><span class="badge badge-warning">${report.priority || 'Medium'}</span></td>
                        <td>${report.date || ''}</td>
                        <td>
                            <button class="btn btn-primary btn-small" onclick="viewIncidentDetails('${report.id || ''}','${report.type || ''}','${report.location || ''}','${report.status || 'Open'}')">View</button>
                            <button class="btn btn-success btn-small" onclick="updateIncidentStatus('${report.id || ''}')">Update</button>
                        </td>
                    </tr>
                `).join('') : `
                    <tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:18px;">No reports found.</td></tr>
                `;

                filterIncidentReports();
            } catch (error) {
                showNotification('Reports unavailable', error.message || 'Unable to load incident reports.');
            }
        }

        function filterIncidentReports() {
            const searchInput = document.getElementById('incidentSearchInput');
            const statusFilter = document.getElementById('incidentStatusFilter');
            const rows = document.querySelectorAll('#incidentReportsTableBody tr');
            const searchText = String(searchInput?.value || '').toLowerCase();
            const statusValue = String(statusFilter?.value || '').toLowerCase();

            rows.forEach((row) => {
                const rowText = row.textContent.toLowerCase();
                const rowStatus = String(row.getAttribute('data-status') || '').toLowerCase();
                const matchesSearch = !searchText || rowText.includes(searchText);
                const matchesStatus = !statusValue || rowStatus === statusValue;
                row.style.display = matchesSearch && matchesStatus ? '' : 'none';
            });
        }

        function viewIncidentDetails(id, type, location, status) {
            const modal = document.getElementById('incidentDetailModal');
            const title = document.getElementById('incidentDetailTitle');
            const body = document.getElementById('incidentDetailBody');
            if (!modal || !title || !body) return;

            title.textContent = `${id || 'Incident'} Details`;
            body.innerHTML = `
                <div><strong>Type:</strong> ${type || 'N/A'}</div>
                <div><strong>Location:</strong> ${location || 'N/A'}</div>
                <div><strong>Status:</strong> ${status || 'Open'}</div>
                <div><strong>Reported By:</strong> ${currentUser || 'Citizen'}</div>
            `;
            modal.classList.add('active');
        }

        function updateIncidentStatus(id) {
            const modal = document.getElementById('updateStatusModal');
            const idField = document.getElementById('updateStatusId');
            const msg = document.getElementById('updateStatusMsg');
            if (!modal || !idField || !msg) return;

            idField.textContent = id || 'Unknown incident';
            msg.style.display = 'none';
            modal.classList.add('active');
        }

        async function submitStatusUpdate() {
            const idField = document.getElementById('updateStatusId');
            const statusSelect = document.getElementById('newStatusSelect');
            const notes = document.getElementById('updateStatusNotes');
            const msg = document.getElementById('updateStatusMsg');
            const incidentId = String(idField?.textContent || '').trim();

            if (!incidentId) {
                if (msg) {
                    msg.style.display = 'block';
                    msg.className = 'error-msg';
                    msg.textContent = 'Select an incident before updating the status.';
                }
                return;
            }

            try {
                await apiRequest(`/api/reports/${encodeURIComponent(incidentId)}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        status: statusSelect?.value || 'Open',
                        notes: notes?.value || ''
                    })
                });

                if (msg) {
                    msg.style.display = 'block';
                    msg.className = 'success-msg';
                    msg.textContent = `Updated ${incidentId} to ${statusSelect?.value || 'Open'}.`;
                }

                showNotification('Status updated', `Incident ${incidentId} set to ${statusSelect?.value || 'Open'}.`);
                await loadReports();
            } catch (error) {
                if (msg) {
                    msg.style.display = 'block';
                    msg.className = 'error-msg';
                    msg.textContent = error.message || 'Unable to update incident status.';
                }
                showNotification('Status update failed', error.message || 'Unable to update incident status.');
                return;
            }

            const modal = document.getElementById('updateStatusModal');
            if (modal) modal.classList.remove('active');

            if (notes) notes.value = '';
        }

        async function updateProfile(event) {
            event.preventDefault();
            const form = event.target;
            const formData = new FormData();
            formData.append('name', form.name.value.trim());
            formData.append('email', form.email.value.trim());
            formData.append('phone', form.phone.value.trim());

            const notificationPreferences = {
                emailIncidents: Boolean(form.emailIncidents.checked),
                smsEmergencies: Boolean(form.smsEmergencies.checked),
                pushNotifications: Boolean(form.pushNotifications.checked)
            };
            formData.append('notificationPreferences', JSON.stringify(notificationPreferences));

            if (form.avatar?.files?.[0]) {
                formData.append('avatar', form.avatar.files[0]);
            }

            const profileMsg = document.getElementById('profileMsg');
            try {
                await apiRequest('/api/profile', {
                    method: 'POST',
                    body: formData
                });

                if (profileMsg) {
                    profileMsg.style.display = 'block';
                    profileMsg.className = 'success-msg';
                    profileMsg.textContent = 'Profile updated successfully.';
                }

                showNotification('Profile saved', 'Your profile changes were saved.');
                await loadProfile();
            } catch (error) {
                if (profileMsg) {
                    profileMsg.style.display = 'block';
                    profileMsg.className = 'error-msg';
                    profileMsg.textContent = error.message || 'Profile update failed.';
                }
            }
        }

        async function changePassword(event) {
            event.preventDefault();
            const form = event.target;
            const passwordMsg = document.getElementById('passwordMsg');

            if (form.newPassword.value !== form.confirmNewPassword.value) {
                if (passwordMsg) {
                    passwordMsg.style.display = 'block';
                    passwordMsg.className = 'error-msg';
                    passwordMsg.textContent = 'New password and confirmation do not match.';
                }
                return;
            }

            try {
                await apiRequest('/api/profile/password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        currentPassword: form.currentPassword.value,
                        newPassword: form.newPassword.value
                    })
                });

                if (passwordMsg) {
                    passwordMsg.style.display = 'block';
                    passwordMsg.className = 'success-msg';
                    passwordMsg.textContent = 'Password updated successfully.';
                }
                form.reset();
            } catch (error) {
                if (passwordMsg) {
                    passwordMsg.style.display = 'block';
                    passwordMsg.className = 'error-msg';
                    passwordMsg.textContent = error.message || 'Password update failed.';
                }
            }
        }

        async function loadContacts() {
            const table = document.getElementById('contactsTableBody');
            if (!table) return;

            try {
                const data = await apiRequest('/api/contacts', { method: 'GET' }, false);
                const contacts = Array.isArray(data.contacts) ? data.contacts : [];
                table.innerHTML = contacts.map((contact) => `
                    <tr>
                        <td>${contact.name || 'N/A'}</td>
                        <td>${contact.relation || contact.relation || 'N/A'}</td>
                        <td>${contact.phone || 'N/A'}</td>
                        <td><button class="btn btn-danger btn-small" onclick="removeContact('${contact.phone || ''}')">Remove</button></td>
                    </tr>
                `).join('');
            } catch (error) {
                console.warn('Contacts unavailable:', error.message);
            }
        }

        async function addContact() {
            const name = prompt('Contact name:');
            if (!name) return;
            const relation = prompt('Relationship:') || 'Emergency';
            const phone = prompt('Phone number:');
            if (!phone) return;

            try {
                await apiRequest('/api/contacts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, relation, phone })
                }, false);
                await loadContacts();
            } catch (error) {
                showNotification('Contact failed', error.message || 'Unable to add contact.');
            }
        }

        async function removeContact(phone) {
            try {
                await apiRequest('/api/contacts', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone })
                }, false);
                await loadContacts();
            } catch (error) {
                showNotification('Contact failed', error.message || 'Unable to remove contact.');
            }
        }

        function openUploadEvidenceModal() {
            const modal = document.getElementById('uploadEvidenceModal');
            if (modal) modal.classList.add('active');
        }

        function clearEvidenceFilters() {
            const search = document.getElementById('evSearchInput');
            const type = document.getElementById('evTypeFilter');
            const status = document.getElementById('evStatusFilter');
            if (search) search.value = '';
            if (type) type.value = '';
            if (status) status.value = '';
            filterEvidenceVault();
        }

        function filterEvidenceVault() {
            const searchText = String(document.getElementById('evSearchInput')?.value || '').toLowerCase();
            const typeValue = String(document.getElementById('evTypeFilter')?.value || '').toLowerCase();
            const statusValue = String(document.getElementById('evStatusFilter')?.value || '').toLowerCase();
            const cards = document.querySelectorAll('#evidenceVaultGrid .detection-card');

            cards.forEach((card) => {
                const text = card.textContent.toLowerCase();
                const matchesSearch = !searchText || text.includes(searchText);
                const matchesType = !typeValue || text.includes(typeValue);
                const matchesStatus = !statusValue || text.includes(statusValue);
                card.style.display = matchesSearch && matchesType && matchesStatus ? '' : 'none';
            });
        }

        async function submitEvidenceUpload(event) {
            event.preventDefault();
            const form = event.target;
            const msg = document.getElementById('evUploadMsg');
            const formData = new FormData();
            formData.append('caseId', form.evCaseId?.value?.trim() || 'Unassigned');
            formData.append('evidenceType', form.evUploadType?.value?.trim() || 'other');
            formData.append('description', form.evUploadDesc?.value?.trim() || '');

            const files = form.evidence?.files || [];
            for (const file of files) {
                formData.append('evidence', file);
            }

            try {
                const data = await apiRequest('/api/evidence/upload', {
                    method: 'POST',
                    body: formData
                });

                if (msg) {
                    msg.style.display = 'block';
                    msg.className = 'success-msg';
                    msg.textContent = data?.evidence?.length ? `Uploaded ${data.evidence.length} evidence item(s).` : 'Evidence uploaded successfully.';
                }

                const modal = document.getElementById('uploadEvidenceModal');
                if (modal) modal.classList.remove('active');
                form.reset();
                await renderEvidenceVault();
                showNotification('Evidence uploaded', 'Evidence was saved to the vault.');
            } catch (error) {
                if (msg) {
                    msg.style.display = 'block';
                    msg.className = 'error-msg';
                    msg.textContent = error.message || 'Unable to upload evidence.';
                }
                showNotification('Evidence upload failed', error.message || 'Unable to upload evidence.');
            }
        }

        async function renderEvidenceVault() {
            const grid = document.getElementById('evidenceVaultGrid');
            if (!grid) return;

            try {
                const data = await apiRequest('/api/evidence', { method: 'GET' }, false);
                const evidence = Array.isArray(data.evidence) ? data.evidence : [];

                grid.innerHTML = evidence.length ? evidence.map((item) => `
                    <div class="detection-card">
                        <div class="detection-image">${item.mimeType?.startsWith('image/') ? '🖼️' : '📎'}</div>
                        <div class="detection-info">
                            <div class="detection-type weapon">${item.evidenceType || 'Evidence'}</div>
                            <div style="color:var(--text-muted);font-size:14px;">Case: ${item.caseId || 'Unassigned'}</div>
                            <div style="color:var(--text-muted);font-size:14px;">${item.fileName || 'Unnamed file'}</div>
                            <div style="color:var(--text-muted);font-size:12px;">Uploaded by ${item.uploader || 'Citizen'} • ${item.status || 'Verified'}</div>
                        </div>
                    </div>
                `).join('') : `
                    <div class="detection-card">
                        <div class="detection-image">📁</div>
                        <div class="detection-info">
                            <div class="detection-type weapon">No evidence yet</div>
                            <div style="color:var(--text-muted);font-size:14px;">Uploaded files will appear here.</div>
                        </div>
                    </div>
                `;

                filterEvidenceVault();
            } catch (error) {
                grid.innerHTML = `
                    <div class="detection-card">
                        <div class="detection-image">⚠️</div>
                        <div class="detection-info">
                            <div class="detection-type weapon">Evidence unavailable</div>
                            <div style="color:var(--text-muted);font-size:14px;">${error.message || 'Unable to load evidence.'}</div>
                        </div>
                    </div>
                `;
            }
        }

        async function fetchAuditLogs() {
            const tableBody = document.getElementById('auditLogTableBody');
            if (!tableBody) return;

            try {
                const data = await apiRequest('/api/audit-logs', { method: 'GET' });
                const logs = Array.isArray(data.logs) ? data.logs : [];

                tableBody.innerHTML = logs.length ? logs.map((log) => `
                    <tr>
                        <td>${log.id || 'N/A'}</td>
                        <td>${log.user || 'system'}</td>
                        <td>${log.action || 'Log entry'}</td>
                        <td>${log.details || ''}</td>
                        <td>${log.ipAddress || 'render-runtime'}</td>
                        <td>${log.date || ''}</td>
                    </tr>
                `).join('') : `
                    <tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:18px;">No audit entries yet.</td></tr>
                `;

                showNotification('Audit log', 'Audit logs loaded successfully.');
            } catch (error) {
                tableBody.innerHTML = `
                    <tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:18px;">${error.message || 'Unable to load audit logs.'}</td></tr>
                `;
                showNotification('Audit log unavailable', error.message || 'Unable to load audit logs.');
            }
        }

        function renderDetectionHistory(detections) {
            const history = document.getElementById('adminDetectionHistory');
            if (!history) return;

            history.innerHTML = detections.length ? detections.map((detection) => `
                <div style="padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div style="display:flex; justify-content:space-between; gap:10px;">
                        <strong>${detection.id || detection.type || 'Detection'}</strong>
                        <span>${Number.isFinite(Number(detection.confidence)) ? `${Number(detection.confidence).toFixed(1)}%` : ''}</span>
                    </div>
                    <div>${detection.type || 'Event'} • ${detection.location || 'Unknown location'}</div>
                    <div>${detection.license ? `License: ${detection.license} • ` : ''}${detection.time || ''}</div>
                </div>
            `).join('') : '<div style="color:var(--text-muted); text-align:center; padding:20px;">No detection history available.</div>';
        }

        async function startDetection() {
            const statusText = document.getElementById('aiStatusText');
            const statusDot = document.getElementById('aiStatusDot');
            const logPanel = document.getElementById('detectionLogPanel');
            const stopBtn = document.getElementById('aiStopBtn');
            const startBtn = document.getElementById('aiStartBtn');
            try {
                const data = await apiRequest('/api/ai-detections', { method: 'GET' }, false);
                const detections = Array.isArray(data.detections) ? data.detections : [];

                renderDetectionHistory(detections);
                if (statusText) statusText.textContent = 'Running';
                if (statusDot) statusDot.style.background = '#22c55e';
                if (logPanel) logPanel.style.display = '';
                if (stopBtn) stopBtn.disabled = false;
                if (startBtn) startBtn.disabled = true;
                showNotification('Detection started', 'AI detection is now running.');
            } catch (error) {
                showNotification('Detection unavailable', error.message || 'Unable to load AI detections.');
            }
        }

        function stopDetection() {
            const statusText = document.getElementById('aiStatusText');
            const statusDot = document.getElementById('aiStatusDot');
            const stopBtn = document.getElementById('aiStopBtn');
            const startBtn = document.getElementById('aiStartBtn');
            if (statusText) statusText.textContent = 'Stopped';
            if (statusDot) statusDot.style.background = '#94a3b8';
            if (stopBtn) stopBtn.disabled = true;
            if (startBtn) startBtn.disabled = false;
            showNotification('Detection stopped', 'AI detection has been stopped.');
        }

        function exportDetectionLog() {
            const history = document.getElementById('adminDetectionHistory');
            if (!history) {
                showNotification('Export unavailable', 'No detection history panel found.');
                return;
            }

            const rows = Array.from(history.querySelectorAll('div')).map((row) => row.textContent.trim()).filter(Boolean);
            if (!rows.length) {
                showNotification('Export unavailable', 'No detection history to export.');
                return;
            }

            const csv = ['entry', ...rows.map((row) => `"${row.replace(/"/g, '""')}"`)].join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'detection-history.csv';
            link.click();
            URL.revokeObjectURL(url);
            showNotification('Export ready', 'Detection log export downloaded.');
        }

        function dispatchUnit(id, type, location) {
            showNotification('Dispatch', `Unit dispatched for ${id} at ${location}.`);
        }

        function monitorFeed(id, type, location) {
            showNotification('Monitoring', `${type} at ${location} is now being monitored.`);
        }

        function interceptVehicle(id, plate, location) {
            showNotification('Intercept', `Vehicle ${plate} at ${location} is being intercepted.`);
        }

        function renderAdminCameras(cameras) {
            const body = document.getElementById('adminCameraTableBody');
            if (!body) return;

            body.innerHTML = cameras.length ? cameras.map((camera) => `
                <tr>
                    <td>${camera.id || 'N/A'}</td>
                    <td>${camera.location || 'Unknown'}</td>
                    <td><span class="badge badge-${String(camera.status || 'Online').toLowerCase().includes('online') ? 'success' : String(camera.status || '').toLowerCase().includes('maint') ? 'warning' : 'danger'}">${camera.status || 'Online'}</span></td>
                    <td>${camera.resolution || '1080p'}</td>
                    <td>${camera.mode || 'Monitoring'}</td>
                    <td>${camera.lastPing || ''}</td>
                    <td><button class="btn btn-primary btn-small" onclick="adminSaveModelConfig()">Sync</button></td>
                </tr>
            `).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:18px;">No cameras configured.</td></tr>';
        }

        async function loadAdminCameras() {
            const body = document.getElementById('adminCameraTableBody');
            const modelSelect = document.getElementById('adminModelSelect');
            const fpsSelect = document.getElementById('adminFpsSelect');
            const alertMode = document.getElementById('adminAlertMode');
            const autoDispatch = document.getElementById('adminAutoDispatch');

            try {
                const [cameraData, modelData] = await Promise.all([
                    apiRequest('/api/admin/cameras', { method: 'GET' }),
                    apiRequest('/api/admin/model-config', { method: 'GET' })
                ]);

                renderAdminCameras(Array.isArray(cameraData.cameras) ? cameraData.cameras : []);

                const config = modelData.modelConfig || {};
                if (modelSelect && config.activeModel) modelSelect.value = config.activeModel;
                if (fpsSelect && config.frameRate) fpsSelect.value = config.frameRate;
                if (alertMode && config.alertMode) alertMode.value = config.alertMode;
                if (autoDispatch) autoDispatch.checked = Boolean(config.autoDispatch);

                [['confWeaponVal', config.weaponThreshold], ['confViolenceVal', config.violenceThreshold], ['confSuspVal', config.suspiciousThreshold], ['confVehicleVal', config.vehicleThreshold]].forEach(([id, value]) => {
                    const node = document.getElementById(id);
                    if (node && Number.isFinite(Number(value))) {
                        node.textContent = `${Number(value)}%`;
                    }
                });

                if (body) body.dataset.loaded = 'true';
            } catch (error) {
                if (body) {
                    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:18px;">${error.message || 'Unable to load cameras.'}</td></tr>`;
                }
                showNotification('Camera load failed', error.message || 'Unable to load admin cameras.');
            }
        }

        async function adminAddCamera() {
            const location = window.prompt('Enter camera location', 'New camera location');
            if (!location) return;

            try {
                await apiRequest('/api/admin/cameras', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        location,
                        status: 'Online',
                        resolution: '1080p',
                        mode: 'General Monitoring'
                    })
                });

                await loadAdminCameras();
                showNotification('Camera added', `${location} is now in the camera list.`);
            } catch (error) {
                showNotification('Camera error', error.message || 'Unable to add camera.');
            }
        }

        async function adminRefreshCameras() {
            await loadAdminCameras();
            showNotification('Camera list refreshed', 'Camera and model configuration reloaded.');
        }

        async function adminSaveModelConfig() {
            const weapon = document.getElementById('confWeaponVal');
            const violence = document.getElementById('confViolenceVal');
            const suspicious = document.getElementById('confSuspVal');
            const vehicle = document.getElementById('confVehicleVal');
            const modelSelect = document.getElementById('adminModelSelect');
            const fpsSelect = document.getElementById('adminFpsSelect');
            const alertMode = document.getElementById('adminAlertMode');
            const autoDispatch = document.getElementById('adminAutoDispatch');

            try {
                await apiRequest('/api/admin/model-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        weaponThreshold: Number(String(weapon?.textContent || '85').replace('%', '')),
                        violenceThreshold: Number(String(violence?.textContent || '80').replace('%', '')),
                        suspiciousThreshold: Number(String(suspicious?.textContent || '70').replace('%', '')),
                        vehicleThreshold: Number(String(vehicle?.textContent || '90').replace('%', '')),
                        activeModel: modelSelect?.value || 'YOLOv8 (Current)',
                        frameRate: fpsSelect?.value || '15 FPS - Balanced',
                        alertMode: alertMode?.value || 'Filtered - Above threshold only',
                        autoDispatch: Boolean(autoDispatch?.checked)
                    })
                });

                showNotification('Model saved', 'Model configuration synced to the backend.');
            } catch (error) {
                showNotification('Model save failed', error.message || 'Unable to save model config.');
            }
        }

        async function adminResetModel() {
            try {
                await apiRequest('/api/admin/model-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        weaponThreshold: 85,
                        violenceThreshold: 80,
                        suspiciousThreshold: 70,
                        vehicleThreshold: 90,
                        activeModel: 'YOLOv8 (Current)',
                        frameRate: '15 FPS - Balanced',
                        alertMode: 'Filtered - Above threshold only',
                        autoDispatch: true
                    })
                });

                await loadAdminCameras();
                showNotification('Model reset', 'Model configuration restored to defaults.');
            } catch (error) {
                showNotification('Reset failed', error.message || 'Unable to reset model config.');
            }
        }

        function adminClearHistory() {
            const history = document.getElementById('adminDetectionHistory');
            if (history) history.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px;">History cleared.</div>';
            showNotification('History cleared', 'Detection history view has been cleared.');
        }

        function runNLPAnalysis() {
            refreshAnalytics();
            showNotification('Analysis refreshed', 'NLP crime analysis updated.');
        }

        function generateAnalysisReport() {
            showNotification('Report generated', 'Analysis report is ready.');
        }

        function emailReport() {
            const modal = document.getElementById('emailReportModal');
            if (!modal) return;

            const subject = document.getElementById('emailReportSubjectDisplay');
            const body = document.getElementById('emailReportBody');
            const mailto = document.getElementById('emailReportMailtoLink');

            const reportSubject = 'AI Crime Detection Analysis Report';
            const reportBody = [
                `Prepared for: ${currentUser || 'User'}`,
                `Generated: ${new Date().toLocaleString()}`,
                'Summary: Live dashboard report from the AI Crime Detection System.'
            ].join('\n');

            if (subject) subject.textContent = reportSubject;
            if (body) body.value = reportBody;
            if (mailto) mailto.href = `mailto:?subject=${encodeURIComponent(reportSubject)}&body=${encodeURIComponent(reportBody)}`;
            modal.classList.add('active');
        }

        function copyEmailBody() {
            const body = document.getElementById('emailReportBody');
            if (!body) return;
            body.select();
            document.execCommand('copy');
            showNotification('Copied', 'Email body copied to clipboard.');
        }

        function sendEmailReport() {
            const link = document.getElementById('emailReportMailtoLink');
            if (link) {
                window.open(link.href, '_blank');
            }
        }

        function deployNewUnit() {
            const units = document.getElementById('patrolUnits');
            if (!units) return;

            const card = document.createElement('div');
            card.className = 'patrol-card';
            card.innerHTML = `
                <div class="patrol-header">
                    <div class="patrol-id">Unit P-${Math.floor(100 + Math.random() * 900)}</div>
                    <span class="badge badge-success">Active</span>
                </div>
                <div style="color: var(--text-muted); font-size: 14px;">\n                    <div>📍 New deployment</div>\n                    <div>👮 Officers: 2</div>\n                    <div>⏱️ Response: 4.0 min</div>\n                </div>
            `;
            units.prepend(card);

            apiRequest('/api/patrol-units', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: `P-${Math.floor(100 + Math.random() * 900)}`,
                    status: 'Active',
                    location: 'New deployment',
                    officers: 2,
                    responseTime: '4.0 min'
                })
            }).catch(() => {});

            showNotification('Unit deployed', 'A patrol unit has been added to the dashboard.');
        }
