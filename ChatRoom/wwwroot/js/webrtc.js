// webrtc.js — Full-mesh WebRTC peer connections (audio only)

const WebRTCManager = (() => {
    const peers = {};       // connectionId → RTCPeerConnection
    let localStream = null;
    let hub = null;
    let onRemoteStream = null;

    const ICE_CONFIG = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    // ── Init ───────────────────────────────────────────────────────────────

    function init(stream, signalHub, remoteStreamCb) {
        localStream = stream;
        hub = signalHub;
        onRemoteStream = remoteStreamCb;
    }

    // ── Peer Connection Factory ────────────────────────────────────────────

    function _createPc(connectionId) {
        if (peers[connectionId]) {
            peers[connectionId].close();
        }

        const pc = new RTCPeerConnection(ICE_CONFIG);

        // Add local audio tracks
        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }

        // ICE candidates → send via SignalR
        pc.onicecandidate = (e) => {
            if (e.candidate) {
                hub.invoke('SendIceCandidate', connectionId, JSON.stringify(e.candidate))
                    .catch(console.error);
            }
        };

        // Remote track arrived → pass to AudioManager
        pc.ontrack = (e) => {
            if (onRemoteStream && e.streams && e.streams[0]) {
                onRemoteStream(connectionId, e.streams[0]);
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed') {
                console.warn(`WebRTC peer ${connectionId} failed, closing.`);
                closePeer(connectionId);
            }
        };

        peers[connectionId] = pc;
        return pc;
    }

    // ── Offer / Answer / ICE ───────────────────────────────────────────────

    async function createOffer(connectionId) {
        const pc = _createPc(connectionId);
        try {
            const offer = await pc.createOffer({ offerToReceiveAudio: true });
            await pc.setLocalDescription(offer);
            hub.invoke('SendOffer', connectionId, JSON.stringify(pc.localDescription))
                .catch(console.error);
        } catch (err) {
            console.error('createOffer error:', err);
        }
    }

    async function handleOffer(fromId, sdpJson) {
        const pc = _createPc(fromId);
        try {
            const sdp = JSON.parse(sdpJson);
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            hub.invoke('SendAnswer', fromId, JSON.stringify(pc.localDescription))
                .catch(console.error);
        } catch (err) {
            console.error('handleOffer error:', err);
        }
    }

    async function handleAnswer(fromId, sdpJson) {
        const pc = peers[fromId];
        if (!pc) return;
        try {
            const sdp = JSON.parse(sdpJson);
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        } catch (err) {
            console.error('handleAnswer error:', err);
        }
    }

    async function handleIceCandidate(fromId, candidateJson) {
        const pc = peers[fromId];
        if (!pc) return;
        try {
            const candidate = JSON.parse(candidateJson);
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            // Ignore benign ICE errors (e.g. candidate added after close)
        }
    }

    // ── Cleanup ────────────────────────────────────────────────────────────

    function closePeer(connectionId) {
        if (peers[connectionId]) {
            peers[connectionId].close();
            delete peers[connectionId];
        }
    }

    function closeAll() {
        Object.keys(peers).forEach(closePeer);
    }

    // ── Track Replace (on mic device change) ──────────────────────────────

    async function replaceStream(newStream) {
        localStream = newStream;
        const newTrack = newStream.getAudioTracks()[0];
        if (!newTrack) return;

        const promises = Object.values(peers).map(async (pc) => {
            const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
            if (sender) await sender.replaceTrack(newTrack).catch(console.error);
        });
        await Promise.all(promises);
    }

    // ── Public API ─────────────────────────────────────────────────────────
    return {
        init,
        createOffer,
        handleOffer,
        handleAnswer,
        handleIceCandidate,
        closePeer,
        closeAll,
        replaceStream
    };
})();
