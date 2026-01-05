#!/usr/bin/env python3
"""
Test script for Mars Mission 3D Visualization
"""

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
        
        # Test mission phases
        phases = []
        for t in [0, 100, 300, 700, 900]:
            phase, mission_number, time_in_mission = engine.get_mission_phase(t)
            phases.append((t, phase.value))
            print(f"  ✅ Phase at day {t}: {phase.value} (mission={mission_number}, t={time_in_mission:.1f})")
        
        # Test spacecraft position
        ship_pos = engine.get_spacecraft_position(100)
        print(f"  ✅ Spacecraft position at day 100: {ship_pos}")
        
        # Test mission info
        info = engine.get_mission_info(500)
        print(f"  ✅ Mission info at day 500: phase={info['phase']}")
        
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
        print(f"  ✅ WebSockets version: {websockets.__version__}")
        
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
