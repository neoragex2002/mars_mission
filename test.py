#!/usr/bin/env python3
"""
Test script for Mars Mission 3D Visualization
"""

import math
import sys
sys.path.insert(0, 'backend')

def test_orbit_engine():
    print("Testing Orbit Engine...")
    try:
        from orbit_engine import OrbitEngine
        engine = OrbitEngine()
        
        # Test planet positions
        earth_pos = engine.get_planet_position('earth', 0)
        mars_pos = engine.get_planet_position('mars', 0)
        
        print(f"  ✅ Earth position at t=0: {earth_pos}")
        print(f"  ✅ Mars position at t=0: {mars_pos}")
        
        # Test mission phases (relative to the dynamically generated schedule).
        schedule = engine._get_schedule_for_time(0.0)
        t_start = schedule.t_start
        t_launch = schedule.leg_outbound.t_depart
        t_arr_mars = schedule.leg_outbound.t_arrive
        t_dep_mars = schedule.leg_inbound.t_depart
        t_arr_earth = schedule.leg_inbound.t_arrive

        if not (t_start <= t_launch <= t_arr_mars <= t_dep_mars <= t_arr_earth):
            raise AssertionError(
                "Mission schedule timestamps are not monotone: "
                f"t_start={t_start:.3f}, t_launch={t_launch:.3f}, t_arr_mars={t_arr_mars:.3f}, "
                f"t_dep_mars={t_dep_mars:.3f}, t_arr_earth={t_arr_earth:.3f}"
            )

        sample_times = [
            t_start,
            max(t_start, t_launch - 1.0),
            t_launch + 1.0,
            t_arr_mars + 1.0,
            t_dep_mars + 1.0,
            max(t_start, t_arr_earth - 1.0),
        ]
        for t in sample_times:
            phase, mission_number, time_in_mission = engine.get_mission_phase(t)
            print(f"  ✅ Phase at day {t:.1f}: {phase.value} (mission={mission_number}, t={time_in_mission:.1f})")
        
        # Test spacecraft position
        ship_pos = engine.get_spacecraft_position(100)
        print(f"  ✅ Spacecraft position at day 100: {ship_pos}")
        
        # Test mission info
        info = engine.get_mission_info(500)
        print(f"  ✅ Mission info at day 500: phase={info['phase']}")

        def dist3(a, b):
            dx = a[0] - b[0]
            dy = a[1] - b[1]
            dz = a[2] - b[2]
            return math.sqrt(dx * dx + dy * dy + dz * dz)

        # Regression: Lambert legs (a) reach endpoints and (b) stay prograde in x-y.
        for leg in [schedule.leg_outbound, schedule.leg_inbound]:
            end_pos, _end_vel = engine._propagate_two_body(leg.pos_depart, leg.vel_depart, leg.duration)
            miss = dist3(end_pos, leg.pos_arrive)
            if miss > 5e-4:
                raise AssertionError(f"Lambert propagation misses endpoint by {miss:.3e} AU")

            samples = 25
            times = [leg.t_depart + leg.duration * (i / samples) for i in range(samples + 1)]

            angles = []
            for t in times:
                x, y, _z = engine._get_transfer_position(leg, t)
                theta = math.atan2(y, x)
                angles.append(theta)

            unwrapped = [angles[0]]
            for a in angles[1:]:
                prev = unwrapped[-1]
                while a - prev <= -math.pi:
                    a += 2 * math.pi
                while a - prev > math.pi:
                    a -= 2 * math.pi
                unwrapped.append(a)

            min_delta = min(unwrapped[i + 1] - unwrapped[i] for i in range(len(unwrapped) - 1))
            if min_delta < -1e-6:
                raise AssertionError(f"Transfer leg is not prograde: min dθ={min_delta:.3e} rad")


        r_excl_earth = engine.earth_visual_r + engine.safety_margin + engine.spacecraft_collision_r
        r_excl_mars = engine.mars_visual_r + engine.safety_margin + engine.spacecraft_collision_r


        def assert_leg_clearance(leg, dt_days):
            dt_days = float(max(1e-6, dt_days))
            t0 = float(leg.t_depart)
            t1 = float(leg.t_arrive)
            if t1 <= t0:
                return

            steps = int(math.ceil((t1 - t0) / dt_days))
            steps = max(1, steps)
            for i in range(steps + 1):
                t = t0 + (t1 - t0) * (i / steps)
                ship = engine._get_transfer_position(leg, t)
                earth = engine.get_planet_position('earth', t)
                mars = engine.get_planet_position('mars', t)

                de = dist3(ship, earth)
                dm = dist3(ship, mars)

                if de < r_excl_earth:
                    raise AssertionError(
                        f"Collision with Earth during transfer at t={t:.3f}: d={de:.4f} < r_excl={r_excl_earth:.4f}"
                    )
                if dm < r_excl_mars:
                    raise AssertionError(
                        f"Collision with Mars during transfer at t={t:.3f}: d={dm:.4f} < r_excl={r_excl_mars:.4f}"
                    )

        dt_clear = getattr(engine, 'clearance_check_dt_days', 0.25)
        assert_leg_clearance(schedule.leg_outbound, dt_clear)
        assert_leg_clearance(schedule.leg_inbound, dt_clear)

        print("  ✅ Transfer legs are prograde and collision-free (Lambert)")

        
        print("✅ Orbit Engine tests passed!\n")
        return True
        
    except Exception as e:
        print(f"❌ Orbit Engine test failed: {e}\n")
        import traceback
        traceback.print_exc()
        return False

