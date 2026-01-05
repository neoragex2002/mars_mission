// Main.js - Main application entry point

class MarsMissionApp {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.composer = null;

        this.objects = {
            sun: null,
            earth: null,
            mars: null,
            spacecraft: null,
            earthOrbit: null,
            marsOrbit: null,
            stars: null
        };

        this.ws = null;
        this.connected = false;
        this.missionData = null;
        this.simulationRunning = false;
        this.viewMode = 'free';
        this.animationId = null;

        this.textureLoader = new THREE.TextureLoader();

        this.lastPhase = null;
        this.lastSpacecraftPosition = null;

        this.init();
    }

    init() {
        console.log('Initializing Mars Mission 3D Visualization...');
        
        this.setupScene();
        this.setupCamera();
        this.setupRenderer();
        this.setupControls();
        this.setupPostProcessing();
        this.setupLighting();
        this.setupStars();
        this.setupWebSocket();
        this.setupEventListeners();
        this.animate();
        
        console.log('Initialization complete!');
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
    }

    setupCamera() {
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            20000
        );
        this.camera.position.set(5, 4, 5);
        this.camera.lookAt(0, 0, 0);
    }

    setupRenderer() {
        const container = document.getElementById('canvas-container');
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
    }

    setupControls() {
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 50;
        this.controls.target.set(0, 0, 0);
    }

    setupPostProcessing() {
        this.composer = new THREE.EffectComposer(this.renderer);

        const renderPass = new THREE.RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        this.bloomPass = new THREE.UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            2.0,
            0.8,
            0.5
        );
        this.composer.addPass(this.bloomPass);
    }

    setupLighting() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x333333);
        this.scene.add(ambientLight);
        
        // Point light from sun
        const sunLight = new THREE.PointLight(0xffffff, 2, 100);
        sunLight.position.set(0, 0, 0);
        this.scene.add(sunLight);
    }

    setupStars() {
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        
        for (let i = 0; i < 10000; i++) {
            const x = (Math.random() - 0.5) * 1000;
            const y = (Math.random() - 0.5) * 1000;
            const z = (Math.random() - 0.5) * 1000;
            vertices.push(x, y, z);
        }
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        
        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.5,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.8
        });
        
        this.objects.stars = new THREE.Points(geometry, material);
        this.scene.add(this.objects.stars);
    }

    setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${protocol}://${window.location.host}/ws`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.connected = true;
            this.updateConnectionStatus(true);
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.connected = false;
            this.updateConnectionStatus(false);
        };
    }

    handleMessage(data) {
        switch (data.type) {
            case 'init':
                console.log('Received initial data');
                this.handleInitialData(data);
                break;
            
            case 'snapshot':
            case 'update':
                this.handleMissionUpdate(data);
                break;
            
            case 'ack':
                console.log('Command acknowledged:', data.command);
                break;
        }
    }

    handleInitialData(data) {
        this.missionData = data.mission_info;
        
        // Create sun
        this.createSun();
        
        // Create planets
        this.createPlanet('earth', data.earth_orbit);
        this.createPlanet('mars', data.mars_orbit);
        
        // Create spacecraft
        this.createSpacecraft();
        
        // Update UI with mission info
        updateMissionInfo(data.mission_info);
        
        // Update total days
        document.getElementById('total-days').textContent = 
            Math.round(data.mission_info.total_duration);
        
        // Update timeline max
        document.getElementById('timeline').max = 
            Math.round(data.mission_info.total_duration);
        
        console.log('Scene setup complete');
    }

    createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const context = canvas.getContext('2d');
        const gradient = context.createRadialGradient(256, 256, 0, 256, 256, 256);
        
        gradient.addColorStop(0, 'rgba(255, 250, 240, 1.0)');
        gradient.addColorStop(0.1, 'rgba(255, 240, 200, 0.95)');
        gradient.addColorStop(0.25, 'rgba(255, 200, 120, 0.7)');
        gradient.addColorStop(0.4, 'rgba(255, 160, 60, 0.4)');
        gradient.addColorStop(0.6, 'rgba(255, 100, 40, 0.2)');
        gradient.addColorStop(0.8, 'rgba(200, 60, 20, 0.08)');
        gradient.addColorStop(1, 'rgba(150, 40, 10, 0)');
        
        context.fillStyle = gradient;
        context.fillRect(0, 0, 512, 512);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    createRadialTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const context = canvas.getContext('2d');
        const gradient = context.createRadialGradient(256, 256, 0, 256, 256, 256);
        
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        context.fillStyle = gradient;
        context.fillRect(0, 0, 512, 512);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    createSun() {
        if (this.objects.sun) {
            this.scene.remove(this.objects.sun);
        }

        const geometry = new THREE.SphereGeometry(0.2, 64, 64);
        const sunTexture = this.textureLoader.load('/static/assets/textures/sunmap.jpg');
        sunTexture.wrapS = sunTexture.wrapT = THREE.RepeatWrapping;
        
        const material = new THREE.MeshStandardMaterial({
            map: sunTexture,
            emissive: 0xffaa00,
            emissiveIntensity: 1.0,
            emissiveMap: sunTexture,
            toneMapped: false,
            depthWrite: true
        });
        
        this.objects.sun = new THREE.Mesh(geometry, material);
        
        const glowTexture = this.createGlowTexture();
        
        const spriteMaterial1 = new THREE.SpriteMaterial({
            map: glowTexture,
            color: 0xffddaa,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const sprite1 = new THREE.Sprite(spriteMaterial1);
        sprite1.scale.set(1.2, 1.2, 1.0);
        this.objects.sun.add(sprite1);

        const spriteMaterial2 = new THREE.SpriteMaterial({
            map: glowTexture,
            color: 0xffaa66,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const sprite2 = new THREE.Sprite(spriteMaterial2);
        sprite2.scale.set(2.5, 2.5, 1.0);
        this.objects.sun.add(sprite2);

        this.objects.sunGlow = [sprite1, sprite2];
        
        this.scene.add(this.objects.sun);
        this.sunTexture = sunTexture;
    }

    createPlanet(name, orbitPoints) {
        if (this.objects[name]) {
            this.scene.remove(this.objects[name]);
        }
        if (this.objects[`${name}Orbit`]) {
            this.scene.remove(this.objects[`${name}Orbit`]);
        }

        const size = name === 'earth' ? 0.12 : 0.08;
        const color = name === 'earth' ? 0x4a90d9 : 0xe74c3c;
        const geometry = new THREE.SphereGeometry(size, 64, 64);
        
        let material;
        if (name === 'earth') {
            const earthTexture = this.textureLoader.load('/static/assets/textures/earth_atmos_2048.jpg');
            const earthSpecular = this.textureLoader.load('/static/assets/textures/earth_specular_2048.jpg');
            const earthBump = this.textureLoader.load('/static/assets/textures/earthbump1k.jpg');
            const earthLights = this.textureLoader.load('/static/assets/textures/earthlights1k.jpg');
            
            material = new THREE.MeshPhongMaterial({
                map: earthTexture,
                specularMap: earthSpecular,
                bumpMap: earthBump,
                bumpScale: 0.05,
                emissiveMap: earthLights,
                emissive: new THREE.Color(0xffff44),
                emissiveIntensity: 0.8,
                specular: new THREE.Color(0x111111),
                shininess: 15
            });

            const cloudGeometry = new THREE.SphereGeometry(size * 1.02, 64, 64);
            const cloudTexture = this.textureLoader.load('/static/assets/textures/earth_clouds_1024.png');
            const cloudMaterial = new THREE.MeshPhongMaterial({
                map: cloudTexture,
                transparent: true,
                opacity: 0.8
            });
            const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
            this.objects.earthClouds = clouds;
            
            this.objects[name] = new THREE.Mesh(geometry, material);
            this.objects[name].add(clouds);
        } else if (name === 'mars') {
            const marsTexture = this.textureLoader.load('/static/assets/textures/mars_1k_color.jpg');
            const marsBump = this.textureLoader.load('/static/assets/textures/marsbump1k.jpg');
            
            material = new THREE.MeshPhongMaterial({
                map: marsTexture,
                bumpMap: marsBump,
                bumpScale: 0.02,
                shininess: 2
            });
            this.objects[name] = new THREE.Mesh(geometry, material);
        } else {
            material = new THREE.MeshPhongMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.2,
                shininess: 10
            });
            this.objects[name] = new THREE.Mesh(geometry, material);
        }
        
        this.scene.add(this.objects[name]);
        
        const glowTexture = this.createRadialTexture();
        const glowMaterial = new THREE.SpriteMaterial({
            map: glowTexture,
            color: color,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        
        const glow = new THREE.Sprite(glowMaterial);
        glow.scale.set(size * 4, size * 4, 1.0);
        this.objects[name].add(glow);
        
        const orbitGeometry = new THREE.BufferGeometry();
        const positions = [];
        
        orbitPoints.points.forEach(point => {
            positions.push(point[0], point[1], point[2]);
        });
        
        orbitGeometry.setAttribute('position', 
            new THREE.Float32BufferAttribute(positions, 3));
        
        const orbitMaterial = new THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.6
        });
        
        const orbitLine = new THREE.Line(orbitGeometry, orbitMaterial);
        orbitLine.frustumCulled = false;
        this.objects[`${name}Orbit`] = orbitLine;
        this.scene.add(orbitLine);
    }

    createSpacecraft() {
        const SpacecraftClass =
            (typeof globalThis !== 'undefined' && globalThis.Spacecraft) ? globalThis.Spacecraft : undefined;
        if (typeof SpacecraftClass !== 'function') {
            console.error('Spacecraft is not defined. Check that /static/spacecraft.js loaded before main.js.');
            if (typeof showToast === 'function') {
                showToast('Failed to load spacecraft model (spacecraft.js). Check console/network tab.', 6000);
            }
            return;
        }

        this.objects.spacecraft = new SpacecraftClass(this.scene);
    }

    updateSpacecraftTrail(position) {
        if (this.objects.spacecraft) {
            this.objects.spacecraft.addTrailPoint(position);
        }
    }

    clearSpacecraftTrail() {
        if (this.objects.spacecraft) {
            this.objects.spacecraft.clearTrail();
        }
    }

    handleMissionUpdate(data) {
        const missionInfo = data.type === 'update' ? data : data.data;
        
        // Clear trail on phase change
        if (missionInfo.phase && this.lastPhase !== missionInfo.phase) {
            this.clearSpacecraftTrail();
            this.lastPhase = missionInfo.phase;
        }
        
        // Update planet positions
        if (missionInfo.earth_position && this.objects.earth) {
            const pos = missionInfo.earth_position;
            this.objects.earth.position.set(pos[0], pos[1], pos[2]);
        }
        
        if (missionInfo.mars_position && this.objects.mars) {
            const pos = missionInfo.mars_position;
            this.objects.mars.position.set(pos[0], pos[1], pos[2]);
        }
        
        if (missionInfo.spacecraft_position && this.objects.spacecraft) {
            const pos = missionInfo.spacecraft_position;
            this.objects.spacecraft.getMesh().position.set(pos[0], pos[1], pos[2]);
            this.objects.spacecraft.getMesh().visible = true;

            const isTransfer = missionInfo.phase === 'transfer_to_mars' || missionInfo.phase === 'transfer_to_earth';
            this.objects.spacecraft.setThrusterActive(isTransfer);

            if (isTransfer) {
                this.updateSpacecraftTrail(pos);
            }
            
            // Update spacecraft rotation to face direction of travel
            if (this.lastSpacecraftPosition) {
            const rawDirection = new THREE.Vector3(
                pos[0] - this.lastSpacecraftPosition[0],
                pos[1] - this.lastSpacecraftPosition[1],
                pos[2] - this.lastSpacecraftPosition[2]
            );

            if (rawDirection.length() > 0.001) {
                const direction = rawDirection.normalize();
                const target = new THREE.Vector3(
                    pos[0] + direction.x,
                    pos[1] + direction.y,
                    pos[2] + direction.z
                );
                this.objects.spacecraft.getMesh().lookAt(target);
            }
            }
            this.lastSpacecraftPosition = pos;
        } else {
            console.warn('Spacecraft object not found or no position data');
        }
        
        // Update UI
        updateDataPanel(missionInfo);
        updateTimeline(missionInfo.time_days);
    }

    setViewMode(mode) {
        this.viewMode = mode;
    }

    updateCamera() {
        if (!this.missionData) return;

        const earthPos = this.objects.earth ? this.objects.earth.position : null;
        const marsPos = this.objects.mars ? this.objects.mars.position : null;
        const shipPos = this.objects.spacecraft ? this.objects.spacecraft.getMesh().position : null;

        switch (this.viewMode) {
            case 'earth':
                if (earthPos) {
                    this.controls.target.copy(earthPos);
                    this.camera.position.set(
                        earthPos.x + 1,
                        earthPos.y + 0.5,
                        earthPos.z + 1
                    );
                }
                break;

            case 'mars':
                if (marsPos) {
                    this.controls.target.copy(marsPos);
                    this.camera.position.set(
                        marsPos.x + 1,
                        marsPos.y + 0.5,
                        marsPos.z + 1
                    );
                }
                break;

            case 'spacecraft':
                if (shipPos) {
                    this.controls.target.copy(shipPos);
                    this.camera.position.set(
                        shipPos.x + 0.5,
                        shipPos.y + 0.3,
                        shipPos.z + 0.5
                    );
                }
                break;

            case 'top':
                this.controls.target.set(0, 0, 0);
                this.camera.position.set(0, 4, 0);
                this.camera.lookAt(0, 0, 0);
                break;

            case 'free':
            default:
                break;
        }

        this.controls.update();
    }

    setupEventListeners() {
        window.addEventListener('resize', () => this.onWindowResize());
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        if (this.bloomPass) {
            this.bloomPass.resolution.set(window.innerWidth, window.innerHeight);
        }
    }

    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('connection-status');
        if (connected) {
            statusElement.textContent = '● Connected';
            statusElement.className = 'status connected';
        } else {
            statusElement.textContent = '● Disconnected';
            statusElement.className = 'status disconnected';
        }
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        this.updateCamera();

        if (this.objects.sun) {
            this.objects.sun.rotation.y += 0.001;
        }

        if (this.objects.sunGlow) {
            const time = Date.now() * 0.002;
            const pulse = 1.0 + Math.sin(time) * 0.08;
            this.objects.sunGlow[0].scale.set(1.2 * pulse, 1.2 * pulse, 1.0);
            this.objects.sunGlow[1].scale.set(2.5 * (1.0 + Math.sin(time * 0.5) * 0.12), 2.5 * (1.0 + Math.sin(time * 0.5) * 0.12), 1.0);
        }

        if (this.sunTexture) {
            this.sunTexture.offset.x += 0.0005;
            this.sunTexture.offset.y += 0.0002;
        }

        if (this.objects.earth) {
            this.objects.earth.rotation.y += 0.005;
        }
        if (this.objects.earthClouds) {
            this.objects.earthClouds.rotation.y += 0.001;
            this.objects.earthClouds.rotation.x += 0.0002;
        }

        if (this.objects.mars) {
            this.objects.mars.rotation.y += 0.004;
        }

        if (this.objects.spacecraft) {
            const time = Date.now();
            this.objects.spacecraft.update(time);
        }

        if (this.objects.stars) {
            this.objects.stars.rotation.y += 0.0001;
        }

        this.composer.render();
    }

    // Methods for sending commands to backend
    startSimulation() {
        this.sendCommand('start');
    }

    pauseSimulation() {
        this.sendCommand('pause');
    }

    stopSimulation() {
        this.sendCommand('stop');
    }

    setTimeSpeed(speed) {
        this.sendCommand('set_speed', { speed: speed });
    }

    setTime(time) {
        this.sendCommand('set_time', { time: time });
    }

    sendCommand(command, params = {}) {
        if (this.ws && this.connected) {
            this.ws.send(JSON.stringify({
                command: command,
                ...params
            }));
        } else {
            console.warn('WebSocket not connected, command not sent');
        }
    }
}

// Initialize the application
let app = null;

document.addEventListener('DOMContentLoaded', () => {
    app = new MarsMissionApp();
});
