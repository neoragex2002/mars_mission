// controls.js - User interaction and controls

const UI_PREFS_KEY = 'mm_ui_prefs_v1';

function loadUiPrefs() {
    try {
        const raw = localStorage.getItem(UI_PREFS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        return {};
    }
}

function saveUiPrefs(prefs) {
    try {
        localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
        return;
    }
}

function setOverlayFlag(overlay, className, enabled) {
    if (!overlay) return;
    if (enabled) {
        overlay.classList.add(className);
    } else {
        overlay.classList.remove(className);
    }
}

function setupControls() {
    setupPlaybackControls();
    setupTimeSpeedControl();
    setupTimelineControl();
    setupViewModeControl();
    setupInfoModal();
    setupUiToggles();
}

function setupPlaybackControls() {
    const startBtn = document.getElementById('btn-start');
    const pauseBtn = document.getElementById('btn-pause');
    const stopBtn = document.getElementById('btn-stop');
    
    startBtn.addEventListener('click', () => {
        if (app) {
            app.startSimulation();
        }
    });
    
    pauseBtn.addEventListener('click', () => {
        if (app) {
            app.pauseSimulation();
        }
    });
    
    stopBtn.addEventListener('click', () => {
        if (app) {
            app.stopSimulation();
        }
    });
}

function setupTimeSpeedControl() {
    const timeSpeedSlider = document.getElementById('time-speed');
    const speedValue = document.getElementById('speed-value');
    
    timeSpeedSlider.addEventListener('input', (event) => {
        const speed = parseFloat(event.target.value);
        speedValue.textContent = speed.toFixed(1);
        
        if (app) {
            app.setTimeSpeed(speed);
        }
    });
}

function setupTimelineControl() {
    const timeline = document.getElementById('timeline');

    let pendingTime = null;
    let sendTimer = null;

    const flush = () => {
        sendTimer = null;
        const time = pendingTime;
        pendingTime = null;
        if (app && typeof time === 'number' && Number.isFinite(time)) {
            app.setTime(time);
        }
    };

    timeline.addEventListener('input', (event) => {
        pendingTime = parseFloat(event.target.value);
        if (sendTimer === null) {
            sendTimer = setTimeout(flush, 80);
        }
    });

    timeline.addEventListener('change', (event) => {
        pendingTime = parseFloat(event.target.value);
        if (sendTimer !== null) {
            clearTimeout(sendTimer);
            sendTimer = null;
        }
        flush();
    });
}

function setupViewModeControl() {
    const viewModeSelect = document.getElementById('view-mode');
    
    viewModeSelect.addEventListener('change', (event) => {
        const mode = event.target.value;
        
        if (app) {
            app.setViewMode(mode);
        }
    });
}

function applyUiPrefs(prefs) {
    const overlay = document.getElementById('ui-overlay');
    const hudBtn = document.getElementById('btn-hud');
    const leftBtn = document.getElementById('btn-left-panel');
    const rightBtn = document.getElementById('btn-right-panel');

    const cinema = !!prefs.cinema;
    const leftCollapsed = !!prefs.leftCollapsed;
    const rightCollapsed = !!prefs.rightCollapsed;

    setOverlayFlag(overlay, 'is-cinema', cinema);
    setOverlayFlag(overlay, 'is-left-collapsed', leftCollapsed);
    setOverlayFlag(overlay, 'is-right-collapsed', rightCollapsed);

    if (hudBtn) hudBtn.setAttribute('aria-pressed', cinema ? 'true' : 'false');

    if (leftBtn) {
        leftBtn.setAttribute('aria-expanded', leftCollapsed ? 'false' : 'true');
        leftBtn.textContent = leftCollapsed ? '▸' : '◂';
    }

    if (rightBtn) {
        rightBtn.setAttribute('aria-expanded', rightCollapsed ? 'false' : 'true');
        rightBtn.textContent = rightCollapsed ? '◂' : '▸';
    }

    return { cinema, leftCollapsed, rightCollapsed };
}

function setupUiToggles() {
    const overlay = document.getElementById('ui-overlay');
    const hudBtn = document.getElementById('btn-hud');
    const leftBtn = document.getElementById('btn-left-panel');
    const rightBtn = document.getElementById('btn-right-panel');

    if (!overlay) return;

    let prefs = loadUiPrefs();
    prefs = applyUiPrefs(prefs);

    if (hudBtn) {
        hudBtn.addEventListener('click', () => {
            prefs.cinema = !prefs.cinema;
            applyUiPrefs(prefs);
            saveUiPrefs(prefs);
        });
    }

    if (leftBtn) {
        leftBtn.addEventListener('click', () => {
            prefs.leftCollapsed = !prefs.leftCollapsed;
            applyUiPrefs(prefs);
            saveUiPrefs(prefs);
        });
    }

    if (rightBtn) {
        rightBtn.addEventListener('click', () => {
            prefs.rightCollapsed = !prefs.rightCollapsed;
            applyUiPrefs(prefs);
            saveUiPrefs(prefs);
        });
    }
}

function setupInfoModal() {
    const infoBtn = document.getElementById('info-btn');
    const modal = document.getElementById('info-modal');
    const closeBtn = modal ? modal.querySelector('.close') : null;

    if (!infoBtn || !modal || !closeBtn) {
        return;
    }

    const openModal = () => {
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        closeBtn.focus();
    };

    const closeModal = () => {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        infoBtn.focus();
    };

    infoBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);

    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });
}

