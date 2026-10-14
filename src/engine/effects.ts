import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

// A cena é renderizada com fundo transparente (cores pré-multiplicadas pelo alfa).
// Este efeito aplica a exposição só no 3D, suaviza os brilhos fortes e coloca o fundo por baixo,
// com as cores exatas escolhidas.
//
// Curva "suave": tudo abaixo de 0.9 (linear) passa intacto, então o print e o fundo ficam fiéis;
// só os reflexos acima disso se apagam aos poucos em vez de estourar em branco chapado.
export class SceneCompositeEffect extends Effect {
  constructor() {
    super(
      'SceneCompositeEffect',
      /* glsl */ `
      uniform sampler2D bgMap;
      uniform float bgOn;
      uniform float exposure;
      uniform float softClip;
      vec3 softClipCurve(vec3 c) {
        const float k = 0.9;
        float peak = max(c.r, max(c.g, c.b));
        if (peak <= k) return c;
        float np = 1.0 - (1.0 - k) * exp(-(peak - k) / (1.0 - k));
        vec3 s = c * (np / peak);
        float g = 1.0 - 1.0 / (0.15 * (peak - np) + 1.0);
        return mix(s, vec3(np), g);
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float a = clamp(inputColor.a, 0.0, 1.0);
        vec3 rgb = a > 1e-4 ? inputColor.rgb / a : vec3(0.0);
        rgb *= exposure;
        if (softClip > 0.5) rgb = softClipCurve(rgb);
        vec3 c = rgb * a;
        vec4 bg = texture2D(bgMap, uv) * bgOn;
        outputColor = vec4(c + bg.rgb * (1.0 - a), a + bg.a * (1.0 - a));
      }`,
      {
        blendFunction: BlendFunction.SET,
        uniforms: new Map<string, THREE.Uniform>([
          ['bgMap', new THREE.Uniform(null)],
          ['bgOn', new THREE.Uniform(1)],
          ['exposure', new THREE.Uniform(1)],
          ['softClip', new THREE.Uniform(1)],
        ]),
      },
    );
  }
}

// Máscara de nitidez simples (realça bordas comparando cada pixel com os vizinhos).
export class SharpenEffect extends Effect {
  constructor() {
    super(
      'SharpenEffect',
      /* glsl */ `
      uniform float amount;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec4 n = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y))
               + texture2D(inputBuffer, uv - vec2(0.0, texelSize.y))
               + texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0))
               + texture2D(inputBuffer, uv - vec2(texelSize.x, 0.0));
        vec3 s = inputColor.rgb * (1.0 + 4.0 * amount) - n.rgb * amount;
        outputColor = vec4(clamp(s, 0.0, max(inputColor.a, 1e-4)), inputColor.a);
      }`,
      {
        blendFunction: BlendFunction.SET,
        attributes: EffectAttribute.CONVOLUTION,
        uniforms: new Map<string, THREE.Uniform>([['amount', new THREE.Uniform(0.25)]]),
      },
    );
  }
}

// Ajustes de cor da imagem final: contraste (em espaço perceptual), saturação e temperatura.
export class ColorGradeEffect extends Effect {
  constructor() {
    super(
      'ColorGradeEffect',
      /* glsl */ `
      uniform float contrast;
      uniform float saturation;
      uniform float temperature;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float a = max(inputColor.a, 1e-4);
        vec3 c = inputColor.rgb / a;
        c *= vec3(1.0 + 0.12 * temperature, 1.0 + 0.02 * temperature, 1.0 - 0.12 * temperature);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, 1.0 + saturation);
        vec3 p = pow(max(c, 0.0), vec3(1.0 / 2.2));
        p = (p - 0.5) * (1.0 + contrast) + 0.5;
        c = pow(max(p, 0.0), vec3(2.2));
        outputColor = vec4(c * inputColor.a, inputColor.a);
      }`,
      {
        blendFunction: BlendFunction.SET,
        uniforms: new Map<string, THREE.Uniform>([
          ['contrast', new THREE.Uniform(0)],
          ['saturation', new THREE.Uniform(0)],
          ['temperature', new THREE.Uniform(0)],
        ]),
      },
    );
  }
}
