// ui.js - UI updates and data display

let lastMissionSchedule = null;
let lastPhaseLabel = '';
let lastMissionNumber = null;
let lastTimelineMax = null;
let timelineTooltipHideTimer = null;
let lastTimelineMarkersKey = null;

function updateMissionInfo(missionInfo) {
    // Reserved for future richer mission metadata rendering.
    // For now, wire mission schedule preview (if present) into the timeline marker system.
    if (!missionInfo || typeof missionInfo !== 'object') return;

    const schedule = missionInfo.mission_schedule;
    if (schedule && typeof schedule === 'object') {
        setMissionSchedule(schedule);
        return;
    }

    const preview = missionInfo.schedule_preview;
    if (Array.isArray(preview) && preview.length > 0) {
        const entry = preview[0];
        if (entry && typeof entry === 'object') {
            setMissionSchedule(entry);
        }
    }
}

function setMissionSchedule(schedule) {
    if (schedule && typeof schedule === 'object') {
        lastMissionSchedule = schedule;
        lastTimelineMarkersKey = null;
        renderTimelineMarkers();
    }
}

function getFiniteNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return null;
}

function getTimelineMaxDays() {
    if (lastTimelineMax !== null) return lastTimelineMax;
    const timeline = document.getElementById('timeline');
    if (!timeline) return null;
    const max = parseFloat(timeline.max || '0');
    return Number.isFinite(max) ? max : null;
}

function getPhaseLabelForTime(timeDays) {
    const t = getFiniteNumber(timeDays);
    if (t === null) return '';

    const s = lastMissionSchedule;
    if (!s || typeof s !== 'object') return lastPhaseLabel || '';

    const tStart = getFiniteNumber(s.t_start);
    const tLaunch = getFiniteNumber(s.t_launch_earth);
    const tArrMars = getFiniteNumber(s.t_arrival_mars);
    const tDepMars = getFiniteNumber(s.t_depart_mars);
    const tArrEarth = getFiniteNumber(s.t_arrival_earth);

    if ([tStart, tLaunch, tArrMars, tDepMars, tArrEarth].some(v => v === null)) {
        return lastPhaseLabel || '';
    }

    if (t < tLaunch) return 'Earth Orbit Stay';
    if (t < tArrMars) return 'Earth → Mars Transfer';
    if (t < tDepMars) return 'Mars Orbit Stay';
    if (t <= tArrEarth) return 'Mars → Earth Transfer';

    return '';
}

function renderTimelineMarkers() {
    const container = document.getElementById('timeline-markers');
    if (!container) return;

    const max = getTimelineMaxDays();
    if (max === null || max <= 0) return;

    const s = lastMissionSchedule;
    if (!s || typeof s !== 'object') return;

    const times = [
        getFiniteNumber(s.t_launch_earth),
        getFiniteNumber(s.t_arrival_mars),
        getFiniteNumber(s.t_depart_mars),
        getFiniteNumber(s.t_arrival_earth),
    ];

    if (times.some(v => v === null)) {
        return;
    }

    const key = `${max}|${times.map(v => v.toFixed(6)).join('|')}`;
    if (lastTimelineMarkersKey === key) {
        return;
    }
    lastTimelineMarkersKey = key;

    container.textContent = '';

    const markers = [
        { key: 'Launch', time: times[0] },
        { key: 'Mars Arrival', time: times[1] },
        { key: 'Mars Departure', time: times[2] },
        { key: 'Earth Return', time: times[3] },
    ];

    const timeline = document.getElementById('timeline');

    for (const marker of markers) {
        if (marker.time < 0 || marker.time > max) continue;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'timeline-marker';
        button.style.left = `${(marker.time / max) * 100}%`;
        button.setAttribute('aria-label', marker.key);

        button.addEventListener('click', () => {
            const t = marker.time;
            if (timeline) {
                timeline.value = String(t);
                const currentDay = document.getElementById('current-day');
                if (currentDay) currentDay.textContent = String(Math.round(t));
            }
            if (typeof app !== 'undefined' && app) {
                app.setTime(t);
            }
        });

        container.appendChild(button);
    }
}

