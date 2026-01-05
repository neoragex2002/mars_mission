// ui.js - UI updates and data display

function updateMissionInfo(missionInfo) {
    console.log('Updating mission info:', missionInfo);
}

function updateDataPanel(data) {
    // Update phase display
    const phaseDisplay = document.getElementById('phase-display');
    const phase = data.phase || '';
    const cssPhase = phase.replace(/_/g, '-');
    phaseDisplay.textContent = formatPhase(phase);
    phaseDisplay.className = `phase-badge ${cssPhase}`;
    
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

function updateTimeline(time) {
    document.getElementById('current-day').textContent = 
        Math.round(time);
    document.getElementById('timeline').value = time;
}

function formatPhase(phase) {
    const phaseMap = {
        'pre_launch': 'Pre-Launch',
        'transfer_to_mars': 'Earth → Mars Transfer',
        'on_mars': 'On Mars Surface',
        'transfer_to_earth': 'Mars → Earth Transfer',
        'complete': 'Mission Complete'
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
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(74, 144, 217, 0.9);
        color: white;
        padding: 15px 25px;
        border-radius: 5px;
        z-index: 3000;
        animation: fadeIn 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, duration);
}

function showLoadingIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'loading-indicator';
    indicator.innerHTML = `
        <div class="spinner"></div>
        <p>Loading simulation...</p>
    `;
    indicator.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 30px;
        border-radius: 10px;
        z-index: 3000;
        text-align: center;
        border: 1px solid rgba(255, 255, 255, 0.2);
    `;
    
    // Add spinner CSS
    const style = document.createElement('style');
    style.textContent = `
        .spinner {
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-top: 3px solid #4a90d9;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 15px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        
        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
        }
    `;
    document.head.appendChild(style);
    
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
        statusElement.textContent = '● ' + message;
        statusElement.className = 'status ' + status;
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
