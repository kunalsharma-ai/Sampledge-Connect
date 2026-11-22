/**
 * The camera effects pipeline for calls: appearance (filters, light and colour, touch-up and face
 * shaping) and then the background (blur or an image). One LiveKit track processor does both, so
 * the two can be combined. Every frame is processed on this device with WebGL and the MediaPipe
 * models served from this app's own /vision folder; nothing is sent anywhere.
 */
import {
  BackgroundTransformer,
  ProcessorWrapper,
  type VideoTrackTransformer,
  type VideoTransformerInitOptions,
} from '@livekit/track-processors';
import {
  DEFAULT_CALL_APPEARANCE,
  isNeutralAppearance,
  usesFaceShaping,
  type CallAppearance,
} from '@sampledge/contracts';
import {
  FACE_POINTS,
  MAX_SHIFTS,
  faceWarps,
  lookParams,
  type FaceWarps,
  type Point,
} from './camera-look';

export type EffectsBackground =
  { mode: 'off' } | { mode: 'blur'; blurRadius: number } | { mode: 'image'; imagePath: string };

export interface EffectsOptions extends Record<string, unknown> {
  background: EffectsBackground;
  appearance: CallAppearance;
}

export const NO_EFFECTS: EffectsOptions = {
  background: { mode: 'off' },
  appearance: DEFAULT_CALL_APPEARANCE,
};

export const effectsOff = (o: EffectsOptions) =>
  o.background.mode === 'off' && isNeutralAppearance(o.appearance);

const vision = () => ({
  tasksVisionFileSet: `${window.location.origin}/vision`,
  modelAssetPath: `${window.location.origin}/vision/selfie_segmenter.tflite`,
  faceModel: `${window.location.origin}/vision/face_landmarker.task`,
});

const makeCanvas = (w: number, h: number): OffscreenCanvas | HTMLCanvasElement => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

// ---------- the look shader ----------

const VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_bright, u_contrast, u_sat, u_warm, u_gray, u_sepia, u_glow, u_vig;
uniform float u_low, u_sharp, u_smooth;
uniform int u_shiftN, u_eyeN;
uniform vec4 u_shift[8];
uniform float u_shiftR[8];
uniform vec3 u_eye[2];
uniform float u_eyeK;
const vec3 LUM = vec3(0.299, 0.587, 0.114);

// Content near c is magnified by k at the centre, fading out at radius r.
vec2 magnify(vec2 p, vec2 c, float r, float k) {
  vec2 d = p - c;
  float t = length(d) / r;
  if (t >= 1.0) return p;
  return c + d * (1.0 - k * (1.0 - t * t));
}

void main() {
  vec2 p = v_uv * u_res;
  // Content near each point moves with it, fading out smoothly at its radius. Overlapping moves
  // are averaged so the picture stays continuous.
  vec2 move = vec2(0.0);
  float weight = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= u_shiftN) break;
    float t = length(p - u_shift[i].xy) / u_shiftR[i];
    if (t >= 1.0) continue;
    float w = (1.0 - t * t) * (1.0 - t * t);
    move += w * u_shift[i].zw;
    weight += w;
  }
  p -= move / max(1.0, weight);
  for (int i = 0; i < 2; i++) if (i < u_eyeN) p = magnify(p, u_eye[i].xy, u_eye[i].z, u_eyeK);
  vec2 uv = clamp(p / u_res, vec2(0.0), vec2(1.0));
  vec3 c0 = texture(u_tex, uv).rgb;
  vec3 c = c0;

  if (u_smooth > 0.0 || u_sharp > 0.0 || u_glow > 0.0) {
    vec2 px = max(1.0, u_res.y / 720.0) / u_res;
    vec3 sum = c0;
    float ws = 1.0;
    vec3 near = vec3(0.0);
    vec3 all = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 0.7854 + (i >= 8 ? 0.3927 : 0.0);
      float rad = i < 8 ? 2.5 : 5.5;
      vec3 s = texture(u_tex, uv + vec2(cos(a), sin(a)) * rad * px).rgb;
      if (i < 8) near += s;
      all += s;
      vec3 diff = s - c0;
      float w = exp(-dot(diff, diff) * 70.0);
      sum += s * w;
      ws += w;
    }
    if (u_smooth > 0.0) {
      float cb = 0.5 - 0.168736 * c0.r - 0.331264 * c0.g + 0.5 * c0.b;
      float cr = 0.5 + 0.5 * c0.r - 0.418688 * c0.g - 0.081312 * c0.b;
      float skin = (1.0 - smoothstep(0.08, 0.13, abs(cb - 0.40)))
                 * (1.0 - smoothstep(0.06, 0.11, abs(cr - 0.60)));
      c = mix(c0, sum / ws, u_smooth * mix(0.15, 1.0, skin));
    }
    if (u_sharp > 0.0) c += (c0 - near / 8.0) * u_sharp * 1.6;
    if (u_glow > 0.0) c = 1.0 - (1.0 - c) * (1.0 - all / 16.0 * u_glow * 0.55);
  }

  c = clamp(c, 0.0, 1.0);
  if (u_low > 0.0) c = pow(c, vec3(1.0 / (1.0 + u_low * 0.8)));
  c += u_bright * 0.25;
  c = (c - 0.5) * (1.0 + u_contrast * 0.6) + 0.5;
  c += vec3(0.08, 0.02, -0.08) * u_warm;
  c = mix(vec3(dot(c, LUM)), c, 1.0 + u_sat);
  c = mix(c, vec3(dot(c, LUM)), u_gray);
  vec3 sepia = vec3(dot(c, vec3(0.393, 0.769, 0.189)),
                    dot(c, vec3(0.349, 0.686, 0.168)),
                    dot(c, vec3(0.272, 0.534, 0.131)));
  c = mix(c, sepia, u_sepia);
  c *= 1.0 - u_vig * 0.6 * smoothstep(0.3, 0.8, length(v_uv - 0.5));
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const UNIFORMS = [
  'u_tex',
  'u_res',
  'u_bright',
  'u_contrast',
  'u_sat',
  'u_warm',
  'u_gray',
  'u_sepia',
  'u_glow',
  'u_vig',
  'u_low',
  'u_sharp',
  'u_smooth',
  'u_shiftN',
  'u_eyeN',
  'u_shift',
  'u_shiftR',
  'u_eye',
  'u_eyeK',
] as const;

