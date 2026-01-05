// orbit.js - Orbit rendering and management

class OrbitManager {
    constructor(scene) {
        this.scene = scene;
        this.orbits = {};
        this.trails = {};
        this.maxTrailPoints = 1000;
    }

    createOrbit(planetName, orbitData, color) {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        
        orbitData.points.forEach(point => {
            positions.push(point[0], point[1], point[2]);
        });
        
        geometry.setAttribute('position', 
            new THREE.Float32BufferAttribute(positions, 3));
        
        const material = new THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.6,
            linewidth: 1
        });
        
        const orbitLine = new THREE.Line(geometry, material);
        orbitLine.frustumCulled = false;
        this.scene.add(orbitLine);
        this.orbits[planetName] = orbitLine;
        
        return orbitLine;
    }

    updateOrbit(planetName, newOrbitData) {
        if (this.orbits[planetName]) {
            this.scene.remove(this.orbits[planetName]);
        }
        
        // Get color from existing orbit or default
        const existingColor = this.orbits[planetName]?.material.color;
        const color = existingColor || 
            (planetName === 'earth' ? 0x4a90d9 : 0xe74c3c);
        
        return this.createOrbit(planetName, newOrbitData, color);
    }

    createTrail(objectName, color, maxPoints = 1000) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxPoints * 3);
        
        geometry.setAttribute('position', 
            new THREE.BufferAttribute(positions, 3));
        geometry.setDrawRange(0, 0);
        
        const material = new THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.8,
            linewidth: 2
        });
        
        const trail = new THREE.Line(geometry, material);
        trail.frustumCulled = false;
        this.scene.add(trail);
        
        this.trails[objectName] = {
            line: trail,
            points: [],
            maxPoints: maxPoints
        };
        
        return trail;
    }

    updateTrail(objectName, position) {
        if (!this.trails[objectName]) {
            return;
        }
        
        const trail = this.trails[objectName];
        
        // Add new position
        trail.points.push({
            x: position[0],
            y: position[1],
            z: position[2]
        });
        
        // Limit number of points
        if (trail.points.length > trail.maxPoints) {
            trail.points.shift();
        }
        
        // Update geometry
        const positions = trail.line.geometry.attributes.position.array;
        
        for (let i = 0; i < trail.points.length; i++) {
            positions[i * 3] = trail.points[i].x;
            positions[i * 3 + 1] = trail.points[i].y;
            positions[i * 3 + 2] = trail.points[i].z;
        }
        
        trail.line.geometry.attributes.position.needsUpdate = true;
        trail.line.geometry.setDrawRange(0, trail.points.length);
    }

    clearTrail(objectName) {
        if (this.trails[objectName]) {
            this.trails[objectName].points = [];
            const positions = this.trails[objectName].line.geometry.attributes.position.array;
            positions.fill(0);
            this.trails[objectName].line.geometry.attributes.position.needsUpdate = true;
            this.trails[objectName].line.geometry.setDrawRange(0, 0);
        }
    }

    removeOrbit(planetName) {
        if (this.orbits[planetName]) {
            this.scene.remove(this.orbits[planetName]);
            delete this.orbits[planetName];
        }
    }

    removeTrail(objectName) {
        if (this.trails[objectName]) {
            this.scene.remove(this.trails[objectName].line);
            delete this.trails[objectName];
        }
    }

    updateTrailColor(objectName, color) {
        if (this.trails[objectName]) {
            this.trails[objectName].line.material.color.setHex(color);
        }
    }

    updateOrbitColor(planetName, color) {
        if (this.orbits[planetName]) {
            this.orbits[planetName].material.color.setHex(color);
        }
    }

    setOrbitVisibility(planetName, visible) {
        if (this.orbits[planetName]) {
            this.orbits[planetName].visible = visible;
        }
    }

    setTrailVisibility(objectName, visible) {
        if (this.trails[objectName]) {
            this.trails[objectName].line.visible = visible;
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OrbitManager;
}
