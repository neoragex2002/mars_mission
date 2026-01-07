// controls.js - User interaction and controls

function setupControls() {
    console.log('Setting up controls...');
    
    setupPlaybackControls();
    setupTimeSpeedControl();
    setupTimelineControl();
    setupViewModeControl();
    setupInfoModal();
    
    console.log('Controls setup complete');
}

function setupPlaybackControls() {
    const startBtn = document.getElementById('btn-start');
    const pauseBtn = document.getElementById('btn-pause');
    const stopBtn = document.getElementById('btn-stop');
    
    startBtn.addEventListener('click', () => {
        if (app) {
            app.startSimulation();
            console.log('Start simulation');
        }
    });
    
    pauseBtn.addEventListener('click', () => {
        if (app) {
            app.pauseSimulation();
            console.log('Pause simulation');
        }
    });
    
    stopBtn.addEventListener('click', () => {
        if (app) {
            app.stopSimulation();
            console.log('Stop simulation');
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
                    const currentTime = parseFloat(document.getElementById('timeline').value);
                    app.setTime(Math.max(0, currentTime - 1));
                }
                break;
            
            case 'ArrowRight':
                // Step forward
                if (app) {
                    const currentTime = parseFloat(document.getElementById('timeline').value);
                    const maxTime = parseFloat(document.getElementById('timeline').max);
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
