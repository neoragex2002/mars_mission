// ui.js - UI updates and data display

function updateMissionInfo(missionInfo) {
    console.log('Updating mission info:', missionInfo);
}

function updateDataPanel(data) {
    // Update phase display
    const phaseDisplay = document.getElementById('phase-badge');
    const phase = data.phase || '';
    const cssPhase = phase.replace(/_/g, '-');
    const missionNumber =
        typeof data.mission_number === 'number' ? data.mission_number + 1 : undefined;
    const phaseText = formatPhase(phase);
    
    if (phaseDisplay) {
        phaseDisplay.textContent =
            missionNumber !== undefined ? `Mission ${missionNumber}: ${phaseText}` : phaseText;
        phaseDisplay.className = `phase-badge ${cssPhase}`;
    }
    
    // Update positions
    if (data.earth_position) {
        document.getElementById('earth-pos').textContent = 
            formatPosition(data.earth_position);
    }
    
    if (data.mars_position) {
        document.getElementById('mars-pos').textContent = 
            formatPosition(data.mars_position);
    }
    
    if (data.spacecraft_position) {
        document.getElementById('ship-pos').textContent = 
            formatPosition(data.spacecraft_position);
    }
    
    // Update distances
    if (data.earth_mars_distance !== undefined) {
        document.getElementById('earth-mars-dist').textContent = 
            data.earth_mars_distance.toFixed(3) + ' AU';
    }
    
    // Update progress
    if (data.progress !== undefined) {
        const progressBar = document.getElementById('mission-progress');
        progressBar.style.width = (data.progress * 100) + '%';
    }
    
    // Update velocities
    if (data.earth_velocity) {
        document.getElementById('earth-vel').textContent = 
            calculateSpeed(data.earth_velocity).toFixed(4);
    }
    
    if (data.mars_velocity) {
        document.getElementById('mars-vel').textContent = 
            calculateSpeed(data.mars_velocity).toFixed(4);
    }
}

function updateTimeline(time, horizonEnd) {
    const timeline = document.getElementById('timeline');
    const totalDays = document.getElementById('total-days');

    if (typeof horizonEnd === 'number' && Number.isFinite(horizonEnd)) {
        const currentMax = parseFloat(timeline.max || '0');
        const nextMax = Math.ceil(Math.max(currentMax, horizonEnd));
        if (nextMax !== currentMax) {
            timeline.max = String(nextMax);
            totalDays.textContent = Math.round(nextMax);
        }
    }

    document.getElementById('current-day').textContent = Math.round(time);
    timeline.value = time;
}

function formatPhase(phase) {
    const phaseMap = {
        'pre_launch': 'Pre-Launch',
        'transfer_to_mars': 'Earth → Mars Transfer',
        'on_mars': 'On Mars Surface',
        'transfer_to_earth': 'Mars → Earth Transfer'
    };
    
    return phaseMap[phase] || phase;
}

function formatPosition(position) {
    if (!position || position.length < 3) return '(0.00, 0.00, 0.00)';
    
    return `(${position[0].toFixed(3)}, ${position[1].toFixed(3)}, ${position[2].toFixed(3)})`;
}

function calculateSpeed(velocity) {
    if (!velocity || velocity.length < 3) return 0;
    
    return Math.sqrt(
        velocity[0] * velocity[0] +
        velocity[1] * velocity[1] +
        velocity[2] * velocity[2]
    );
}

function formatTime(days) {
    const years = Math.floor(days / 365);
    const remainingDays = Math.floor(days % 365);
    
    if (years > 0) {
        return `${years}y ${remainingDays}d`;
    } else {
        return `${remainingDays}d`;
    }
}

function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;

    document.body.appendChild(toast);

    const hide = () => {
        toast.classList.add('is-hiding');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    setTimeout(hide, duration);
}

function showLoadingIndicator() {
    if (document.getElementById('loading-indicator')) {
        return;
    }

    const indicator = document.createElement('div');
    indicator.id = 'loading-indicator';
    indicator.innerHTML = `
        <div class="spinner"></div>
        <p>Initializing Command Center...</p>
    `;
    indicator.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(5, 10, 20, 0.9);
        backdrop-filter: blur(10px);
        color: white;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 5000;
        text-align: center;
    `;

    document.body.appendChild(indicator);
}

function hideLoadingIndicator() {
    const indicator = document.getElementById('loading-indicator');
    if (indicator) {
        indicator.remove();
    }
}

function updateButtonState(buttonId, state) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    
    button.disabled = state === 'disabled';
    
    if (state === 'active') {
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
    } else if (state === 'disabled') {
        button.style.opacity = '0.5';
        button.style.cursor = 'not-allowed';
    }
}

function updateStatusIndicator(message, status) {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        const textElement = statusElement.querySelector('.status-text');
        if (textElement) textElement.textContent = message;
        statusElement.className = 'status-indicator ' + status;
    }
}

function logEvent(event) {
    console.log(`[${new Date().toISOString()}] ${event}`);
}

// Animation frame for smooth UI updates
let lastUpdateTime = 0;

function animateUI(timestamp) {
    if (timestamp - lastUpdateTime > 16) { // ~60 FPS
        // Update any animated UI elements here
        lastUpdateTime = timestamp;
    }
    
    requestAnimationFrame(animateUI);
}

// Start UI animation loop
requestAnimationFrame(animateUI);

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        updateDataPanel,
        updateTimeline,
        formatPhase,
        formatPosition,
        calculateSpeed,
        formatTime,
        showToast,
        showLoadingIndicator,
        hideLoadingIndicator,
        updateButtonState,
        updateStatusIndicator,
        logEvent
    };
}
