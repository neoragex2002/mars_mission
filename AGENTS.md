# AGENTS.md — Mars Mission 3D (Agent Instructions)

This repository is a lightweight Python + static-frontend project:
- Backend: FastAPI + WebSocket (`backend/main.py`) serving `/` + `/static/*`.
- Frontend: plain JS + Three.js loaded via CDN (`frontend/index.html`).
- Tests: a single self-check script (`test.py`), not pytest.

There are no Cursor rules (`.cursor/rules/` / `.cursorrules`) and no Copilot instructions (`.github/copilot-instructions.md`) in this repo at the time of writing.

---

## Quick Commands

### Python setup
Prefer a virtualenv; `start.sh` may install dependencies globally if you don’t.

- Create venv:
  - `python3 -m venv .venv`
  - `source .venv/bin/activate`
- Install deps:
  - `pip install -r requirements.txt`

Dependencies are pinned in `requirements.txt` (FastAPI, Uvicorn, NumPy, websockets).

### Run (dev)
The canonical way to run is via the provided start script:
- `./start.sh`
  - Auto-finds a free port (starts from `8712`)
  - Runs backend as `cd backend && python3 main.py --port <PORT>`

Manual run (matches import expectations in `backend/main.py`):
- `cd backend && python3 main.py --port 8712`

### “Build”
There is no build step:
- Frontend is served as static files (no bundler / no npm toolchain).
- Three.js and examples are loaded from CDN in `frontend/index.html`.

### Tests
Run the full self-check suite:
- `python3 test.py`

Run a single test function (recommended pattern; avoids `test` module name collisions):
- `python3 -c "import runpy; ns=runpy.run_path('test.py'); ns['test_dependencies']()"`
- `python3 -c "import runpy; ns=runpy.run_path('test.py'); ns['test_frontend_files']()"`
- `python3 -c "import runpy; ns=runpy.run_path('test.py'); ns['test_orbit_engine']()"`
- `python3 -c "import runpy; ns=runpy.run_path('test.py'); ns['test_fastapi_import']()"`

### Lint / format
No linter/formatter is configured (no `pyproject.toml`, `ruff`, `black`, `flake8`, `eslint`, `prettier`, etc.).

Optional “cheap sanity” checks (only if needed while debugging):
- Python syntax check:
  - `python3 -m py_compile backend/main.py backend/orbit_engine.py test.py`
- Python bytecode compile:
  - `python3 -m compileall backend`

If you want to add a formatter/linter, ask first (project is intentionally minimal).

---

## Repo Structure (high level)

- `backend/main.py`
  - FastAPI app
  - REST endpoints under `/api/*`
  - WebSocket endpoint at `/ws`
  - Serves `frontend/index.html` at `/`
  - Serves static assets at `/static/*`
- `backend/orbit_engine.py`
  - Orbital mechanics + dynamic mission scheduling
  - Primary backend “model” used by API + WS
- `frontend/index.html`
  - HTML + loads JS/CSS
  - Script order matters (globals)
- `frontend/main.js`
  - Main Three.js scene + render loop
  - WebSocket client and message handlers
- `frontend/ui.js`, `frontend/controls.js`, `frontend/orbit.js`, `frontend/spacecraft.js`
  - UI updates, DOM bindings, orbit rendering helpers, spacecraft model
- `test.py`
  - Minimal runtime checks + regression checks for transfer legs

---

## Code Style Guidelines (match existing code)

### General
- Prefer small, focused changes. Avoid refactors when fixing a bug.
- Don’t introduce new dependencies (Python or JS) unless explicitly requested.
- Keep API/WS payloads stable (snake_case keys; see “Data contracts”).

### Python (backend + scripts)
Observed patterns come primarily from `backend/main.py` and `backend/orbit_engine.py`.

**Formatting & structure**
- 4-space indentation.
- Keep imports at top of file.
- Prefer readable, explicit code over clever one-liners.

**Naming**
- `snake_case` for functions, variables, and dict keys.
- `PascalCase` for classes, Enums, and dataclasses.
- Leading underscore for internal helpers/methods (e.g., `_compute_transfer_leg`).
- Constants in standalone scripts may use `ALL_CAPS` (see `mission.py`).

