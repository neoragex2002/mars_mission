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

        this.materialMode = 'default';
        this._originalMaterials = new Map();
        this._whiteMaterial = null;
        this._contactShadowLayer = null;

        this.createSpacecraft();
    }

    setMaterialMode(mode) {
        const normalized = (String(mode || '').trim().toLowerCase() === 'white') ? 'white' : 'default';
        this.materialMode = normalized;
        this._applyPostCreateFlags();
    }

    setContactShadowLayer(layer) {
        const raw = Number(layer);
        if (!Number.isFinite(raw)) return;
        const normalized = Math.max(0, Math.min(31, Math.floor(raw)));
        this._contactShadowLayer = normalized;
        this._applyPostCreateFlags();
    }

    _ensureWhiteMaterial() {
        if (this._whiteMaterial) return this._whiteMaterial;
        this._whiteMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.0,
            roughness: 1.0
        });
        return this._whiteMaterial;
    }

    _cacheOriginalMaterials() {
        if (!this.mesh || typeof this.mesh.traverse !== 'function') return;
        this.mesh.traverse((child) => {
            if (!child || child.isMesh !== true) return;
            if (!child.material) return;
            if (this._originalMaterials.has(child)) return;
            this._originalMaterials.set(child, child.material);
        });
    }

    _applyWhiteMaterial() {
        this._cacheOriginalMaterials();
        const white = this._ensureWhiteMaterial();
        if (!this.mesh || typeof this.mesh.traverse !== 'function') return;
        this.mesh.traverse((child) => {
            if (!child || child.isMesh !== true) return;
            if (!child.material) return;
            child.material = white;
        });
    }

    _restoreOriginalMaterials() {
        for (const [child, material] of this._originalMaterials.entries()) {
            if (!child || child.isMesh !== true) continue;
            child.material = material;
        }
    }

    _applyContactShadowLayer() {
        if (this._contactShadowLayer === null || this._contactShadowLayer === undefined) return;
        if (!this.mesh || typeof this.mesh.traverse !== 'function') return;
        this.mesh.traverse((child) => {
            if (!child || child.isMesh !== true) return;
            if (!child.layers || typeof child.layers.enable !== 'function') return;
            child.layers.enable(this._contactShadowLayer);
        });
    }

    _applyPostCreateFlags() {
        this._applyContactShadowLayer();
        if (this.materialMode === 'white') {
            this._applyWhiteMaterial();
        } else {
            this._restoreOriginalMaterials();
        }

        this.applyIblIntensity();

        if (typeof window !== 'undefined' && window.app) {
            if (typeof window.app.installPlanetShadowForSpacecraft === 'function') {
                window.app.installPlanetShadowForSpacecraft();
            }
            if (typeof window.app.installContactShadowForSpacecraft === 'function') {
                window.app.installContactShadowForSpacecraft();
            }
        }
    }

    applyIblIntensity() {
        if (typeof window === 'undefined') return;
        if (typeof window.__mm_applyIblIntensity !== 'function') return;
        window.__mm_applyIblIntensity();
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

    getThrusterSpriteTexture() {
        if (this.sharedTextures.thrusterSprite) {
            return this.sharedTextures.thrusterSprite;
        }

        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        const center = size * 0.5;
        const gradient = context.createRadialGradient(center, center, 0, center, center, center);

        gradient.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
        gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.9)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.45)');
        gradient.addColorStop(0.75, 'rgba(255, 255, 255, 0.12)');
        gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');

        context.clearRect(0, 0, size, size);
        context.fillStyle = gradient;
        context.fillRect(0, 0, size, size);

        const texture = new THREE.CanvasTexture(canvas);
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;

        this.sharedTextures.thrusterSprite = texture;
        return texture;
    }

    createSpacecraft() {
        this.mesh = new THREE.Group();
        this.mesh.scale.set(0.34, 0.4, 0.4);
        this.modelTargetSize = 0.2;
        this.autoCenterModelPivot = false;
        this.autoAlignModelAxes = false;
        this.modelYawCorrection = 0;
        this.modelPitchCorrection = 0;
        this.modelRollCorrection = 0;
        this.modelRoot = null;
        this.modelLoaded = false;
        
        this.createThrusterEffect();

        const loaderAvailable = (typeof THREE !== 'undefined' && typeof THREE.GLTFLoader === 'function');
        if (loaderAvailable) {
            this.loadGatewayModel();
        } else {
            console.warn('GLTFLoader missing; falling back to procedural spacecraft.');
            this.createProceduralModel();
        }

        this._applyPostCreateFlags();
        this.scene.add(this.mesh);
    }

    createProceduralModel() {
        this.createBody();
        this.createCockpit();
        this.createSolarPanels();
        this.createThrusterNozzles();
        this.createAntenna();
        this.createLandingLegs();
        this.createDetails();

        this.mesh.traverse((child) => {
            if (!child.isMesh) return;
            if (child.isPoints || child.isLine || child.isSprite) return;
            child.receiveShadow = true;
        });

        this.applyIblIntensity();
        this._applyPostCreateFlags();
    }

     loadGatewayModel() {
         const loader = new THREE.GLTFLoader();
         loader.load(
             '/static/assets/models/GatewayCore.glb',
             (gltf) => {
                 const root = gltf.scene || gltf.scenes[0];
                 if (!root) {
                     console.warn('GLB loaded without a scene; falling back to procedural model.');
                   this.createProceduralModel();
                   this.applyIblIntensity();
                   if (typeof window !== 'undefined' && window.app && typeof window.app.installPlanetShadowForSpacecraft === 'function') {
                       window.app.installPlanetShadowForSpacecraft();
                   }
                   return;


             }


                 this.applySavedCalibration();

                 const normalized = this.normalizeLoadedModel(root);
                 this.mesh.add(normalized);
                 this.modelRoot = normalized;
                 this.modelLoaded = true;
 
                 if (this.modelCalibrationRoot) {
                     this.modelCalibrationRoot.rotation.set(0, 0, 0);
                     this.modelCalibrationRoot.rotateX(this.modelPitchCorrection);
                     this.modelCalibrationRoot.rotateY(this.modelYawCorrection);
                     this.modelCalibrationRoot.rotateZ(this.modelRollCorrection);
                 }
 
                 this.applyIblIntensity();
                  if (typeof window !== 'undefined' && window.app && typeof window.app.installPlanetShadowForSpacecraft === 'function') {
                      window.app.installPlanetShadowForSpacecraft();
                  }
                  this._applyPostCreateFlags();
              },


             undefined,
             (error) => {
                   console.warn('Failed to load GatewayCore GLB; falling back to procedural model.', error);
                   this.createProceduralModel();
                   this.applyIblIntensity();
                   if (typeof window !== 'undefined' && window.app && typeof window.app.installPlanetShadowForSpacecraft === 'function') {
                       window.app.installPlanetShadowForSpacecraft();
                   }
               }


         );
     }

     applySavedCalibration() {
         const STORAGE_KEY = 'mm_model_calibration_v1';
         try {
             const raw = localStorage.getItem(STORAGE_KEY);
             if (!raw) return;
             const parsed = JSON.parse(raw);
             if (!parsed || typeof parsed !== 'object') return;

             const yaw = typeof parsed.yaw === 'number' ? parsed.yaw : 0;
             const pitch = typeof parsed.pitch === 'number' ? parsed.pitch : 0;
             const roll = typeof parsed.roll === 'number' ? parsed.roll : 0;

             this.modelYawCorrection = (yaw * Math.PI) / 180.0;
             this.modelPitchCorrection = (pitch * Math.PI) / 180.0;
             this.modelRollCorrection = (roll * Math.PI) / 180.0;
         } catch (e) {
             return;
         }
     }


    normalizeLoadedModel(model) {
        const container = new THREE.Group();
        container.position.set(0, 0, 0);
        container.rotation.set(0, 0, 0);
        container.scale.set(1, 1, 1);

        const calibration = new THREE.Group();
        calibration.position.set(0, 0, 0);
        calibration.rotation.set(0, 0, 0);
        calibration.scale.set(1, 1, 1);

        container.add(calibration);
        calibration.add(model);

        model.updateMatrixWorld(true);
        calibration.updateMatrixWorld(true);
        container.updateMatrixWorld(true);


        if (Number.isFinite(this.modelPitchCorrection)) {
            calibration.rotateX(this.modelPitchCorrection);
        }
        if (Number.isFinite(this.modelYawCorrection)) {
            calibration.rotateY(this.modelYawCorrection);
        }
        if (Number.isFinite(this.modelRollCorrection)) {
            calibration.rotateZ(this.modelRollCorrection);
        }
        container.updateMatrixWorld(true);

        this.modelCalibrationRoot = calibration;

        const scaledBox = new THREE.Box3().setFromObject(container);
        const size = new THREE.Vector3();
        scaledBox.getSize(size);

        const maxDimension = Math.max(size.x, size.y, size.z);
        const safeDimension = maxDimension > 0 ? maxDimension : 1;
        const uniformScale = this.modelTargetSize / safeDimension;
        container.scale.set(uniformScale, uniformScale, uniformScale);
        container.updateMatrixWorld(true);


        model.traverse((child) => {
            if (!child.isMesh) return;
            if (child.isPoints || child.isLine || child.isSprite) return;
            child.receiveShadow = true;

            const material = child.material;
            if (!material) return;

            const applyMaterialFixes = (m) => {
                if (!m) return;

                m.transparent = false;
                m.opacity = 1.0;
                m.alphaTest = 0.0;
                m.depthWrite = true;
                m.depthTest = true;

                m.side = THREE.DoubleSide;

                if (typeof m.envMapIntensity === 'number') {
                    if (typeof m.userData.baseEnvMapIntensity !== 'number') {
                        m.userData.baseEnvMapIntensity = m.envMapIntensity;
                    }
                }
                m.needsUpdate = true;
            };

            if (Array.isArray(material)) {
                material.forEach((m) => applyMaterialFixes(m));
                return;
            }

            applyMaterialFixes(material);
        });

        return container;
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
        this.thrusterConfig = {
            core: {
                particleCount: 220,
                originX: 0.0,
                originZ: -0.05,
                originY: -0.01,
                baseSize: 0.0012,
                sizeJitter: 0.00065,
                baseOpacity: 0.22,
                lifeMin: 0.16,
                lifeMax: 0.28,
                speedMin: 0.004,
                speedMax: 0.0065,
                spread: 0.00008,
                colorStart: new THREE.Color(0xeaf6ff),
                colorEnd: new THREE.Color(0xa9d2ff)
            },
            plume: {
                particleCount: 180,
                originX: 0.0,
                originZ: -0.05,
                originY: -0.01,
                baseSize: 0.0022,
                sizeJitter: 0.0018,
                baseOpacity: 0.16,
                lifeMin: 0.55,
                lifeMax: 1.1,
                speedMin: 0.0018,
                speedMax: 0.0040,
                spread: 0.00085,
                colorStart: new THREE.Color(0xb9ddff),
                colorEnd: new THREE.Color(0x4f9dff)
            },
            update: {
                dtLife: 0.03,
                jitterFactor: 0.07,
                minSizeRatio: 0.05
            }
        };

        const thrusterSprite = this.getThrusterSpriteTexture();

        const buildSystem = (config) => {
            const geometry = new THREE.BufferGeometry();

            const positions = new Float32Array(config.particleCount * 3);
            const colors = new Float32Array(config.particleCount * 3);
            const sizes = new Float32Array(config.particleCount);
            const data = [];

            for (let i = 0; i < config.particleCount; i++) {
                positions[i * 3] = config.originX || 0;
                positions[i * 3 + 1] = config.originY || 0;
                positions[i * 3 + 2] = config.originZ;

                const maxLife = config.lifeMin + Math.random() * (config.lifeMax - config.lifeMin);
                const speed = config.speedMin + Math.random() * (config.speedMax - config.speedMin);

                const jitter = (Math.random() - 0.5);
                sizes[i] = config.baseSize + jitter * config.sizeJitter;

                const c = config.colorStart.clone().lerp(config.colorEnd, Math.random());
                colors[i * 3] = c.r;
                colors[i * 3 + 1] = c.g;
                colors[i * 3 + 2] = c.b;

                data.push({
                    velocity: {
                        x: (Math.random() - 0.5) * config.spread,
                        y: (Math.random() - 0.5) * config.spread,
                        z: -speed
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
                size: config.baseSize,
                map: thrusterSprite,
                alphaTest: 0.0,
                vertexColors: true,
                transparent: true,
                opacity: config.baseOpacity,
                blending: THREE.AdditiveBlending,
                sizeAttenuation: true,
                depthWrite: false
            });

            const points = new THREE.Points(geometry, material);
            points.visible = false;

            return { points, data };
        };

        const core = buildSystem(this.thrusterConfig.core);
        const plume = buildSystem(this.thrusterConfig.plume);

        this.thrusterCore = core.points;
        this.thrusterPlume = plume.points;
        this.thrusterCoreData = core.data;
        this.thrusterPlumeData = plume.data;

        this.mesh.add(this.thrusterCore);
        this.mesh.add(this.thrusterPlume);
    }

    updateThrusterEffect() {
        const updateSystem = (points, data, config) => {
            if (!points || !points.visible) return;

            const positions = points.geometry.attributes.position.array;
            const colors = points.geometry.attributes.color.array;
            const sizes = points.geometry.attributes.size.array;

            const updateCfg = this.thrusterConfig && this.thrusterConfig.update ? this.thrusterConfig.update : null;
            const jitterFactor = updateCfg ? updateCfg.jitterFactor : 0.08;
            const dtLife = updateCfg ? updateCfg.dtLife : 0.03;
            const minSizeRatio = updateCfg ? updateCfg.minSizeRatio : 0.05;

            for (let i = 0; i < data.length; i++) {
                const particle = data[i];

                positions[i * 3] += particle.velocity.x;
                positions[i * 3 + 1] += particle.velocity.y;
                positions[i * 3 + 2] += particle.velocity.z;

                particle.velocity.x += (Math.random() - 0.5) * (config.spread * jitterFactor);
                particle.velocity.y += (Math.random() - 0.5) * (config.spread * jitterFactor);

                particle.life -= dtLife;


                if (particle.life <= 0) {
                    positions[i * 3] = config.originX || 0;
                    positions[i * 3 + 1] = config.originY || 0;
                    positions[i * 3 + 2] = config.originZ;

                    const maxLife = config.lifeMin + Math.random() * (config.lifeMax - config.lifeMin);
                    const speed = config.speedMin + Math.random() * (config.speedMax - config.speedMin);

                    particle.velocity.x = (Math.random() - 0.5) * config.spread;
                    particle.velocity.y = (Math.random() - 0.5) * config.spread;
                    particle.velocity.z = -speed;
                    particle.maxLife = maxLife;
                    particle.life = particle.maxLife;
                }

                const lifeRatio = particle.life / particle.maxLife;

                const t = 1.0 - Math.max(0.0, Math.min(1.0, lifeRatio));
                const c = config.colorStart.clone().lerp(config.colorEnd, t);
                colors[i * 3] = c.r;
                colors[i * 3 + 1] = c.g;
                colors[i * 3 + 2] = c.b;

                sizes[i] = particle.size * Math.max(minSizeRatio, lifeRatio);
            }

            points.geometry.attributes.position.needsUpdate = true;
            points.geometry.attributes.color.needsUpdate = true;
            points.geometry.attributes.size.needsUpdate = true;
        };

        if (this.thrusterCore && this.thrusterPlume) {
            updateSystem(this.thrusterCore, this.thrusterCoreData, this.thrusterConfig.core);
            updateSystem(this.thrusterPlume, this.thrusterPlumeData, this.thrusterConfig.plume);
            return;
        }

        if (this.thrusterParticles && this.particleData) {
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
        if (this.thrusterCore && this.thrusterPlume) {
            this.thrusterCore.visible = active;
            this.thrusterPlume.visible = active;
        }
        if (this.thrusterParticles) {
            this.thrusterParticles.visible = active;
        }
        
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
