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
        this.sharedTextures = {};
        
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
        this.createSun();
        this.createPlanet('earth', data.earth_orbit);
        this.createPlanet('mars', data.mars_orbit);
        this.createSpacecraft();
        updateMissionInfo(data.mission_info);
        document.getElementById('total-days').textContent = Math.round(data.mission_info.total_duration);
        document.getElementById('timeline').max = Math.round(data.mission_info.total_duration);
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
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        this.renderer.toneMappingExposure = 1.2;
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
            const r = 800 + Math.random() * 400;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            let x = r * Math.sin(phi) * Math.cos(theta);
            let y = r * Math.sin(phi) * Math.sin(theta);
            let z = r * Math.cos(phi);

            const tilt = 0.5;
            if (isDust || Math.random() > 0.6) {
                const spread = isDust ? 150 : 250;
                const dist = 50 + Math.random() * spread;
                const angle = Math.random() * Math.PI * 2;
                x = dist * Math.cos(angle) * (r / 300);
                y = (dist * Math.sin(angle) * Math.sin(tilt) + (Math.random() - 0.5) * (isDust ? 60 : 100)) * (r / 300);
                z = (dist * Math.sin(angle) * Math.cos(tilt)) * (r / 300);
            }

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            const color = isDust ? new THREE.Color(0xaa88ff) : colorOptions[Math.floor(Math.random() * colorOptions.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
            sizes[i] = isDust ? 0.3 + Math.random() * 0.5 : 0.8 + Math.random() * 2.5;
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
                    float intensity = pow(1.0 + dot(vNormal, vec3(0, 0, 1.0)), 6.0);
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
            const earthTexture = this.textureLoader.load('/static/assets/textures/earth_atmos_2048.jpg');
            const earthBump = this.textureLoader.load('/static/assets/textures/earthbump1k.jpg');
            const earthLights = this.textureLoader.load('/static/assets/textures/earthlights1k.jpg');
            
            material = new THREE.MeshStandardMaterial({
                map: earthTexture,
                bumpMap: earthBump,
                bumpScale: 0.03,
                emissiveMap: earthLights,
                emissive: new THREE.Color(0xffff44),
                emissiveIntensity: 0.8,
                metalness: 0.0,
                roughness: 0.92,
                envMapIntensity: 0.2
            });

            const cloudGeometry = new THREE.SphereGeometry(size * 1.02, 64, 64);
            const cloudTexture = this.textureLoader.load('/static/assets/textures/earth_clouds_1024.png');
            const cloudMaterial = new THREE.MeshStandardMaterial({
                map: cloudTexture,
                transparent: true,
                opacity: 0.75,
                metalness: 0.0,
                roughness: 1.0,
                envMapIntensity: 0.0,
                depthWrite: false
            });
            const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
            this.objects.earthClouds = clouds;
            
            this.objects[name] = new THREE.Mesh(geometry, material);
            this.objects[name].add(clouds);
        } else if (name === 'mars') {
            const marsTexture = this.textureLoader.load('/static/assets/textures/mars_1k_color.jpg');
            const marsBump = this.textureLoader.load('/static/assets/textures/marsbump1k.jpg');
            
            material = new THREE.MeshStandardMaterial({
                map: marsTexture,
                bumpMap: marsBump,
                bumpScale: 0.02,
                metalness: 0.0,
                roughness: 0.98,
                envMapIntensity: 0.15
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

        const atmosphereGeometry = new THREE.SphereGeometry(size * 1.06, 64, 64);
        const atmosphereMaterial = this.createAtmosphereMaterial(color);
        const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        this.objects[name].add(atmosphere);
        
        const orbitGeometry = new THREE.BufferGeometry();
        const positions = [];
        
        orbitPoints.points.forEach(point => {
            positions.push(point[0], point[2], point[1]);
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
            this.objects.earth.position.set(pos[0], pos[2], pos[1]);
        }
        
        if (missionInfo.mars_position && this.objects.mars) {
            const pos = missionInfo.mars_position;
            this.objects.mars.position.set(pos[0], pos[2], pos[1]);
        }
        
        if (missionInfo.spacecraft_position && this.objects.spacecraft) {
            const pos = missionInfo.spacecraft_position;
            this.objects.spacecraft.getMesh().position.set(pos[0], pos[2], pos[1]);
            this.objects.spacecraft.getMesh().visible = true;

            const isTransfer = missionInfo.phase === 'transfer_to_mars' || missionInfo.phase === 'transfer_to_earth';
            this.objects.spacecraft.setThrusterActive(isTransfer);

            if (isTransfer) {
                this.updateSpacecraftTrail([pos[0], pos[2], pos[1]]);
            }
            
            if (this.lastSpacecraftPosition && Array.isArray(this.lastSpacecraftPosition)) {
                const rawDirection = new THREE.Vector3(
                    pos[0] - this.lastSpacecraftPosition[0],
                    pos[2] - this.lastSpacecraftPosition[1],
                    pos[1] - this.lastSpacecraftPosition[2]
                );

                if (rawDirection.length() > 0.001) {
                    const direction = rawDirection.normalize();
                    const target = new THREE.Vector3(
                        pos[0] + direction.x,
                        pos[2] + direction.y,
                        pos[1] + direction.z
                    );
                    this.objects.spacecraft.getMesh().lookAt(target);
                }
            }
            this.lastSpacecraftPosition = [pos[0], pos[2], pos[1]];
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

    updateLensFlare() {
        if (!this.flareElements || !this.objects.sun) return;

        const sunPos = new THREE.Vector3();
        this.objects.sun.getWorldPosition(sunPos);

        const screenPos = sunPos.clone();
        screenPos.project(this.camera);

        const isVisible = (screenPos.x >= -1 && screenPos.x <= 1 &&
                           screenPos.y >= -1 && screenPos.y <= 1 &&
                           screenPos.z < 1);

        if (!isVisible) {
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
            if (this.objects.stars.material.uniforms) {
                this.objects.stars.material.uniforms.time.value = Date.now() % 1000000;
            }
        }

        if (this.objects.nebulae) {
            this.objects.nebulae.rotation.y += 0.00005;
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
}

// Initialize the application
let app = null;

document.addEventListener('DOMContentLoaded', () => {
    app = new MarsMissionApp();
});
