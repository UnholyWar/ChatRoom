// lobby.js — Real-time room counts via SignalR

(function () {
    const lobbyData = document.getElementById('lobby-data');
    const nickname  = lobbyData.dataset.nickname;
    const color     = lobbyData.dataset.color;

    const connection = new signalR.HubConnectionBuilder()
        .withUrl(`/hub?nickname=${encodeURIComponent(nickname)}&color=${color.replace('#', '')}`)
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Warning)
        .build();

    connection.on('RoomCounts', (counts) => {
        Object.entries(counts).forEach(([roomId, count]) => {
            const countEl = document.querySelector(`#count-${roomId} .rc-num`);
            if (countEl) countEl.textContent = count;

            const liveEl = document.getElementById(`live-${roomId}`);
            if (liveEl) liveEl.classList.toggle('has-users', count > 0);
        });
    });

    connection.start().catch(err => console.error('Lobby hub error:', err));

    window.addEventListener('beforeunload', () => connection.stop());
})();
