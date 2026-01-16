// spacecraft.js - Enhanced Mars spacecraft with detailed 3D model

class Spacecraft {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.thrusterParticles = null;
        this.thrusterActive = false;
        this.trail = null;
        this.trailPoints = [];
        this.maxTrailPoints = 1000;
        this.lastPosition = null;
        this.solarPanelLeft = null;
        this.solarPanelRight = null;
        this.antenna = null;
        this.landingLegs = [];
        this.sharedTextures = {};
        
        this.createSpacecraft();
    }

    getMicroNormalMap() {
        if (this.sharedTextures.microNormal) {
            return this.sharedTextures.microNormal;
        }

        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        const image = context.createImageData(size, size);

        const amplitude = 0.16;
        for (let i = 0; i < size * size; i++) {
            const nx = (Math.random() - 0.5) * amplitude;
            const ny = (Math.random() - 0.5) * amplitude;

            image.data[i * 4] = Math.floor((0.5 + nx) * 255);
            image.data[i * 4 + 1] = Math.floor((0.5 + ny) * 255);
            image.data[i * 4 + 2] = 255;
            image.data[i * 4 + 3] = 255;
        }

        context.putImageData(image, 0, 0);

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(6, 6);
        texture.needsUpdate = true;

        this.sharedTextures.microNormal = texture;
        return texture;
    }

    createSpacecraft() {
        this.mesh = new THREE.Group();
        this.mesh.scale.set(0.54, 0.54, 0.54);
        
        this.createBody();
        this.createCockpit();
        this.createSolarPanels();
        this.createThrusterNozzles();
        this.createAntenna();
        this.createLandingLegs();
        this.createThrusterEffect();
        this.createDetails();
        
        this.scene.add(this.mesh);
    }

    createBody() {
        const bodyGeometry = new THREE.CylinderGeometry(0.012, 0.015, 0.05, 16);
        const microNormal = this.getMicroNormalMap();
        
        const bodyMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xb9c1c8,
            metalness: 1.0,
            roughness: 0.35,
            clearcoat: 0.25,
            clearcoatRoughness: 0.28,
            envMapIntensity: 1.4,
            normalMap: microNormal,
            normalScale: new THREE.Vector2(0.12, 0.12)
        });
        
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.rotation.x = Math.PI / 2;
        body.castShadow = true;
        body.receiveShadow = true;
        this.mesh.add(body);
        
        for (let i = 0; i < 3; i++) {
            const panelGeometry = new THREE.BoxGeometry(0.025, 0.0015, 0.012);
            const panelMaterial = new THREE.MeshPhysicalMaterial({
                color: 0x8e99aa,
                metalness: 0.9,
                roughness: 0.45,
                clearcoat: 0.15,
                clearcoatRoughness: 0.35,
                envMapIntensity: 1.2,
                normalMap: microNormal,
                normalScale: new THREE.Vector2(0.08, 0.08)
            });
            const panel = new THREE.Mesh(panelGeometry, panelMaterial);
            panel.position.y = -0.008 + i * 0.008;
            panel.position.z = (i - 1) * 0.012;
            panel.rotation.x = Math.PI / 2;
            this.mesh.add(panel);
        }
    }

    createCockpit() {
        const cockpitGeometry = new THREE.ConeGeometry(0.012, 0.02, 16);
        
        const cockpitMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x0a1630,
            metalness: 0.0,
            roughness: 0.06,
            clearcoat: 1.0,
            clearcoatRoughness: 0.08,
            transparent: true,
            opacity: 0.35,
            envMapIntensity: 1.0
        });
        
        const cockpit = new THREE.Mesh(cockpitGeometry, cockpitMaterial);
        cockpit.rotation.x = -Math.PI / 2;
        cockpit.position.z = 0.035;
        cockpit.castShadow = true;
        this.mesh.add(cockpit);
        
        const windowGeometry = new THREE.CircleGeometry(0.006, 16);
        const windowMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x05070f,
            metalness: 0.0,
            roughness: 0.08,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05,
            transparent: true,
            opacity: 0.6,
            envMapIntensity: 1.0
        });
        
        const window = new THREE.Mesh(windowGeometry, windowMaterial);
        window.position.z = 0.046;
        this.mesh.add(window);
    }

    createSolarPanels() {
        const panelGroupLeft = new THREE.Group();
        
        const frameGeometry = new THREE.BoxGeometry(0.06, 0.002, 0.02);
        const frameMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x2a2a2a,
            metalness: 1.0,
            roughness: 0.6,
            envMapIntensity: 1.0,
            normalMap: this.getMicroNormalMap(),
            normalScale: new THREE.Vector2(0.06, 0.06)
        });
        
        const frameLeft = new THREE.Mesh(frameGeometry, frameMaterial);
        panelGroupLeft.add(frameLeft);
        
        const cellGeometry = new THREE.BoxGeometry(0.028, 0.001, 0.018);
        const cellMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a237e,
            metalness: 0.0,
            roughness: 0.35,
            emissive: 0x0a0a52,
            emissiveIntensity: 0.1
        });
        
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 3; col++) {
                const cell = new THREE.Mesh(cellGeometry, cellMaterial);
                cell.position.x = (col - 1) * 0.009;
                cell.position.y = (row - 0.5) * 0.008;
                cell.position.z = 0.001;
                panelGroupLeft.add(cell);
            }
        }
        
        panelGroupLeft.position.x = -0.04;
        panelGroupLeft.position.z = -0.015;
        this.solarPanelLeft = panelGroupLeft;
        this.mesh.add(panelGroupLeft);

        const panelGroupRight = new THREE.Group();
        const frameRight = new THREE.Mesh(frameGeometry, frameMaterial);
        panelGroupRight.add(frameRight);

        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 3; col++) {
                const cell = new THREE.Mesh(cellGeometry, cellMaterial);
                cell.position.x = (col - 1) * 0.009;
                cell.position.y = (row - 0.5) * 0.008;
                cell.position.z = 0.001;
                panelGroupRight.add(cell);
            }
        }

        panelGroupRight.position.x = 0.04;
        panelGroupRight.position.z = -0.015;
        this.solarPanelRight = panelGroupRight;
        this.mesh.add(panelGroupRight);
    }

    createThrusterNozzles() {
        const nozzleGeometry = new THREE.CylinderGeometry(0.006, 0.01, 0.015, 12);
        const nozzleMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x3a3a3a,
            metalness: 1.0,
            roughness: 0.65,
            envMapIntensity: 1.0,
            normalMap: this.getMicroNormalMap(),
            normalScale: new THREE.Vector2(0.08, 0.08)
        });
        
        const nozzle = new THREE.Mesh(nozzleGeometry, nozzleMaterial);
        nozzle.rotation.x = Math.PI / 2;
        nozzle.position.z = -0.025;
        nozzle.castShadow = true;
        this.mesh.add(nozzle);
        
        const glowGeometry = new THREE.TorusGeometry(0.006, 0.002, 16, 32);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: 0xffaa00,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });
        
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.rotation.x = Math.PI / 2;
        glow.position.z = -0.025;
        glow.rotation.y = Math.PI / 2;
        this.mesh.add(glow);
        
        const sideNozzleGeometry = new THREE.CylinderGeometry(0.003, 0.005, 0.01, 8);
        for (let i = 0; i < 4; i++) {
            const sideNozzle = new THREE.Mesh(sideNozzleGeometry, nozzleMaterial);
            const angle = (i / 4) * Math.PI * 2;
            sideNozzle.position.x = Math.cos(angle) * 0.018;
            sideNozzle.position.y = Math.sin(angle) * 0.018;
            sideNozzle.rotation.x = Math.PI / 2;
            sideNozzle.rotation.y = angle;
            this.mesh.add(sideNozzle);
        }
    }

    createAntenna() {
        const dishGeometry = new THREE.CylinderGeometry(0.008, 0.008, 0.002, 16);
        const dishMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xd0d0d0,
            metalness: 1.0,
            roughness: 0.25,
            clearcoat: 0.15,
            clearcoatRoughness: 0.25,
            envMapIntensity: 1.2,
            normalMap: this.getMicroNormalMap(),
            normalScale: new THREE.Vector2(0.06, 0.06)
        });
        
        const dish = new THREE.Mesh(dishGeometry, dishMaterial);
        dish.rotation.x = Math.PI / 2;
        dish.position.set(0.008, 0.01, 0.02);
        this.mesh.add(dish);
        
        const mastGeometry = new THREE.CylinderGeometry(0.001, 0.001, 0.03, 8);
        const mastMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x7f7f7f,
            metalness: 1.0,
            roughness: 0.45,
            envMapIntensity: 1.1,
            normalMap: this.getMicroNormalMap(),
            normalScale: new THREE.Vector2(0.06, 0.06)
        });
        
        const mast = new THREE.Mesh(mastGeometry, mastMaterial);
        mast.position.set(0.008, 0.01, 0.025);
        this.mesh.add(mast);
        
        this.antenna = dish;
    }

    createLandingLegs() {
        const legGeometry = new THREE.BoxGeometry(0.002, 0.02, 0.002);
        const legMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x686868,
            metalness: 1.0,
            roughness: 0.55,
            envMapIntensity: 1.1,
            normalMap: this.getMicroNormalMap(),
            normalScale: new THREE.Vector2(0.06, 0.06)
        });
        
        for (let i = 0; i < 4; i++) {
            const leg = new THREE.Mesh(legGeometry, legMaterial);
            const angle = (i / 4) * Math.PI * 2;
            leg.position.x = Math.cos(angle) * 0.01;
            leg.position.y = Math.sin(angle) * 0.01;
            leg.position.z = -0.02;
            
            const footGeometry = new THREE.BoxGeometry(0.008, 0.002, 0.008);
            const foot = new THREE.Mesh(footGeometry, legMaterial);
            foot.position.z = -0.01;
            leg.add(foot);
            
            this.landingLegs.push(leg);
            this.mesh.add(leg);
        }
    }

    createDetails() {
        const lightGeometry = new THREE.SphereGeometry(0.002, 8, 8);
        
        const redLightMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.9
        });
        const redLight = new THREE.Mesh(lightGeometry, redLightMaterial);
        redLight.position.set(-0.018, 0.015, 0);
        redLight.userData.isLight = true;
        redLight.userData.color = 0xff0000;
        this.mesh.add(redLight);
        
        const greenLightMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.9
        });
        const greenLight = new THREE.Mesh(lightGeometry, greenLightMaterial);
        greenLight.position.set(0.018, 0.015, 0);
        greenLight.userData.isLight = true;
        greenLight.userData.color = 0x00ff00;
        this.mesh.add(greenLight);
        
        const whiteLightMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.95
        });
        const whiteLight = new THREE.Mesh(lightGeometry, whiteLightMaterial);
        whiteLight.position.set(0, 0.03, 0);
        whiteLight.userData.isLight = true;
        whiteLight.userData.color = 0xffffff;
        this.mesh.add(whiteLight);
    }

    createThrusterEffect() {
        const particleCount = 150;
        const geometry = new THREE.BufferGeometry();
        
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const velocities = [];
        
        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = -0.04;
            
            const t = Math.random();
            colors[i * 3] = 1.0;
            colors[i * 3 + 1] = 0.3 + t * 0.4;
            colors[i * 3 + 2] = 0.0;
            
            sizes[i] = Math.random() * 0.008 + 0.002;
            
            const maxLife = Math.random() * 0.4 + 0.3;
            velocities.push({
                velocity: {
                    x: (Math.random() - 0.5) * 0.003,
                    y: (Math.random() - 0.5) * 0.003,
                    z: -Math.random() * 0.004 - 0.002
                },
                life: Math.random() * maxLife,
                maxLife,
                size: sizes[i]
            });
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        const material = new THREE.PointsMaterial({
            size: 0.01,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
            depthWrite: false
        });
        
        this.thrusterParticles = new THREE.Points(geometry, material);
        this.thrusterParticles.visible = false;
        this.particleData = velocities;
        this.mesh.add(this.thrusterParticles);
    }

    updateThrusterEffect() {
        if (!this.thrusterParticles.visible) return;
        
        const positions = this.thrusterParticles.geometry.attributes.position.array;
        const colors = this.thrusterParticles.geometry.attributes.color.array;
        const sizes = this.thrusterParticles.geometry.attributes.size.array;
        
        for (let i = 0; i < this.particleData.length; i++) {
            const particle = this.particleData[i];
            
            positions[i * 3] += particle.velocity.x;
            positions[i * 3 + 1] += particle.velocity.y;
            positions[i * 3 + 2] += particle.velocity.z;
            
            particle.velocity.x += (Math.random() - 0.5) * 0.0001;
            particle.velocity.y += (Math.random() - 0.5) * 0.0001;
            
            particle.life -= 0.025;
            
            if (particle.life <= 0) {
                positions[i * 3] = 0;
                positions[i * 3 + 1] = 0;
                positions[i * 3 + 2] = -0.04;

                particle.velocity.x = (Math.random() - 0.5) * 0.003;
                particle.velocity.y = (Math.random() - 0.5) * 0.003;
                particle.velocity.z = -Math.random() * 0.004 - 0.002;
                particle.life = particle.maxLife;
            }
            
            const lifeRatio = particle.life / particle.maxLife;
            colors[i * 3] = 1.0;
            colors[i * 3 + 1] = 0.3 * lifeRatio;
            colors[i * 3 + 2] = 0.0;
            
            sizes[i] = particle.size * lifeRatio;
        }
        
        this.thrusterParticles.geometry.attributes.position.needsUpdate = true;
        this.thrusterParticles.geometry.attributes.color.needsUpdate = true;
        this.thrusterParticles.geometry.attributes.size.needsUpdate = true;
    }

    updateNavigationLights(time) {
        const strobeOn = Math.sin(time * 0.02) > 0;
        const strobeLight = this.mesh.children.find(c => 
            c.userData && c.userData.isLight && c.userData.color === 0xffffff
        );
        if (strobeLight) {
            strobeLight.visible = strobeOn;
        }
        
        if (this.antenna) {
            this.antenna.rotation.z = Math.sin(time * 0.005) * 0.1;
        }
        
        if (this.solarPanelLeft && this.solarPanelRight) {
            const panelAngle = Math.sin(time * 0.003) * 0.05;
            this.solarPanelLeft.rotation.z = panelAngle;
            this.solarPanelRight.rotation.z = -panelAngle;
        }
    }

    setThrusterActive(active) {
        this.thrusterActive = active;
        this.thrusterParticles.visible = active;
        
        this.landingLegs.forEach((leg, index) => {
            const targetRotation = active ? Math.PI / 6 : 0;
            leg.rotation.x = targetRotation;
        });
    }

    updatePosition(position, lookAt, time = 0) {
        this.mesh.position.set(position[0], position[1], position[2]);
        
        if (lookAt) {
            this.mesh.lookAt(lookAt[0], lookAt[1], lookAt[2]);
        }
        
        this.updateNavigationLights(time);
        
        if (this.lastPosition) {
            const distance = Math.sqrt(
                Math.pow(position[0] - this.lastPosition[0], 2) +
                Math.pow(position[1] - this.lastPosition[1], 2) +
                Math.pow(position[2] - this.lastPosition[2], 2)
            );
            
            if (distance > 0.001) {
                this.addTrailPoint(position);
            }
        }
        
        this.lastPosition = position;
    }

    addTrailPoint(position) {
        this.trailPoints.push(position[0], position[1], position[2]);
        
        if (this.trailPoints.length > this.maxTrailPoints * 3) {
            this.trailPoints.splice(0, 3);
        }
        
        this.updateTrail();
    }

    createTrail() {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(this.maxTrailPoints * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setDrawRange(0, 0);
        
        const material = new THREE.LineBasicMaterial({
            color: 0x00ffaa,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending
        });
        
        this.trail = new THREE.Line(geometry, material);
        this.trail.frustumCulled = false;
        this.scene.add(this.trail);
    }

    updateTrail() {
        if (!this.trail) {
            this.createTrail();
        }
        
        const positions = this.trail.geometry.attributes.position.array;
        const floatsToCopy = Math.min(this.trailPoints.length, positions.length);

        for (let i = 0; i < floatsToCopy; i++) {
            positions[i] = this.trailPoints[i];
        }
        
        this.trail.geometry.attributes.position.needsUpdate = true;
        this.trail.geometry.setDrawRange(0, floatsToCopy / 3);
    }

    clearTrail() {
        this.trailPoints = [];
        if (this.trail) {
            const positions = this.trail.geometry.attributes.position.array;
            positions.fill(0);
            this.trail.geometry.attributes.position.needsUpdate = true;
            this.trail.geometry.setDrawRange(0, 0);
        }
    }

    setTrailColor(color) {
        if (this.trail) {
            this.trail.material.color.setHex(color);
        }
    }

    setTrailVisibility(visible) {
        if (this.trail) {
            this.trail.visible = visible;
        }
    }

    update(time = 0) {
        this.updateThrusterEffect();
        this.updateNavigationLights(time);
    }

    setVisible(visible) {
        this.mesh.visible = visible;
    }

    setPosition(x, y, z) {
        this.mesh.position.set(x, y, z);
    }

    getPosition() {
        return this.mesh.position;
    }

    getMesh() {
        return this.mesh;
    }

    setRotation(x, y, z) {
        this.mesh.rotation.set(x, y, z);
    }

    setScale(x, y, z) {
        this.mesh.scale.set(x, y, z);
    }
}

// Expose as a global for non-module script usage (main.js expects `Spacecraft`).
if (typeof window !== 'undefined') {
    window.Spacecraft = Spacecraft;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Spacecraft;
}
