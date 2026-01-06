// Main.js - Main application entry point

// Custom Shader for Cinematic Effects (Grain + Chromatic Aberration)
const CinematicShader = {
    uniforms: {
        "tDiffuse": { value: null },
        "time": { value: 0.0 },
        "amount": { value: 0.002 }, // Chromatic Aberration intensity
        "grainIntensity": { value: 0.03 } // Film Grain intensity
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float time;
        uniform float amount;
        uniform float grainIntensity;
        varying vec2 vUv;

        // Pseudo-random generator
        float random(vec2 p) {
            return fract(sin(dot(p.xy ,vec2(12.9898,78.233))) * 43758.5453);
        }

        void main() {
            vec2 uv = vUv;
            
            // 1. Chromatic Aberration (RGB Shift based on distance from center)
            float dist = distance(uv, vec2(0.5));
            vec2 offset = (uv - 0.5) * amount * dist * 2.0;
            
            float r = texture2D(tDiffuse, uv + offset).r;
            float g = texture2D(tDiffuse, uv).g;
            float b = texture2D(tDiffuse, uv - offset).b;
            vec3 color = vec3(r, g, b);

            // 2. Film Grain
            float noise = random(uv + time);
            color += (noise - 0.5) * grainIntensity;

            // 3. Simple Vignette (Darker corners)
            float vignette = 1.0 - dist * 0.5;
            color *= vignette;

            gl_FragColor = vec4(color, 1.0);
        }
    `
};

class MarsMissionApp {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.composer = null;
        this.raycaster = new THREE.Raycaster(); // For lens flare occlusion

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
        this.sharedTextures = {};
        
        // Camera smoothing
        this.camLerpFactor = 0.05;
        this.targetLerpFactor = 0.05;
        this.isTransitioning = false;
        this.lastViewMode = 'free';
        
        this.textureLoader = new THREE.TextureLoader();

        this.lastPhase = null;
        this.lastSpacecraftPosition = null;

        this.simulationState = {
            is_running: false,
            paused: false,
            time_speed: 0.5,
        };
        // Simulation-time tracking for smooth rendering between WS updates.
        // Backend advances time at ~20Hz (see backend sleep 0.05s), so we locally interpolate.
        this.serverTickSeconds = 0.05;
        this.simulationTimeDays = 0.0; // last authoritative time_days received
        this.simulationTimeBaseMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        this.simulationTimeRateDaysPerSec = 0.0;
        this.lastSimPacketTimeDays = null;
        this.lastSimPacketMs = null;

        // Visual spin rates (radians per simulated day)
        // Chosen to roughly match the previous on-screen speed at default time_speed.
        this.earthSpinRate = 0.09;
        this.earthCloudSpinRate = 0.03;
        this.marsSpinRate = 0.06;
        this.marsCloudSpinRate = 0.02;

        this.init();
    }

    init() {
        console.log('Initializing Mars Mission 3D Visualization...');
        
        this.setupScene();
        this.setupCamera();
        this.setupRenderer();
        this.setupEnvironment();
        this.setupControls();
        this.setupPostProcessing();
        this.setupLighting();
        this.setupStars();
        this.setupNebulae();
        this.createLensFlare();
        this.setupWebSocket();
        this.setupEventListeners();
        this.animate();
        
        console.log('Initialization complete!');
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
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.connected = false;
            this.updateConnectionStatus(false);
        };
    }

    handleMessage(data) {
        switch (data.type) {
            case 'init':
                this.handleInitialData(data);
                break;
            case 'snapshot':
            case 'update':
                this.handleMissionUpdate(data);
                break;
        }
    }

    handleInitialData(data) {
        this.missionData = data.mission_info;
        if (data.simulation_state) {
            this.simulationState = { ...this.simulationState, ...data.simulation_state };
        }
        this.createSun();
        this.createPlanet('earth', data.earth_orbit);
        this.createPlanet('mars', data.mars_orbit);
        this.createSpacecraft();
        updateMissionInfo(data.mission_info);
        const initialHorizonEnd =
            (data.current_snapshot && typeof data.current_snapshot.timeline_horizon_end === 'number')
                ? data.current_snapshot.timeline_horizon_end
                : (data.mission_info && typeof data.mission_info.timeline_horizon_end === 'number')
                    ? data.mission_info.timeline_horizon_end
                    : 0;

        document.getElementById('total-days').textContent = Math.round(initialHorizonEnd);
        document.getElementById('timeline').max = Math.ceil(initialHorizonEnd);

        // Apply initial snapshot so objects don't start at origin until "Start".
        if (data.current_snapshot) {
            this.handleMissionUpdate({ type: 'snapshot', data: data.current_snapshot });
        }
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
    }

    setupCamera() {
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.03,
            3000
        );
        this.camera.position.set(5, 4, 5);
        this.camera.lookAt(0, 0, 0);
    }

    setupRenderer() {
        const container = document.getElementById('canvas-container');
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        // Switch to ACES Filmic Tone Mapping for cinematic look
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        // Adjusted: Lower exposure slightly to prevent blowout on sunlit sides
        this.renderer.toneMappingExposure = 0.9;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
    }

    createEnvironmentTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const context = canvas.getContext('2d');

        const bg = context.createLinearGradient(0, 0, 0, canvas.height);
        bg.addColorStop(0, 'rgb(6, 6, 16)');
        bg.addColorStop(0.5, 'rgb(2, 2, 8)');
        bg.addColorStop(1, 'rgb(6, 6, 16)');
        context.fillStyle = bg;
        context.fillRect(0, 0, canvas.width, canvas.height);

        const nebulaColors = [
            'rgba(80, 60, 150, 0.26)',
            'rgba(20, 90, 140, 0.22)',
            'rgba(140, 40, 90, 0.20)',
            'rgba(200, 130, 60, 0.16)'
        ];

        for (let i = 0; i < 14; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const radius = 140 + Math.random() * 280;
            const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, nebulaColors[i % nebulaColors.length]);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            context.fillStyle = gradient;
            context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }

        const highlights = [
            { x: canvas.width * 0.22, y: canvas.height * 0.25, r: 260, c0: 'rgba(255, 255, 255, 0.85)', c1: 'rgba(255, 255, 255, 0.25)' },
            { x: canvas.width * 0.78, y: canvas.height * 0.20, r: 220, c0: 'rgba(255, 245, 230, 0.80)', c1: 'rgba(255, 245, 230, 0.22)' },
            { x: canvas.width * 0.62, y: canvas.height * 0.78, r: 280, c0: 'rgba(210, 230, 255, 0.75)', c1: 'rgba(210, 230, 255, 0.20)' }
        ];

        highlights.forEach(({ x, y, r, c0, c1 }) => {
            const gradient = context.createRadialGradient(x, y, 0, x, y, r);
            gradient.addColorStop(0, c0);
            gradient.addColorStop(0.15, c1);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            context.fillStyle = gradient;
            context.fillRect(x - r, y - r, r * 2, r * 2);
        });

        const texture = new THREE.CanvasTexture(canvas);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.needsUpdate = true;
        return texture;
    }

    setupEnvironment() {
        const environmentTexture = this.createEnvironmentTexture();
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        pmremGenerator.compileEquirectangularShader();

        const envRenderTarget = pmremGenerator.fromEquirectangular(environmentTexture);
        this.scene.environment = envRenderTarget.texture;
        this.environmentRenderTarget = envRenderTarget;

        environmentTexture.dispose();
        pmremGenerator.dispose();
    }

    setupControls() {
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 0.3;
        this.controls.maxDistance = 50;
        this.controls.target.set(0, 0, 0);

        this.isUserInteracting = false;
        this.controls.addEventListener('start', () => {
            this.isUserInteracting = true;
            // Interrupt any ongoing transition immediately on interaction
            this.isTransitioning = false;
        });
        this.controls.addEventListener('end', () => {
            this.isUserInteracting = false;
        });
    }

    setupPostProcessing() {
        this.composer = new THREE.EffectComposer(this.renderer);

        const renderPass = new THREE.RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        this.bloomPass = new THREE.UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            2.0,
            0.8,
            0.85 // Raised threshold: Only sun/lights glow, not the planet surface
        );
        this.composer.addPass(this.bloomPass);

        // Add Cinematic Pass (Grain + Chromatic Aberration)
        this.cinematicPass = new THREE.ShaderPass(CinematicShader);
        this.cinematicPass.renderToScreen = true;
        this.composer.addPass(this.cinematicPass);
    }

    setupLighting() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x151515);
        this.scene.add(ambientLight);
        
        // Point light from sun
        const sunLight = new THREE.PointLight(0xffffff, 2, 100);
        sunLight.position.set(0, 0, 0);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        sunLight.shadow.camera.near = 0.5;
        sunLight.shadow.camera.far = 500;
        sunLight.shadow.camera.far = 500;
        sunLight.shadow.bias = -0.0008;
        this.scene.add(sunLight);
    }

    createNebulaTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext('2d');
        const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 256, 256);
        return new THREE.CanvasTexture(canvas);
    }

    setupNebulae() {
        const texture = this.createNebulaTexture();
        const colors = [0x442288, 0x112266, 0x441144, 0x114466];
        const nebulaCount = 8;
        this.objects.nebulae = new THREE.Group();
        for (let i = 0; i < nebulaCount; i++) {
            const material = new THREE.SpriteMaterial({
                map: texture,
                color: colors[i % colors.length],
                transparent: true,
                opacity: 0.2 + Math.random() * 0.2,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const sprite = new THREE.Sprite(material);
            const r = 900;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            sprite.position.set(
                r * Math.sin(phi) * Math.cos(theta),
                r * Math.sin(phi) * Math.sin(theta),
                r * Math.cos(phi)
            );
            const scale = 300 + Math.random() * 500;
            sprite.scale.set(scale, scale, 1);
            this.objects.nebulae.add(sprite);
        }
        this.scene.add(this.objects.nebulae);
    }

    setupStars() {
        const starCount = 20000;
        const dustCount = 20000;
        const totalCount = starCount + dustCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(totalCount * 3);
        const colors = new Float32Array(totalCount * 3);
        const sizes = new Float32Array(totalCount);
        const colorOptions = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xfff4ea),
            new THREE.Color(0xeaf4ff),
            new THREE.Color(0xffe5d9)
        ];

        for (let i = 0; i < totalCount; i++) {
            const isDust = i >= starCount;
            // Parallax optimization: Move dust much closer to create depth
            // Stars are background (800-1200), Dust is foreground volume (250-650)
            // Adjusted: Pushed dust further away (was 20-300) to reduce visual clutter
            const r = isDust ? 250 + Math.random() * 400 : 800 + Math.random() * 400;
            
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            let x = r * Math.sin(phi) * Math.cos(theta);
            let y = r * Math.sin(phi) * Math.sin(theta);
            let z = r * Math.cos(phi);

            const tilt = 0.5;
            if (isDust || Math.random() > 0.6) {
                // Flatten dust slightly into a disk-like shape for orbital plane feeling
                // But keep some spread
                const spread = isDust ? 40 : 250; 
                const dist = 50 + Math.random() * spread;
                const angle = Math.random() * Math.PI * 2;
                x = dist * Math.cos(angle) * (r / 300);
                y = (dist * Math.sin(angle) * Math.sin(tilt) + (Math.random() - 0.5) * (isDust ? 60 : 100)) * (r / 300);
                z = (dist * Math.sin(angle) * Math.cos(tilt)) * (r / 300);
            }

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            // FIX: Drastically reduce dust brightness to avoid Bloom artifacts
            // Dust should be subtle (dark grey/blue), Stars stay bright
            const color = isDust ? new THREE.Color(0x333344) : colorOptions[Math.floor(Math.random() * colorOptions.length)];
            
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
            
            // FIX: Make dust much smaller so it looks like speed lines, not light bulbs
            sizes[i] = isDust ? 0.2 + Math.random() * 0.4 : 0.8 + Math.random() * 2.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 }
            },
            vertexShader: `
                uniform float time;
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;
                varying float vOpacity;
                void main() {
                    vColor = color;
                    // Add subtle twinkling effect based on position and time
                    float twinkle = sin(time * 0.002 + position.x + position.y) * 0.3 + 0.7;
                    vOpacity = twinkle;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = max(1.5, size * (950.0 / -mvPosition.z));
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vOpacity;
                void main() {
                    float r = distance(gl_PointCoord, vec2(0.5));
                    if (r > 0.5) discard;
                    gl_FragColor = vec4(vColor * 1.5, vOpacity * (1.0 - r * 2.0));
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.objects.stars = new THREE.Points(geometry, material);
        this.scene.add(this.objects.stars);
    }

    createGlowTexture() {
        if (this.sharedTextures.glow) {
            return this.sharedTextures.glow;
        }

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
        this.sharedTextures.glow = texture;
        return texture;
    }

    createRadialTexture() {
        if (this.sharedTextures.radial) {
            return this.sharedTextures.radial;
        }

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
        this.sharedTextures.radial = texture;
        return texture;
    }

    loadTextureWithFallback(primaryUrl, fallbackUrl, onLoad) {
        const texture = this.textureLoader.load(
            primaryUrl,
            (loadedTexture) => {
                if (onLoad) onLoad(loadedTexture);
            },
            undefined,
            () => {
                if (!fallbackUrl) return;
                this.textureLoader.load(
                    fallbackUrl,
                    (fallbackTexture) => {
                        // Keep the original texture object so materials don't need to be updated.
                        texture.image = fallbackTexture.image;
                        texture.needsUpdate = true;
                        if (onLoad) onLoad(texture);
                        fallbackTexture.dispose();
                    },
                    undefined,
                    (err) => {
                        console.warn('Failed to load texture and fallback:', primaryUrl, fallbackUrl, err);
                    }
                );
            }
        );
        return texture;
    }

    disposeObject(obj) {
        if (!obj) return;
        
        if (obj.geometry) {
            obj.geometry.dispose();
        }
        
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(material => {
                    if (material.map) material.map.dispose();
                    if (material.lightMap) material.lightMap.dispose();
                    if (material.bumpMap) material.bumpMap.dispose();
                    if (material.normalMap) material.normalMap.dispose();
                    if (material.specularMap) material.specularMap.dispose();
                    if (material.emissiveMap) material.emissiveMap.dispose();
                    material.dispose();
                });
            } else {
                if (obj.material.map) obj.material.map.dispose();
                if (obj.material.lightMap) obj.material.lightMap.dispose();
                if (obj.material.bumpMap) obj.material.bumpMap.dispose();
                if (obj.material.normalMap) obj.material.normalMap.dispose();
                if (obj.material.specularMap) obj.material.specularMap.dispose();
                if (obj.material.emissiveMap) obj.material.emissiveMap.dispose();
                obj.material.dispose();
            }
        }
        
        if (obj.children) {
            while (obj.children.length > 0) {
                this.disposeObject(obj.children[0]);
                obj.remove(obj.children[0]);
            }
        }
    }

    createFlareTexture(type) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        const center = 64;

        if (type === 'hexagon') {
            context.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = (i * Math.PI) / 3;
                const x = center + 50 * Math.cos(angle);
                const y = center + 50 * Math.sin(angle);
                if (i === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }
            context.closePath();
            context.fillStyle = 'rgba(255, 255, 255, 0.2)';
            context.fill();
        } else if (type === 'ring') {
            context.beginPath();
            context.arc(center, center, 40, 0, Math.PI * 2);
            context.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            context.lineWidth = 1;
            context.stroke();
        } else {
            const gradient = context.createRadialGradient(center, center, 0, center, center, 64);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
            gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.2)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            context.fillStyle = gradient;
            context.fillRect(0, 0, 128, 128);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    createLensFlare() {
        const textures = {
            main: this.createFlareTexture('glow'),
            hexagon: this.createFlareTexture('hexagon'),
            ring: this.createFlareTexture('ring')
        };

        this.flareElements = [];
        
        const flareConfigs = [
            { dist: 0.0, size: 1.0, opacity: 0.4, color: 0xffffff, tex: 'main' },
            { dist: 0.2, size: 0.15, opacity: 0.2, color: 0xffccaa, tex: 'hexagon' },
            { dist: 0.4, size: 0.08, opacity: 0.15, color: 0xffaaaa, tex: 'hexagon' },
            { dist: 0.5, size: 0.3, opacity: 0.1, color: 0xffffff, tex: 'ring' },
            { dist: 0.6, size: 0.1, opacity: 0.15, color: 0xaaaaff, tex: 'hexagon' },
            { dist: 0.8, size: 0.2, opacity: 0.1, color: 0xffffff, tex: 'ring' },
            { dist: 1.1, size: 0.3, opacity: 0.15, color: 0xffccaa, tex: 'hexagon' }
        ];

        flareConfigs.forEach(cfg => {
            const mat = new THREE.SpriteMaterial({
                map: textures[cfg.tex],
                color: cfg.color,
                transparent: true,
                opacity: cfg.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: false
            });
            const sprite = new THREE.Sprite(mat);
            sprite.scale.set(cfg.size, cfg.size, 1);
            sprite.visible = false;
            this.scene.add(sprite);
            this.flareElements.push({ sprite, dist: cfg.dist });
        });
    }

    createSun() {
        if (this.objects.sun) {
            this.disposeObject(this.objects.sun);
            this.scene.remove(this.objects.sun);
        }

        const geometry = new THREE.SphereGeometry(0.2, 64, 64);
        const sunTexture = this.textureLoader.load('/static/assets/textures/sunmap.jpg');
        sunTexture.wrapS = sunTexture.wrapT = THREE.RepeatWrapping;
        
        const material = new THREE.MeshStandardMaterial({
            map: sunTexture,
            emissive: 0xffaa00,
            emissiveIntensity: 0.5,
            emissiveMap: sunTexture,
            toneMapped: false,
            depthWrite: false
        });
        
        this.objects.sun = new THREE.Mesh(geometry, material);
        
        const glowTexture = this.createGlowTexture();
        
        const spriteMaterial1 = new THREE.SpriteMaterial({
            map: glowTexture,
            color: 0xffddaa,
            transparent: true,
            opacity: 0.5,
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
            opacity: 0.22,
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

    createAtmosphereMaterial(color) {
        return new THREE.ShaderMaterial({
            uniforms: { 
                glowColor: { value: new THREE.Color(color) }
            },
            vertexShader: `
                varying vec3 vNormal;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 glowColor;
                varying vec3 vNormal;
                void main() {
                    // BackSide rendering: edge dot is 0, center dot is -1
                    // We want intensity to be 1 at edge and 0 at center
                    float intensity = pow(1.0 + dot(vNormal, vec3(0, 0, 1.0)), 4.5);
                    gl_FragColor = vec4(glowColor, intensity);
                }
            `,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false
        });
    }

    createPlanet(name, orbitPoints) {
        if (this.objects[name]) {
            this.disposeObject(this.objects[name]);
            this.scene.remove(this.objects[name]);
        }
        if (this.objects[`${name}Orbit`]) {
            this.disposeObject(this.objects[`${name}Orbit`]);
            this.scene.remove(this.objects[`${name}Orbit`]);
        }

        const size = name === 'earth' ? 0.12 : 0.08;
        const color = name === 'earth' ? 0x4a90d9 : 0xe74c3c;
        const geometry = new THREE.SphereGeometry(size, 64, 64);
        
        let material;
        if (name === 'earth') {
            const earthTexture = this.textureLoader.load('/static/assets/textures/earth/earthmap4k.jpg');
            earthTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            earthTexture.minFilter = THREE.LinearMipmapLinearFilter;
            earthTexture.magFilter = THREE.LinearFilter;
            
            const earthBump = this.textureLoader.load('/static/assets/textures/earth/earthbump4k.jpg');
            earthBump.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            earthBump.minFilter = THREE.LinearMipmapLinearFilter;
            earthBump.magFilter = THREE.LinearFilter;
            
            const earthLights = this.textureLoader.load('/static/assets/textures/earth/earthlights4k.jpg');
            earthLights.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            earthLights.minFilter = THREE.LinearMipmapLinearFilter;
            earthLights.magFilter = THREE.LinearFilter;
            
            const earthSpec = this.textureLoader.load('/static/assets/textures/earth/earthspec4k.jpg');
            earthSpec.minFilter = THREE.LinearFilter;
            earthSpec.magFilter = THREE.LinearFilter;
            
            material = new THREE.MeshStandardMaterial({
                map: earthTexture,
                bumpMap: earthBump,
                bumpScale: 0.005,
                emissiveMap: earthLights,
                // FIX: Must use White (0xffffff) so the emissiveMap can be seen.
                // Our custom shader mask will handle turning it off during the day.
                emissive: new THREE.Color(0xffffff),
                emissiveIntensity: 1.5,
                metalness: 0.0,
                roughness: 1.0,
                roughnessMap: earthSpec,
                envMapIntensity: 0.1
            });

            material.onBeforeCompile = (shader) => {
                 shader.uniforms.sunDirectionView = { value: new THREE.Vector3(0, 0, 1) };
                 this.earthMaterialShader = shader;

                shader.fragmentShader = shader.fragmentShader.replace(
                     '#include <common>',
                     `
                     #include <common>
                     uniform vec3 sunDirectionView;
                     `
                 );

                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <roughnessmap_fragment>',
                    `
                    float roughnessFactor = roughness;
                    #ifdef USE_ROUGHNESSMAP
                        vec4 texelRoughness = texture2D( roughnessMap, vUv );
                        roughnessFactor *= (1.0 - texelRoughness.g);
                    #endif
                    `
                );
                
                shader.fragmentShader = shader.fragmentShader.replace(
                        '#include <emissivemap_fragment>',
                        `
                        #include <emissivemap_fragment>
                        
                        vec3 lightDirView = normalize(sunDirectionView);
                        float NdotL = dot(normalize(vNormal), lightDirView);
                        
                        #ifdef USE_EMISSIVEMAP
                            float nightMask = smoothstep(-0.2, 0.2, NdotL);
                            totalEmissiveRadiance *= nightMask;
                        #endif
                        `
                    );
            };

            const cloudGeometry = new THREE.SphereGeometry(size * 1.02, 64, 64);

            const cloudAlpha = this.textureLoader.load('/static/assets/textures/earth/cloudmap4k.jpg');
            cloudAlpha.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            cloudAlpha.minFilter = THREE.LinearMipmapLinearFilter;
            cloudAlpha.magFilter = THREE.LinearFilter;

            const cloudMaterial = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                alphaMap: cloudAlpha,
                transparent: true,
                opacity: 0.95,
                metalness: 0.0,
                roughness: 0.9,               // 稍微降低粗糙度
                emissive: 0x222233,           // 微弱的自发光（深灰蓝）
                emissiveIntensity: 0.5,       // 低强度
                envMapIntensity: 1,           // 反射环境光
                depthWrite: false,
                side: THREE.DoubleSide        // 双面渲染
            });

            const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
            // clouds.castShadow = true;
            // clouds.receiveShadow = false;
            this.objects.earthClouds = clouds;
            
            this.objects[name] = new THREE.Mesh(geometry, material);
            // this.objects[name].receiveShadow = true;
            this.objects[name].add(clouds);
        } else if (name === 'mars') {
            const marsTexture = this.loadTextureWithFallback(
                '/static/assets/textures/mars/mars_2k_color.png'
            );
            marsTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            marsTexture.minFilter = THREE.LinearMipmapLinearFilter;
            marsTexture.magFilter = THREE.LinearFilter;

            const marsNormal = this.loadTextureWithFallback(
                '/static/assets/textures/mars/mars_2k_normal.png'
            );
            marsNormal.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            marsNormal.minFilter = THREE.LinearMipmapLinearFilter;
            marsNormal.magFilter = THREE.LinearFilter;
            
            material = new THREE.MeshStandardMaterial({
                map: marsTexture,
                normalMap: marsNormal,
                // Tip reference strength: ~300%
                normalScale: new THREE.Vector2(3.0, 3.0),
                metalness: 0.0,
                roughness: 0.98,
                envMapIntensity: 0.15
            });
            this.objects[name] = new THREE.Mesh(geometry, material);

            // Mars clouds (separate transparent shell)
            const cloudGeometry = new THREE.SphereGeometry(size * 1.018, 64, 64);
            const marsClouds = this.textureLoader.load(
                '/static/assets/textures/mars/mars_clouds.png',
                (texture) => {
                    // The provided mars_clouds.png has a very low alpha range (0..~42).
                    // Boost it at load time so the cloud layer is actually visible.
                    try {
                        const image = texture.image;
                        if (!image || !image.width || !image.height) return;

                        const canvas = document.createElement('canvas');
                        canvas.width = image.width;
                        canvas.height = image.height;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) return;

                        ctx.drawImage(image, 0, 0);
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const data = imageData.data;

                        let maxAlpha = 0;
                        for (let i = 3; i < data.length; i += 4) {
                            if (data[i] > maxAlpha) maxAlpha = data[i];
                        }
                        if (maxAlpha <= 0 || maxAlpha >= 255) return;

                        const targetMaxAlpha = 255;
                        const boostFactor = Math.min(8.0, targetMaxAlpha / maxAlpha);
                        if (boostFactor <= 1.01) return;

                        for (let i = 3; i < data.length; i += 4) {
                            data[i] = Math.min(255, Math.round(data[i] * boostFactor));
                        }

                        ctx.putImageData(imageData, 0, 0);
                        texture.image = canvas;
                        texture.needsUpdate = true;
                    } catch (err) {
                        console.warn('Failed to boost Mars clouds alpha:', err);
                    }
                }
            );
            marsClouds.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            marsClouds.minFilter = THREE.LinearMipmapLinearFilter;
            marsClouds.magFilter = THREE.LinearFilter;

            const cloudMaterial = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                map: marsClouds,
                transparent: true,
                opacity: 0.2,
                metalness: 0.0,
                roughness: 1.0,
                emissive: 0x111111,
                emissiveIntensity: 0.25,
                envMapIntensity: 0.2,
                depthWrite: false,
                side: THREE.DoubleSide
            });

            const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
            this.objects.marsClouds = clouds;
            this.objects[name].add(clouds);
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

        const atmosphereGeometry = new THREE.SphereGeometry(size * 1.06, 64, 64);
        const atmosphereMaterial = this.createAtmosphereMaterial(color);
        const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        this.objects[name].add(atmosphere);
        
        const orbitGeometry = new THREE.BufferGeometry();
        const positions = [];
        
        orbitPoints.points.forEach(point => {
            // Backend (x, y, z) -> Three.js (x, z, -y)
            positions.push(point[0], point[2], -point[1]);
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

        if (missionInfo.simulation && typeof missionInfo.simulation === 'object') {
            this.simulationState = { ...this.simulationState, ...missionInfo.simulation };
        }
        if (typeof missionInfo.time_days === 'number' && Number.isFinite(missionInfo.time_days)) {
            const nowMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            const nextDays = missionInfo.time_days;

            // Estimate sim-time rate (days/sec) from packet cadence (preferred), with a fallback
            // to the configured backend rate (time_speed days/tick at ~20Hz).
            let nextRate = this.simulationTimeRateDaysPerSec;

            if (typeof this.lastSimPacketTimeDays === 'number' && typeof this.lastSimPacketMs === 'number') {
                const dtSec = (nowMs - this.lastSimPacketMs) / 1000.0;
                const dDays = nextDays - this.lastSimPacketTimeDays;
                if (dtSec > 0.02 && dDays >= 0) {
                    const instRate = dDays / dtSec;
                    if (Number.isFinite(instRate) && instRate >= 0) {
                        nextRate = nextRate > 0 ? (nextRate * 0.8 + instRate * 0.2) : instRate;
                    }
                }
            }

            const configuredSpeed =
                (this.simulationState && typeof this.simulationState.time_speed === 'number' && Number.isFinite(this.simulationState.time_speed))
                    ? this.simulationState.time_speed
                    : 0.0;
            const fallbackRate = this.serverTickSeconds > 0 ? (configuredSpeed / this.serverTickSeconds) : 0.0;
            if (!(nextRate > 0) && fallbackRate > 0) {
                nextRate = fallbackRate;
            }

            this.simulationTimeRateDaysPerSec = nextRate;
            this.simulationTimeDays = nextDays;
            this.simulationTimeBaseMs = nowMs;
            this.lastSimPacketTimeDays = nextDays;
            this.lastSimPacketMs = nowMs;
        }
        
        // Clear trail on phase change
        if (missionInfo.phase && this.lastPhase !== missionInfo.phase) {
            this.clearSpacecraftTrail();
            this.lastPhase = missionInfo.phase;
        }
        
        if (missionInfo.earth_position && this.objects.earth) {
            const pos = missionInfo.earth_position;
            if (!this.objects.earth.userData.targetPos) this.objects.earth.userData.targetPos = new THREE.Vector3();
            this.objects.earth.userData.targetPos.set(pos[0], pos[2], -pos[1]);
        }
        
        if (missionInfo.mars_position && this.objects.mars) {
            const pos = missionInfo.mars_position;
            if (!this.objects.mars.userData.targetPos) this.objects.mars.userData.targetPos = new THREE.Vector3();
            this.objects.mars.userData.targetPos.set(pos[0], pos[2], -pos[1]);
        }
        
        if (missionInfo.spacecraft_position && this.objects.spacecraft) {
            const pos = missionInfo.spacecraft_position;
            const mesh = this.objects.spacecraft.getMesh();

            const mappedX = pos[0];
            const mappedY = pos[2];
            const mappedZ = -pos[1];
            
            if (!mesh.userData.targetPos) mesh.userData.targetPos = new THREE.Vector3();
            mesh.userData.targetPos.set(mappedX, mappedY, mappedZ);

            mesh.visible = true;
            const isTransfer = missionInfo.phase === 'transfer_to_mars' || missionInfo.phase === 'transfer_to_earth';
            this.objects.spacecraft.setThrusterActive(isTransfer);

            if (isTransfer) {
                this.updateSpacecraftTrail([mappedX, mappedY, mappedZ]);
            }
            
            if (this.lastSpacecraftPosition && Array.isArray(this.lastSpacecraftPosition)) {
                const [lastX, lastY, lastZ] = this.lastSpacecraftPosition;
                const rawDirection = new THREE.Vector3(
                    mappedX - lastX,
                    mappedY - lastY,
                    mappedZ - lastZ
                );

                if (rawDirection.length() > 0.001) {
                    const direction = rawDirection.normalize();
                    const target = new THREE.Vector3(
                        mappedX + direction.x,
                        mappedY + direction.y,
                        mappedZ + direction.z
                    );
                    mesh.userData.lookTarget = target;
                }
            }
            this.lastSpacecraftPosition = [mappedX, mappedY, mappedZ];
        }
        
        updateDataPanel(missionInfo);
        updateTimeline(missionInfo.time_days, missionInfo.timeline_horizon_end);
    }

    setViewMode(mode) {
        this.viewMode = mode;
    }

    updateCamera() {
        if (!this.missionData) return;

        // Detect mode change to trigger transition
        if (this.viewMode !== this.lastViewMode) {
            this.isTransitioning = true;
            this.lastViewMode = this.viewMode;
        }

        const earthPos = this.objects.earth ? this.objects.earth.position : null;
        const marsPos = this.objects.mars ? this.objects.mars.position : null;
        const shipPos = this.objects.spacecraft ? this.objects.spacecraft.getMesh().position : null;

        let focusPoint = null;
        let idealOffset = null;

        // 1. Determine Focus Point & Ideal Offset based on mode
        switch (this.viewMode) {
            case 'earth':
                this.controls.enablePan = false;
                if (earthPos) {
                    focusPoint = earthPos;
                    idealOffset = new THREE.Vector3(0.8, 0.4, 0.8);
                }
                break;

            case 'mars':
                this.controls.enablePan = false;
                if (marsPos) {
                    focusPoint = marsPos;
                    idealOffset = new THREE.Vector3(0.6, 0.3, 0.6);
                }
                break;

            case 'spacecraft':
                this.controls.enablePan = false;
                if (shipPos) {
                    focusPoint = shipPos;
                    idealOffset = new THREE.Vector3(0.3, 0.2, 0.3);
                }
                break;

            case 'top':
                this.controls.enablePan = true;
                if (!this.isUserInteracting) {
                    this.controls.target.lerp(new THREE.Vector3(0, 0, 0), this.targetLerpFactor);
                    // Add a tiny offset to avoid collinearity singularities in OrbitControls.
                    this.camera.position.lerp(new THREE.Vector3(0.0001, 4, 0.0001), this.camLerpFactor);
                }
                this.controls.update();
                return;

            case 'free':
            default:
                this.controls.enablePan = true;
                this.controls.update();
                return;
        }

        // 2. Handle Follow Logic (Earth/Mars/Spacecraft)
        if (focusPoint && idealOffset) {
            const lastTarget = this.controls.target.clone();
            const idealCameraPos = focusPoint.clone().add(idealOffset);
            
            if (this.isTransitioning && !this.isUserInteracting) {
                const distToTarget = this.camera.position.distanceTo(idealCameraPos);
                const distToFocus = this.controls.target.distanceTo(focusPoint);
                
                if (distToTarget < 0.001 && distToFocus < 0.001) {
                    this.isTransitioning = false;
                    this.controls.target.copy(focusPoint);
                    this.camera.position.copy(idealCameraPos);
                } else {
                    this.controls.target.lerp(focusPoint, this.targetLerpFactor);
                    this.camera.position.lerp(idealCameraPos, this.camLerpFactor);
                }
            } else {
                this.controls.target.copy(focusPoint);
                const delta = new THREE.Vector3().subVectors(this.controls.target, lastTarget);
                this.camera.position.add(delta);
            }
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

    updateLensFlare() {
        if (!this.flareElements || !this.objects.sun) return;

        const sunPos = new THREE.Vector3();
        this.objects.sun.getWorldPosition(sunPos);

        const screenPos = sunPos.clone();
        screenPos.project(this.camera);

        const isVisibleOnScreen = (screenPos.x >= -1 && screenPos.x <= 1 &&
                           screenPos.y >= -1 && screenPos.y <= 1 &&
                           screenPos.z < 1);

        // Occlusion Check using Raycaster
        let isOccluded = false;
        if (isVisibleOnScreen) {
            const direction = sunPos.clone().sub(this.camera.position).normalize();
            this.raycaster.set(this.camera.position, direction);
            
            // Reuse explicit array to avoid GC and ensure we only hit the solid planetary body
            // recursive: false is intentional! We don't want clouds/atmosphere to trigger occlusion.
            const obstacles = [this.objects.earth, this.objects.mars].filter(obj => obj !== null);
            
            const intersects = this.raycaster.intersectObjects(obstacles, false);
            
            // If obstacle is closer than the sun, it's an occlusion
            if (intersects.length > 0) {
                const distToSun = this.camera.position.distanceTo(sunPos);
                if (intersects[0].distance < distToSun) {
                    isOccluded = true;
                }
            }
        }

        if (!isVisibleOnScreen || isOccluded) {
            this.flareElements.forEach(f => f.sprite.visible = false);
            return;
        }

        const sunVec = sunPos.clone().sub(this.camera.position);
        const camDir = new THREE.Vector3();
        this.camera.getWorldDirection(camDir);

        this.flareElements.forEach(f => {
            const dist = f.dist;
            const pos = this.camera.position.clone()
                .add(sunVec.clone().multiplyScalar(dist))
                .add(camDir.clone().multiplyScalar(1 - dist).multiplyScalar(0.5));
            
            f.sprite.position.copy(pos);
            f.sprite.visible = true;
        });
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        // Interpolate planet/ship positions
        const lerpAlpha = 0.1;
        
        if (this.objects.earth && this.objects.earth.userData.targetPos) {
            this.objects.earth.position.lerp(this.objects.earth.userData.targetPos, lerpAlpha);
        }
        
        if (this.objects.mars && this.objects.mars.userData.targetPos) {
            this.objects.mars.position.lerp(this.objects.mars.userData.targetPos, lerpAlpha);
        }
        
        if (this.objects.spacecraft) {
            const mesh = this.objects.spacecraft.getMesh();
            if (mesh.userData.targetPos) {
                mesh.position.lerp(mesh.userData.targetPos, lerpAlpha);
            }
            
            if (mesh.userData.lookTarget) {
                // Smooth lookAt
                const currentQuat = mesh.quaternion.clone();
                mesh.lookAt(mesh.userData.lookTarget);
                const targetQuat = mesh.quaternion.clone();
                mesh.quaternion.copy(currentQuat).slerp(targetQuat, lerpAlpha);
            }
            
            const time = Date.now();
            this.objects.spacecraft.update(time);
        }

        this.updateCamera();

        // FIX: Manually update camera matrices to avoid 1-frame lag in lighting calculation
        // The renderer usually does this, but we need it NOW to calculate sunPositionView correctly.
        this.camera.updateMatrixWorld();
        this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();

        if (this.objects.sun) {
            this.objects.sun.rotation.y += 0.001;
            
            if (this.earthMaterialShader) {
                const sunPosWorld = new THREE.Vector3();
                this.objects.sun.getWorldPosition(sunPosWorld);
                
                const earthPosWorld = new THREE.Vector3();
                this.objects.earth.getWorldPosition(earthPosWorld);
                
                const lightDirWorld = new THREE.Vector3().subVectors(earthPosWorld, sunPosWorld).normalize();
                
                const lightDirView = lightDirWorld.clone();
                lightDirView.transformDirection(this.camera.matrixWorldInverse);
                
                this.earthMaterialShader.uniforms.sunDirectionView.value.copy(lightDirView);
            }
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

        // Planet self-rotation: bind to (interpolated) simulation time so it respects time speed and pause.
        const simDays = this.getDisplaySimulationTimeDays();
        const twoPi = Math.PI * 2;
        if (this.objects.earth) {
            this.objects.earth.rotation.y = (simDays * this.earthSpinRate) % twoPi;
        }
        if (this.objects.earthClouds) {
            this.objects.earthClouds.rotation.y = (simDays * this.earthCloudSpinRate) % twoPi;
        }
        if (this.objects.mars) {
            this.objects.mars.rotation.y = (simDays * this.marsSpinRate) % twoPi;
        }
        if (this.objects.marsClouds) {
            this.objects.marsClouds.rotation.y = (simDays * this.marsCloudSpinRate) % twoPi;
        }

        if (this.objects.stars) {
            this.objects.stars.rotation.y += 0.0001;
            if (this.objects.stars.material.uniforms) {
                this.objects.stars.material.uniforms.time.value = Date.now() % 1000000;
            }
        }

        if (this.objects.nebulae) {
            this.objects.nebulae.rotation.y += 0.00005;
        }

        if (this.cinematicPass) {
            this.cinematicPass.uniforms.time.value = Date.now() * 0.001;
        }

        this.updateLensFlare();

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

    togglePlayPause() {
        const isRunning = !!(this.simulationState && this.simulationState.is_running);
        if (!isRunning) {
            this.startSimulation();
            return;
        }
        this.pauseSimulation();
    }

    getDisplaySimulationTimeDays() {
        const baseDays =
            (typeof this.simulationTimeDays === 'number' && Number.isFinite(this.simulationTimeDays))
                ? this.simulationTimeDays
                : 0.0;

        const isRunning = !!(this.simulationState && this.simulationState.is_running);
        const isPaused = !!(this.simulationState && this.simulationState.paused);
        if (!isRunning || isPaused) {
            return baseDays;
        }

        const nowMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        const dtSec = (nowMs - this.simulationTimeBaseMs) / 1000.0;
        const rate =
            (typeof this.simulationTimeRateDaysPerSec === 'number' && Number.isFinite(this.simulationTimeRateDaysPerSec))
                ? this.simulationTimeRateDaysPerSec
                : 0.0;

        return baseDays + Math.max(0.0, rate) * Math.max(0.0, dtSec);
    }
}

// Initialize the application
let app = null;

document.addEventListener('DOMContentLoaded', () => {
    app = new MarsMissionApp();
});