function updateDataPanel(data) {
    // Update phase display
    const phaseDisplay = document.getElementById('phase-badge');
    const phase = data.phase || '';
    const cssPhase = getPhaseCssClass(phase);
    const missionNumber =
        typeof data.mission_number === 'number' ? data.mission_number + 1 : undefined;
    const phaseText = formatPhase(phase);

    lastPhaseLabel = phaseText;
    lastMissionNumber = missionNumber !== undefined ? missionNumber : null;

    if (data.mission_schedule && typeof data.mission_schedule === 'object') {
        setMissionSchedule(data.mission_schedule);
    }
    
    if (phaseDisplay) {
        phaseDisplay.textContent =
            missionNumber !== undefined ? `Mission ${missionNumber}: ${phaseText}` : phaseText;
        phaseDisplay.className = `phase-badge ${cssPhase}`;
    }
    
    // Update positions
    if (data.earth_position) {
        const earthPos = document.getElementById('earth-pos');
        if (earthPos) {
            earthPos.textContent = formatPosition(data.earth_position);
        }
    }

    if (data.mars_position) {
        const marsPos = document.getElementById('mars-pos');
        if (marsPos) {
            marsPos.textContent = formatPosition(data.mars_position);
        }
    }

    if (data.spacecraft_position) {
        const shipPos = document.getElementById('ship-pos');
        if (shipPos) {
            shipPos.textContent = formatPosition(data.spacecraft_position);
        }
    }

    // Update distances
    if (data.earth_mars_distance !== undefined) {
        const earthMarsDist = document.getElementById('earth-mars-dist');
        if (earthMarsDist) {
            earthMarsDist.textContent = data.earth_mars_distance.toFixed(3) + ' AU';
        }
    }

    // Update progress
    if (data.progress !== undefined) {
        const progressBar = document.getElementById('mission-progress');
        if (progressBar) {
            progressBar.style.width = (data.progress * 100) + '%';
        }
    }

    // Update velocities
    if (data.earth_velocity) {
        const earthVel = document.getElementById('earth-vel');
        if (earthVel) {
            earthVel.textContent = calculateSpeed(data.earth_velocity).toFixed(4);
        }
    }

    if (data.mars_velocity) {
        const marsVel = document.getElementById('mars-vel');
        if (marsVel) {
            marsVel.textContent = calculateSpeed(data.mars_velocity).toFixed(4);
        }
    }
}

function updateTimeline(time, horizonEnd) {
    const timeline = document.getElementById('timeline');
    const totalDays = document.getElementById('total-days');

    if (timeline && totalDays && typeof horizonEnd === 'number' && Number.isFinite(horizonEnd)) {
        const currentMax = parseFloat(timeline.max || '0');
        const nextMax = Math.ceil(Math.max(currentMax, horizonEnd));
        if (nextMax !== currentMax) {
            timeline.max = String(nextMax);
            totalDays.textContent = Math.round(nextMax);
        }
    }

    const nextMax = timeline ? parseFloat(timeline.max || '0') : NaN;
    if (Number.isFinite(nextMax)) {
        if (lastTimelineMax !== nextMax) {
            lastTimelineMax = nextMax;
            lastTimelineMarkersKey = null;
        }
    } else {
        lastTimelineMax = null;
        lastTimelineMarkersKey = null;
    }

    renderTimelineMarkers();

    const currentDay = document.getElementById('current-day');
    if (currentDay) {
        currentDay.textContent = Math.round(time);
    }
    if (timeline) {
        timeline.value = time;
    }
}

function getPhaseCssClass(phase) {
    const normalized = typeof phase === 'string' ? phase : '';
    if (normalized === 'earth_orbit_stay') return 'pre-launch';
    if (normalized === 'mars_orbit_stay') return 'on-mars';
    return normalized.replace(/_/g, '-');
}

function formatPhase(phase) {
    const phaseMap = {
        'earth_orbit_stay': 'Earth Orbit Stay',
        'transfer_to_mars': 'Earth → Mars Transfer',
        'mars_orbit_stay': 'Mars Orbit Stay',
        'transfer_to_earth': 'Mars → Earth Transfer',
        'pre_launch': 'Pre-Launch',
        'on_mars': 'On Mars Surface'
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

function showTimelineTooltip(timeDays) {
    const timeline = document.getElementById('timeline');
    const tooltip = document.getElementById('timeline-tooltip');
    if (!timeline || !tooltip) return;

    const max = getTimelineMaxDays();
    const t = getFiniteNumber(timeDays);
    if (max === null || max <= 0 || t === null) return;

    const percent = Math.min(1, Math.max(0, t / max));
    tooltip.style.left = `${percent * 100}%`;

    const label = getPhaseLabelForTime(t);
    tooltip.textContent = label ? `${Math.round(t)}d • ${label}` : `${Math.round(t)}d`;

    tooltip.classList.add('is-visible');
    tooltip.setAttribute('aria-hidden', 'false');

    if (timelineTooltipHideTimer) {
        clearTimeout(timelineTooltipHideTimer);
        timelineTooltipHideTimer = null;
    }
    timelineTooltipHideTimer = setTimeout(() => {
        tooltip.classList.remove('is-visible');
        tooltip.setAttribute('aria-hidden', 'true');
    }, 900);
}

function setupTimelinePreview() {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;

    timeline.addEventListener('input', (event) => {
        const value = parseFloat(event.target.value);
        showTimelineTooltip(value);
    });

    timeline.addEventListener('pointerdown', () => {
        showTimelineTooltip(parseFloat(timeline.value));
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupTimelinePreview);
} else {
    setupTimelinePreview();
}

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
