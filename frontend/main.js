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

            color *= vec3(0.98, 1.0, 1.02);

            // 3. Simple Vignette (Darker corners)
            float vignette = 1.0 - dist * 0.5;
            color *= vignette;

            gl_FragColor = vec4(color, 1.0);
        }
    `
};

const TEXTURE_PATHS = Object.freeze({
    sunMap: '/static/assets/textures/sunmap.jpg',

    earthMap: '/static/assets/textures/earth/earthmap4k.jpg',
    earthBump: '/static/assets/textures/earth/earthbump4k.jpg',
    earthLights: '/static/assets/textures/earth/earthlights4k.jpg',
    earthSpec: '/static/assets/textures/earth/earthspec4k.jpg',
    earthCloudAlpha: '/static/assets/textures/earth/cloudmap4k.jpg',

    marsMap: '/static/assets/textures/mars/mars_2k_color.png',
    marsNormal: '/static/assets/textures/mars/mars_2k_normal.png',
    marsClouds: '/static/assets/textures/mars/mars_clouds.png'
});

const TEXTURE_PATH_LIST = Object.freeze([
    TEXTURE_PATHS.sunMap,
    TEXTURE_PATHS.earthMap,
    TEXTURE_PATHS.earthBump,
    TEXTURE_PATHS.earthLights,
    TEXTURE_PATHS.earthSpec,
    TEXTURE_PATHS.earthCloudAlpha,
    TEXTURE_PATHS.marsMap,
    TEXTURE_PATHS.marsNormal,
    TEXTURE_PATHS.marsClouds
]);

const BLOOM_LAYER = 1;

const AdditiveBlendShader = {
    uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        bloomStrength: { value: 1.0 }
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
        uniform sampler2D tBloom;
        uniform float bloomStrength;
        varying vec2 vUv;

        void main() {
            vec4 baseColor = texture2D(tDiffuse, vUv);
            vec4 bloomColor = texture2D(tBloom, vUv);
            gl_FragColor = baseColor + bloomColor * bloomStrength;
        }
    `
};

class MarsMissionApp {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.bloomComposer = null;
        this.finalComposer = null;
        this.additivePass = null;
        this.bloomPass = null;
        this.cinematicPass = null;
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
        this.sunWorldPosition = new THREE.Vector3();
        this.sunViewPosition = new THREE.Vector3();
        this.earthDayShader = null;
        this.earthNightShader = null;
        this.earthLightsShader = null;

        this.ws = null;
        this.connected = false;
        this.missionData = null;
        this.simulationRunning = false;
        this.viewMode = 'free';
        this.animationId = null;
        this.sharedTextures = {};
        this.textureRegistry = { color: new Set(), data: new Set() };
        this.textureColorMode = 'srgb';

        this.lensFlareOccluders = { earth: [], mars: null };