**Typing**
- Use type hints for public APIs and non-trivial helpers.
- Prefer built-in generics (`list[...]`, `dict[...]`) where the code already does.
- Dataclasses are used for structured records:
  - mutable dataclasses for elements
  - `@dataclass(frozen=True)` for immutable schedule/leg records

**Error handling**
- For invalid input/state in core logic:
  - raise `ValueError` for bad arguments (e.g., unknown planet)
  - raise `RuntimeError` for “should not happen” states
- For FastAPI endpoints, the current style is “simple dict error”:
  - return `{"error": "..."}` (no explicit `HTTPException` used today)
- For WebSocket broadcast:
  - keep `try/except` tight and only around network send/remove
  - remove dead connections on send failure
  - don’t swallow exceptions silently unless the failure is expected and handled

**Async/FastAPI**
- Endpoints are `async def`.
- Background simulation loop is started via `lifespan` (`asyncio.create_task`).
- Keep the simulation loop lightweight; it runs continuously.

### JavaScript (frontend)
This frontend is intentionally “no build tools” and uses globals.

**Formatting**
- 4-space indentation.
- Semicolons are used.
- Prefer single quotes for strings; use template literals for interpolation.

**Module pattern / imports**
- No ES module imports/exports in runtime code.
- Dependencies are loaded in `frontend/index.html` (CDN scripts + `/static/*.js`).
- Cross-file access uses globals (e.g., `THREE`, `app`, `Spacecraft`).
- Some files include a CommonJS export guard (`module.exports`) for non-browser usage.

**Naming**
- `camelCase` for functions, variables, and methods.
- `PascalCase` for classes (`MarsMissionApp`, `OrbitManager`, `Spacecraft`).

**Error handling**
- Prefer guard clauses and `console.warn` / `console.error` over throwing.
- Use `try/catch` only for narrow “may fail” blocks (e.g., texture/bitmap operations).
- When a dependency is expected to be global (e.g., `Spacecraft`), log a clear error if missing.

**DOM / UI updates**
- UI code uses `document.getElementById(...)` and updates `textContent`.
- Keep UI update functions tolerant of missing/partial payload fields.

---

## Data Contracts & Invariants (don’t break)

### Coordinate mapping (backend → Three.js)
Backend positions are `(x, y, z)` in AU.
Frontend rendering maps backend coordinates into Three.js space as:
- `(x, y, z)_backend → (x, z, -y)_three`

UI panels typically display backend raw coordinates; rendering uses the mapped coordinates.

### WebSocket messages
- Messages include a `type` field:
  - `init` (initial payload)
  - `update` (streamed updates)
  - `snapshot` (explicit snapshot request)
  - `ack` (command acknowledgement)
- Commands sent from frontend use lower-case strings:
  - `start`, `pause`, `stop`, `set_speed`, `set_time`, `get_snapshot`

### Mission phase values
Backend uses `snake_case` phase strings (Enum values):
- `pre_launch`
- `transfer_to_mars`
- `on_mars`
- `transfer_to_earth`

Frontend maps these strings to user-facing labels and CSS classes (underscores → hyphens).

---

## Safe Change Checklist (for agents)

Before editing:
- Identify whether the change touches:
  - backend data fields (WS/REST payload)
  - coordinate mapping
  - script load order assumptions

After editing:
- Run `python3 test.py` (or the single relevant test function).
- If you changed WS/REST payloads, sanity-check the frontend update path:
  - `frontend/main.js` message handlers
  - `frontend/ui.js` data panel updates

---

## Notes / Gotchas

- `backend/main.py` imports `orbit_engine` as a local module (`from orbit_engine import OrbitEngine`).
  - This expects the current working directory to be `backend/` when running.
  - Use `cd backend && python3 main.py ...` (or `./start.sh`).
- `start.sh` will install deps if `fastapi` import fails; in development, prefer using a venv.
- No Node toolchain is required; don’t add `package.json` unless the project direction changes.
