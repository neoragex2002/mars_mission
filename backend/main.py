from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from contextlib import asynccontextmanager, suppress
import asyncio
from pathlib import Path
from orbit_engine import OrbitEngine

# Lifespan context manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    simulation_task = asyncio.create_task(simulation_loop())
    try:
        yield
    finally:
        # Shutdown
        simulation_task.cancel()
        with suppress(asyncio.CancelledError):
            await simulation_task

app = FastAPI(title="Mars Mission 3D Visualization", lifespan=lifespan)

# Mount static files
frontend_dir = Path(__file__).parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")

# Initialize orbit engine
orbit_engine = OrbitEngine()

# Store active WebSocket connections
active_connections: list[WebSocket] = []

class SimulationState:
    def __init__(self):
        self.is_running = False
        self.current_time = 0.0
        self.time_speed = 0.5  # days per frame (slower for better visibility)
        self.paused = False

sim_state = SimulationState()

def build_simulation_update(message_type: str = "update") -> dict:
    mission_info = orbit_engine.get_mission_info(sim_state.current_time)
    mission_info["simulation"] = {
        "time_speed": sim_state.time_speed,
        "paused": sim_state.paused,
        "is_running": sim_state.is_running,
    }
    mission_info["type"] = message_type
    return mission_info

@app.get("/")
async def get_root():
    """Serve the main HTML file"""
    html_file = frontend_dir / "index.html"
    return HTMLResponse(content=html_file.read_text())

@app.get("/api/mission/info")
async def get_mission_info():
    """Get model/timeline metadata for UI initialization."""
    schedule_preview = orbit_engine.get_schedule_preview(3)
    timeline_horizon_end = (
        schedule_preview[-1]["t_arrival_earth"] if schedule_preview else orbit_engine.get_mission_info(0.0)["timeline_horizon_end"]
    )

    return {
        "model": "dynamic_hohmann_v1",
        "mu_sun": orbit_engine.mu_sun,
        "schedule_preview": schedule_preview,
        "timeline_horizon_end": timeline_horizon_end,
    }

@app.get("/api/planets")
async def get_planets():
    """Get planet orbital parameters"""
    return {
        "earth": {
            "a": orbit_engine.planets["earth"].a,
            "e": orbit_engine.planets["earth"].e,
            "i": orbit_engine.planets["earth"].i,
            "period": orbit_engine.planets["earth"].period
        },
        "mars": {
            "a": orbit_engine.planets["mars"].a,
            "e": orbit_engine.planets["mars"].e,
            "i": orbit_engine.planets["mars"].i,
            "period": orbit_engine.planets["mars"].period
        }
    }

@app.get("/api/orbit/{planet}")
async def get_orbit_points(planet: str, num_points: int = 360):
    """Get orbit points for a planet"""
    if planet not in ["earth", "mars"]:
        return {"error": "Invalid planet"}

    if num_points < 4 or num_points > 5000:
        return {"error": "Invalid num_points (expected 4..5000)"}

    points = orbit_engine.generate_orbit_points(planet, num_points)
    return {"planet": planet, "points": points}

@app.get("/api/state")
async def get_simulation_state():
    """Get current simulation state"""
    return {
        "is_running": sim_state.is_running,
        "current_time": sim_state.current_time,
        "time_speed": sim_state.time_speed,
        "paused": sim_state.paused
    }

@app.get("/api/snapshot")
async def get_snapshot():
    """Get current snapshot of the system"""
    return orbit_engine.get_mission_info(sim_state.current_time)

async def broadcast_to_clients(message: dict):
    """Send message to all connected clients"""

    async def _send_one(connection: WebSocket):
        try:
            await asyncio.wait_for(connection.send_json(message), timeout=0.5)
            return None
        except Exception:
            return connection

    connections = list(active_connections)
    if not connections:
        return

    results = await asyncio.gather(*(_send_one(connection) for connection in connections))
    for dead in results:
        if dead is None:
            continue
        try:
            active_connections.remove(dead)
        except ValueError:
            pass

async def simulation_loop():
    """Main simulation loop"""
    try:
        while True:
            if sim_state.is_running and not sim_state.paused:
                sim_state.current_time += sim_state.time_speed
                await broadcast_to_clients(build_simulation_update("update"))

            await asyncio.sleep(0.05)  # 20 FPS
    except asyncio.CancelledError:
        return

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates"""
    await websocket.accept()
    active_connections.append(websocket)
    
    try:
        # Send initial state
        initial_data = {
            "type": "init",
            "mission_info": await get_mission_info(),
            "planets": await get_planets(),
            "simulation_state": await get_simulation_state(),
            "earth_orbit": await get_orbit_points("earth", 360),
            "mars_orbit": await get_orbit_points("mars", 360),
            "current_snapshot": await get_snapshot()
        }
        await websocket.send_json(initial_data)
        
        # Listen for client commands
        while True:
            try:
                data = await websocket.receive_json()
            except WebSocketDisconnect:
                raise
            except Exception:
                await websocket.send_json({
                    "type": "error",
                    "command": None,
                    "message": "Invalid JSON message",
                })
                continue

            command = data.get("command")

            handled = True
            ok = True

            if command == "start":
                sim_state.is_running = True
                sim_state.paused = False
                await broadcast_to_clients(build_simulation_update("update"))
            
            elif command == "pause":
                sim_state.paused = not sim_state.paused
                await broadcast_to_clients(build_simulation_update("update"))
            
            elif command == "stop":
                sim_state.is_running = False
                sim_state.paused = False
                sim_state.current_time = 0.0
                await broadcast_to_clients(build_simulation_update("update"))
            
            elif command == "set_speed":
                raw_speed = data.get("speed", 1.0)
                try:
                    speed = float(raw_speed)
                except (TypeError, ValueError):
                    ok = False
                    await websocket.send_json({
                        "type": "error",
                        "command": command,
                        "message": f"Invalid speed: {raw_speed!r}",
                    })
                else:
                    sim_state.time_speed = max(0.0, speed)
                    await broadcast_to_clients(build_simulation_update("update"))
            
            elif command == "set_time":
                raw_time = data.get("time", 0.0)
                try:
                    t = float(raw_time)
                except (TypeError, ValueError):
                    ok = False
                    await websocket.send_json({
                        "type": "error",
                        "command": command,
                        "message": f"Invalid time: {raw_time!r}",
                    })
                else:
                    sim_state.current_time = max(0.0, t)
                    await broadcast_to_clients(build_simulation_update("update"))
            
            elif command == "get_snapshot":
                snapshot = await get_snapshot()
                await websocket.send_json({"type": "snapshot", "data": snapshot})

            else:
                handled = False
                ok = False
                await websocket.send_json({
                    "type": "error",
                    "command": command,
                    "message": "Unknown command",
                })

            if handled and ok:
                await websocket.send_json({"type": "ack", "command": command})
            
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in active_connections:
            active_connections.remove(websocket)

# Mount static files
# app.mount("/static", StaticFiles(directory="frontend"), name="static")

if __name__ == "__main__":
    import uvicorn
    import sys
    
    # Check for port argument
    port = 8712
    if len(sys.argv) > 1 and sys.argv[1] == "--port":
        if len(sys.argv) > 2:
            try:
                port = int(sys.argv[2])
            except ValueError:
                print(f"Invalid port: {sys.argv[2]!r}; using default {port}")
        else:
            print(f"Missing port after --port; using default {port}")
    
    uvicorn.run(app, host="0.0.0.0", port=port)