/** Draws a frame with a look into a WebGL2 canvas. */
class LookRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private u = {} as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;

  constructor(readonly canvas: OffscreenCanvas | HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      premultipliedAlpha: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? 'shader failed');
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
    this.program = program;
    gl.useProgram(program);
    for (const n of UNIFORMS) this.u[n] = gl.getUniformLocation(program, n);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.u.u_tex, 0);
  }

  render(frame: VideoFrame, a: CallAppearance, warps: FaceWarps | null): VideoFrame {
    const { gl, u } = this;
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);

    const p = lookParams(a);
    gl.uniform2f(u.u_res, w, h);
    gl.uniform1f(u.u_bright, p.brightness);
    gl.uniform1f(u.u_contrast, p.contrast);
    gl.uniform1f(u.u_sat, p.saturation);
    gl.uniform1f(u.u_warm, p.warmth);
    gl.uniform1f(u.u_gray, p.grayscale);
    gl.uniform1f(u.u_sepia, p.sepia);
    gl.uniform1f(u.u_glow, p.glow);
    gl.uniform1f(u.u_vig, p.vignette);
    gl.uniform1f(u.u_low, p.lowLight);
    gl.uniform1f(u.u_sharp, p.sharpness);
    gl.uniform1f(u.u_smooth, p.smoothing);

    const shiftN = warps ? Math.min(MAX_SHIFTS, warps.radii.length) : 0;
    const eyeN = warps ? warps.eyes.length / 3 : 0;
    gl.uniform1i(u.u_shiftN, shiftN);
    gl.uniform1i(u.u_eyeN, eyeN);
    if (warps && shiftN) {
      gl.uniform4fv(u.u_shift, pad(warps.shifts, MAX_SHIFTS * 4));
      gl.uniform1fv(u.u_shiftR, pad(warps.radii, MAX_SHIFTS));
    }
    if (warps && eyeN) {
      gl.uniform3fv(u.u_eye, pad(warps.eyes, 6));
      gl.uniform1f(u.u_eyeK, warps.eyeScale);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return new VideoFrame(this.canvas, { timestamp: frame.timestamp });
  }

  dispose() {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteProgram(this.program);
  }
}

const pad = (v: number[], n: number) => {
  const out = new Float32Array(n);
  out.set(v.slice(0, n));
  return out;
};

// ---------- face tracking ----------

type Landmarker = import('@mediapipe/tasks-vision').FaceLandmarker;

/** Finds the face in frames (MediaPipe face landmarker, on the device). */
class FaceTracker {
  private landmarker: Landmarker | null = null;
  private points = new Map<number, Point>();
  private lastSeen = 0;
  private tick = 0;
  ready = false;
  failed = false;

  async load() {
    try {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const v = vision();
      const files = await FilesetResolver.forVisionTasks(v.tasksVisionFileSet);
      // The CPU path finds faces reliably on every GPU and in every browser (the GPU path can
      // miss them on some drivers); it is only asked every third frame.
      this.landmarker = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: v.faceModel, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      this.ready = true;
    } catch (e) {
      this.failed = true;
      console.warn('Face shaping could not start on this device', e);
    }
  }

  /** The face in this frame (every third frame is looked at; the points are smoothed). */
  /** Whether a face was found in the last half second. */
  get found() {
    return this.points.size > 0;
  }

