// audio.js — Microphone pipeline: device selection, gain, noise gate, mute, speaking detection, remote volumes

const AudioManager = (() => {
    // ── State ──────────────────────────────────────────────────────────────
    let audioCtx        = null;
    let gainNode        = null;
    let noiseGateNode   = null;   // GainNode used as noise gate output
    let analyserNode    = null;
    let localStream     = null;   // raw stream from getUserMedia
    let processedStream = null;   // stream after pipeline (sent to WebRTC)
    let muted           = false;
    let speakingTimeout = null;
    let animFrameId     = null;
    let onSpeakingCallback   = null;
    let currentlySpeaking    = false;

    // Noise gate: 0 = off, 1–100 maps to amplitude threshold 0–80 (out of 255)
    let noiseGateThreshold = 0;   // 0 = disabled
    let gateOpen           = true;

    const SPEAKING_THRESHOLD  = 20;    // for speaking indicator (fixed)
    const SPEAKING_DEBOUNCE_MS = 350;
    const GATE_ATTACK_TIME    = 0.015; // seconds — how fast gate opens
    const GATE_RELEASE_TIME   = 0.08;  // seconds — how fast gate closes

    const remoteAudios = {};           // connectionId → HTMLAudioElement

    // ── Mic Enumeration ────────────────────────────────────────────────────

    async function enumerateMics() {
        try {
            const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
            tmp.getTracks().forEach(t => t.stop());
        } catch (_) { /* permission denied — labels may be empty */ }

        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(d => d.kind === 'audioinput');
    }

    // ── Init / Reinit ──────────────────────────────────────────────────────

    async function init(deviceId, onSpeaking) {
        _teardown();
        onSpeakingCallback = onSpeaking;

        const constraints = {
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                noiseSuppression: true,
                echoCancellation: true,
                autoGainControl: true
            }
        };

        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        await audioCtx.resume();

        const source = audioCtx.createMediaStreamSource(localStream);

        // Analyser — reads raw signal for speaking detection & noise gate
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 512;
        analyserNode.smoothingTimeConstant = 0.6;

        // User gain — mic sensitivity slider (0.0–2.0)
        gainNode = audioCtx.createGain();
        gainNode.gain.value = 1.0;

        // Noise gate — opened/closed by the rAF loop
        noiseGateNode = audioCtx.createGain();
        noiseGateNode.gain.value = 1.0;

        // Destination → WebRTC stream
        const destination = audioCtx.createMediaStreamDestination();

        // Pipeline: source → analyser → gainNode → noiseGateNode → destination
        source.connect(analyserNode);
        analyserNode.connect(gainNode);
        gainNode.connect(noiseGateNode);
        noiseGateNode.connect(destination);

        processedStream = destination.stream;

        localStream.getAudioTracks().forEach(t => t.enabled = !muted);

        _startSpeakingLoop();

        return processedStream;
    }

    // ── Speaking Detection + Noise Gate Loop ──────────────────────────────

    function _startSpeakingLoop() {
        const data = new Uint8Array(analyserNode.fftSize);

        function loop() {
            if (!analyserNode) return;
            analyserNode.getByteFrequencyData(data);
            const avg = data.reduce((a, b) => a + b, 0) / data.length;

            // ── Noise gate ─────────────────────────────────────────────
            if (noiseGateThreshold > 0 && noiseGateNode) {
                // threshold is 0–100 slider value, map to 0–10.4 amplitude
                // (100% = what previously was 13% of the old 0–80 range)
                const ampThreshold = (noiseGateThreshold / 100) * 10.4;

                if (avg >= ampThreshold) {
                    if (!gateOpen) {
                        gateOpen = true;
                        noiseGateNode.gain.setTargetAtTime(1.0, audioCtx.currentTime, GATE_ATTACK_TIME);
                    }
                } else {
                    if (gateOpen) {
                        gateOpen = false;
                        noiseGateNode.gain.setTargetAtTime(0.0, audioCtx.currentTime, GATE_RELEASE_TIME);
                    }
                }
            }

            // ── Speaking indicator ──────────────────────────────────────
            if (avg > SPEAKING_THRESHOLD) {
                if (!currentlySpeaking) {
                    currentlySpeaking = true;
                    if (onSpeakingCallback) onSpeakingCallback(true);
                }
                clearTimeout(speakingTimeout);
                speakingTimeout = setTimeout(() => {
                    currentlySpeaking = false;
                    if (onSpeakingCallback) onSpeakingCallback(false);
                }, SPEAKING_DEBOUNCE_MS);
            }

            animFrameId = requestAnimationFrame(loop);
        }

        animFrameId = requestAnimationFrame(loop);
    }

    // ── Controls ───────────────────────────────────────────────────────────

    function setGain(value) {
        if (gainNode) gainNode.gain.value = parseFloat(value);
    }

    function getGain() {
        return gainNode ? gainNode.gain.value : 1;
    }

    /**
     * Set noise gate threshold.
     * @param {number} value  0 = off, 1–100 = progressively stricter gate
     */
    function setNoiseGate(value) {
        noiseGateThreshold = Math.max(0, Math.min(100, parseInt(value, 10)));

        // If turning off, immediately open the gate
        if (noiseGateThreshold === 0 && noiseGateNode) {
            gateOpen = true;
            noiseGateNode.gain.setTargetAtTime(1.0, audioCtx.currentTime, GATE_ATTACK_TIME);
        }
    }

    function getNoiseGate() { return noiseGateThreshold; }

    function toggleMute() {
        muted = !muted;
        if (localStream)
            localStream.getAudioTracks().forEach(t => t.enabled = !muted);
        return muted;
    }

    function isMuted() { return muted; }

    function getProcessedStream() { return processedStream; }

    // ── Remote Audio ───────────────────────────────────────────────────────

    function attachRemoteStream(connectionId, stream) {
        let audio = remoteAudios[connectionId];
        if (!audio) {
            audio = new Audio();
            audio.autoplay = true;
            remoteAudios[connectionId] = audio;
        }
        audio.srcObject = stream;
        return audio;
    }

    function setRemoteVolume(connectionId, value) {
        if (remoteAudios[connectionId])
            remoteAudios[connectionId].volume = Math.max(0, Math.min(1, parseFloat(value)));
    }

    function detachRemote(connectionId) {
        const audio = remoteAudios[connectionId];
        if (audio) { audio.srcObject = null; delete remoteAudios[connectionId]; }
    }

    // ── Cleanup ────────────────────────────────────────────────────────────

    function _teardown() {
        if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
        clearTimeout(speakingTimeout);
        currentlySpeaking = false;
        gateOpen = true;
        if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
        if (audioCtx) { audioCtx.close(); audioCtx = null; }
        gainNode = null;
        noiseGateNode = null;
        analyserNode = null;
        processedStream = null;
    }

    function destroy() {
        _teardown();
        Object.keys(remoteAudios).forEach(detachRemote);
    }

    // ── Public API ─────────────────────────────────────────────────────────
    return {
        enumerateMics,
        init,
        setGain,
        getGain,
        setNoiseGate,
        getNoiseGate,
        toggleMute,
        isMuted,
        getProcessedStream,
        attachRemoteStream,
        setRemoteVolume,
        detachRemote,
        destroy
    };
})();
