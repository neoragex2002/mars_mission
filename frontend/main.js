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

    earthMap: '/static/assets/textures/earth/4k/earth_day.jpg',
    earthBump: '/static/assets/textures/earth/4k/earth_bump.jpg',
    earthLights: '/static/assets/textures/earth/4k/earth_night.jpg',
    earthSpec: '/static/assets/textures/earth/4k/earth_spec.jpg',
    earthCloudAlpha: '/static/assets/textures/earth/4k/earth_clouds.jpg',

    marsMap: '/static/assets/textures/mars/2k/mars_diffuse.png',
    marsNormal: '/static/assets/textures/mars/2k/mars_norm.png',
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
const CONTACT_SHADOW_LAYER = 2;

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

const DebugViewShader = {
    uniforms: {
        tDiffuse: { value: null },
        debugMode: { value: 0 }
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
        uniform float debugMode;
        varying vec2 vUv;

        vec3 exposureRamp(float luma) {
            if (luma >= 8.0) return vec3(1.0);
            if (luma >= 4.0) return vec3(1.0, 0.0, 1.0);
            if (luma >= 2.0) return vec3(1.0, 0.35, 0.0);
            if (luma >= 1.0) return vec3(1.0, 1.0, 0.0);
            float t = clamp(luma, 0.0, 1.0);
            return mix(vec3(0.0, 0.12, 0.3), vec3(0.0, 0.7, 1.0), t);
        }

        void main() {
            vec3 color = texture2D(tDiffuse, vUv).rgb;
            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            if (debugMode > 1.5) {
                gl_FragColor = vec4(vec3(luma), 1.0);
            } else {
                gl_FragColor = vec4(exposureRamp(luma), 1.0);
            }
        }
    `
};

const ContactShadowShader = {
    uniforms: {
        tDiffuse: { value: null },
        tSceneDepth: { value: null },
        tShipDepth: { value: null },

        uProjectionMatrix: { value: new THREE.Matrix4() },
        uInvProjectionMatrix: { value: new THREE.Matrix4() },
        uViewMatrix: { value: new THREE.Matrix4() },
        uInvViewMatrix: { value: new THREE.Matrix4() },

        uDepthAvailable: { value: 0.0 },
        uSunPosWorld: { value: new THREE.Vector3(0, 0, 0) },

        uMaxDistance: { value: 0.18 },
        uThickness: { value: 0.003 },
        uStrength: { value: 1.1 },
        uSteps: { value: 22 },

        uMinWorldRadius: { value: 0.35 },
        uMaxViewDistance: { value: 80.0 },
        uVisibilityEps: { value: 0.002 }
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
        uniform sampler2D tSceneDepth;
        uniform sampler2D tShipDepth;

        uniform mat4 uProjectionMatrix;
        uniform mat4 uInvProjectionMatrix;
        uniform mat4 uViewMatrix;
        uniform mat4 uInvViewMatrix;

        uniform float uDepthAvailable;
        uniform vec3 uSunPosWorld;

        uniform float uMaxDistance;
        uniform float uThickness;
        uniform float uStrength;
        uniform float uSteps;
        uniform float uMinWorldRadius;
        uniform float uMaxViewDistance;
        uniform float uVisibilityEps;

        varying vec2 vUv;

        #define MAX_STEPS 24

        vec3 reconstructViewPosition(vec2 uv, float depth) {
            float z = depth * 2.0 - 1.0;
            vec4 clip = vec4(uv * 2.0 - 1.0, z, 1.0);
            vec4 view = uInvProjectionMatrix * clip;
            return view.xyz / max(view.w, 1e-6);
        }

        vec2 projectToUv(vec3 viewPos) {
            vec4 clip = uProjectionMatrix * vec4(viewPos, 1.0);
            vec3 ndc = clip.xyz / max(clip.w, 1e-6);
            return ndc.xy * 0.5 + 0.5;
        }

        void main() {
            vec4 base = texture2D(tDiffuse, vUv);

            if (uDepthAvailable < 0.5) {
                gl_FragColor = base;
                return;
            }

            float shipDepth = texture2D(tShipDepth, vUv).x;
            if (shipDepth >= 1.0) {
                // Not a spacecraft pixel.
                gl_FragColor = base;
                return;
            }

            float sceneDepth = texture2D(tSceneDepth, vUv).x;
            if (sceneDepth >= 1.0) {
                // Scene depth missing or mismatch. Avoid applying on unknown pixels.
                gl_FragColor = base;
                return;
            }

            vec3 shipView = reconstructViewPosition(vUv, shipDepth);
            vec3 sceneView = reconstructViewPosition(vUv, sceneDepth);

            // Apply only when the spacecraft is actually visible in the main render.
            // (If the spacecraft is occluded by a planet, shipDepth still exists in the ship-only prepass.)
            if (abs(shipView.z - sceneView.z) > uVisibilityEps) {
                gl_FragColor = base;
                return;
            }

            vec3 pView = shipView;
            vec3 pWorld = (uInvViewMatrix * vec4(pView, 1.0)).xyz;

            float rWorld = length(pWorld);
            if (rWorld < uMinWorldRadius || length(pView) > uMaxViewDistance) {
                gl_FragColor = base;
                return;
            }

            vec3 toSunWorld = uSunPosWorld - pWorld;
            vec3 toSunView = (uViewMatrix * vec4(toSunWorld, 0.0)).xyz;
            float toSunLen = length(toSunView);
            if (toSunLen <= 1e-6) {
                gl_FragColor = base;
                return;
            }

            vec3 rayDirView = toSunView / toSunLen;
            float maxDist = min(uMaxDistance, toSunLen);

            float steps = clamp(floor(uSteps + 0.5), 1.0, float(MAX_STEPS));

            float occlusion = 0.0;
            float startDist = max(uThickness * 2.0, 1e-5);

            for (int i = 0; i < MAX_STEPS; i++) {
                if (float(i) >= steps) break;

                float t = float(i) / max(steps - 1.0, 1.0);
                float dist = startDist + t * maxDist;

                vec3 sampleView = pView + rayDirView * dist;
                vec2 suv = projectToUv(sampleView);
                if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
                    break;
                }

                float sDepth = texture2D(tShipDepth, suv).x;
                if (sDepth >= 1.0) {
                    continue;
                }

                vec3 occView = reconstructViewPosition(suv, sDepth);

                if (occView.z > sampleView.z + uThickness) {
                    float w = 1.0 - smoothstep(0.0, maxDist, dist);
                    occlusion = max(occlusion, w);
                    break;
                }
            }

            float shadowFactor = clamp(1.0 - uStrength * occlusion, 0.0, 1.0);
            gl_FragColor = vec4(base.rgb * shadowFactor, base.a);
        }
    `
};

const ContactShadowDebugShader = {
    uniforms: {
        tShipDepth: { value: null },

        uProjectionMatrix: { value: new THREE.Matrix4() },
        uInvProjectionMatrix: { value: new THREE.Matrix4() },
        uViewMatrix: { value: new THREE.Matrix4() },
        uInvViewMatrix: { value: new THREE.Matrix4() },

        uDepthAvailable: { value: 0.0 },
        uSunPosWorld: { value: new THREE.Vector3(0, 0, 0) },

        uDebugMode: { value: 0.0 },
        uNear: { value: 0.01 },
        uFar: { value: 3000.0 },
        uDebugMaxZ: { value: 50.0 },

        uMaxDistance: { value: 0.18 },
        uThickness: { value: 0.003 },
        uSteps: { value: 22 },
        uVisibilityEps: { value: 0.002 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tShipDepth;

        uniform mat4 uProjectionMatrix;
        uniform mat4 uInvProjectionMatrix;
        uniform mat4 uViewMatrix;
        uniform mat4 uInvViewMatrix;

        uniform float uDepthAvailable;
        uniform vec3 uSunPosWorld;

        uniform float uDebugMode;
        uniform float uNear;
        uniform float uFar;
        uniform float uDebugMaxZ;

        uniform float uMaxDistance;
        uniform float uThickness;
        uniform float uSteps;
        uniform float uVisibilityEps;

        varying vec2 vUv;

        #define MAX_STEPS 24

        vec3 reconstructViewPosition(vec2 uv, float depth) {
            float z = depth * 2.0 - 1.0;
            vec4 clip = vec4(uv * 2.0 - 1.0, z, 1.0);
            vec4 view = uInvProjectionMatrix * clip;
            return view.xyz / max(view.w, 1e-6);
        }

        vec2 projectToUv(vec3 viewPos) {
            vec4 clip = uProjectionMatrix * vec4(viewPos, 1.0);
            vec3 ndc = clip.xyz / max(clip.w, 1e-6);
            return ndc.xy * 0.5 + 0.5;
        }

        float linearDepth01(vec3 viewPos) {
            float z = -viewPos.z;
            return clamp((z - uNear) / max(uFar - uNear, 1e-6), 0.0, 1.0);
        }

        void main() {
            if (uDepthAvailable < 0.5) {
                gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
                return;
            }

            float shipDepth = texture2D(tShipDepth, vUv).x;
            bool shipValid = shipDepth < 1.0;
            if (!shipValid) {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                return;
            }

            vec3 shipView = reconstructViewPosition(vUv, shipDepth);

            if (uDebugMode < 1.5) {
                // Depth debug (contrast-enhanced).
                vec3 viewPos = shipView;
                float z = max(-viewPos.z, 0.0);
                float maxZ = max(uDebugMaxZ, 1e-3);

	                float dn = clamp(log2(1.0 + z) / log2(1.0 + maxZ), 0.0, 1.0);
	                float shade = pow(1.0 - dn, 0.45);
	
	                float v = dn * 48.0;
	                float tri = abs(fract(v) - 0.5);
	                float line = 1.0 - smoothstep(0.0, 0.06, tri);
	
	                vec3 base = vec3(shade);
	                vec3 lineColor = vec3(1.0, 0.92, 0.25);
	                vec3 color = mix(base, lineColor, line * 0.55);

                gl_FragColor = vec4(color, 1.0);
                return;
            }

            // Occlusion debug (0..1). Only meaningful on visible spacecraft pixels.
            vec3 pWorld = (uInvViewMatrix * vec4(shipView, 1.0)).xyz;

            vec3 toSunWorld = uSunPosWorld - pWorld;
            vec3 toSunView = (uViewMatrix * vec4(toSunWorld, 0.0)).xyz;
            float toSunLen = length(toSunView);
            if (toSunLen <= 1e-6) {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                return;
            }

            vec3 rayDirView = toSunView / toSunLen;
            float maxDist = min(uMaxDistance, toSunLen);
            float steps = clamp(floor(uSteps + 0.5), 1.0, float(MAX_STEPS));

            float occlusion = 0.0;
            float startDist = max(uThickness * 2.0, 1e-5);

            for (int i = 0; i < MAX_STEPS; i++) {
                if (float(i) >= steps) break;

                float t = float(i) / max(steps - 1.0, 1.0);
                float dist = startDist + t * maxDist;
                vec3 sampleView = shipView + rayDirView * dist;
                vec2 suv = projectToUv(sampleView);
                if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
                    break;
                }

                float sDepth = texture2D(tShipDepth, suv).x;
                if (sDepth >= 1.0) {
                    continue;
                }

                vec3 occView = reconstructViewPosition(suv, sDepth);
                if (occView.z > sampleView.z + uThickness) {
                    float w = 1.0 - smoothstep(0.0, maxDist, dist);
                    occlusion = max(occlusion, w);
                    break;
                }
            }

            gl_FragColor = vec4(vec3(clamp(occlusion, 0.0, 1.0)), 1.0);
        }
    `
};

class ContactShadowPass extends THREE.ShaderPass {
    constructor(camera, uniforms) {
        super(ContactShadowShader);
        this.camera = camera;
        this.uniforms = this.material.uniforms;
        this.sceneDepthTexture = null;
        this.shipDepthTexture = null;

        if (uniforms && typeof uniforms === 'object') {
            if (typeof uniforms.maxDistance === 'number') this.uniforms.uMaxDistance.value = uniforms.maxDistance;
            if (typeof uniforms.thickness === 'number') this.uniforms.uThickness.value = uniforms.thickness;
            if (typeof uniforms.strength === 'number') this.uniforms.uStrength.value = uniforms.strength;
            if (typeof uniforms.steps === 'number') this.uniforms.uSteps.value = uniforms.steps;
            if (typeof uniforms.minWorldRadius === 'number') this.uniforms.uMinWorldRadius.value = uniforms.minWorldRadius;
            if (typeof uniforms.maxViewDistance === 'number') this.uniforms.uMaxViewDistance.value = uniforms.maxViewDistance;
            if (typeof uniforms.visibilityEps === 'number') this.uniforms.uVisibilityEps.value = uniforms.visibilityEps;
        }
    }

    setDepthTextures(sceneDepthTexture, shipDepthTexture) {
        this.sceneDepthTexture = sceneDepthTexture || null;
        this.shipDepthTexture = shipDepthTexture || null;
    }

    render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
        if (this.sceneDepthTexture && this.shipDepthTexture) {
            this.uniforms.tSceneDepth.value = this.sceneDepthTexture;
            this.uniforms.tShipDepth.value = this.shipDepthTexture;
            this.uniforms.uDepthAvailable.value = 1.0;
        } else {
            this.uniforms.uDepthAvailable.value = 0.0;
        }

        if (this.camera) {
            this.uniforms.uProjectionMatrix.value.copy(this.camera.projectionMatrix);
            this.uniforms.uInvProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);
            this.uniforms.uViewMatrix.value.copy(this.camera.matrixWorldInverse);
            this.uniforms.uInvViewMatrix.value.copy(this.camera.matrixWorld);
        }

        super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    }
}

function getRequestedContactShadowParams() {
    if (typeof window === 'undefined' || !window.location) {
        return null;
    }
    if (typeof URLSearchParams === 'undefined') {
        return null;
    }

    const params = new URLSearchParams(window.location.search || '');

    const rawMaxDist = params.get('csDist');
    const rawThickness = params.get('csThick');
    const rawStrength = params.get('csStr');
    const rawSteps = params.get('csSteps');

    const parseNum = (raw) => {
        if (raw === null || raw === undefined) return null;
        const v = Number(raw);
        return Number.isFinite(v) ? v : null;
    };

    const maxDistance = parseNum(rawMaxDist);
    const thickness = parseNum(rawThickness);
    const strength = parseNum(rawStrength);
    const steps = parseNum(rawSteps);

    return {
        maxDistance: maxDistance !== null ? THREE.MathUtils.clamp(maxDistance, 0.0, 0.5) : undefined,
        thickness: thickness !== null ? THREE.MathUtils.clamp(thickness, 0.0, 0.05) : undefined,
        strength: strength !== null ? THREE.MathUtils.clamp(strength, 0.0, 2.0) : undefined,
        steps: steps !== null ? THREE.MathUtils.clamp(Math.round(steps), 1, 24) : undefined,
    };
}

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
        this.ssaaPass = null;
        this.smaaPass = null;
        this.debugPass = null;
        this.contactShadowPass = null;
        this.aaMode = 'none';
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

        this.aoMode = this.getRequestedAoMode();
        this.csDebugMode = this.getRequestedContactShadowDebugMode();
        this.materialMode = this.getRequestedMaterialMode();
        this.missionData = null;
        this.simulationRunning = false;
        this.viewMode = 'free';
        this.animationId = null;
        this.sharedTextures = {};
        this.textureRegistry = { color: new Set(), data: new Set() };
        this.textureColorMode = 'srgb';
        this.iblIntensity = this.getRequestedIblIntensity();
        if (typeof window !== 'undefined') {
            window.__mm_applyIblIntensity = () => this.applyIblIntensity();
        }

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

        this.planetShadowEnabled = this.isPlanetShadowEnabled();
         this.planetShadowUniforms = null;

         this.contactShadowUniforms = null;

        this.spacecraftSelfShadowEnabled = this.isSpacecraftSelfShadowEnabled();
        this.spacecraftSelfShadowLight = null;

         this.contactShadowSceneDepthRT = null;
         this.contactShadowShipDepthRT = null;
         this.contactShadowDepthMaterial = null;
         this.contactShadowDebugScene = null;
         this.contactShadowDebugCamera = null;
         this.contactShadowDebugMesh = null;
         this.contactShadowDebugMaterial = null;
         this.contactShadowDepthUnsupported = false;


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
        this.earthCloudSpinRate = -0.01;
        this.marsSpinRate = 0.06;
        this.marsCloudSpinRate = -0.007;

        this.cloudIdleSpinRadPerSec = 0.045;
        this.earthCloudRotationOffset = 0.0;
        this.marsCloudRotationOffset = 0.0;
        this.lastRenderMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        this.orientationBlendTauSec = 0.25;
        this.orientationBlendW = 0.0;
        this.bankMaxRad = 0.5;
        this.bankGainPerUnit = 0.18;
        this.bankTauSec = 0.35;
        this.bankCurvatureTauSec = 0.25;
        this.bankDeadbandRad = 0.02;

        this.init();
    }

    init() {
        console.log('Initializing Mars Mission 3D Visualization...');
        
        this.setupScene();
        this.setupCamera();
        this.setupRenderer();
        this.setupEnvironment();
        this.applyIblIntensity();
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

    mapBackendToThreeArray(position) {
        if (!position || !Array.isArray(position) || position.length < 3) return null;
        const x = Number(position[0]);
        const y = Number(position[1]);
        const z = Number(position[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        return [x, z, -y];
    }

    mapBackendToThreeVector(position, outVec3) {
        if (!outVec3) return false;
        const mapped = this.mapBackendToThreeArray(position);
        if (!mapped) return false;
        outVec3.set(mapped[0], mapped[1], mapped[2]);
        return true;
    }

    getRequestedAAMode() {
        if (typeof window === 'undefined' || !window.location) {
            return 'none';
        }
        if (typeof URLSearchParams === 'undefined') {
            return 'none';
        }

        const params = new URLSearchParams(window.location.search || '');
        const raw = String(params.get('aa') || '').trim().toLowerCase();
        if (!raw || raw === '0' || raw === 'off' || raw === 'none') {
            return 'none';
        }
        if (raw === 'ssaa') {
            return 'ssaa';
        }
        if (raw === 'smaa') {
            return 'smaa';
        }
        return 'none';
    }

    getRequestedEnvironmentMode() {
        if (typeof window === 'undefined' || !window.location) {
            return 'canvas';
        }
        if (typeof URLSearchParams === 'undefined') {
            return 'canvas';
        }

        const params = new URLSearchParams(window.location.search || '');
        const raw = String(params.get('env') || '').trim().toLowerCase();
        if (!raw || raw === 'canvas') {
            return 'canvas';
        }
        if (raw === 'room') {
            return 'room';
        }
        if (raw === 'hdr') {
            return 'hdr';
        }
        return 'canvas';
    }

    getRequestedIblEnvironmentStyle() {
        if (typeof window === 'undefined' || !window.location) {
            return 'default';
        }
        if (typeof URLSearchParams === 'undefined') {
            return 'default';
        }

        const params = new URLSearchParams(window.location.search || '');
        const raw = String(params.get('iblEnv') || '').trim().toLowerCase();
        if (!raw || raw === 'default' || raw === 'auto' || raw === '1' || raw === 'on') {
            return 'default';
        }
        if (raw === 'neutral' || raw === 'gray' || raw === 'grey') {
            return 'neutral';
        }
        if (raw === 'space' || raw === 'deepspace' || raw === 'deep_space') {
            return 'space';
        }
        return 'default';
    }

    getRequestedAASampleLevel(fallbackLevel) {
        if (typeof window === 'undefined' || !window.location) {
            return fallbackLevel;
        }
        if (typeof URLSearchParams === 'undefined') {
            return fallbackLevel;
        }

        const params = new URLSearchParams(window.location.search || '');
        const raw = String(params.get('aaLevel') || '').trim();
        if (!raw) {
            return fallbackLevel;
        }

        const value = Number(raw);
        if (!Number.isFinite(value)) {
            return fallbackLevel;
        }

        const level = Math.round(value);
        return THREE.MathUtils.clamp(level, 0, 5);
    }

    getRequestedPostMode() {
        if (typeof window === 'undefined' || !window.location) {
            return 'default';
        }
        if (typeof URLSearchParams === 'undefined') {
            return 'default';
        }

        const params = new URLSearchParams(window.location.search || '');
        const raw = String(params.get('post') || '').trim().toLowerCase();
        if (!raw || raw === '1' || raw === 'on' || raw === 'default') {
            return 'default';
        }
        if (raw === 'raw' || raw === '0' || raw === 'off') {
            return 'raw';
        }
        return 'default';
    }

    getRequestedBgMode() {
        if (typeof window === 'undefined' || !window.location) {
            return 'default';
        }
        if (typeof URLSearchParams === 'undefined') {
            return 'default';
        }

        const params = new URLSearchParams(window.location.search || '');
        const raw = String(params.get('bg') || '').trim().toLowerCase();
        if (!raw || raw === '1' || raw === 'on' || raw === 'default') {
            return 'default';
        }
        if (raw === 'off' || raw === '0' || raw === 'none') {
            return 'off';
        }
        if (raw === 'dim') {
            return 'dim';
        }
        return 'default';
    }

     getRequestedCityLightsIntensity() {
         if (typeof window === 'undefined' || !window.location) {
             return 1.0;
         }
         if (typeof URLSearchParams === 'undefined') {
             return 1.0;
         }

         const params = new URLSearchParams(window.location.search || '');
         const raw = String(params.get('city') || '').trim();
         if (!raw) {
             return 1.0;
         }

         const value = Number(raw);
         if (!Number.isFinite(value)) {
             return 1.0;
         }

         return THREE.MathUtils.clamp(value, 0, 2);
     }


     getRequestedDebugMode() {
         if (typeof window === 'undefined' || !window.location) {
             return 'none';
         }
         if (typeof URLSearchParams === 'undefined') {
             return 'none';
         }

         const params = new URLSearchParams(window.location.search || '');
         const raw = String(params.get('debug') || '').trim().toLowerCase();
         if (!raw || raw === '0' || raw === 'off' || raw === 'none') {
             return 'none';
         }
         if (raw === 'exposure') {
             return 'exposure';
         }
         if (raw === 'luma') {
             return 'luma';
         }
         return 'none';
     }

     isPlanetShadowEnabled() {
          if (typeof window === 'undefined' || !window.location) {
              return false;
          }
          if (typeof URLSearchParams === 'undefined') {
              return false;
          }

          const params = new URLSearchParams(window.location.search || '');
          const raw = String(params.get('planetShadow') || params.get('ps') || '').trim().toLowerCase();
          if (!raw || raw === '0' || raw === 'off' || raw === 'false') {
              return false;
          }
          return true;
      }

     isSpacecraftSelfShadowEnabled() {
         if (typeof window === 'undefined' || !window.location) {
             return false;
         }
         if (typeof URLSearchParams === 'undefined') {
             return false;
         }

         const params = new URLSearchParams(window.location.search || '');
         const raw = String(params.get('sShadow') || '').trim().toLowerCase();
         if (!raw || raw === '0' || raw === 'off' || raw === 'false') {
             return false;
         }
         return true;
     }

	     getRequestedAoMode() {
	         if (typeof window === 'undefined' || !window.location) {
	             return 'off';
	         }
	         if (typeof URLSearchParams === 'undefined') {
	             return 'off';
	         }

         const params = new URLSearchParams(window.location.search || '');
         const raw = String(params.get('ao') || '').trim().toLowerCase();
         if (!raw || raw === '0' || raw === 'off' || raw === 'none') {
             return 'off';
         }
         if (raw === 'contact') {
             return 'contact';
         }
         if (raw === 'ssao' || raw === 'sao') {
             // Placeholder for future Phase 3B; keep parsing stable.
             return 'ssao';
         }
	         return 'off';
	     }

	     getRequestedContactShadowDebugMode() {
	         if (typeof window === 'undefined' || !window.location) {
	             return 0;
	         }
	         if (typeof URLSearchParams === 'undefined') {
	             return 0;
	         }
	
	         const params = new URLSearchParams(window.location.search || '');
	         const raw = String(params.get('csDebug') || '').trim();
	         if (!raw) {
	             return 0;
	         }
	
	         const value = Number(raw);
	         if (!Number.isFinite(value)) {
	             return 0;
	         }
	
	         const mode = Math.max(0, Math.min(2, Math.floor(value)));
	         return mode;
	     }

	     getRequestedMaterialMode() {
	         if (typeof window === 'undefined' || !window.location) {
	             return 'default';
	         }
	         if (typeof URLSearchParams === 'undefined') {
	             return 'default';
	         }

	         const params = new URLSearchParams(window.location.search || '');
	         const raw = String(params.get('mat') || '').trim().toLowerCase();
	         if (!raw || raw === 'default') {
	             return 'default';
	         }
	         if (raw === 'white') {
	             return 'white';
	         }
	         return 'default';
	     }



	    getRequestedExposure() {
	        if (typeof window === 'undefined' || !window.location) {
	            return 0.9;
        }
        if (typeof URLSearchParams === 'undefined') {
            return 0.9;
        }

        const params = new URLSearchParams(window.location.search || '');
        const raw = String(params.get('exp') || '').trim();
        if (!raw) {
            return 0.9;
        }

        const value = Number(raw);
        if (!Number.isFinite(value)) {
            return 0.9;
        }

        return THREE.MathUtils.clamp(value, 0, 3);
    }

    getRequestedSunIntensity() {
        if (typeof window === 'undefined' || !window.location) {
            return 3.8;
        }
        if (typeof URLSearchParams === 'undefined') {
            return 3.8;
        }

        const params = new URLSearchParams(window.location.search || '');
        const raw = String(params.get('sun') || '').trim();
        if (!raw) {
            return 3.8;
        }

        const value = Number(raw);
        if (!Number.isFinite(value)) {
            return 3.8;
        }

        return Math.max(0, value);
    }

    getRequestedAmbientIntensity() {
        if (typeof window === 'undefined' || !window.location) {
            return 0.03;
        }
        if (typeof URLSearchParams === 'undefined') {
            return 0.03;
        }

        const params = new URLSearchParams(window.location.search || '');
        const raw = String(params.get('amb') || '').trim();
        if (!raw) {
            return 0.03;
        }

        const value = Number(raw);
        if (!Number.isFinite(value)) {
            return 0.03;
        }

        return Math.max(0, value);
    }

    getRequestedHemisphereIntensity() {
        if (typeof window === 'undefined' || !window.location) {
            return 0.03;
        }
        if (typeof URLSearchParams === 'undefined') {
            return 0.03;
        }

        const params = new URLSearchParams(window.location.search || '');
        const raw = String(params.get('hemi') || '').trim();
        if (!raw) {
            return 0.03;
        }

        const value = Number(raw);
        if (!Number.isFinite(value)) {
            return 0.03;
        }

        return Math.max(0, value);
    }

     getRequestedIblIntensity() {
         if (typeof window === 'undefined' || !window.location) {
             return 1.0;
         }
         if (typeof URLSearchParams === 'undefined') {
             return 1.0;
         }

         const params = new URLSearchParams(window.location.search || '');
         const raw = String(params.get('ibl') || '').trim();
         if (!raw) {
             return 1.0;
         }

         const value = Number(raw);
         if (!Number.isFinite(value)) {
             return 1.0;
         }

         return Math.max(0, value);
     }

     getRequestedTimeSpeed() {
         if (typeof window === 'undefined' || !window.location) {
             return null;
         }
         if (typeof URLSearchParams === 'undefined') {
             return null;
         }

         const params = new URLSearchParams(window.location.search || '');
         const raw = String(params.get('speed') || params.get('warp') || '').trim();
         if (!raw) {
             return null;
         }

         const value = Number(raw);
         if (!Number.isFinite(value)) {
             return null;
         }

         return THREE.MathUtils.clamp(value, 0, 5);
     }


    applyIblIntensity() {
        if (!this.scene) return;
        this.scene.traverse((node) => {
            if (!node.isMesh) return;
            if (node.isPoints || node.isLine || node.isSprite) return;
            if (!node.material) return;

            const applyToMaterial = (material) => {
                if (!material) return;
                if (!(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial)) return;
                if (typeof material.envMapIntensity !== 'number') return;
                if (typeof material.userData.baseEnvMapIntensity !== 'number') {
                    material.userData.baseEnvMapIntensity = material.envMapIntensity;
                }
                material.envMapIntensity = material.userData.baseEnvMapIntensity * this.iblIntensity;
            };

            if (Array.isArray(node.material)) {
                node.material.forEach((material) => applyToMaterial(material));
                return;
            }

            applyToMaterial(node.material);
        });
    }

    setAAMode(mode) {
        if (typeof window === 'undefined' || !window.location) {
            return;
        }
        if (typeof URLSearchParams === 'undefined') {
            return;
        }

        const nextMode = String(mode || '').trim().toLowerCase();
        const params = new URLSearchParams(window.location.search || '');
        if (!nextMode || nextMode === 'none' || nextMode === 'off' || nextMode === '0') {
            params.delete('aa');
        } else {
            params.set('aa', nextMode);
        }
        window.location.search = params.toString();
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
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (err) {
                console.warn('Failed to parse WebSocket message:', err, event && event.data);
                return;
            }

            try {
                this.handleMessage(data);
            } catch (err) {
                console.warn('Failed to handle WebSocket message:', err, data);
            }
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
            case 'ack':
                break;
            case 'error':
                console.warn('Server error:', data);
                if (typeof showToast === 'function') {
                    const message = (data && typeof data.message === 'string' && data.message) ? data.message : 'Unknown server error';
                    const suffix = (data && data.command) ? ` (${data.command})` : '';
                    showToast(`${message}${suffix}`, 6000);
                }
                break;
            default:
                console.warn('Unknown message type:', data);
                break;
        }
    }

     handleInitialData(data) {
         this.missionData = data.mission_info;

         if (data.simulation_state) {
             this.simulationState = { ...this.simulationState, ...data.simulation_state };
         }

         const requestedSpeed = this.getRequestedTimeSpeed();
         if (requestedSpeed !== null) {
             this.simulationState = { ...this.simulationState, time_speed: requestedSpeed };
         }

         this.syncUiFromSimulationState();

         if (requestedSpeed !== null && this.connected) {
             this.setTimeSpeed(requestedSpeed);
         }

        this.createSun();
        this.createPlanet('earth', data.earth_orbit);
        this.createPlanet('mars', data.mars_orbit);
        this.createSpacecraft();
        this.applyIblIntensity();
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

        const bgMode = this.getRequestedBgMode();
        this.objects.bgMode = bgMode;
    }

    setupCamera() {
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.01,
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

        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NeutralToneMapping;
        this.renderer.toneMappingExposure = this.getRequestedExposure();
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

    createNeutralEnvironmentTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const context = canvas.getContext('2d');

        const bg = context.createLinearGradient(0, 0, 0, canvas.height);
        bg.addColorStop(0, 'rgb(3, 3, 3)');
        bg.addColorStop(0.5, 'rgb(2, 2, 2)');
        bg.addColorStop(1, 'rgb(3, 3, 3)');
        context.fillStyle = bg;
        context.fillRect(0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.needsUpdate = true;
        this.registerColorTexture(texture);
        return texture;
    }

    createDeepSpaceEnvironmentTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const context = canvas.getContext('2d');

        const fill = context.createLinearGradient(0, 0, 0, canvas.height);
        fill.addColorStop(0, 'rgb(3, 3, 3)');
        fill.addColorStop(0.5, 'rgb(2, 2, 2)');
        fill.addColorStop(1, 'rgb(3, 3, 3)');
        context.fillStyle = fill;
        context.fillRect(0, 0, canvas.width, canvas.height);

        const drawLobe = (cx, cy, radius, c0, c1, alpha0, alpha1) => {
            const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
            gradient.addColorStop(0, `rgba(${c0[0]}, ${c0[1]}, ${c0[2]}, ${alpha0})`);
            gradient.addColorStop(1, `rgba(${c1[0]}, ${c1[1]}, ${c1[2]}, ${alpha1})`);
            context.fillStyle = gradient;
            context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
        };

        for (let i = 0; i < 8; i++) {
            const x = canvas.width * (0.15 + i * 0.1);
            const y = canvas.height * (0.55 + Math.sin(i * 0.7) * 0.08);
            const r = canvas.width * 0.22;
            drawLobe(x, y, r, [220, 225, 230], [0, 0, 0], 0.035, 0.0);
        }

        drawLobe(canvas.width * 0.22, canvas.height * 0.28, canvas.width * 0.10, [255, 244, 225], [0, 0, 0], 0.22, 0.0);
        drawLobe(canvas.width * 0.22, canvas.height * 0.28, canvas.width * 0.18, [255, 236, 205], [0, 0, 0], 0.06, 0.0);

        const texture = new THREE.CanvasTexture(canvas);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.needsUpdate = true;
        this.registerColorTexture(texture);
        return texture;
    }

    setupEnvironment() {
        const envMode = this.getRequestedEnvironmentMode();
        const iblEnvStyle = this.getRequestedIblEnvironmentStyle();
        if (typeof window !== 'undefined') {
            window.__mm_envMode = envMode;
            window.__mm_iblEnvStyle = iblEnvStyle;
            window.__mm_shipEnvIntensity = envMode === 'canvas' ? 3.0 : 1.4;
        }
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        pmremGenerator.compileEquirectangularShader();

        const disposePreviousEnvironment = () => {
            if (this.environmentRenderTarget) {
                this.environmentRenderTarget.dispose();
                this.environmentRenderTarget = null;
            }
        };

        const applyEnvRenderTarget = (envRenderTarget) => {
            disposePreviousEnvironment();
            this.scene.environment = envRenderTarget.texture;
            this.environmentRenderTarget = envRenderTarget;
            this.applyIblIntensity();
        };

        const applyCanvasEnvironment = () => {
            const environmentTexture = (iblEnvStyle === 'neutral')
                ? this.createNeutralEnvironmentTexture()
                : (iblEnvStyle === 'space')
                    ? this.createDeepSpaceEnvironmentTexture()
                    : this.createEnvironmentTexture();
            const envRenderTarget = pmremGenerator.fromEquirectangular(environmentTexture);
            applyEnvRenderTarget(envRenderTarget);
            environmentTexture.dispose();
            this.textureRegistry.color.delete(environmentTexture);
            pmremGenerator.dispose();
        };

        const applyRoomEnvironment = () => {
            if (typeof THREE.RoomEnvironment !== 'function') {
                console.warn('RoomEnvironment unavailable; falling back to canvas environment.');
                applyCanvasEnvironment();
                return;
            }

            const roomScene = new THREE.RoomEnvironment();
            const envRenderTarget = pmremGenerator.fromScene(roomScene, 0.04);
            roomScene.dispose();
            applyEnvRenderTarget(envRenderTarget);
            pmremGenerator.dispose();
        };

        const applyHdrEnvironment = () => {
            if (typeof THREE.RGBELoader !== 'function') {
                console.warn('RGBELoader unavailable; falling back to room environment.');
                applyRoomEnvironment();
                return;
            }

            const params = new URLSearchParams(window.location.search || '');
            const envUrl = String(params.get('envUrl') || '').trim();
            const defaultHdrUrl = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/equirectangular/venice_sunset_1k.hdr';
            const targetUrl = envUrl || defaultHdrUrl;
            const loader = new THREE.RGBELoader();

            loader.load(
                targetUrl,
                (texture) => {
                    texture.mapping = THREE.EquirectangularReflectionMapping;
                    const envRenderTarget = pmremGenerator.fromEquirectangular(texture);
                    applyEnvRenderTarget(envRenderTarget);
                    texture.dispose();
                    pmremGenerator.dispose();
                },
                undefined,
                (error) => {
                    console.warn('Failed to load HDR environment. Falling back to room environment.', error);
                    applyRoomEnvironment();
                }
            );
        };

        if (envMode === 'hdr') {
            applyHdrEnvironment();
        } else if (envMode === 'room') {
            applyRoomEnvironment();
        } else {
            applyCanvasEnvironment();
        }
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
	        const width = window.innerWidth;
	        const height = window.innerHeight;

        let renderTargetType = (typeof THREE.UnsignedByteType !== 'undefined')
            ? THREE.UnsignedByteType
            : undefined;

        const supportsHalfFloat =
            !!(this.renderer && this.renderer.capabilities && this.renderer.capabilities.isWebGL2) &&
            !!(this.renderer && this.renderer.extensions && typeof this.renderer.extensions.has === 'function') &&
            (this.renderer.extensions.has('EXT_color_buffer_float') || this.renderer.extensions.has('EXT_color_buffer_half_float'));

        if (supportsHalfFloat && typeof THREE.HalfFloatType !== 'undefined') {
            renderTargetType = THREE.HalfFloatType;
        }


	        const pixelRatio = (this.renderer && typeof this.renderer.getPixelRatio === 'function')
	            ? this.renderer.getPixelRatio()
	            : (window.devicePixelRatio || 1);

	        const wantsContactShadowDepth = this.aoMode === 'contact' || this.csDebugMode !== 0;
	        if (wantsContactShadowDepth) {
	            this.ensureContactShadowDepthTargets(width, height, pixelRatio);
	            this.setupContactShadowDebugView();
	        }

	        const createRenderTargetForComposer = () => {
	            // Let EffectComposer.setPixelRatio() + setSize() manage internal scaling.
	            // Do NOT attach DepthTexture here: EffectComposer clones/ping-pongs targets and
            // sharing a single DepthTexture can create an illegal feedback loop.
            return new THREE.WebGLRenderTarget(width, height, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: renderTargetType,
                depthBuffer: true,
                stencilBuffer: false
            });
        };

	        this.bloomComposer = new THREE.EffectComposer(this.renderer, createRenderTargetForComposer());
	        if (typeof this.bloomComposer.setPixelRatio === 'function') {
	            this.bloomComposer.setPixelRatio(pixelRatio);
	        }
	        this.bloomComposer.setSize(width, height);
	        this.bloomComposer.renderToScreen = false;

        const bloomRenderPass = new THREE.RenderPass(this.scene, this.camera);
        this.bloomComposer.addPass(bloomRenderPass);

        this.bloomPass = new THREE.UnrealBloomPass(
            new THREE.Vector2(width * pixelRatio, height * pixelRatio),
            0.95,
            0.42,
            0.82
        );
        this.bloomComposer.addPass(this.bloomPass);

	        this.finalComposer = new THREE.EffectComposer(
	            this.renderer,
	            createRenderTargetForComposer()
        );
        if (typeof this.finalComposer.setPixelRatio === 'function') {
            this.finalComposer.setPixelRatio(pixelRatio);
        }
        this.finalComposer.setSize(width, height);

        this.aaMode = this.getRequestedAAMode();
        this.ssaaPass = null;
        this.smaaPass = null;
        this.debugPass = null;
        this.contactShadowPass = null;

        const aaRequested = this.aaMode;

        if (aaRequested === 'ssaa') {
            if (typeof THREE.SSAARenderPass === 'function') {
                this.ssaaPass = new THREE.SSAARenderPass(this.scene, this.camera);
                this.ssaaPass.sampleLevel = this.getRequestedAASampleLevel(1);
                this.finalComposer.addPass(this.ssaaPass);
            } else {
                console.warn('SSAA requested (?aa=ssaa) but THREE.SSAARenderPass is not available. Falling back to no AA.');
                this.aaMode = 'none';
                this.finalComposer.addPass(new THREE.RenderPass(this.scene, this.camera));
            }
        } else {
            this.finalComposer.addPass(new THREE.RenderPass(this.scene, this.camera));
        }

	        // NOTE: `ao=contact` is implemented as a spacecraft material patch (sun-direct only),
	        // not as a post-process pass. We keep csDebug as a full-screen debug view.

        this.additivePass = new THREE.ShaderPass(AdditiveBlendShader);
        this.additivePass.uniforms.tBloom.value = null;
        this.additivePass.uniforms.bloomStrength.value = 1.0;
        this.finalComposer.addPass(this.additivePass);

        if (aaRequested === 'smaa') {
            if (typeof THREE.SMAAPass === 'function') {
                this.smaaPass = new THREE.SMAAPass(width * pixelRatio, height * pixelRatio);
                this.finalComposer.addPass(this.smaaPass);
            } else {
                console.warn('SMAA requested (?aa=smaa) but THREE.SMAAPass is not available. Falling back to no AA.');
                this.aaMode = 'none';
            }
        }

        const debugMode = this.getRequestedDebugMode();
        if (debugMode !== 'none') {
            this.debugPass = new THREE.ShaderPass(DebugViewShader);
            this.debugPass.uniforms.debugMode.value = debugMode === 'luma' ? 2 : 1;
            this.finalComposer.addPass(this.debugPass);
        }

	        if (typeof THREE.OutputPass === 'function') {
	            this.outputPass = new THREE.OutputPass();
	            this.finalComposer.addPass(this.outputPass);
	        } else {
	            console.warn('OutputPass unavailable; final output may look incorrect.');
	        }

	    }

	    ensureContactShadowDepthTargets(width, height, pixelRatio) {
	        if (!this.renderer || !this.scene || !this.camera) return;
	        if (typeof THREE.WebGLRenderTarget !== 'function') return;

	        if (this.contactShadowDepthUnsupported) {
	            return;
	        }

	        if (typeof THREE.DepthTexture !== 'function') {
	            console.warn('DepthTexture unavailable; disabling ao=contact.');
	            this.contactShadowShipDepthRT = null;
	            this.contactShadowDepthUnsupported = true;
	            if (this.aoMode === 'contact') {
	                this.aoMode = 'off';
	            }
	            return;
	        }

	        const w = Math.max(1, Math.floor(width * pixelRatio));
	        const h = Math.max(1, Math.floor(height * pixelRatio));

	        const createDepthTarget = (name) => {
	            const rt = new THREE.WebGLRenderTarget(w, h, {
	                minFilter: THREE.NearestFilter,
	                magFilter: THREE.NearestFilter,
	                format: THREE.RGBAFormat,
	                type: THREE.UnsignedByteType,
	                depthBuffer: true,
	                stencilBuffer: false
	            });
	            rt.texture.name = name;
	            const depthTexture = new THREE.DepthTexture(w, h);
	            depthTexture.type = THREE.UnsignedShortType;
	            depthTexture.format = THREE.DepthFormat;
	            depthTexture.minFilter = THREE.NearestFilter;
	            depthTexture.magFilter = THREE.NearestFilter;
	            depthTexture.generateMipmaps = false;
	            rt.depthTexture = depthTexture;
	            return rt;
	        };

	        const ensureSize = (rt, name) => {
	            if (!rt) return createDepthTarget(name);
	            const dt = rt.depthTexture;
	            const ok =
	                dt &&
	                dt.isDepthTexture &&
	                dt.image &&
	                dt.image.width === w &&
	                dt.image.height === h;
	            if (ok) return rt;
	            try {
	                rt.dispose();
	            } catch (e) {
	                // ignore
	            }
	            return createDepthTarget(name);
	        };

	        this.contactShadowShipDepthRT = ensureSize(this.contactShadowShipDepthRT, 'mm_shipDepth');

	        if (!this.contactShadowDepthMaterial) {
	            this.contactShadowDepthMaterial = new THREE.MeshDepthMaterial();
	            this.contactShadowDepthMaterial.blending = THREE.NoBlending;
	        }
	    }

	    setupContactShadowDebugView() {
	        if (this.contactShadowDebugScene) return;
	        if (!this.renderer) return;

	        this.contactShadowDebugScene = new THREE.Scene();
	        this.contactShadowDebugCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

	        this.contactShadowDebugMaterial = new THREE.ShaderMaterial({
	            uniforms: THREE.UniformsUtils.clone(ContactShadowDebugShader.uniforms),
	            vertexShader: ContactShadowDebugShader.vertexShader,
	            fragmentShader: ContactShadowDebugShader.fragmentShader,
	            depthTest: false,
	            depthWrite: false
	        });
	        this.contactShadowDebugMaterial.toneMapped = false;

	        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.contactShadowDebugMaterial);
	        quad.frustumCulled = false;
	        this.contactShadowDebugMesh = quad;
	        this.contactShadowDebugScene.add(quad);
	    }

	    renderContactShadowDepthTargets() {
	        if (!this.renderer || !this.scene || !this.camera) return false;
	        if (!this.contactShadowShipDepthRT) return false;
	        if (!this.contactShadowDepthMaterial) return false;

	        const renderer = this.renderer;
	        const scene = this.scene;
	        const camera = this.camera;

	        const prevTarget = renderer.getRenderTarget();
	        const prevOverride = scene.overrideMaterial;
	        const prevMask = camera.layers.mask;
	        const prevShadowAutoUpdate = renderer.shadowMap ? renderer.shadowMap.autoUpdate : null;
	        const prevShadowNeedsUpdate = renderer.shadowMap ? renderer.shadowMap.needsUpdate : null;

	        if (renderer.shadowMap && typeof renderer.shadowMap.autoUpdate === 'boolean') {
	            renderer.shadowMap.autoUpdate = false;
	            renderer.shadowMap.needsUpdate = false;
	        }

	        // Ship-only depth via layer.
	        camera.layers.set(CONTACT_SHADOW_LAYER);
	        renderer.setRenderTarget(this.contactShadowShipDepthRT);
	        renderer.clear(true, true, true);
	        scene.overrideMaterial = this.contactShadowDepthMaterial;
	        renderer.render(scene, camera);

	        camera.layers.mask = prevMask;
	        scene.overrideMaterial = prevOverride;
	        renderer.setRenderTarget(prevTarget);
	        if (renderer.shadowMap && typeof renderer.shadowMap.autoUpdate === 'boolean') {
	            renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;
	            renderer.shadowMap.needsUpdate = prevShadowNeedsUpdate;
	        }

	        return true;
	    }

	    renderContactShadowDebug() {
	        if (!this.contactShadowDebugMaterial || !this.contactShadowDebugScene || !this.contactShadowDebugCamera) {
	            return false;
	        }

	        const uniforms = this.contactShadowDebugMaterial.uniforms;
	        const shipDepth = this.contactShadowShipDepthRT ? this.contactShadowShipDepthRT.depthTexture : null;

	        uniforms.tShipDepth.value = shipDepth;
	        uniforms.uDepthAvailable.value = shipDepth ? 1.0 : 0.0;

	        uniforms.uDebugMode.value = this.csDebugMode;
	        uniforms.uNear.value = this.camera ? this.camera.near : 0.01;
	        uniforms.uFar.value = this.camera ? this.camera.far : 3000.0;
        if (this.camera) {
            if (!this._contactShadowDebugRefPos) {
                this._contactShadowDebugRefPos = new THREE.Vector3();
            }
            this._contactShadowDebugRefPos.set(0, 0, 0);
            const shipMesh =
                (this.objects && this.objects.spacecraft && typeof this.objects.spacecraft.getMesh === 'function')
                    ? this.objects.spacecraft.getMesh()
                    : null;
            if (shipMesh && typeof shipMesh.getWorldPosition === 'function') {
                shipMesh.getWorldPosition(this._contactShadowDebugRefPos);
            }
            const dist = this.camera.position.distanceTo(this._contactShadowDebugRefPos);
            uniforms.uDebugMaxZ.value = THREE.MathUtils.clamp(dist * 2.0, 5.0, 200.0);
        } else {
            uniforms.uDebugMaxZ.value = 50.0;
        }

        const overrides = getRequestedContactShadowParams() || {};
        if (typeof overrides.maxDistance === 'number') uniforms.uMaxDistance.value = overrides.maxDistance;
        if (typeof overrides.thickness === 'number') uniforms.uThickness.value = overrides.thickness;
        if (typeof overrides.steps === 'number') uniforms.uSteps.value = overrides.steps;

	        uniforms.uVisibilityEps.value = 0.002;

	        if (this.camera) {
	            uniforms.uProjectionMatrix.value.copy(this.camera.projectionMatrix);
	            uniforms.uInvProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);
	            uniforms.uViewMatrix.value.copy(this.camera.matrixWorldInverse);
	            uniforms.uInvViewMatrix.value.copy(this.camera.matrixWorld);
	        }

	        const renderer = this.renderer;
	        const prevToneMapping = renderer.toneMapping;
	        const prevExposure = renderer.toneMappingExposure;
	        const prevTarget = renderer.getRenderTarget();

	        renderer.toneMapping = THREE.NoToneMapping;
	        renderer.toneMappingExposure = 1.0;
	        renderer.setRenderTarget(null);
	        renderer.render(this.contactShadowDebugScene, this.contactShadowDebugCamera);

	        renderer.setRenderTarget(prevTarget);
	        renderer.toneMapping = prevToneMapping;
	        renderer.toneMappingExposure = prevExposure;

	        return true;
	    }

	     setupLighting() {
	         // Ambient light
	         const ambientLight = new THREE.AmbientLight(0x101820, this.getRequestedAmbientIntensity());
	         // Keep layer 0 (default) and also allow lighting the spacecraft-only layer when needed.
	         ambientLight.layers.enable(CONTACT_SHADOW_LAYER);
	         this.scene.add(ambientLight);
	         this.ambientLight = ambientLight;
	 
	     const hemiLight = new THREE.HemisphereLight(0xfff2e3, 0x05080c, this.getRequestedHemisphereIntensity());
	     hemiLight.layers.enable(CONTACT_SHADOW_LAYER);
	     this.scene.add(hemiLight);
	     this.hemiLight = hemiLight;
	 
	     // Point light from sun
	     const sunLight = new THREE.PointLight(0xfff2e3, this.getRequestedSunIntensity(), 0, 2);
	     sunLight.position.set(0, 0, 0);
	     // Always keep the sun PointLight on the default layer; `sShadow=1` moves the spacecraft off layer 0.
	     sunLight.layers.set(0);
	     // NOTE: When `sShadow=1` we use a ship-only DirectionalLight shadow map for self-shadowing,
	     // and keep the sun PointLight shadow disabled to avoid expensive cube shadow updates and
	     // double-shadowing artifacts.
	     sunLight.castShadow = !this.spacecraftSelfShadowEnabled;
	     if (sunLight.castShadow) {
	         sunLight.shadow.mapSize.width = 2048;
	         sunLight.shadow.mapSize.height = 2048;
	         sunLight.shadow.camera.near = 0.5;
	         sunLight.shadow.camera.far = 500;
	         sunLight.shadow.bias = -0.0008;
	     }
	     this.scene.add(sunLight);
	     this.sunLight = sunLight;

	     if (this.spacecraftSelfShadowEnabled) {
	         this.setupSpacecraftSelfShadowLight();
	     }
	 }

		 setupSpacecraftSelfShadowLight() {
		     if (!this.scene) return;
		     if (!this.renderer || !this.renderer.shadowMap || this.renderer.shadowMap.enabled !== true) {
		         return;
		     }

	     if (this.spacecraftSelfShadowLight) {
	         return;
	     }

	     // NOTE: keep intensity > 0 so three.js includes the light in the lighting + shadow pipeline.
	     // When `sShadow=1`, the spacecraft is moved off the sun PointLight layer and is lit by this
	     // DirectionalLight (with intensity adjusted per-frame for 1/r^2 falloff).
	     const light = new THREE.DirectionalLight(0xffffff, 0.0001);
	     light.name = 'mm_spacecraftSelfShadow';
	     light.castShadow = true;

		     // Only affect / render shadows for the spacecraft layer.
		     light.layers.set(CONTACT_SHADOW_LAYER);

		     // Slightly higher-res + less blur for clearer self-shadow edges.
		     light.shadow.mapSize.set(2048, 2048);
		     light.shadow.bias = -0.00003;
		     light.shadow.normalBias = 0.002;
		     light.shadow.radius = 0;

	     // Initialize a reasonable shadow camera volume (will be tightened per-frame once the ship exists).
	     const cam = light.shadow.camera;
	     cam.left = -1;
	     cam.right = 1;
	     cam.top = 1;
	     cam.bottom = -1;
	     cam.near = 0.1;
	     cam.far = 50;
	     cam.updateProjectionMatrix();

	     this.scene.add(light);
	     this.scene.add(light.target);

	     this.spacecraftSelfShadowLight = light;

	     if (!this._sShadowBox) {
	         this._sShadowBox = new THREE.Box3();
	     }
	     if (!this._sShadowBoxCenter) {
	         this._sShadowBoxCenter = new THREE.Vector3();
	     }
	     if (!this._sShadowBoxSize) {
	         this._sShadowBoxSize = new THREE.Vector3();
	     }
	     if (!this._sShadowCorner) {
	         this._sShadowCorner = new THREE.Vector3();
	     }
	     if (!this._sShadowCorners) {
	         this._sShadowCorners = Array.from({ length: 8 }, () => new THREE.Vector3());
	     }
	     if (!this._sShadowSphere) {
	         this._sShadowSphere = new THREE.Sphere();
	     }
	     if (!this._sShadowSunDir) {
	         this._sShadowSunDir = new THREE.Vector3();
	     }
	     if (!this._sShadowSunPos) {
	         this._sShadowSunPos = new THREE.Vector3();
	     }
	 }

	 updateSpacecraftSelfShadowLight() {
	     if (!this.spacecraftSelfShadowEnabled) return;
	     const light = this.spacecraftSelfShadowLight;
	     if (!light || !light.shadow || !light.shadow.camera) return;
	     if (!this.scene) return;
	     if (!this.objects || !this.objects.spacecraft || typeof this.objects.spacecraft.getMesh !== 'function') return;

	     const shipMesh = this.objects.spacecraft.getMesh();
	     if (!shipMesh) return;

	     const box = this._sShadowBox;
	     const center = this._sShadowBoxCenter;
	     const size = this._sShadowBoxSize;

	     box.setFromObject(shipMesh);
	     if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
	         return;
	     }

	     box.getCenter(center);
	     box.getSize(size);
	     box.getBoundingSphere(this._sShadowSphere);
	     const shipRadius = Math.max(0.01, this._sShadowSphere.radius);

	     // Sun is at world origin today; keep the hook for future where it may move.
	     if (this.sunWorldPosition) {
	         this._sShadowSunPos.copy(this.sunWorldPosition);
	     } else {
	         this._sShadowSunPos.set(0, 0, 0);
	     }

	     this._sShadowSunDir.copy(center).sub(this._sShadowSunPos);
	     if (this._sShadowSunDir.lengthSq() <= 1e-12) {
	         this._sShadowSunDir.set(1, 0, 0);
	     } else {
	         this._sShadowSunDir.normalize();
	     }

	     const maxExtent = Math.max(size.x, size.y, size.z);
	     const lightDistance = Math.max(2.0, shipRadius * 10.0, maxExtent * 6.0);
	     light.position.copy(center).sub(this._sShadowCorner.copy(this._sShadowSunDir).multiplyScalar(lightDistance));
	     light.target.position.copy(center);
	     light.target.updateMatrixWorld();
	     light.updateMatrixWorld();

	     // Keep shadow camera volume simple and safe using the ship's bounding sphere.
	     // (A tight AABB-in-light-space fit is possible, but this is more robust.)
	     const shadowCam = light.shadow.camera;
	     const marginXY = Math.max(0.02, shipRadius * 0.6);
	     const marginZ = Math.max(0.2, shipRadius * 4.0);

	     const r = shipRadius + marginXY;
	     shadowCam.left = -r;
	     shadowCam.right = r;
	     shadowCam.bottom = -r;
	     shadowCam.top = r;
	     shadowCam.near = Math.max(0.01, lightDistance - shipRadius - marginZ);
	     shadowCam.far = lightDistance + shipRadius + marginZ;
	     shadowCam.updateProjectionMatrix();

	     // Approximate 1/r^2 falloff to match the sun PointLight intensity at the spacecraft distance.
	     const distToSun = Math.max(0.01, center.distanceTo(this._sShadowSunPos));
	     if (this.sunLight && typeof this.sunLight.intensity === 'number') {
	         light.intensity = Math.max(0.0001, this.sunLight.intensity / (distToSun * distToSun));
	     } else {
	         light.intensity = 0.0001;
	     }

	     if (light.shadow) {
	         light.shadow.needsUpdate = true;
	     }
	 }


    createNebulaTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext('2d');
        const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
        gradient.addColorStop(0, 'rgba(240, 238, 233, 0.18)');
        gradient.addColorStop(0.5, 'rgba(240, 238, 233, 0.06)');
        gradient.addColorStop(1, 'rgba(240, 238, 233, 0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 256, 256);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        this.registerColorTexture(texture);
        return texture;
    }

     setupNebulae() {
         if (this.objects.bgMode === 'off') {
             return;
         }

         const texture = this.createNebulaTexture();

        const colors = [0x2b2b31, 0x363338, 0x302f33, 0x3a3a3f];
        const nebulaCount = 8;
        this.objects.nebulae = new THREE.Group();
        for (let i = 0; i < nebulaCount; i++) {
            const material = new THREE.SpriteMaterial({
                map: texture,
                color: colors[i % colors.length],
                transparent: true,
                opacity: 0.08 + Math.random() * 0.12,
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
         if (this.objects.bgMode === 'off') {
             return;
         }

         const starCount = 20000;

        const dustCount = 20000;
        const totalCount = starCount + dustCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(totalCount * 3);
        const colors = new Float32Array(totalCount * 3);
        const sizes = new Float32Array(totalCount);
        const colorOptions = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xfff7ef),
            new THREE.Color(0xf4f8ff),
            new THREE.Color(0xfff0e2),
            new THREE.Color(0xf8f6f0)
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
            const color = isDust ? new THREE.Color(0x2e2e33) : colorOptions[Math.floor(Math.random() * colorOptions.length)];
            
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
            
            // FIX: Make dust much smaller so it looks like speed lines, not light bulbs
            sizes[i] = isDust ? 0.2 + Math.random() * 0.4 : 0.8 + Math.random() * 2.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

         const bgMode = this.objects.bgMode;
         const dimFactor = bgMode === 'dim' ? 0.4 : 1.0;

         const material = new THREE.ShaderMaterial({
             uniforms: {
                 time: { value: 0 },
                 dimFactor: { value: dimFactor }
             },

            vertexShader: `
                uniform float time;
                uniform float dimFactor;
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;
                varying float vOpacity;
                void main() {
                    vColor = color;
                    // Add subtle twinkling effect based on position and time
                    float twinkle = sin(time * 0.002 + position.x + position.y) * 0.3 + 0.7;
                    vOpacity = twinkle * dimFactor;
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
                    gl_FragColor = vec4(vColor * 1.0, vOpacity * (1.0 - r * 2.0));
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

         if (typeof THREE.NoColorSpace === 'undefined') return;

         const nextColorSpace = THREE.NoColorSpace;
         if (texture.colorSpace === nextColorSpace) return;

         texture.colorSpace = nextColorSpace;
         if (texture.image && texture.image.width && texture.image.height) {
             texture.needsUpdate = true;
         }
     }

     applyTextureColorMode(texture) {
         if (!texture) return;
         if (typeof THREE.SRGBColorSpace === 'undefined') return;

         const nextColorSpace = (this.textureColorMode === 'linear' && typeof THREE.LinearSRGBColorSpace !== 'undefined')
             ? THREE.LinearSRGBColorSpace
             : THREE.SRGBColorSpace;

         if (texture.colorSpace === nextColorSpace) return;

         texture.colorSpace = nextColorSpace;
         if (texture.image && texture.image.width && texture.image.height) {
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
            emissiveIntensity: 9.2,
            emissiveMap: sunTexture,
            toneMapped: false,
            depthWrite: true
        });
        
        this.objects.sun = new THREE.Mesh(geometry, material);
        
        this.objects.sun.layers.enable(BLOOM_LAYER);

        if (this.getRequestedPostMode() !== 'raw') {
            const glowTexture = this.createGlowTexture();

            const spriteMaterial1 = new THREE.SpriteMaterial({
                map: glowTexture,
                color: 0xffd2a3,
                transparent: true,
                opacity: 0.5,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            });
            const sprite1 = new THREE.Sprite(spriteMaterial1);
            sprite1.scale.set(0.85, 0.85, 1.0);
            this.objects.sun.add(sprite1);

            const spriteMaterial2 = new THREE.SpriteMaterial({
                map: glowTexture,
                color: 0xff9c63,
                transparent: true,
                opacity: 0.21,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            });
            const sprite2 = new THREE.Sprite(spriteMaterial2);
            sprite2.scale.set(1.7, 1.7, 1.0);
            this.objects.sun.add(sprite2);

            this.objects.sunGlow = [sprite1, sprite2];

            sprite1.layers.enable(BLOOM_LAYER);
            sprite2.layers.enable(BLOOM_LAYER);
        } else {
            this.objects.sunGlow = [];
        }
        
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
                         vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
                         roughnessFactor *= texelRoughness.g;
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
                         vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
                         roughnessFactor *= texelRoughness.g;
                     #endif
                     `
                 );

                 shader.fragmentShader = shader.fragmentShader.replace(
                     '#include <dithering_fragment>',
                     `
                     vec3 fragPosView = -vViewPosition;
                     vec3 sunDirView = normalize(sunPositionView - fragPosView);
                     vec3 N = normalize(vNormal);
                     float ndl = dot(N, sunDirView);


                    // Night visibility mask (soft terminator): 0 on day side, 1 on deep night.
                    float nightMask = 1.0 - smoothstep(0.02, 0.18, ndl);

                    // Horizon fade: suppress lights near the limb to avoid a "ring" and reduce aliasing.
                    vec3 V = normalize(-vViewPosition);
                    float ndv = abs(dot(N, V));
                    float limbFade = smoothstep(0.02, 0.10, ndv);

                    float visible = clamp(nightMask * limbFade, 0.0, 1.0);
                    totalEmissiveRadiance *= visible;

                    if (visible <= 0.001) discard;

                    #include <dithering_fragment>
                    `
                );
            };

            const earthLightsMaterial = new THREE.MeshStandardMaterial({
                color: 0x000000,
                emissive: new THREE.Color(0xffffff),
                emissiveIntensity: 0.6 * this.getRequestedCityLightsIntensity(),

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
                shader.uniforms.time = { value: 0.0 };
                this.earthLightsShader = shader;

                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    `
                    #include <common>
                    uniform vec3 sunPositionView;
                    uniform float time;
                    `
                );



                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <emissivemap_fragment>',
                    `
                    #ifdef USE_EMISSIVEMAP
                        vec3 emissiveTexel = texture2D( emissiveMap, vEmissiveMapUv ).rgb;
                        float luminance = dot(emissiveTexel, vec3(0.2126, 0.7152, 0.0722));
                        
                        // 基础亮度处理
                        float adjustedLuminance = clamp(luminance, 0.0, 1.0);
                        
                        // Base intensity
                        float baseMask = smoothstep(0.05, 0.30, adjustedLuminance);
                        float baseGlow = pow(adjustedLuminance, 0.75) * baseMask;
                        
                        // City sparkle mask
                        float cityMask = smoothstep(0.02, 0.10, adjustedLuminance);
                        cityMask = pow(cityMask, 2.3);
                        
                        // 基础颜色
                        vec3 baseColor = vec3(0.95, 0.90, 0.83) * baseGlow;
                        
                        vec3 cityColor = vec3(1.0, 0.78, 0.55) * cityMask;

                        vec3 totalRadiance = baseColor + cityColor;
                        totalEmissiveRadiance = totalRadiance / (1.0 + totalRadiance);
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
            earthGroup.receiveShadow = false;

            const earthDayMesh = new THREE.Mesh(geometry, earthDayMaterial);
            const earthNightMesh = new THREE.Mesh(geometry, material);

            earthDayMesh.castShadow = true;
            earthNightMesh.castShadow = true;
            earthDayMesh.receiveShadow = false;
            earthNightMesh.receiveShadow = false;

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
            this.objects[name].castShadow = true;
            this.objects[name].receiveShadow = false;
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

        if (this.getRequestedPostMode() !== 'raw') {
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
        }

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
        atmosphere.visible = this.getRequestedPostMode() !== 'raw';

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
            const mapped = this.mapBackendToThreeArray(point);
            if (mapped) {
                positions.push(mapped[0], mapped[1], mapped[2]);
            } else {
                positions.push(0, 0, 0);
            }
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
	         window.__spacecraft = this.objects.spacecraft;

	         if (this.objects.spacecraft) {
	             if (typeof this.objects.spacecraft.setMaterialMode === 'function') {
	                 this.objects.spacecraft.setMaterialMode(this.materialMode);
	             }
	             if (typeof this.objects.spacecraft.setContactShadowLayer === 'function') {
	                 this.objects.spacecraft.setContactShadowLayer(CONTACT_SHADOW_LAYER);
	             }
	         }

	         if (this.planetShadowEnabled) {
	             this.installPlanetShadowForSpacecraft();
	             this.updatePlanetShadowUniforms();
	         }

		         if (this.aoMode === 'contact') {
		             this.installContactShadowForSpacecraft();
		         }

			         if (this.spacecraftSelfShadowEnabled) {
			             this.applySpacecraftSelfShadowFlags();
			         }

		     }

	    applySpacecraftSelfShadowFlags() {
	        if (!this.spacecraftSelfShadowEnabled) return;
	        if (!this.objects || !this.objects.spacecraft || typeof this.objects.spacecraft.getMesh !== 'function') return;
	        const shipMesh = this.objects.spacecraft.getMesh();
	        if (!shipMesh) return;
	        if (this.camera && this.camera.layers && typeof this.camera.layers.enable === 'function') {
	            // Ensure the main camera can still see the spacecraft once we remove it from layer 0.
	            this.camera.layers.enable(CONTACT_SHADOW_LAYER);
	        }
	        shipMesh.traverse((node) => {
	            if (!node || node.isMesh !== true) return;
	            if (node.isPoints || node.isLine || node.isSprite) return;
	            if (node.layers && typeof node.layers.enable === 'function' && typeof node.layers.disable === 'function') {
	                node.layers.enable(CONTACT_SHADOW_LAYER);
	                node.layers.disable(0);
	            }
	            node.castShadow = true;
	            node.receiveShadow = true;
	        });
	    }

    ensureContactShadowUniforms() {
        if (this.contactShadowUniforms) {
            return this.contactShadowUniforms;
        }

        const overrides = getRequestedContactShadowParams() || {};
	        const defaults = {
	            maxDistance: 0.18,
	            thickness: 0.003,
	            strength: 1.1,
	            steps: 22
	        };

        const maxDistance = (typeof overrides.maxDistance === 'number') ? overrides.maxDistance : defaults.maxDistance;
        const thickness = (typeof overrides.thickness === 'number') ? overrides.thickness : defaults.thickness;
        const strength = (typeof overrides.strength === 'number') ? overrides.strength : defaults.strength;
        const steps = (typeof overrides.steps === 'number') ? overrides.steps : defaults.steps;

        this.contactShadowUniforms = {
            uMMContactEnabled: { value: 1.0 },
            uMMDepthAvailable: { value: 0.0 },
            uMMShipDepth: { value: null },
            uMMProjectionMatrix: { value: new THREE.Matrix4() },
            uMMInvProjectionMatrix: { value: new THREE.Matrix4() },
            uMMSunPosView: { value: new THREE.Vector3(0, 0, 0) },
            uMMCsMaxDistance: { value: maxDistance },
            uMMCsThickness: { value: thickness },
            uMMCsStrength: { value: strength },
            uMMCsSteps: { value: steps }
        };

        return this.contactShadowUniforms;
    }

    updateContactShadowUniforms() {
        if (this.aoMode !== 'contact') {
            return;
        }
        const uniforms = this.ensureContactShadowUniforms();

        const shipDepth = this.contactShadowShipDepthRT ? this.contactShadowShipDepthRT.depthTexture : null;
        uniforms.uMMShipDepth.value = shipDepth;
        uniforms.uMMDepthAvailable.value = shipDepth ? 1.0 : 0.0;

        if (this.camera) {
            uniforms.uMMProjectionMatrix.value.copy(this.camera.projectionMatrix);
            uniforms.uMMInvProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);
        }

        if (this.sunViewPosition) {
            uniforms.uMMSunPosView.value.copy(this.sunViewPosition);
        }
    }

    installContactShadowForSpacecraft() {
        if (this.aoMode !== 'contact') return;
        if (!this.objects || !this.objects.spacecraft) return;

        if (this.contactShadowDepthUnsupported) {
            return;
        }

        const shipMesh = this.objects.spacecraft.getMesh();
        if (!shipMesh) return;

        const uniforms = this.ensureContactShadowUniforms();

        const applyToMaterial = (material) => {
            if (!material) return;
            if (!(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial)) return;
            if (material.userData && material.userData.mmContactShadowInstalled) return;

            const prevCompile = material.onBeforeCompile;
            material.onBeforeCompile = (shader) => {
                if (typeof prevCompile === 'function') {
                    prevCompile(shader);
                }

                shader.uniforms.uMMContactEnabled = uniforms.uMMContactEnabled;
                shader.uniforms.uMMDepthAvailable = uniforms.uMMDepthAvailable;
                shader.uniforms.uMMShipDepth = uniforms.uMMShipDepth;
                shader.uniforms.uMMProjectionMatrix = uniforms.uMMProjectionMatrix;
                shader.uniforms.uMMInvProjectionMatrix = uniforms.uMMInvProjectionMatrix;
                shader.uniforms.uMMSunPosView = uniforms.uMMSunPosView;
                shader.uniforms.uMMCsMaxDistance = uniforms.uMMCsMaxDistance;
                shader.uniforms.uMMCsThickness = uniforms.uMMCsThickness;
                shader.uniforms.uMMCsStrength = uniforms.uMMCsStrength;
                shader.uniforms.uMMCsSteps = uniforms.uMMCsSteps;

                if (!shader.fragmentShader.includes('mmContactShadowFactor')) {
                    shader.fragmentShader = shader.fragmentShader.replace(
                        '#include <common>',
                        `#include <common>

uniform float uMMContactEnabled;
uniform float uMMDepthAvailable;
uniform sampler2D uMMShipDepth;
uniform mat4 uMMProjectionMatrix;
uniform mat4 uMMInvProjectionMatrix;
uniform vec3 uMMSunPosView;
uniform float uMMCsMaxDistance;
uniform float uMMCsThickness;
uniform float uMMCsStrength;
uniform float uMMCsSteps;

#define MM_CS_MAX_STEPS 24

vec3 mmReconstructViewPosition(vec2 uv, float depth) {
    float z = depth * 2.0 - 1.0;
    vec4 clip = vec4(uv * 2.0 - 1.0, z, 1.0);
    vec4 view = uMMInvProjectionMatrix * clip;
    return view.xyz / max(view.w, 1e-6);
}

vec2 mmProjectToUv(vec3 viewPos) {
    vec4 clip = uMMProjectionMatrix * vec4(viewPos, 1.0);
    vec3 ndc = clip.xyz / max(clip.w, 1e-6);
    return ndc.xy * 0.5 + 0.5;
}

float mmContactShadowFactor(vec3 fragViewPos) {
    if (uMMContactEnabled < 0.5) return 1.0;
    if (uMMDepthAvailable < 0.5) return 1.0;

    vec3 toSunView = uMMSunPosView - fragViewPos;
    float toSunLen = length(toSunView);
    if (toSunLen <= 1e-6) return 1.0;

    vec3 rayDirView = toSunView / toSunLen;
    float maxDist = min(uMMCsMaxDistance, toSunLen);

    float stepsF = clamp(floor(uMMCsSteps + 0.5), 1.0, float(MM_CS_MAX_STEPS));
    float occlusion = 0.0;
    float startDist = max(uMMCsThickness * 2.0, 1e-5);

    for (int i = 0; i < MM_CS_MAX_STEPS; i++) {
        if (float(i) >= stepsF) break;

        float t = float(i) / max(stepsF - 1.0, 1.0);
        float dist = startDist + t * maxDist;

        vec3 sampleView = fragViewPos + rayDirView * dist;
        vec2 suv = mmProjectToUv(sampleView);
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
            break;
        }

        float sDepth = texture2D(uMMShipDepth, suv).x;
        if (sDepth >= 1.0) {
            continue;
        }

        vec3 occView = mmReconstructViewPosition(suv, sDepth);
        if (occView.z > sampleView.z + uMMCsThickness) {
            float w = 1.0 - smoothstep(0.0, maxDist, dist);
            occlusion = max(occlusion, w);
            break;
        }
    }

    float shadow = clamp(1.0 - uMMCsStrength * occlusion, 0.0, 1.0);
    return shadow;
}`
                    );
                }

                if (!shader.fragmentShader.includes('mmContactShadowApplied')) {
                    const before = shader.fragmentShader;
                    shader.fragmentShader = shader.fragmentShader.replace(
                        '#include <lights_fragment_end>',
                        `#include <lights_fragment_end>

// mmContactShadowApplied
if (uMMContactEnabled > 0.5 && uMMDepthAvailable > 0.5) {
    float mmContact = mmContactShadowFactor(geometryPosition);
    reflectedLight.directDiffuse *= mmContact;
    reflectedLight.directSpecular *= mmContact;
}`
                    );

                    if (shader.fragmentShader === before) {
                        console.warn('Failed to inject contact shadows; ao=contact may have no effect.');
                    }
                }

                material.userData.mmContactShadowShader = shader;
            };

            if (!material.userData) {
                material.userData = {};
            }
            material.userData.mmContactShadowInstalled = true;
            material.needsUpdate = true;
        };

        shipMesh.traverse((node) => {
            if (!node || node.isMesh !== true) return;
            if (node.isPoints || node.isLine || node.isSprite) return;
            if (!node.material) return;

            if (Array.isArray(node.material)) {
                node.material.forEach((m) => applyToMaterial(m));
            } else {
                applyToMaterial(node.material);
            }
        });
    }

    installSpacecraftSelfShadowForSpacecraft() {
        if (!this.spacecraftSelfShadowEnabled) return;

        // The spacecraft GLTF loads asynchronously; ensure new meshes get the correct layer + shadow flags
        // after material swaps / model load completes.
        if (!this.spacecraftSelfShadowLight) {
            this.setupSpacecraftSelfShadowLight();
        }
        this.applySpacecraftSelfShadowFlags();
        this.updateSpacecraftSelfShadowLight();
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

     updatePlanetShadowUniforms() {
         if (!this.planetShadowUniforms) return;

         this.planetShadowUniforms.uSunPosWorld.value.set(0, 0, 0);

         if (this.objects.earth) {
             this.objects.earth.getWorldPosition(this.planetShadowUniforms.uEarthPosWorld.value);
         } else {
             this.planetShadowUniforms.uEarthPosWorld.value.set(1e9, 1e9, 1e9);
         }

         if (this.objects.mars) {
             this.objects.mars.getWorldPosition(this.planetShadowUniforms.uMarsPosWorld.value);
         } else {
             this.planetShadowUniforms.uMarsPosWorld.value.set(1e9, 1e9, 1e9);
         }
     }

     installPlanetShadowForSpacecraft() {
         if (!this.planetShadowEnabled) return;
         if (!this.objects || !this.objects.spacecraft) return;

          if (!this.planetShadowUniforms) {
              const earthRadius = 0.12;
              const marsRadius = 0.08;

              this.planetShadowUniforms = {
                  uPlanetShadowEnabled: { value: 1 },
                  uSunPosWorld: { value: new THREE.Vector3(0, 0, 0) },
                  uSunPosView: { value: new THREE.Vector3(0, 0, 0) },
                  uEarthPosWorld: { value: new THREE.Vector3(0, 0, 0) },
                  uEarthRadius: { value: earthRadius },
                  uMarsPosWorld: { value: new THREE.Vector3(0, 0, 0) },
                  uMarsRadius: { value: marsRadius }
              };
          }

          const uniforms = this.planetShadowUniforms;
          uniforms.uPlanetShadowEnabled.value = 1;


         const shipMesh = this.objects.spacecraft.getMesh();
         if (!shipMesh) return;

          const applyToMaterial = (material) => {
              if (!material) return;
              if (!(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial)) return;
              if (material.userData && material.userData.mmPlanetShadowInstalled) return;

              const prevCompile = material.onBeforeCompile;
              material.onBeforeCompile = (shader) => {
                  if (typeof prevCompile === 'function') {
                      prevCompile(shader);
                  }


                 shader.uniforms.uPlanetShadowEnabled = uniforms.uPlanetShadowEnabled;
                 shader.uniforms.uSunPosWorld = uniforms.uSunPosWorld;
                 shader.uniforms.uSunPosView = uniforms.uSunPosView;
                 shader.uniforms.uEarthPosWorld = uniforms.uEarthPosWorld;
                 shader.uniforms.uEarthRadius = uniforms.uEarthRadius;
                 shader.uniforms.uMarsPosWorld = uniforms.uMarsPosWorld;
                 shader.uniforms.uMarsRadius = uniforms.uMarsRadius;

                 shader.vertexShader = shader.vertexShader.replace(
                     '#include <common>',
                     `#include <common>\nvarying vec3 vMMPlanetShadowWorldPos;`
                 );

                 shader.vertexShader = shader.vertexShader.replace(
                     '#include <begin_vertex>',
                     `#include <begin_vertex>\nvec4 mmPlanetShadowWorldPos = modelMatrix * vec4(transformed, 1.0);\nvMMPlanetShadowWorldPos = mmPlanetShadowWorldPos.xyz;`
                 );

                  shader.fragmentShader = shader.fragmentShader.replace(
                      '#include <common>',
                      `#include <common>\n\nuniform float uPlanetShadowEnabled;\nuniform vec3 uSunPosWorld;\nuniform vec3 uEarthPosWorld;\nuniform float uEarthRadius;\nuniform vec3 uMarsPosWorld;\nuniform float uMarsRadius;\n\nvarying vec3 vMMPlanetShadowWorldPos;\n\nbool mmPlanetShadowRaySphereOccluded(vec3 rayOrigin, vec3 rayDir, vec3 sphereCenter, float sphereRadius, float maxT) {\n    vec3 oc = rayOrigin - sphereCenter;\n    float b = dot(oc, rayDir);\n    float c = dot(oc, oc) - sphereRadius * sphereRadius;\n    float h = b * b - c;\n    if (h < 0.0) return false;\n    float t = -b - sqrt(h);\n    return t > 0.0 && t < maxT;\n}\n\nfloat mmPlanetShadowFactor() {\n    if (uPlanetShadowEnabled < 0.5) return 1.0;\n    vec3 toSun = uSunPosWorld - vMMPlanetShadowWorldPos;\n    float maxT = length(toSun);\n    if (maxT <= 1e-6) return 1.0;\n    vec3 dir = toSun / maxT;\n\n    if (mmPlanetShadowRaySphereOccluded(vMMPlanetShadowWorldPos, dir, uEarthPosWorld, uEarthRadius, maxT)) return 0.0;\n    if (mmPlanetShadowRaySphereOccluded(vMMPlanetShadowWorldPos, dir, uMarsPosWorld, uMarsRadius, maxT)) return 0.0;\n    return 1.0;\n}`
                  );


                  shader.fragmentShader = shader.fragmentShader.replace(
                      '#include <lights_fragment_begin>',
                      `#include <lights_fragment_begin>\n\nfloat mmPlanetShadow = mmPlanetShadowFactor();`
                  );

                  let mmPatchedPointLight = false;
                  shader.fragmentShader = shader.fragmentShader.replace(
                      /getPointLightInfo\(\s*pointLights\s*\[\s*i\s*\]\s*,\s*geometry\s*,\s*directLight\s*\)\s*;\s*/,
                      (match) => {
                          mmPatchedPointLight = true;
                          return `${match}\nif (distance(pointLights[i].position, uSunPosWorld) < 1e-6) { directLight.color *= mmPlanetShadow; }\n`;
                      }
                  );

                  if (!mmPatchedPointLight) {
                      shader.fragmentShader = shader.fragmentShader.replace(
                          '#include <lights_fragment_end>',
                          `#include <lights_fragment_end>\n\nif (mmPlanetShadow < 0.5) {\n    reflectedLight.directDiffuse = vec3(0.0);\n    reflectedLight.directSpecular = vec3(0.0);\n}`
                      );
                  }




                 material.userData.mmPlanetShadowShader = shader;
             };

             if (!material.userData) {
                 material.userData = {};
             }
             material.userData.mmPlanetShadowInstalled = true;
             material.needsUpdate = true;
         };

         shipMesh.traverse((node) => {
             if (!node || node.isMesh !== true) return;
             if (node.isPoints || node.isLine || node.isSprite) return;
             if (!node.material) return;

             if (Array.isArray(node.material)) {
                 node.material.forEach((m) => applyToMaterial(m));
             } else {
                 applyToMaterial(node.material);
             }
         });
     }

     handleMissionUpdate(data) {

        const missionInfo = data.type === 'update' ? data : data.data;

         if (missionInfo.simulation && typeof missionInfo.simulation === 'object') {
             this.simulationState = { ...this.simulationState, ...missionInfo.simulation };
             this.syncUiFromSimulationState();
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
             this.lastSpacecraftPosition = null;
             if (this.objects.spacecraft) {
                 const mesh = this.objects.spacecraft.getMesh();
                 if (mesh) {
                     mesh.userData.lookTarget = null;
                     if (mesh.userData.prevRenderPos) {
                         mesh.userData.prevRenderPos.copy(mesh.position);
                     } else {
                         mesh.userData.prevRenderPos = mesh.position.clone();
                     }
                 }
             }
         }

        
        if (missionInfo.earth_position && this.objects.earth) {
            if (!this.objects.earth.userData.targetPos) this.objects.earth.userData.targetPos = new THREE.Vector3();
            this.mapBackendToThreeVector(missionInfo.earth_position, this.objects.earth.userData.targetPos);
        }

        if (missionInfo.mars_position && this.objects.mars) {
            if (!this.objects.mars.userData.targetPos) this.objects.mars.userData.targetPos = new THREE.Vector3();
            this.mapBackendToThreeVector(missionInfo.mars_position, this.objects.mars.userData.targetPos);
        }

        if (missionInfo.spacecraft_position && this.objects.spacecraft) {
            const mesh = this.objects.spacecraft.getMesh();
            const mapped = this.mapBackendToThreeArray(missionInfo.spacecraft_position);
            if (mapped) {
                const [mappedX, mappedY, mappedZ] = mapped;

                if (!mesh.userData.targetPos) mesh.userData.targetPos = new THREE.Vector3();
                mesh.userData.targetPos.set(mappedX, mappedY, mappedZ);

                mesh.visible = true;
                const isTransfer = missionInfo.phase === 'transfer_to_mars' || missionInfo.phase === 'transfer_to_earth';
                this.objects.spacecraft.setThrusterActive(isTransfer);

                if (isTransfer) {
                    this.updateSpacecraftTrail([mappedX, mappedY, mappedZ]);
                }

            } else {
                console.warn('Invalid spacecraft_position payload:', missionInfo.spacecraft_position);
            }
        }
        
        updateDataPanel(missionInfo);
        updateTimeline(missionInfo.time_days, missionInfo.timeline_horizon_end);
    }

    setViewMode(mode) {
        // Switching between preset modes and free OrbitControls can cause jumps if OrbitControls'
        // internal state (spherical/pan deltas) is out of sync with the camera/target we set.
        // Keep it stable by forcing a sync on mode changes.
        const prevMode = this.viewMode;
        this.viewMode = mode;

        if (!this.controls) return;

        if ((prevMode === 'top' && mode === 'free') || (prevMode === 'free' && mode === 'top')) {
            try {
                // Clear any residual inertial deltas that could be applied next update.
                if (this.controls.sphericalDelta && typeof this.controls.sphericalDelta.set === 'function') {
                    this.controls.sphericalDelta.set(0, 0, 0);
                }
                if (this.controls.panOffset && typeof this.controls.panOffset.set === 'function') {
                    this.controls.panOffset.set(0, 0, 0);
                }
                if (typeof this.controls.scale === 'number') {
                    this.controls.scale = 1;
                }
                if (typeof this.controls.zoomChanged === 'boolean') {
                    this.controls.zoomChanged = false;
                }
            } catch (e) {
                // Ignore: OrbitControls internals vary by three.js version.
            }

            // Force OrbitControls to recompute its internal spherical state from the current
            // camera.position and controls.target (which updateCamera() manipulates directly).
            this.controls.update();
        }
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
                this.controls.minDistance = 0.3;
                this.controls.maxDistance = 50;
                if (earthPos) {
                    focusPoint = earthPos;
                    idealOffset = new THREE.Vector3(0.8, 0.4, 0.8);
                }
                break;

            case 'mars':
                this.controls.enablePan = false;
                this.controls.minDistance = 0.3;
                this.controls.maxDistance = 50;
                if (marsPos) {
                    focusPoint = marsPos;
                    idealOffset = new THREE.Vector3(0.6, 0.3, 0.6);
                }
                break;

            case 'spacecraft':
                this.controls.enablePan = false;
                this.controls.minDistance = 0.02;
                this.controls.maxDistance = 10;
                if (shipPos) {
                    focusPoint = shipPos;
                    idealOffset = new THREE.Vector3(0.18, 0.12, 0.18);
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
	        const width = window.innerWidth;
	        const height = window.innerHeight;
	        const pixelRatio = (this.renderer && typeof this.renderer.getPixelRatio === 'function')
	            ? this.renderer.getPixelRatio()
	            : (window.devicePixelRatio || 1);

	        this.renderer.setSize(width, height);
	        if (this.bloomComposer) {
	            if (typeof this.bloomComposer.setPixelRatio === 'function') {
	                this.bloomComposer.setPixelRatio(pixelRatio);
	            }
	            this.bloomComposer.setSize(width, height);
	        }
	        if (this.finalComposer) {
	            if (typeof this.finalComposer.setPixelRatio === 'function') {
	                this.finalComposer.setPixelRatio(pixelRatio);
	            }
	            this.finalComposer.setSize(width, height);
	        }
	        if (this.bloomPass) {
	            this.bloomPass.resolution.set(width * pixelRatio, height * pixelRatio);
	        }
	        if (this.ssaaPass && typeof this.ssaaPass.setSize === 'function') {
	            this.ssaaPass.setSize(width * pixelRatio, height * pixelRatio);
	        }
	        if (this.smaaPass && typeof this.smaaPass.setSize === 'function') {
	            this.smaaPass.setSize(width * pixelRatio, height * pixelRatio);
	        }

	        const wantsContactShadowDepth = this.aoMode === 'contact' || this.csDebugMode !== 0;
	        if (wantsContactShadowDepth) {
	            this.ensureContactShadowDepthTargets(width, height, pixelRatio);
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

     syncUiFromSimulationState() {
         const state = this.simulationState;
         if (!state || typeof state !== 'object') return;

         const speed = (typeof state.time_speed === 'number' && Number.isFinite(state.time_speed)) ? state.time_speed : null;
         if (speed === null) return;

         const timeSpeedSlider = document.getElementById('time-speed');
         if (timeSpeedSlider) {
             timeSpeedSlider.value = String(speed);
         }

         const speedValue = document.getElementById('speed-value');
         if (speedValue) {
             speedValue.textContent = speed.toFixed(1);
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

        const nowMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        const dtSec = Math.max(0.0, Math.min(0.2, (nowMs - this.lastRenderMs) / 1000.0));
        this.lastRenderMs = nowMs;

        // Interpolate planet/ship positions
        const lerpAlpha = 0.1;

        if (this.objects.earth) {
            const earth = this.objects.earth;
            if (earth.userData.targetPos) {
                earth.position.lerp(earth.userData.targetPos, lerpAlpha);
            }
            if (!earth.userData.prevRenderPos) {
                earth.userData.prevRenderPos = earth.position.clone();
            }
            if (!earth.userData.renderDelta) {
                earth.userData.renderDelta = new THREE.Vector3();
            }
            earth.userData.renderDelta.copy(earth.position).sub(earth.userData.prevRenderPos);
            earth.userData.prevRenderPos.copy(earth.position);
        }

        if (this.objects.mars) {
            const mars = this.objects.mars;
            if (mars.userData.targetPos) {
                mars.position.lerp(mars.userData.targetPos, lerpAlpha);
            }
            if (!mars.userData.prevRenderPos) {
                mars.userData.prevRenderPos = mars.position.clone();
            }
            if (!mars.userData.renderDelta) {
                mars.userData.renderDelta = new THREE.Vector3();
            }
            mars.userData.renderDelta.copy(mars.position).sub(mars.userData.prevRenderPos);
            mars.userData.prevRenderPos.copy(mars.position);
        }

        if (this.objects.spacecraft) {
            const mesh = this.objects.spacecraft.getMesh();

            if (!mesh.userData.prevRenderPos) {
                mesh.userData.prevRenderPos = mesh.position.clone();
            }
            if (!mesh.userData.renderDelta) {
                mesh.userData.renderDelta = new THREE.Vector3();
            }
            if (!mesh.userData.forwardDir) {
                mesh.userData.forwardDir = new THREE.Vector3();
            }

            if (mesh.userData.targetPos) {
                mesh.position.lerp(mesh.userData.targetPos, lerpAlpha);
            }

            const phase = this.lastPhase;
            const isEarthStay = phase === 'earth_orbit_stay';
            const isMarsStay = phase === 'mars_orbit_stay';
            const isParking = isEarthStay || isMarsStay;
            const targetW = isParking ? 1.0 : 0.0;
            const blendTau = (typeof this.orientationBlendTauSec === 'number' && this.orientationBlendTauSec > 0)
                ? this.orientationBlendTauSec
                : 0.0;
            const blendAlpha = blendTau > 0 ? (1 - Math.exp(-dtSec / blendTau)) : 1.0;
            this.orientationBlendW = this.orientationBlendW + (targetW - this.orientationBlendW) * blendAlpha;
            if (this.orientationBlendW < 0) {
                this.orientationBlendW = 0;
            } else if (this.orientationBlendW > 1) {
                this.orientationBlendW = 1;
            }
            const w = this.orientationBlendW;
            const lookAlpha = isParking ? 0.2 : lerpAlpha;

            mesh.userData.renderDelta.copy(mesh.position).sub(mesh.userData.prevRenderPos);
            if (mesh.userData.renderDelta.lengthSq() > 1e-10) {
                if (!mesh.userData.lookTarget) {
                    mesh.userData.lookTarget = new THREE.Vector3();
                }
                if (!mesh.userData.inertialDir) {
                    mesh.userData.inertialDir = new THREE.Vector3();
                }
                if (!mesh.userData.relativeDir) {
                    mesh.userData.relativeDir = new THREE.Vector3();
                }
                if (!mesh.userData.mixedDir) {
                    mesh.userData.mixedDir = new THREE.Vector3();
                }

                const planetDelta = isEarthStay && this.objects.earth
                    ? this.objects.earth.userData.renderDelta
                    : (isMarsStay && this.objects.mars ? this.objects.mars.userData.renderDelta : null);

                mesh.userData.inertialDir.copy(mesh.userData.renderDelta);
                if (planetDelta) {
                    mesh.userData.relativeDir.copy(mesh.userData.renderDelta).sub(planetDelta);
                } else {
                    mesh.userData.relativeDir.copy(mesh.userData.renderDelta);
                }

                const inertialLenSq = mesh.userData.inertialDir.lengthSq();
                const relativeLenSq = mesh.userData.relativeDir.lengthSq();
                const hasInertial = inertialLenSq > 1e-10;
                const hasRelative = relativeLenSq > 1e-10;

                if (hasInertial) {
                    mesh.userData.inertialDir.normalize();
                }
                if (hasRelative) {
                    mesh.userData.relativeDir.normalize();
                }

                if (hasInertial && hasRelative) {
                    mesh.userData.mixedDir.copy(mesh.userData.inertialDir).multiplyScalar(1 - w);
                    mesh.userData.mixedDir.addScaledVector(mesh.userData.relativeDir, w);
                    if (mesh.userData.mixedDir.lengthSq() <= 1e-10) {
                        mesh.userData.mixedDir.copy(w >= 0.5 ? mesh.userData.relativeDir : mesh.userData.inertialDir);
                    }
                } else if (hasInertial) {
                    mesh.userData.mixedDir.copy(mesh.userData.inertialDir);
                } else if (hasRelative) {
                    mesh.userData.mixedDir.copy(mesh.userData.relativeDir);
                }

                if (mesh.userData.mixedDir.lengthSq() > 1e-10) {
                    mesh.userData.forwardDir.copy(mesh.userData.mixedDir).normalize();
                    mesh.userData.lookTarget.copy(mesh.position).add(mesh.userData.forwardDir);
                }
            }
            mesh.userData.prevRenderPos.copy(mesh.position);

            if (mesh.userData.lookTarget) {
                if (!mesh.userData._q0) {
                    mesh.userData._q0 = new THREE.Quaternion();
                }
                if (!mesh.userData._q1) {
                    mesh.userData._q1 = new THREE.Quaternion();
                }
                if (!mesh.userData.prevForward) {
                    mesh.userData.prevForward = new THREE.Vector3();
                }
                if (!mesh.userData._bankCross) {
                    mesh.userData._bankCross = new THREE.Vector3();
                }
                if (!mesh.userData._bankWorldUp) {
                    mesh.userData._bankWorldUp = new THREE.Vector3(0, 1, 0);
                }
                if (!mesh.userData._bankAxis) {
                    mesh.userData._bankAxis = new THREE.Vector3(0, 0, -1);
                }
                if (!mesh.userData._bankQuat) {
                    mesh.userData._bankQuat = new THREE.Quaternion();
                }
                if (typeof mesh.userData.bank !== 'number') {
                    mesh.userData.bank = 0.0;
                }

                if (typeof mesh.userData.bankCurvature !== 'number') {
                    mesh.userData.bankCurvature = 0.0;
                }

                let bankTarget = 0.0;
                const forwardDir = mesh.userData.forwardDir;
                if (forwardDir && forwardDir.lengthSq() > 1e-10) {
                    if (mesh.userData.prevForward.lengthSq() <= 1e-10) {
                        mesh.userData.prevForward.copy(forwardDir);
                    }
                    const dot = Math.max(-1, Math.min(1, mesh.userData.prevForward.dot(forwardDir)));
                    const angle = Math.acos(dot);
                    const turnSign = Math.sign(
                        mesh.userData._bankCross.crossVectors(mesh.userData.prevForward, forwardDir)
                            .dot(mesh.userData._bankWorldUp)
                    );
                    const stepDist = mesh.userData.renderDelta.length();
                    const measuredCurvature = stepDist > 1e-10 ? (turnSign * angle / stepDist) : 0.0;

                    const curvatureTau = (typeof this.bankCurvatureTauSec === 'number' && this.bankCurvatureTauSec > 0)
                        ? this.bankCurvatureTauSec
                        : 0.0;
                    const curvatureAlpha = curvatureTau > 0 ? (1 - Math.exp(-dtSec / curvatureTau)) : 1.0;
                    mesh.userData.bankCurvature = mesh.userData.bankCurvature + (measuredCurvature - mesh.userData.bankCurvature) * curvatureAlpha;

                    const gain = (typeof this.bankGainPerUnit === 'number' && this.bankGainPerUnit > 0)
                        ? this.bankGainPerUnit
                        : 0.0;
                    bankTarget = Math.max(
                        -this.bankMaxRad,
                        Math.min(this.bankMaxRad, mesh.userData.bankCurvature * gain)
                    );

                    const deadband = (typeof this.bankDeadbandRad === 'number' && this.bankDeadbandRad > 0)
                        ? this.bankDeadbandRad
                        : 0.0;
                    if (Math.abs(bankTarget) < deadband) {
                        bankTarget = 0.0;
                    }

                    mesh.userData.prevForward.copy(forwardDir);
                }

                const bankTau = (typeof this.bankTauSec === 'number' && this.bankTauSec > 0) ? this.bankTauSec : 0.0;
                const bankAlpha = bankTau > 0 ? (1 - Math.exp(-dtSec / bankTau)) : 1.0;
                mesh.userData.bank = mesh.userData.bank + (bankTarget - mesh.userData.bank) * bankAlpha;


                const currentQuat = mesh.userData._q0.copy(mesh.quaternion);
                mesh.lookAt(mesh.userData.lookTarget);
                const targetQuat = mesh.userData._q1.copy(mesh.quaternion);
                if (mesh.userData.bank !== 0) {
                    mesh.userData._bankQuat.setFromAxisAngle(mesh.userData._bankAxis, mesh.userData.bank);
                    targetQuat.multiply(mesh.userData._bankQuat);
                }
                mesh.quaternion.copy(currentQuat).slerp(targetQuat, lookAlpha);
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

	             this.updatePlanetShadowUniforms();
	             
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
                if (this.earthLightsShader.uniforms.time) {
                    this.earthLightsShader.uniforms.time.value = Date.now() * 0.001;
	            }
	        }

	        this.updateSpacecraftSelfShadowLight();
        }

        if (this.objects.sunGlow && this.objects.sunGlow.length >= 2) {
            const time = Date.now() * 0.002;
            const pulse = 1.0 + Math.sin(time) * 0.08;
            this.objects.sunGlow[0].scale.set(0.85 * pulse, 0.85 * pulse, 1.0);
            this.objects.sunGlow[1].scale.set(1.7 * (1.0 + Math.sin(time * 0.5) * 0.12), 1.7 * (1.0 + Math.sin(time * 0.5) * 0.12), 1.0);
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
        if (this.objects.mars) {
            this.objects.mars.rotation.y = (simDays * this.marsSpinRate) % twoPi;
        }

        const isRunning = !!(this.simulationState && this.simulationState.is_running);
        const isPaused = !!(this.simulationState && this.simulationState.paused);
        if (!isRunning || isPaused) {
            const idleDelta = this.cloudIdleSpinRadPerSec * dtSec;
            this.earthCloudRotationOffset = (this.earthCloudRotationOffset + idleDelta) % twoPi;
            this.marsCloudRotationOffset = (this.marsCloudRotationOffset + idleDelta) % twoPi;
        }

        if (this.objects.earthClouds) {
            this.objects.earthClouds.rotation.y = (simDays * this.earthCloudSpinRate + this.earthCloudRotationOffset) % twoPi;
        }
        if (this.objects.marsClouds) {
            this.objects.marsClouds.rotation.y = (simDays * this.marsCloudSpinRate + this.marsCloudRotationOffset) % twoPi;
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

        const postMode = this.getRequestedPostMode();
        const isRawPost = postMode === 'raw';

	        if (!isRawPost) {
	            this.updateLensFlare();
	        } else {
	            this.flareElements.forEach(f => f.sprite.visible = false);
	        }

	        const wantsContactShadowDepth = this.aoMode === 'contact' || this.csDebugMode !== 0;
	        if (wantsContactShadowDepth) {
	            const width = window.innerWidth;
	            const height = window.innerHeight;
	            const pixelRatio = (this.renderer && typeof this.renderer.getPixelRatio === 'function')
	                ? this.renderer.getPixelRatio()
	                : (window.devicePixelRatio || 1);

	            this.ensureContactShadowDepthTargets(width, height, pixelRatio);
	            this.renderContactShadowDepthTargets();
	            this.updateContactShadowUniforms();
	        }

	        if (this.csDebugMode !== 0) {
	            this.renderContactShadowDebug();
	            return;
	        }

	        const disableBloom = isRawPost;

        if (
            !disableBloom &&
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
        } else if (this.finalComposer && this.additivePass) {
            if (this.additivePass.uniforms) {
                this.additivePass.uniforms.tBloom.value = null;
                this.additivePass.uniforms.bloomStrength.value = 0.0;
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
    if (app) {
        window.app = app;
    }
});