def test_dependencies():
    print("Testing Dependencies...")
    try:
        import numpy
        print(f"  ✅ NumPy version: {numpy.__version__}")
        
        import fastapi
        print(f"  ✅ FastAPI version: {fastapi.__version__}")
        
        import uvicorn
        print(f"  ✅ Uvicorn version: {uvicorn.__version__}")
        
        import websockets
        ws_version = getattr(websockets, "__version__", None)
        if not ws_version:
            try:
                from importlib.metadata import version as pkg_version
                ws_version = pkg_version("websockets")
            except Exception:
                ws_version = "unknown"
        print(f"  ✅ WebSockets version: {ws_version}")
        
        print("✅ All dependencies installed!\n")
        return True
        
    except ImportError as e:
        print(f"❌ Missing dependency: {e}\n")
        print("Please run: pip install -r requirements.txt\n")
        return False

def test_fastapi_import():
    print("Testing FastAPI Application...")
    try:
        from main import app
        print(f"  ✅ FastAPI app created successfully")
        print(f"  ✅ App title: {app.title}")
        
        # Check routes
        routes = [route.path for route in app.routes]
        print(f"  ✅ Available routes: {len(routes)}")
        
        print("✅ FastAPI tests passed!\n")
        return True
        
    except Exception as e:
        print(f"❌ FastAPI test failed: {e}\n")
        import traceback
        traceback.print_exc()
        return False

def test_frontend_files():
    print("Testing Frontend Files...")
    import os
    
    required_files = [
        'frontend/index.html',
        'frontend/styles.css',
        'frontend/main.js',
        'frontend/orbit.js',
        'frontend/spacecraft.js',
        'frontend/controls.js',
        'frontend/ui.js'
    ]
    
    all_exist = True
    for file_path in required_files:
        if os.path.exists(file_path):
            print(f"  ✅ {file_path}")
        else:
            print(f"  ❌ {file_path} - NOT FOUND")
            all_exist = False
    
    if all_exist:
        print("✅ All frontend files present!\n")
        return True
    else:
        print("❌ Some frontend files missing!\n")
        return False

def main():
    print("=" * 60)
    print("Mars Mission 3D Visualization - Test Suite")
    print("=" * 60)
    print()
    
    results = []
    
    # Run tests
    results.append(("Dependencies", test_dependencies()))
    results.append(("Frontend Files", test_frontend_files()))
    results.append(("Orbit Engine", test_orbit_engine()))
    results.append(("FastAPI", test_fastapi_import()))
    
    # Summary
    print("=" * 60)
    print("Test Summary")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{test_name:.<40} {status}")
    
    print()
    print(f"Total: {passed}/{total} tests passed")
    print()
    
    if passed == total:
        print("🎉 All tests passed! System is ready to run.")
        print()
        print("To start the application, run:")
        print("  ./start.sh")
        print("  or")
        print("  cd backend && python3 main.py")
    else:
        print("⚠️  Some tests failed. Please fix the issues above.")
    
    print("=" * 60)
    
    return 0 if passed == total else 1

if __name__ == "__main__":
    sys.exit(main())
