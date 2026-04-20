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
    }

    async boot() {
        console.log("🚀 Booting Artifact Engine...");
        await this.requestWakeLock();
        this.startDirectorPulse();
        this.initSensors();
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