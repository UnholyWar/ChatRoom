// join.js — Login page: localStorage pre-fill + color picker + Turkish char conversion

(function () {
    const LS_KEY = 'chatroom_last_login';

    const nicknameInput = document.getElementById('nickname');
    const colorInput    = document.getElementById('color');
    const colorBar      = document.getElementById('color-bar');
    const swatches      = document.querySelectorAll('.swatch[data-color]');
    const lastLoginEl   = document.getElementById('last-login');
    const lastLoginInfo = document.getElementById('last-login-info');
    const llDot         = document.getElementById('ll-dot');
    const btnUseLast    = document.getElementById('btn-use-last');

    // ── Turkish → English ─────────────────────────────────────────────────

    const TR_MAP = {
        'ş':'s','Ş':'S','ğ':'g','Ğ':'G','ü':'u','Ü':'U',
        'ö':'o','Ö':'O','ı':'i','İ':'I','ç':'c','Ç':'C'
    };

    function convertTurkish(str) {
        return str.replace(/[şŞğĞüÜöÖıİçÇ]/g, ch => TR_MAP[ch] || ch);
    }

    nicknameInput.addEventListener('input', () => {
        const converted = convertTurkish(nicknameInput.value);
        if (converted !== nicknameInput.value) {
            const pos = nicknameInput.selectionStart;
            nicknameInput.value = converted;
            nicknameInput.setSelectionRange(pos, pos);
        }
    });

    // ── Color picker ──────────────────────────────────────────────────────

    function applyColor(hex) {
        colorInput.value = hex;
        if (colorBar) colorBar.style.background = hex;
        swatches.forEach(s => {
            s.classList.toggle('active', s.dataset.color === hex);
        });
    }

    colorInput.addEventListener('input', () => applyColor(colorInput.value));

    swatches.forEach(s => {
        s.addEventListener('click', () => applyColor(s.dataset.color));
    });

    // ── localStorage pre-fill ─────────────────────────────────────────────

    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');

    if (saved && saved.nickname) {
        lastLoginEl.style.display = 'flex';
        lastLoginInfo.textContent = saved.nickname;
        if (llDot) llDot.style.background = saved.color || '#4f6ef7';
    }

    btnUseLast.addEventListener('click', () => {
        if (!saved) return;
        nicknameInput.value = saved.nickname;
        applyColor(saved.color || '#4f6ef7');
        nicknameInput.focus();
    });

    // ── Save on submit ────────────────────────────────────────────────────

    document.getElementById('login-form').addEventListener('submit', () => {
        localStorage.setItem(LS_KEY, JSON.stringify({
            nickname: nicknameInput.value.trim(),
            color: colorInput.value
        }));
    });

    // ── Init ──────────────────────────────────────────────────────────────

    applyColor(colorInput.value);
})();
