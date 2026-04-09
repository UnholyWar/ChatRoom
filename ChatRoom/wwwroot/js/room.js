// room.js — Room page orchestrator: SignalR + WebRTC + Audio + UI

(async () => {
    // ── Read server-rendered data ──────────────────────────────────────────
    const dataEl   = document.getElementById('room-data');
    const roomId   = dataEl.dataset.roomId;
    const nickname = dataEl.dataset.nickname;
    const color    = dataEl.dataset.color;

    // ── DOM refs ───────────────────────────────────────────────────────────
    const messagesEl    = document.getElementById('messages');
    const messageInput  = document.getElementById('message-input');
    const btnSend       = document.getElementById('btn-send');
    const btnMute       = document.getElementById('btn-mute');
    const gainSlider    = document.getElementById('gain-slider');
    const gainValue     = document.getElementById('gain-value');
    const gateSlider    = document.getElementById('gate-slider');
    const gateValue     = document.getElementById('gate-value');
    const micSelect     = document.getElementById('mic-device');
    const usersList     = document.getElementById('users-list');
    const userCountEl   = document.getElementById('user-count');        // header
    const userCountBadge = document.getElementById('user-count-badge'); // sidebar

    // ── Local state ────────────────────────────────────────────────────────
    const users = {};
    let myConnectionId = null;

    // ── Mic enumeration — independent of SignalR ───────────────────────────
    try {
        const mics = await AudioManager.enumerateMics();
        populateMicSelect(mics);
    } catch (err) {
        console.warn('Mikrofon listesi alınamadı:', err);
        const opt = document.createElement('option');
        opt.textContent = 'Varsayılan mikrofon';
        opt.value = '';
        micSelect.appendChild(opt);
    }

    // ── SignalR — color passed as hex without #, re-added on server ────────
    // We strip # to avoid URL encoding issues (%23 vs #)
    const colorHex = color.startsWith('#') ? color.slice(1) : color;

    const connection = new signalR.HubConnectionBuilder()
        .withUrl(`/hub?nickname=${encodeURIComponent(nickname)}&color=${colorHex}`)
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Warning)
        .build();

    // ── SignalR Event Handlers ─────────────────────────────────────────────

    connection.on('RoomJoined', async (data) => {
        const existingUsers = data.existingUsers || [];

        for (const u of existingUsers) {
            if (!users[u.connectionId]) {
                users[u.connectionId] = { nickname: u.nickname, color: u.color, isMe: false };
                addUserCard(u.connectionId, u.nickname, u.color, false);
            }
        }
        updateUserCount();

        // ── Init audio pipeline ──────────────────────────────────────────
        const selectedDeviceId = micSelect.value || null;

        let stream;
        try {
            stream = await AudioManager.init(selectedDeviceId, (isSpeaking) => {
                connection.invoke('SetSpeaking', isSpeaking).catch(console.error);
                updateSpeakingUI(myConnectionId, isSpeaking);
            });
        } catch (err) {
            console.error('Mikrofon başlatılamadı:', err);
            appendSystemMessage('⚠️ Mikrofon erişimi sağlanamadı.');
            return;
        }

        // ── WebRTC mesh ──────────────────────────────────────────────────
        WebRTCManager.init(stream, connection, (connId, remoteStream) => {
            AudioManager.attachRemoteStream(connId, remoteStream);
        });

        for (const u of existingUsers) {
            await WebRTCManager.createOffer(u.connectionId);
        }
    });

    connection.on('UserJoined', (user) => {
        if (!users[user.connectionId]) {
            users[user.connectionId] = { nickname: user.nickname, color: user.color, isMe: false };
            addUserCard(user.connectionId, user.nickname, user.color, false);
            updateUserCount();
        }
        appendSystemMessage(`${user.nickname} odaya katıldı`);
    });

    connection.on('UserLeft', (connectionId) => {
        const user = users[connectionId];
        if (user) {
            appendSystemMessage(`${user.nickname} odadan ayrıldı`);
            delete users[connectionId];
            removeUserCard(connectionId);
            updateUserCount();
            WebRTCManager.closePeer(connectionId);
            AudioManager.detachRemote(connectionId);
        }
    });

    connection.on('ReceiveMessage', (msg) => appendMessage(msg));

    connection.on('ReceiveOffer',        async (fromId, sdp)       => WebRTCManager.handleOffer(fromId, sdp));
    connection.on('ReceiveAnswer',       async (fromId, sdp)       => WebRTCManager.handleAnswer(fromId, sdp));
    connection.on('ReceiveIceCandidate', async (fromId, candidate) => WebRTCManager.handleIceCandidate(fromId, candidate));

    connection.on('UserSpeaking', (connectionId, isSpeaking) => updateSpeakingUI(connectionId, isSpeaking));

    // Ignore RoomCounts on room page
    connection.on('RoomCounts', () => {});

    // ── UI: User Cards ─────────────────────────────────────────────────────

    function addUserCard(connId, nick, userColor, isMe) {
        if (document.getElementById(`user-${connId}`)) return; // guard dup

        const card = document.createElement('div');
        card.className = 'user-card';
        card.id = `user-${connId}`;
        card.style.setProperty('--user-color', userColor);

        const top = document.createElement('div');
        top.className = 'user-card-top';

        const dot = document.createElement('div');
        dot.className = 'speaking-indicator';
        dot.style.background = userColor;

        const nameEl = document.createElement('span');
        nameEl.className = 'user-name';
        nameEl.style.color = userColor;
        nameEl.textContent = nick;

        top.appendChild(dot);
        top.appendChild(nameEl);

        if (isMe) {
            const badge = document.createElement('span');
            badge.className = 'user-me-badge';
            badge.textContent = 'sen';
            top.appendChild(badge);
        }

        card.appendChild(top);

        if (!isMe) {
            const volRow = document.createElement('div');
            volRow.className = 'volume-control';

            const icon = document.createElement('span');
            icon.className = 'vol-icon';
            icon.textContent = '🔊';

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'volume-slider';
            slider.min = '0';
            slider.max = '1';
            slider.step = '0.05';
            slider.value = '1';
            slider.title = 'Ses seviyesi';
            slider.addEventListener('input', () => AudioManager.setRemoteVolume(connId, slider.value));

            volRow.appendChild(icon);
            volRow.appendChild(slider);
            card.appendChild(volRow);
        }

        usersList.appendChild(card);
    }

    function removeUserCard(connId) {
        document.getElementById(`user-${connId}`)?.remove();
    }

    function updateSpeakingUI(connId, isSpeaking) {
        document.getElementById(`user-${connId}`)?.classList.toggle('speaking', isSpeaking);
    }

    function updateUserCount() {
        const count = Object.keys(users).length;
        if (userCountEl)    userCountEl.textContent    = count;
        if (userCountBadge) userCountBadge.textContent = count;
    }

    // ── UI: Messages ───────────────────────────────────────────────────────

    function appendMessage(msg) {
        const div = document.createElement('div');
        div.className = 'message';

        const time = document.createElement('span');
        time.className = 'msg-time';
        time.textContent = msg.timestamp;

        const sender = document.createElement('span');
        sender.className = 'msg-sender';
        sender.style.color = msg.color;
        sender.textContent = msg.nickname;

        const text = document.createElement('span');
        text.className = 'msg-text';
        text.textContent = msg.text;   // textContent — no XSS risk

        div.appendChild(time);
        div.appendChild(sender);
        div.appendChild(text);
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function appendSystemMessage(text) {
        const div = document.createElement('div');
        div.className = 'message system';
        div.textContent = text;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ── UI: Mic Controls ───────────────────────────────────────────────────

    function populateMicSelect(mics) {
        micSelect.innerHTML = '';
        mics.forEach((mic, i) => {
            const opt = document.createElement('option');
            opt.value = mic.deviceId;
            opt.textContent = mic.label || `Mikrofon ${i + 1}`;
            micSelect.appendChild(opt);
        });
    }

    btnMute.addEventListener('click', () => {
        const nowMuted = AudioManager.toggleMute();
        btnMute.querySelector('.icon-mic').style.display    = nowMuted ? 'none'  : '';
        btnMute.querySelector('.icon-mic-off').style.display = nowMuted ? ''     : 'none';
        btnMute.querySelector('.mute-label').textContent    = nowMuted ? 'Mikrofon Kapalı' : 'Mikrofon Açık';
        btnMute.classList.toggle('muted', nowMuted);
    });

    gainSlider.addEventListener('input', () => {
        const val = parseFloat(gainSlider.value);
        AudioManager.setGain(val);
        gainValue.textContent = Math.round(val * 100) + '%';
    });

    gateSlider.addEventListener('input', () => {
        const val = parseInt(gateSlider.value, 10);
        AudioManager.setNoiseGate(val);
        gateValue.textContent = val === 0 ? 'Kapalı' : val + '%';
    });

    micSelect.addEventListener('change', async () => {
        try {
            const newStream = await AudioManager.init(micSelect.value || null, (isSpeaking) => {
                connection.invoke('SetSpeaking', isSpeaking).catch(console.error);
                updateSpeakingUI(myConnectionId, isSpeaking);
            });
            await WebRTCManager.replaceStream(newStream);
        } catch (err) {
            console.error('Mikrofon değiştirilemedi:', err);
        }
    });

    // ── Chat ───────────────────────────────────────────────────────────────

    function sendMessage() {
        const text = messageInput.value.trim();
        if (!text) return;
        connection.invoke('SendMessage', text).catch(console.error);
        messageInput.value = '';
    }

    btnSend.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    // ── Start ──────────────────────────────────────────────────────────────

    try {
        await connection.start();
    } catch (err) {
        console.error('SignalR bağlantısı kurulamadı:', err);
        appendSystemMessage('⚠️ Sunucu bağlantısı kurulamadı. Sayfayı yenileyin.');
        return;
    }

    myConnectionId = connection.connectionId;

    // Add self to user list
    users[myConnectionId] = { nickname, color, isMe: true };
    addUserCard(myConnectionId, nickname, color, true);
    updateUserCount();

    // Join room → triggers RoomJoined from server
    await connection.invoke('JoinRoom', roomId);

    // ── Cleanup ────────────────────────────────────────────────────────────

    window.addEventListener('beforeunload', () => {
        AudioManager.destroy();
        WebRTCManager.closeAll();
        connection.stop();
    });

})().catch(err => console.error('Room init error:', err));