// Keyboard shortcuts
function setupKeyboardControls() {
    document.addEventListener('keydown', (event) => {
        switch (event.key) {
            case ' ':
                event.preventDefault();
                // Start if stopped; otherwise toggle pause/resume.
                if (app && typeof app.togglePlayPause === 'function') {
                    app.togglePlayPause();
                } else if (app) {
                    // Fallback for older app versions
                    app.pauseSimulation();
                }
                break;
            
            case 'ArrowLeft':
                // Step backward
                if (app) {
                    const timeline = document.getElementById('timeline');
                    const currentTime = timeline ? parseFloat(timeline.value) : 0;
                    app.setTime(Math.max(0, currentTime - 1));
                }
                break;
            
            case 'ArrowRight':
                // Step forward
                if (app) {
                    const timeline = document.getElementById('timeline');
                    const currentTime = timeline ? parseFloat(timeline.value) : 0;
                    const maxTime = timeline ? parseFloat(timeline.max) : 0;
                    app.setTime(Math.min(maxTime, currentTime + 1));
                }
                break;
            
            case 'r':
            case 'R':
                // Reset simulation
                if (app) {
                    app.stopSimulation();
                }
                break;
            
            case 'h':
            case 'H':
                event.preventDefault();
                {
                    const hudBtn = document.getElementById('btn-hud');
                    if (hudBtn) hudBtn.click();
                }
                break;

            case 'f':
            case 'F':
                event.preventDefault();
                // Toggle full screen
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen();
                } else {
                    document.exitFullscreen();
                }
                break;

            case 'c':
            case 'C':
                event.preventDefault();
                // Cycle camera / view mode
                if (app) {
                    const viewModeSelect = document.getElementById('view-mode');
                    const modes = ['free', 'earth', 'mars', 'spacecraft', 'top'];
                    const currentMode =
                        (viewModeSelect && viewModeSelect.value) ? viewModeSelect.value : 'free';
                    const currentIndex = modes.indexOf(currentMode);
                    const nextMode = modes[(currentIndex + 1 + modes.length) % modes.length];

                    if (viewModeSelect) {
                        viewModeSelect.value = nextMode;
                    }
                    app.setViewMode(nextMode);
                }
                break;
        }
    });
}

// Setup controls when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    setupControls();
    setupKeyboardControls();
});
