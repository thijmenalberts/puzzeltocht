/**
 * ArtifactEngine.js - Het brein van de Immersive OS Experience.
 * Regelt hardware sensoren, WakeLock, Audio, Haptics en the AI Director telemetry.
 */
class ArtifactEngine {
    constructor() {
        this.telemetryInterval = null;
        this.wakeLock = null;
        this.sceneStartTime = Date.now();
        this.currentSceneId = document.body.dataset.sceneId || "unknown";
        this.puzzleId = document.body.dataset.puzzleId || "unknown";
        this.triggerFired = false; // Voorkomt dubbele calls
    }

    // Aangepast: Boot accepteert nu de triggers uit de EJS view
    async boot(triggers = []) {
        console.log("🚀 Booting Artifact Engine...");
        
        // Browser-beleid: we moeten een fysieke tap hebben om Audio & Spraak te starten
        this.createImmersionOverlay(() => {
            this.activateSystems(triggers);
        });
    }

    createImmersionOverlay(onUnlock) {
        const overlay = document.createElement("div");
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: #000; color: #0f0; display: flex; align-items: center; 
            justify-content: center; z-index: 99999; font-family: monospace;
            cursor: pointer; flex-direction: column;
        `;
        overlay.innerHTML = `
            <h2>[ VERBINDING MAKEN MET ARTEFACT ]</h2>
            <p style="opacity: 0.7; font-size: 0.8rem; margin-top: 20px;">Druk op het scherm om te kalibreren</p>
        `;
        
        document.body.appendChild(overlay);
        
        overlay.addEventListener("click", () => {
            overlay.style.transition = "opacity 0.5s ease";
            overlay.style.opacity = "0";
            setTimeout(() => overlay.remove(), 500);
            onUnlock();
        });
    }

    async activateSystems(triggers) {
        await this.requestWakeLock();
        this.startDirectorPulse();
        this.initSensors(triggers);
        this.playAtmosphere();
    }

    // 1. Houd het scherm altijd aan (Cruciaal voor de immersie)
    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                this.wakeLock.addEventListener('release', () => console.log('Screen Wake Lock released'));
                
                // Her-activeer als de speler wisselt van tab en terugkomt
                document.addEventListener('visibilitychange', async () => {
                    if (this.wakeLock !== null && document.visibilityState === 'visible') {
                        this.wakeLock = await navigator.wakeLock.request('screen');
                    }
                });
            } catch (err) {
                console.warn(`Wake Lock error: ${err.name}, ${err.message}`);
            }
        }
    }

    // 2. Haptische Taal
    vibrate(type = "success") {
        if (!navigator.vibrate) return;
        const patterns = {
            success: [50, 50, 50],
            error: [200, 100, 200, 100, 500], // Boem... Boem... BOEM
            heartbeat: [100, 100, 100, 800],
            pulse: [10, 2000] // Als je dichterbij komt, verlaag de 2000
        };
        navigator.vibrate(patterns[type] || [50]);
    }

    // 3. Audio Immersion (Spatial/Atmospheric)
    playAtmosphere() {
        // Een diepe drone die altijd speelt in de achtergrond
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if(!AudioContext) return;
        
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(40, ctx.currentTime); // Diepe bas
        gain.gain.setValueAtTime(0.05, ctx.currentTime); // Heel subtiel
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
    }

    // ==========================================
    // 5. DE ZINTUIGEN (Zero-UI Triggers)
    // ==========================================
    initSensors(triggers) {
        console.log("Detecting environment for triggers...", triggers);
        if (!triggers || triggers.length === 0) return;
        
        triggers.forEach(trigger => {
            if (trigger.type === 'speech_match') this.startListening(trigger);
            if (trigger.type === 'orientation') this.startCompass(trigger);
            // Voeg hier later 'camera_vision' of 'gps_proximity' aan toe
        });
    }

    startListening(trigger) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return console.warn("Speech API not supported");
        
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.lang = 'nl-NL';
        recognition.interimResults = false;
        
        recognition.onresult = (event) => {
            const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase();
            console.log("Overhoord:", transcript);
            
            if (transcript.includes(trigger.targetValue.toLowerCase())) {
                this.vibrate("success");
                this.completeScene(trigger);
                recognition.stop();
            }
        };
        
        // Als de microfoon stopt (bijv door stilte), start hem opnieuw
        recognition.onend = () => { if (!this.triggerFired) recognition.start(); };
        recognition.start();
    }

    startCompass(trigger) {
        // Let op: vereist HTTPS. iOS vereist vaak extra permissies, hier vereenvoudigd.
        window.addEventListener('deviceorientation', (e) => {
            if (this.triggerFired || !e.alpha) return;
            
            // alpha is rotatie 0-360 (0 is noord)
            const diff = Math.abs(e.alpha - parseInt(trigger.targetValue));
            
            // Is de telefoon in de juiste richting gewezen? (met margin of error)
            if (diff < trigger.tolerance || diff > (360 - trigger.tolerance)) {
                this.vibrate("success");
                this.completeScene(trigger);
            }
        });
    }

    // ==========================================
    // 6. VOLTOOIING & TRANSTITIE
    // ==========================================
    async completeScene(trigger) {
        if (this.triggerFired) return;
        this.triggerFired = true;
        
        // Kraak het scherm (visueel bewijs dat het werkte)
        document.body.style.transition = "filter 0.5s, transform 0.5s";
        document.body.style.filter = "invert(1) hue-rotate(180deg) blur(2px)";
        document.body.style.transform = "scale(0.98)";

        // Registreer via de nieuwe API backend route
        const res = await fetch("/api/scene/trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                puzzleId: this.puzzleId,
                sceneIndex: this.currentSceneId,
                triggerType: trigger.type,
                targetValue: trigger.targetValue
            })
        });
        
        const data = await res.json();
        if (data.success) {
            // Wacht heel even voor de immersie en laad dan de nieuwe pagina in
            setTimeout(() => window.location.href = data.nextUrl, 1200);
        }
    }

    // 4. De AI Director (Constant monitoren en ingrijpen)
    startDirectorPulse() {
        this.telemetryInterval = setInterval(() => this.sendPulse(), 15000);
    }

    sendPulse() {
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const payload = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                currentSceneId: this.currentSceneId,
                timeInSceneMs: Date.now() - this.sceneStartTime
            };

            try {
                const res = await fetch("/api/director/pulse", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                
                if (data.action === "intervene") {
                    this.handleDirectorIntervention(data);
                }
            } catch (err) {
                console.error("Pulse mislukt, onzichtbaar voor speler...", err);
            }
        }, () => {}, { enableHighAccuracy: true });
    }

    handleDirectorIntervention(data) {
        // The AI speaks! Haptics + UI overname
        if (data.hapticPattern) navigator.vibrate(data.hapticPattern);
        
        // Gebruik Web Speech Synthesis om de tekst dreigend uit te spreken
        const utterance = new SpeechSynthesisUtterance(data.message);
        utterance.pitch = 0.8;
        utterance.rate = 0.9;
        window.speechSynthesis.speak(utterance);
    }
}
window.Artifact = new ArtifactEngine();