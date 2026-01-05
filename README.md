# Mars Mission 3D Visualization 🚀

An interactive 3D visualization of a round-trip Mars mission using real orbital mechanics, built with FastAPI (backend) and Three.js (frontend).

## Quick Reference

```bash
# Install dependencies
pip install -r requirements.txt

# Run tests
python3 test.py

# Start server
./start.sh

# Open browser
http://localhost:8712  # or the port printed by start.sh
```

## Features Overview

## Features

- **Real Orbital Mechanics**: Uses JPL planetary orbital data including eccentricity, inclination, and orbital periods
- **Interactive 3D Visualization**: Rotate, zoom, and pan the view using mouse controls
- **Real-time Simulation**: WebSocket-based real-time data streaming
- **Mission Phases**: 
  - Pre-launch
  - Earth to Mars transfer (Hohmann transfer orbit)
  - Mars surface operations
  - Mars to Earth return transfer
  - Mission complete
- **Sci-fi Visual Effects**: 
  - Bloom post-processing for glowing sun and engine effects
  - Particle systems for thruster effects
  - Starfield background
  - Orbital trails
- **Educational Features**: 
  - Real-time mission data display
  - Phase indicators
  - Distance and velocity information
  - Timeline controls

## Project Structure

```
mars_mission_3d/
├── backend/
│   ├── main.py              # FastAPI server with WebSocket
│   └── orbit_engine.py      # Orbital mechanics calculations
├── frontend/
│   ├── index.html           # Main HTML file
│   ├── styles.css           # Styling
│   ├── main.js             # Three.js scene setup
│   ├── orbit.js            # Orbit rendering
│   ├── spacecraft.js       # Spacecraft model and effects
│   ├── controls.js         # User interaction
│   └── ui.js               # UI updates
└── requirements.txt        # Python dependencies
```

## Installation

1. **Clone or navigate to the project directory:**
   ```bash
   cd /mnt/c/dev/vibe/mars_mission
   ```

2. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **No frontend dependencies needed** - All libraries are loaded via CDN

## Usage

### Quick Start

1. **Run the test suite** (recommended first):
   ```bash
   python3 test.py
   ```

2. **Start the application**:
   ```bash
   ./start.sh
   ```
   
   Or manually:
   ```bash
   cd backend
   python3 main.py
   ```

3. **Open your browser**:
   ```
   http://localhost:8712  (or the port printed by start.sh)
   ```

### Starting the Server

From the project root directory:

```bash
./start.sh
```

Or using uvicorn directly:

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

With custom port:

```bash
./start.sh  # Automatically finds available port
# or
cd backend
python3 main.py --port 9000
```

### Accessing the Application

1. Open your web browser
2. Navigate to: `http://localhost:8712` (or the port shown in the console)
3. The 3D visualization will load automatically
4. Click "Start" to begin the mission simulation

### Controls

**3D Navigation:**
- Left Mouse: Rotate view
- Right Mouse: Pan view
- Scroll: Zoom in/out

**Simulation Controls:**
- **Start**: Begin the mission simulation
- **Pause**: Pause/resume the simulation
- **Stop**: Reset to initial state
- **Time Speed**: Adjust simulation speed (0.1x to 10x)
- **Timeline**: Drag to scrub through the mission
- **View Mode**: Change camera perspective (Free, Follow Earth, Follow Mars, Follow Spacecraft, Top View)

**Keyboard Shortcuts:**
- Space: Pause/Resume
- Left/Right Arrows: Step backward/forward one day
- R: Reset simulation
- F: Toggle fullscreen

## API Endpoints

### REST API

- `GET /` - API status
- `GET /api/mission/info` - Mission information
- `GET /api/planets` - Planetary orbital parameters
- `GET /api/orbit/{planet}` - Generate orbit points
- `GET /api/state` - Current simulation state
- `GET /api/snapshot` - Current system snapshot

### WebSocket

- `WS /ws` - Real-time simulation data stream

## Technical Details

### Orbital Mechanics

- **Earth**:
  - Semi-major axis: 1.000 AU
  - Eccentricity: 0.0167
  - Inclination: 0.000°
  - Period: 365.25 days

- **Mars**:
  - Semi-major axis: 1.524 AU
  - Eccentricity: 0.0934
  - Inclination: 1.850°
  - Period: 687.0 days

### Mission Timeline

- **Earth-Mars Transfer**: ~259 days (Hohmann transfer)
- **Mars Wait Time**: ~454 days (waiting for optimal return window)
- **Mars-Earth Transfer**: ~259 days (Hohmann transfer)
- **Total Mission**: ~972 days

### Technology Stack

**Backend:**
- FastAPI - Modern Python web framework
- WebSocket - Real-time communication
- NumPy - Orbital calculations

**Frontend:**
- Three.js - 3D rendering
- EffectComposer - Post-processing effects
- Bloom - Glow effects

## Customization

### Adjusting Mission Parameters

Edit `backend/orbit_engine.py`:

```python
self.transfer_time_earth_mars = 259  # days
self.transfer_time_mars_earth = 259  # days
self.mars_wait_time = 454  # days
```

### Changing Visual Effects

Edit `frontend/main.js` bloom parameters:

```javascript
const bloomPass = new THREE.UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.5,  // strength
    0.4,  // radius
    0.85  // threshold
);
```

### Adding More Planets

1. Add orbital parameters in `backend/orbit_engine.py`
2. Create planet mesh in `frontend/main.js`
3. Update UI and controls as needed

## Development

### Project Phases

✅ Phase 1: Basic architecture
✅ Phase 2: Orbital mechanics
✅ Phase 3: 3D rendering
✅ Phase 4: Visual effects
✅ Phase 5: Interactive controls
✅ Phase 6: UI interface
🔄 Phase 7: Testing and optimization

### Future Enhancements

- Add more planets (Mercury, Venus, Jupiter)
- Include moon orbits
- Add asteroid belt visualization
- Implement realistic textures
- Add more transfer orbit options
- Mission planning tools
- Export simulation data

## Troubleshooting

### WebSocket Connection Failed

- Ensure the backend server is running
- Check that the selected port is not in use (default: 8712)
- Verify firewall settings

### 3D Scene Not Loading

- Check browser console for errors
- Ensure JavaScript is enabled
- Try a different browser (Chrome, Firefox recommended)

### Performance Issues

- Reduce time speed
- Lower bloom intensity
- Close other browser tabs
- Disable trails

## License

This project is for educational purposes.

## Credits

- Orbital data from NASA JPL
- Three.js by three.js contributors
- Built with FastAPI and modern web technologies

## Contact

For issues or suggestions, please open an issue in the project repository.
