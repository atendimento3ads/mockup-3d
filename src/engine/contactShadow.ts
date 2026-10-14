import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

// Sombra macia de estúdio. Uma câmera ortográfica fica embaixo do chão olhando na direção da luz
// principal (um pouco inclinada). Cada ponto do chão "vê" o aparelho na direção da luz, e a sombra
// escurece conforme o aparelho está mais perto do chão. Depois tudo é desfocado.
// A inclinação faz até um iPhone em pé projetar uma sombra de verdade, não só a marca da base.

const depthVertex = /* glsl */ `
  varying float vHeight;
  uniform float groundY;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vHeight = wp.y - groundY;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const depthFragment = /* glsl */ `
  varying float vHeight;
  uniform float reach;
  void main() {
    float h = clamp(vHeight / reach, 0.0, 1.0);
    gl_FragColor = vec4(0.0, 0.0, 0.0, pow(1.0 - h, 1.5));
  }`;

const planeVertex = /* glsl */ `
  uniform mat4 shadowMatrix;
  varying vec4 vShadow;
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vShadow = shadowMatrix * wp;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const planeFragment = /* glsl */ `
  uniform sampler2D map;
  uniform float opacity;
  uniform float clipRadius;
  uniform vec2 clipCenter;
  varying vec4 vShadow;
  varying vec3 vWorld;
  void main() {
    vec2 uv = vShadow.xy / vShadow.w * 0.5 + 0.5;
    vec2 edge = smoothstep(0.0, 0.06, uv) * smoothstep(0.0, 0.06, 1.0 - uv);
    float a = texture2D(map, clamp(uv, 0.0, 1.0)).a * edge.x * edge.y;
    // No pódio a sombra não pode "sair" do tampo.
    if (clipRadius > 0.0) a *= 1.0 - smoothstep(clipRadius * 0.97, clipRadius, distance(vWorld.xz, clipCenter));
    gl_FragColor = vec4(0.0, 0.0, 0.0, a * opacity);
  }`;

export class ContactShadow {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private rt: THREE.WebGLRenderTarget;
  private rtBlur: THREE.WebGLRenderTarget;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private depthMat: THREE.ShaderMaterial;
  private blurPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private hBlur: THREE.ShaderMaterial;
  private vBlur: THREE.ShaderMaterial;
  private blurScene = new THREE.Scene();
  private blurCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);

  constructor(resolution = 1024) {
    const opts = { type: THREE.HalfFloatType } as const;
    this.rt = new THREE.WebGLRenderTarget(resolution, resolution, opts);
    this.rtBlur = new THREE.WebGLRenderTarget(resolution, resolution, opts);
    this.rt.texture.generateMipmaps = false;
    this.rtBlur.texture.generateMipmaps = false;

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        vertexShader: planeVertex,
        fragmentShader: planeFragment,
        transparent: true,
        depthWrite: false,
        uniforms: {
          map: { value: this.rt.texture },
          opacity: { value: 0.5 },
          shadowMatrix: { value: new THREE.Matrix4() },
          clipRadius: { value: 0 },
          clipCenter: { value: new THREE.Vector2() },
        },
      }),
    );
    this.mesh.renderOrder = -1;

    this.depthMat = new THREE.ShaderMaterial({
      vertexShader: depthVertex,
      fragmentShader: depthFragment,
      side: THREE.DoubleSide,
      uniforms: { groundY: { value: 0 }, reach: { value: 1 } },
    });

    this.hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
    this.vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
    this.hBlur.depthTest = this.vBlur.depthTest = false;
    this.blurPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.hBlur);
    this.blurScene.add(this.blurPlane);
    this.blurCam.position.z = 0.5;
  }

  setOpacity(v: number) {
    this.mesh.material.uniforms.opacity.value = v;
  }

  // lightAzimuth em radianos (mesma direção da luz principal); softness de 0 a 1.
  setClip(radius: number, x: number, z: number) {
    this.mesh.material.uniforms.clipRadius.value = radius;
    this.mesh.material.uniforms.clipCenter.value.set(x, z);
  }

  // `hide`: objetos que não projetam sombra (o cenário, por exemplo).
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, bounds: THREE.Box3, softness: number, lightAzimuth: number, hide: THREE.Object3D[] = []) {
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const groundY = bounds.min.y;
    const reach = Math.max(size.y * 0.9, 0.4);
    const tilt = 32 * (Math.PI / 180);
    // Direção do chão para a luz.
    const toLight = new THREE.Vector3(Math.sin(lightAzimuth) * Math.sin(tilt), Math.cos(tilt), Math.cos(lightAzimuth) * Math.sin(tilt));

    // Área do chão que pode receber sombra: a base do aparelho mais o "rastro" para longe da luz.
    const trail = reach * Math.tan(tilt);
    const extent = Math.max(size.x, size.z) + trail * 2 + 0.6 + softness * 0.6;
    const ground = new THREE.Vector3(center.x, groundY, center.z);
    const planeCenter = ground.clone().addScaledVector(new THREE.Vector3(-toLight.x, 0, -toLight.z).normalize(), trail * 0.5);
    this.mesh.position.set(planeCenter.x, groundY + 0.0015, planeCenter.z);
    this.mesh.scale.set(extent, 1, extent);

    // Câmera embaixo do chão, olhando para a luz.
    const back = extent;
    this.cam.position.copy(ground).addScaledVector(toLight, -back);
    this.cam.up.set(0, 0, -1);
    if (Math.abs(toLight.z) > 0.99) this.cam.up.set(1, 0, 0);
    this.cam.lookAt(ground);
    const half = extent * 0.6;
    this.cam.left = -half;
    this.cam.right = half;
    this.cam.top = half;
    this.cam.bottom = -half;
    this.cam.near = 0.01;
    this.cam.far = back + reach / toLight.y + size.length();
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
    this.mesh.material.uniforms.shadowMatrix.value.multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse);
    this.depthMat.uniforms.groundY.value = groundY;
    this.depthMat.uniforms.reach.value = reach;

    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);

    // Renderiza a cena com o material de "proximidade do chão", sem a própria sombra.
    const prevOverride = scene.overrideMaterial;
    const prevBackground = scene.background;
    scene.overrideMaterial = this.depthMat;
    scene.background = null;
    this.mesh.visible = false;
    const wasVisible = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, this.cam);
    hide.forEach((o, i) => (o.visible = wasVisible[i]));
    this.mesh.visible = true;
    scene.overrideMaterial = prevOverride;
    scene.background = prevBackground;

    // Desfoque em três passadas (largo, médio e fino) para uma borda bem macia.
    const texel = 1 / this.rt.width;
    const blurPass = (amount: number) => {
      this.blurPlane.material = this.hBlur;
      this.hBlur.uniforms.tDiffuse.value = this.rt.texture;
      this.hBlur.uniforms.h.value = amount * texel;
      renderer.setRenderTarget(this.rtBlur);
      renderer.render(this.blurScene, this.blurCam);
      this.blurPlane.material = this.vBlur;
      this.vBlur.uniforms.tDiffuse.value = this.rtBlur.texture;
      this.vBlur.uniforms.v.value = amount * texel;
      renderer.setRenderTarget(this.rt);
      renderer.render(this.blurScene, this.blurCam);
    };
    const base = 1.2 + softness * 7;
    blurPass(base);
    blurPass(base * 0.6);
    blurPass(base * 0.3);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAutoClear;
  }

  dispose() {
    this.rt.dispose();
    this.rtBlur.dispose();
    this.depthMat.dispose();
    this.hBlur.dispose();
    this.vBlur.dispose();
    this.blurPlane.geometry.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