  track(frame: VideoFrame): Map<number, Point> | null {
    if (!this.landmarker) return null;
    this.tick++;
    if (this.tick % 3 === 1) {
      try {
        const res = this.landmarker.detectForVideo(frame, performance.now());
        const face = res.faceLandmarks[0];
        if (face) {
          for (const i of FACE_POINTS) {
            const p = face[i];
            if (!p) continue;
            const prev = this.points.get(i);
            this.points.set(
              i,
              prev ? { x: prev.x * 0.45 + p.x * 0.55, y: prev.y * 0.45 + p.y * 0.55 } : p,
            );
          }
          this.lastSeen = performance.now();
        }
      } catch {
        /* skip this frame */
      }
    }
    // No face for a moment (looked away, left the desk): stop shaping.
    if (performance.now() - this.lastSeen > 700) {
      this.points.clear();
      return null;
    }
    return this.points;
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
    this.ready = false;
  }
}

// ---------- the transformer ----------

function backgroundOptions(b: EffectsBackground) {
  return b.mode === 'blur'
    ? { imagePath: undefined, blurRadius: b.blurRadius, backgroundDisabled: false }
    : b.mode === 'image'
      ? { imagePath: b.imagePath, blurRadius: undefined, backgroundDisabled: false }
      : { imagePath: undefined, blurRadius: undefined, backgroundDisabled: true };
}

class CameraEffectsTransformer implements VideoTrackTransformer<EffectsOptions> {
  transformer?: TransformStream;
  options: EffectsOptions;
  private input?: HTMLVideoElement;
  private look?: LookRenderer;
  private background?: BackgroundTransformer;
  private backgroundReady = false;
  private face?: FaceTracker;
  private disabled = false;

  constructor(options: EffectsOptions) {
    this.options = options;
  }

  async init({ outputCanvas, inputElement }: VideoTransformerInitOptions) {
    this.transformer = new TransformStream({
      transform: (frame, controller) => this.transform(frame, controller),
    });
    this.input = inputElement;
    this.disabled = false;
    try {
      this.look = new LookRenderer(outputCanvas);
    } catch {
      this.look = undefined;
    }
    await this.update(this.options);
  }

  async restart(opts: VideoTransformerInitOptions) {
    await this.destroy();
    await this.init(opts);
  }

  async update(next: EffectsOptions) {
    this.options = { ...this.options, ...next };
    const { background, appearance } = this.options;
    if (background.mode !== 'off') {
      if (!this.background && this.input) {
        const bg = new BackgroundTransformer({
          ...backgroundOptions(background),
          assetPaths: vision(),
        });
        this.background = bg;
        await bg.init({
          outputCanvas: makeCanvas(this.input.videoWidth || 640, this.input.videoHeight || 480),
          inputElement: this.input,
        });
        this.backgroundReady = true;
      } else if (this.background) {
        await this.background.update(backgroundOptions(background));
      }
    }
    if (usesFaceShaping(appearance) && !this.face) {
      this.face = new FaceTracker();
      void this.face.load();
    }
  }

  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    if (this.disabled || frame.codedWidth === 0) {
      controller.enqueue(frame);
      return;
    }
    const { appearance, background } = this.options;
    let out = frame;
    if (this.look && !isNeutralAppearance(appearance)) {
      try {
        const points = usesFaceShaping(appearance) ? this.face?.track(frame) : null;
        const warps = points
          ? faceWarps(points, frame.displayWidth, frame.displayHeight, appearance)
          : null;
        out = this.look.render(frame, appearance, warps);
        frame.close();
      } catch {
        out = frame;
      }
    }
    if (background.mode !== 'off' && this.background && this.backgroundReady) {
      // The background step takes the frame and closes it.
      await this.background.transform(out, controller);
      return;
    }
    controller.enqueue(out);
  }

  /** For the settings screen: is face shaping on, and is a face in view. */
  get faceStatus(): 'off' | 'loading' | 'unavailable' | 'searching' | 'found' {
    if (!usesFaceShaping(this.options.appearance) || !this.face) return 'off';
    if (this.face.failed) return 'unavailable';
    if (!this.face.ready) return 'loading';
    return this.face.found ? 'found' : 'searching';
  }

  async destroy() {
    this.disabled = true;
    this.face?.close();
    this.face = undefined;
    const bg = this.background;
    this.background = undefined;
    this.backgroundReady = false;
    await bg?.destroy();
    this.look?.dispose();
    this.look = undefined;
  }
}

/** The LiveKit processor for my camera. */
export class CameraEffectsProcessor extends ProcessorWrapper<
  EffectsOptions,
  CameraEffectsTransformer
> {
  constructor(options: EffectsOptions) {
    super(new CameraEffectsTransformer(options), 'camera-effects');
  }
  get options() {
    return this.transformer.options;
  }
  get faceStatus() {
    return this.transformer.faceStatus;
  }
}

export const effectsSupported = () =>
  BackgroundTransformer.isSupported && ProcessorWrapper.isSupported;