        this.bloomLayer = new THREE.Layers();
        this.bloomLayer.set(BLOOM_LAYER);
        this.bloomOcclusionMaterials = new Map();
        this.bloomHiddenObjects = new Map();
        this.darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });

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

        if (typeof THREE.sRGBEncoding !== 'undefined') {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }

        // Switch to ACES Filmic Tone Mapping for cinematic look
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
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
            'rgba(60, 90, 160, 0.20)',
            'rgba(70, 150, 190, 0.16)'
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
            { x: canvas.width * 0.78, y: canvas.height * 0.20, r: 220, c0: 'rgba(232, 248, 255, 0.82)', c1: 'rgba(232, 248, 255, 0.24)' },
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
        this.registerColorTexture(texture);
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
        this.textureRegistry.color.delete(environmentTexture);
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
        this.bloomComposer = new THREE.EffectComposer(this.renderer);
        this.bloomComposer.renderToScreen = false;

        const bloomRenderPass = new THREE.RenderPass(this.scene, this.camera);
        this.bloomComposer.addPass(bloomRenderPass);

        this.bloomPass = new THREE.UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.95,
            0.42,
            0.82
        );
        this.bloomComposer.addPass(this.bloomPass);

        this.finalComposer = new THREE.EffectComposer(this.renderer);

        const baseRenderPass = new THREE.RenderPass(this.scene, this.camera);
        this.finalComposer.addPass(baseRenderPass);

        this.additivePass = new THREE.ShaderPass(AdditiveBlendShader);
        this.additivePass.uniforms.tBloom.value = null;
        this.additivePass.uniforms.bloomStrength.value = 1.0;
        this.finalComposer.addPass(this.additivePass);

        this.cinematicPass = new THREE.ShaderPass(CinematicShader);
        this.cinematicPass.renderToScreen = true;
        this.finalComposer.addPass(this.cinematicPass);
    }

    setupLighting() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x223744, 1.1);
        this.scene.add(ambientLight);
        
        // Point light from sun
        const sunLight = new THREE.PointLight(0xf2fbff, 3.1, 100);
        sunLight.position.set(0, 0, 0);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        sunLight.shadow.camera.near = 0.5;
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

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        this.registerColorTexture(texture);
        return texture;
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
            this.registerColorTexture(this.sharedTextures.glow);
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
        this.registerColorTexture(texture);
        return texture;
    }

    createRadialTexture() {
        if (this.sharedTextures.radial) {
            this.registerColorTexture(this.sharedTextures.radial);
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
        this.registerColorTexture(texture);
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

     registerColorTexture(texture) {
         if (!texture) return texture;
         this.textureRegistry.color.add(texture);
         this.applyTextureColorMode(texture);
         return texture;
     }

     registerDataTexture(texture) {
         if (!texture) return texture;
         this.textureRegistry.data.add(texture);
         this.applyDataTextureEncoding(texture);
         return texture;
     }

     applyDataTextureEncoding(texture) {
         if (!texture) return;
         if (typeof THREE.LinearEncoding === 'undefined') return;

         if (texture.encoding !== THREE.LinearEncoding) {
             texture.encoding = THREE.LinearEncoding;
             texture.needsUpdate = true;
         }
     }

     applyTextureColorMode(texture) {
         if (!texture) return;
         if (typeof THREE.sRGBEncoding === 'undefined') return;

         const encoding = (this.textureColorMode === 'linear' && typeof THREE.LinearEncoding !== 'undefined')
             ? THREE.LinearEncoding
             : THREE.sRGBEncoding;

         if (texture.encoding !== encoding) {
             texture.encoding = encoding;
             texture.needsUpdate = true;
         }
     }

     applyPlanetTextureColorMode() {
         for (const texture of this.textureRegistry.color) {
             this.applyTextureColorMode(texture);
         }

         for (const texture of this.textureRegistry.data) {
             this.applyDataTextureEncoding(texture);
         }

         if (this.scene && typeof this.scene.traverse === 'function') {
             this.scene.traverse((child) => {
                 if (child && child.material) {
                     child.material.needsUpdate = true;
                 }
             });
         }
     }

     toggleTextureColorMode() {
         this.textureColorMode = (this.textureColorMode === 'srgb') ? 'linear' : 'srgb';
         this.applyPlanetTextureColorMode();
         console.info('Texture color mode:', this.textureColorMode);
     }


    disposeObject(obj) {
        if (!obj) return;

        const disposedTextures = new Set();
        const disposedMaterials = new Set();
        const disposedGeometries = new Set();

        const disposeTexture = (texture) => {
            if (!texture) return;
            if (disposedTextures.has(texture)) return;
            disposedTextures.add(texture);

            if (this.textureRegistry) {
                this.textureRegistry.color.delete(texture);
                this.textureRegistry.data.delete(texture);
            }

            if (this.sharedTextures) {
                for (const key of Object.keys(this.sharedTextures)) {
                    if (this.sharedTextures[key] === texture) {
                        delete this.sharedTextures[key];
                    }
                }
            }

            if (this.sunTexture === texture) {
                this.sunTexture = null;
            }

            texture.dispose();
        };

        const disposeMaterial = (material) => {
            if (!material) return;
            if (disposedMaterials.has(material)) return;
            disposedMaterials.add(material);

            const textureKeys = [
                'map',
                'alphaMap',
                'aoMap',
                'bumpMap',
                'displacementMap',
                'emissiveMap',
                'envMap',
                'lightMap',
                'metalnessMap',
                'normalMap',
                'roughnessMap',
                'specularMap'
            ];

            for (const key of textureKeys) {
                if (material[key]) {
                    disposeTexture(material[key]);
                }
            }

            material.dispose();
        };

        const disposeGeometry = (geometry) => {
            if (!geometry) return;
            if (disposedGeometries.has(geometry)) return;
            disposedGeometries.add(geometry);
            geometry.dispose();
        };

        const disposeNode = (node) => {
            if (!node) return;

            if (node.geometry) {
                disposeGeometry(node.geometry);
            }

            if (node.material) {
                if (Array.isArray(node.material)) {
                    node.material.forEach(disposeMaterial);
                } else {
                    disposeMaterial(node.material);
                }
            }

            if (node.children && node.children.length > 0) {
                const children = node.children.slice();
                for (const child of children) {
                    disposeNode(child);
                    node.remove(child);
                }
            }
        };

        disposeNode(obj);
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
        this.registerColorTexture(texture);
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
            { dist: 0.0, size: 1.0, opacity: 0.32, color: 0xffd6a5, tex: 'main' },
            { dist: 0.2, size: 0.15, opacity: 0.18, color: 0xffb27a, tex: 'hexagon' },
            { dist: 0.4, size: 0.08, opacity: 0.10, color: 0x8ec1ff, tex: 'hexagon' },
            { dist: 0.5, size: 0.3, opacity: 0.06, color: 0xb8d7ff, tex: 'ring' },
            { dist: 0.6, size: 0.1, opacity: 0.10, color: 0x8ec1ff, tex: 'hexagon' },
            { dist: 0.8, size: 0.2, opacity: 0.05, color: 0xb8d7ff, tex: 'ring' },
            { dist: 1.1, size: 0.3, opacity: 0.08, color: 0xffb27a, tex: 'hexagon' }
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
        const sunTexture = this.textureLoader.load(TEXTURE_PATHS.sunMap);
        this.registerColorTexture(sunTexture);
        sunTexture.wrapS = sunTexture.wrapT = THREE.RepeatWrapping;
        
        const material = new THREE.MeshStandardMaterial({
            map: sunTexture,
            emissive: 0xffaa00,
            emissiveIntensity: 6.0,
            emissiveMap: sunTexture,
            toneMapped: false,
            depthWrite: true
        });
        
        this.objects.sun = new THREE.Mesh(geometry, material);
        
        const glowTexture = this.createGlowTexture();
        
        const spriteMaterial1 = new THREE.SpriteMaterial({
            map: glowTexture,
            color: 0xffd2a3,
            transparent: true,
            opacity: 0.45,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const sprite1 = new THREE.Sprite(spriteMaterial1);
        sprite1.scale.set(0.8, 0.8, 1.0);
        this.objects.sun.add(sprite1);

        const spriteMaterial2 = new THREE.SpriteMaterial({
            map: glowTexture,
            color: 0xff9c63,
            transparent: true,
            opacity: 0.18,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const sprite2 = new THREE.Sprite(spriteMaterial2);
        sprite2.scale.set(1.6, 1.6, 1.0);
        this.objects.sun.add(sprite2);

        this.objects.sunGlow = [sprite1, sprite2];

        this.objects.sun.layers.enable(BLOOM_LAYER);
        sprite1.layers.enable(BLOOM_LAYER);
        sprite2.layers.enable(BLOOM_LAYER);
        
        this.scene.add(this.objects.sun);
        this.sunTexture = sunTexture;
    }

    createAtmosphereMaterial({
        rimColor,
        hazeColor,
        twilightColor,
        intensity = 0.12,
        twilightWidth = 0.05,
        hazeStrength = 0.12,
        twilightStrength = 0.25,
        twilightAlpha = 0.55,
        alphaScale = 0.9
    }) {
        return new THREE.ShaderMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.BackSide,
            uniforms: {
                rimColor: { value: rimColor.clone() },
                hazeColor: { value: hazeColor.clone() },
                twilightColor: { value: twilightColor.clone() },
                sunDirection: { value: new THREE.Vector3(1, 0, 0) },
                cameraFactor: { value: 0.0 },
                rimPowerNear: { value: 5.0 },
                rimPowerFar: { value: 3.5 },
                rimIntensity: { value: intensity },
                hazeStrength: { value: hazeStrength },
                twilightWidth: { value: twilightWidth },
                twilightStrength: { value: twilightStrength },
                twilightAlpha: { value: twilightAlpha },
                alphaScale: { value: alphaScale }
            },
            vertexShader: `
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;
                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPos.xyz;
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: `
                uniform vec3 rimColor;
                uniform vec3 hazeColor;
                uniform vec3 twilightColor;
                uniform vec3 sunDirection;
                uniform float cameraFactor;
                uniform float rimPowerNear;
                uniform float rimPowerFar;
                uniform float rimIntensity;
                uniform float hazeStrength;
                uniform float twilightWidth;
                uniform float twilightStrength;
                uniform float twilightAlpha;
                uniform float alphaScale;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;

	                void main() {
	                    vec3 N = normalize(vWorldNormal);
	                    vec3 V = normalize(cameraPosition - vWorldPos);
	                    float ndv = abs(dot(N, V));
	                    float fresnel = pow(1.0 - ndv, mix(rimPowerNear, rimPowerFar, cameraFactor));
	                    float outerFade = smoothstep(0.0, mix(0.06, 0.02, cameraFactor), ndv);
	                    fresnel *= outerFade;
	                    float sunDot = dot(N, normalize(sunDirection));
	                    float daySide = smoothstep(-0.2, 0.2, sunDot);
	                    float rim = fresnel * rimIntensity * mix(0.35, 1.0, daySide);
	                    float twilight = smoothstep(twilightWidth, 0.0, abs(sunDot));
                    float dayMask = smoothstep(0.0, 0.35, sunDot);

                    vec3 color = rim * rimColor;
                    color += twilight * twilightColor * twilightStrength;
                    color += hazeStrength * rim * mix(hazeColor, rimColor, dayMask);

                    float alpha = clamp((rim + twilight * twilightAlpha) * alphaScale, 0.0, 1.0);
                    gl_FragColor = vec4(color, alpha);
                }
            `
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
            const earthTexture = this.textureLoader.load(TEXTURE_PATHS.earthMap);
            earthTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            earthTexture.minFilter = THREE.LinearMipmapLinearFilter;
            earthTexture.magFilter = THREE.LinearFilter;
            this.registerColorTexture(earthTexture);
            
            const earthBump = this.textureLoader.load(TEXTURE_PATHS.earthBump);
            earthBump.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            earthBump.minFilter = THREE.LinearMipmapLinearFilter;
            earthBump.magFilter = THREE.LinearFilter;
            this.registerDataTexture(earthBump);
            
            const earthLights = this.textureLoader.load(TEXTURE_PATHS.earthLights);
            earthLights.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            earthLights.minFilter = THREE.LinearMipmapLinearFilter;
            earthLights.magFilter = THREE.LinearFilter;
            this.registerColorTexture(earthLights);
            
            const earthSpec = this.textureLoader.load(TEXTURE_PATHS.earthSpec);
            earthSpec.minFilter = THREE.LinearFilter;
            earthSpec.magFilter = THREE.LinearFilter;
            this.registerDataTexture(earthSpec);
            
            const earthNightMaterial = new THREE.MeshStandardMaterial({
                map: earthTexture,
                bumpMap: earthBump,
                bumpScale: 0.0,
                emissive: new THREE.Color(0x000000),
                emissiveIntensity: 0,
                metalness: 0.0,
                roughness: 1.0,
                roughnessMap: earthSpec,
                envMapIntensity: 0.02
            });

            const earthDayMaterial = new THREE.MeshStandardMaterial({
                map: earthTexture,
                bumpMap: earthBump,
                bumpScale: 0.003,
                emissive: new THREE.Color(0x000000),
                emissiveIntensity: 0,
                metalness: 0.0,
                roughness: 1.0,
                roughnessMap: earthSpec,
                envMapIntensity: 0.02
            });

            material = earthNightMaterial;

            earthDayMaterial.onBeforeCompile = (shader) => {
                shader.uniforms.sunPositionView = { value: new THREE.Vector3(0, 0, 0) };
                this.earthDayShader = shader;

                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    `
                    #include <common>
                    uniform vec3 sunPositionView;
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
                    '#include <dithering_fragment>',
                    `
                    vec3 fragPosView = -vViewPosition;
                    vec3 sunDirView = normalize(sunPositionView - fragPosView);
                    float ndl = dot(normalize(vNormal), sunDirView);
                    float dayFactor = smoothstep(0.03, 0.12, ndl);
                    float noise = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453123);
                    if (noise >= dayFactor) discard;
                    #include <dithering_fragment>
                    `
                );
            };

            material.onBeforeCompile = (shader) => {
                shader.uniforms.sunPositionView = { value: new THREE.Vector3(0, 0, 0) };
                this.earthNightShader = shader;

                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    `
                    #include <common>
                    uniform vec3 sunPositionView;
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
                    '#include <dithering_fragment>',
                    `
                    vec3 fragPosView = -vViewPosition;
                    vec3 sunDirView = normalize(sunPositionView - fragPosView);
                    float ndl = dot(normalize(vNormal), sunDirView);
                    float dayFactor = smoothstep(0.03, 0.12, ndl);
                    float noise = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453123);
                    if (noise < dayFactor) discard;
                    #include <dithering_fragment>
                    `
                );
            };

            const earthLightsMaterial = new THREE.MeshStandardMaterial({
                color: 0x000000,
                emissive: new THREE.Color(0xffffff),
                emissiveIntensity: 1.0,
                emissiveMap: earthLights,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                metalness: 0.0,
                roughness: 1.0,
                envMapIntensity: 0.0,
                toneMapped: false
            });

            earthLightsMaterial.onBeforeCompile = (shader) => {
                shader.uniforms.sunPositionView = { value: new THREE.Vector3(0, 0, 0) };
                this.earthLightsShader = shader;

                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    `
                    #include <common>
                    uniform vec3 sunPositionView;
                    `
                );

                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <emissivemap_fragment>',
                    `
                    #ifdef USE_EMISSIVEMAP
                        vec3 emissiveTexel = emissiveMapTexelToLinear(texture2D(emissiveMap, vUv)).rgb;
                        float luminance = dot(emissiveTexel, vec3(0.2126, 0.7152, 0.0722));

                        float baseMask = smoothstep(0.01, 0.22, luminance);
                        float baseGlow = pow(clamp(luminance, 0.0, 1.0), 0.65) * baseMask;

                        float cityMask = smoothstep(0.25, 0.60, luminance);
                        cityMask = pow(cityMask, 2.2);

                        vec3 baseColor = vec3(1.0, 0.95, 0.88) * (baseGlow * 0.9);
                        vec3 cityColor = vec3(1.0, 0.78, 0.55) * (cityMask * 1.0);

                        totalEmissiveRadiance = baseColor + cityColor;
                    #endif
                    `
                );

                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <dithering_fragment>',
                    `
                    vec3 fragPosView = -vViewPosition;
                    vec3 sunDirView = normalize(sunPositionView - fragPosView);
                    float ndl = dot(normalize(vNormal), sunDirView);
                    float dayFactor = smoothstep(0.03, 0.12, ndl);
                    float noise = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453123);
                    if (noise < dayFactor) discard;
                    #include <dithering_fragment>
                    `
                );
            };

            const lightsGeometry = new THREE.SphereGeometry(size * 1.001, 64, 64);
            const lightsMesh = new THREE.Mesh(lightsGeometry, earthLightsMaterial);
            lightsMesh.layers.enable(BLOOM_LAYER);

            const cloudGeometry = new THREE.SphereGeometry(size * 1.01, 64, 64);

            const cloudAlpha = this.textureLoader.load(TEXTURE_PATHS.earthCloudAlpha);
            cloudAlpha.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            cloudAlpha.minFilter = THREE.LinearMipmapLinearFilter;
            cloudAlpha.magFilter = THREE.LinearFilter;
            this.registerDataTexture(cloudAlpha);

            const cloudMaterial = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                alphaMap: cloudAlpha,
                transparent: true,
                opacity: 0.6,
                metalness: 0.0,
                roughness: 0.9,               // 稍微降低粗糙度
                emissive: 0x000000,
                emissiveIntensity: 0.0,
                envMapIntensity: 1,           // 反射环境光
                depthWrite: false,
                //side: THREE.DoubleSide        // 双面渲染
            });

            const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
            // clouds.castShadow = true;
            // clouds.receiveShadow = false;
            this.objects.earthClouds = clouds;
            
            const earthGroup = new THREE.Group();

            const earthDayMesh = new THREE.Mesh(geometry, earthDayMaterial);
            const earthNightMesh = new THREE.Mesh(geometry, material);

            earthGroup.add(earthDayMesh);
            earthGroup.add(earthNightMesh);
            earthGroup.add(lightsMesh);
            earthGroup.add(clouds);

            this.objects[name] = earthGroup;
            this.lensFlareOccluders.earth = [earthDayMesh, earthNightMesh];
        } else if (name === 'mars') {
            const marsTexture = this.loadTextureWithFallback(
                TEXTURE_PATHS.marsMap
            );
            marsTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            marsTexture.minFilter = THREE.LinearMipmapLinearFilter;
            marsTexture.magFilter = THREE.LinearFilter;
            this.registerColorTexture(marsTexture);

            const marsNormal = this.loadTextureWithFallback(
                TEXTURE_PATHS.marsNormal
            );
            marsNormal.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            marsNormal.minFilter = THREE.LinearMipmapLinearFilter;
            marsNormal.magFilter = THREE.LinearFilter;
            this.registerDataTexture(marsNormal);
            
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
            this.lensFlareOccluders.mars = this.objects[name];

            // Mars clouds (separate transparent shell)
            const cloudGeometry = new THREE.SphereGeometry(size * 1.018, 64, 64);
            const marsClouds = this.textureLoader.load(
                TEXTURE_PATHS.marsClouds,
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
            this.registerColorTexture(marsClouds);

            const cloudMaterial = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                map: marsClouds,
                transparent: true,
                opacity: 0.12,
                metalness: 0.0,
                roughness: 1.0,
                emissive: 0x050505,
                emissiveIntensity: 0.1,
                envMapIntensity: 0.2,
                depthWrite: false,
                // side: THREE.DoubleSide
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

        const atmospherePreset = name === 'earth'
            ? {
                rimColor: new THREE.Color(0.75, 0.9, 1.0),
                hazeColor: new THREE.Color(0.58, 0.80, 1.0),
                twilightColor: new THREE.Color(0.75, 0.88, 1.0),
                intensity: 0.85,
                twilightWidth: 0.1,
                hazeStrength: 0.2,
                twilightStrength: 0.42,
                twilightAlpha: 0.75,
                alphaScale: 1.0
            }
            : name === 'mars'
                ? {
                    rimColor: new THREE.Color(0.90, 0.55, 0.35),
                    hazeColor: new THREE.Color(0.75, 0.60, 0.45),
                    twilightColor: new THREE.Color(1.0, 0.65, 0.40),
                    intensity: 0.28,
                    twilightWidth: 0.08,
                    hazeStrength: 0.06,
                    twilightStrength: 0.1,
                    twilightAlpha: 0.25,
                    alphaScale: 0.75
                }
                : {
                    rimColor: new THREE.Color(color),
                    hazeColor: new THREE.Color(color),
                    twilightColor: new THREE.Color(color),
                    intensity: 0.4,
                    twilightWidth: 0.1,
                    hazeStrength: 0.1,
                    twilightStrength: 0.18,
                    twilightAlpha: 0.4,
                    alphaScale: 0.85
                };

        const atmosphereRadius = name === 'earth'
            ? size * 1.02
            : name === 'mars'
                ? size * 1.01
                : size * 1.01;

        const atmosphereGeometry = new THREE.SphereGeometry(atmosphereRadius, 64, 64);
        const atmosphereMaterial = this.createAtmosphereMaterial(atmospherePreset);
        const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        atmosphere.userData.atmosphereRadius = atmosphereRadius;

        const planetWorldPos = new THREE.Vector3();
        const sunWorldPos = new THREE.Vector3();
        const sunDirWorld = new THREE.Vector3();
        const updateAtmosUniforms = (mesh, camera) => {
            if (!mesh.material || !mesh.material.uniforms) return;
            mesh.getWorldPosition(planetWorldPos);
            sunWorldPos.copy(this.sunWorldPosition);
            // Direction from planet -> sun (so N·L > 0 is the day side)
            sunDirWorld.subVectors(sunWorldPos, planetWorldPos);
            const len = sunDirWorld.length();
            if (len > 0.0001) {
                sunDirWorld.divideScalar(len);
            } else {
                sunDirWorld.set(1, 0, 0);
            }
            mesh.material.uniforms.sunDirection.value.copy(sunDirWorld);

            const r = mesh.userData.atmosphereRadius || size;
            const dist = camera.position.distanceTo(planetWorldPos);
            const start = r * 1.05;
            const end = r * 3.0;
            mesh.material.uniforms.cameraFactor.value =
                THREE.MathUtils.clamp((dist - start) / (end - start), 0, 1);
        };

        atmosphere.onBeforeRender = (renderer, scene, camera) => {
            updateAtmosUniforms(atmosphere, camera);
        };

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
        if (this.bloomComposer) {
            this.bloomComposer.setSize(window.innerWidth, window.innerHeight);
        }
        if (this.finalComposer) {
            this.finalComposer.setSize(window.innerWidth, window.innerHeight);
        }
        if (this.bloomPass) {
            this.bloomPass.resolution.set(window.innerWidth, window.innerHeight);
        }
    }

    updateConnectionStatus(connected) {
        if (typeof updateStatusIndicator === 'function') {
            if (connected) {
                updateStatusIndicator('System Online', 'connected');
            } else {
                updateStatusIndicator('System Offline', 'disconnected');
            }
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
            
            const obstacles = [];
            if (this.lensFlareOccluders && Array.isArray(this.lensFlareOccluders.earth)) {
                obstacles.push(...this.lensFlareOccluders.earth);
            } else if (this.objects.earth) {
                obstacles.push(this.objects.earth);
            }
            if (this.lensFlareOccluders && this.lensFlareOccluders.mars) {
                obstacles.push(this.lensFlareOccluders.mars);
            } else if (this.objects.mars) {
                obstacles.push(this.objects.mars);
            }

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

            this.objects.sun.getWorldPosition(this.sunWorldPosition);
            
            this.sunViewPosition.copy(this.sunWorldPosition);
            this.sunViewPosition.applyMatrix4(this.camera.matrixWorldInverse);

            if (this.earthDayShader && this.earthDayShader.uniforms.sunPositionView) {
                this.earthDayShader.uniforms.sunPositionView.value.copy(this.sunViewPosition);
            }
            if (this.earthNightShader && this.earthNightShader.uniforms.sunPositionView) {
                this.earthNightShader.uniforms.sunPositionView.value.copy(this.sunViewPosition);
            }
            if (this.earthLightsShader && this.earthLightsShader.uniforms.sunPositionView) {
                this.earthLightsShader.uniforms.sunPositionView.value.copy(this.sunViewPosition);
            }
        }

        if (this.objects.sunGlow) {
            const time = Date.now() * 0.002;
            const pulse = 1.0 + Math.sin(time) * 0.08;
            this.objects.sunGlow[0].scale.set(0.8 * pulse, 0.8 * pulse, 1.0);
            this.objects.sunGlow[1].scale.set(1.6 * (1.0 + Math.sin(time * 0.5) * 0.12), 1.6 * (1.0 + Math.sin(time * 0.5) * 0.12), 1.0);
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

        if (
            this.bloomComposer &&
            this.finalComposer &&
            this.darkMaterial &&
            this.bloomOcclusionMaterials &&
            this.bloomHiddenObjects
        ) {
            const priorMask = this.camera.layers.mask;
            this.camera.layers.mask = priorMask;
            this.camera.layers.enable(BLOOM_LAYER);

            this.bloomOcclusionMaterials.clear();
            this.bloomHiddenObjects.clear();

            if (this.scene && typeof this.scene.traverse === 'function') {
                this.scene.traverse((obj) => {
                    if (!obj) return;
                    if (obj === this.scene) return;
                    if (obj.isLight === true) return;
                    if (obj.isCamera === true) return;

                    const inBloomLayer = !!(obj.layers && obj.layers.test && obj.layers.test(this.bloomLayer));
                    const isRenderable = obj.isMesh === true || obj.isPoints === true || obj.isLine === true || obj.isSprite === true;

                    if (!isRenderable || inBloomLayer) {
                        return;
                    }

                    if (obj.isMesh === true && obj.material) {
                        const material = obj.material;
                        const isTransparent = Array.isArray(material)
                            ? material.some((m) => m && m.transparent)
                            : !!material.transparent;
                        const depthWriteDisabled = Array.isArray(material)
                            ? material.some((m) => m && m.depthWrite === false)
                            : material.depthWrite === false;

                        if (!isTransparent && !depthWriteDisabled) {
                            this.bloomOcclusionMaterials.set(obj, material);
                            obj.material = this.darkMaterial;
                            return;
                        }
                    }

                    this.bloomHiddenObjects.set(obj, obj.visible);
                    obj.visible = false;
                });
            }

            this.bloomComposer.render();

            for (const [obj, material] of this.bloomOcclusionMaterials.entries()) {
                obj.material = material;
            }
            this.bloomOcclusionMaterials.clear();

            for (const [obj, visible] of this.bloomHiddenObjects.entries()) {
                obj.visible = visible;
            }
            this.bloomHiddenObjects.clear();

            this.camera.layers.mask = priorMask;

            if (this.additivePass && this.bloomComposer.readBuffer) {
                this.additivePass.uniforms.tBloom.value = this.bloomComposer.readBuffer.texture;
            }

            this.finalComposer.render();
        } else if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
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
