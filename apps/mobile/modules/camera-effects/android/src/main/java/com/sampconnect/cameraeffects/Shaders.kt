package com.sampconnect.cameraeffects

/**
 * GLSL for the camera. The look is a port of the web shader (apps/web/lib/camera-effects.ts) so a
 * look is the same on every device; the background is mixed in using the person mask.
 *
 * Coordinates: `v_uv` is the output in GL convention (0,0 bottom left). "img" coordinates are the
 * upright picture with 0,0 top left, the way the models, masks and background images see it.
 */
internal object Shaders {
  enum class Input { OES, RGB, YUV }

  const val VERTEX =
    """
attribute vec4 in_pos;
attribute vec4 in_tc;
varying vec2 v_uv;
void main() {
  gl_Position = in_pos;
  v_uv = in_tc.xy;
}
"""

  private fun cameraSampler(input: Input) =
    when (input) {
      Input.OES ->
        """
#extension GL_OES_EGL_image_external : require
precision highp float;
uniform samplerExternalOES u_tex;
vec3 cam(vec2 tc) { return texture2D(u_tex, tc).rgb; }
"""
      Input.RGB ->
        """
precision highp float;
uniform sampler2D u_tex;
vec3 cam(vec2 tc) { return texture2D(u_tex, tc).rgb; }
"""
      Input.YUV ->
        """
precision highp float;
uniform sampler2D u_tex;
uniform sampler2D u_texU;
uniform sampler2D u_texV;
vec3 cam(vec2 tc) {
  float y = texture2D(u_tex, tc).r;
  float u = texture2D(u_texU, tc).r - 0.5;
  float v = texture2D(u_texV, tc).r - 0.5;
  return vec3(y + 1.403 * v, y - 0.344 * u - 0.714 * v, y + 1.77 * u);
}
"""
    }

  /** Copies the frame upright into a small buffer (for the models and the blurred background). */
  fun copy(input: Input) =
    cameraSampler(input) +
      """
varying vec2 v_uv;
uniform mat4 tex_mat;
void main() {
  gl_FragColor = vec4(cam((tex_mat * vec4(v_uv, 0.0, 1.0)).xy), 1.0);
}
"""

  fun main(input: Input) =
    cameraSampler(input) +
      """
varying vec2 v_uv;
uniform mat4 tex_mat;
uniform vec2 u_res;
uniform float u_bright, u_contrast, u_sat, u_warm, u_gray, u_sepia, u_glow, u_vig;
uniform float u_low, u_sharp, u_smooth;
uniform int u_shiftN, u_eyeN;
uniform vec4 u_shift[8];
uniform float u_shiftR[8];
uniform vec3 u_eye[2];
uniform float u_eyeK;
// 0 none, 1 blur, 2 image
uniform int u_bgMode;
uniform float u_hasMask;
uniform sampler2D u_mask;
uniform sampler2D u_small;
uniform vec2 u_smallRes;
uniform sampler2D u_bg;
uniform vec4 u_bgRect;
const vec3 LUM = vec3(0.299, 0.587, 0.114);

vec3 camAt(vec2 img) {
  vec2 gl = vec2(img.x, 1.0 - img.y);
  return cam((tex_mat * vec4(gl, 0.0, 1.0)).xy);
}

// Content near c is magnified by k at the centre, fading out at radius r.
vec2 magnify(vec2 p, vec2 c, float r, float k) {
  vec2 d = p - c;
  float t = length(d) / r;
  if (t >= 1.0) return p;
  return c + d * (1.0 - k * (1.0 - t * t));
}

// Light and colour, the same steps and numbers as the web shader.
vec3 grade(vec3 c, vec2 img) {
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
  c *= 1.0 - u_vig * 0.6 * smoothstep(0.3, 0.8, length(img - 0.5));
  return clamp(c, 0.0, 1.0);
}

void main() {
  vec2 img0 = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 p = img0 * u_res;
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
  for (int i = 0; i < 2; i++) {
    if (i >= u_eyeN) break;
    p = magnify(p, u_eye[i].xy, u_eye[i].z, u_eyeK);
  }
  vec2 img = clamp(p / u_res, vec2(0.0), vec2(1.0));
  vec3 c0 = camAt(img);
  vec3 c = c0;

  if (u_smooth > 0.0 || u_sharp > 0.0 || u_glow > 0.0) {
    vec2 px = max(1.0, u_res.y / 720.0) / u_res;
    vec3 sum = c0;
    float ws = 1.0;
    vec3 nearSum = vec3(0.0);
    vec3 allSum = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      float fi = float(i);
      float a = fi * 0.7854 + (i >= 8 ? 0.3927 : 0.0);
      float rad = i < 8 ? 2.5 : 5.5;
      vec3 s = camAt(img + vec2(cos(a), sin(a)) * rad * px);
      if (i < 8) nearSum += s;
      allSum += s;
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
    if (u_sharp > 0.0) c += (c0 - nearSum / 8.0) * u_sharp * 1.6;
    if (u_glow > 0.0) c = 1.0 - (1.0 - c) * (1.0 - allSum / 16.0 * u_glow * 0.55);
  }
  c = grade(c, img0);

  if (u_bgMode > 0) {
    // Until the first mask is ready the background covers everything, so the room never shows.
    float m = u_hasMask > 0.5 ? smoothstep(0.3, 0.75, texture2D(u_mask, img0).r) : 0.0;
    vec3 bg;
    if (u_bgMode == 1) {
      // A wide soft blur of the room, from the small copy (already a quarter of the size).
      vec2 spx = 1.0 / u_smallRes;
      vec3 b = texture2D(u_small, img0).rgb;
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 0.5236;
        vec2 d = vec2(cos(a), sin(a));
        b += texture2D(u_small, img0 + d * 3.0 * spx).rgb;
        b += texture2D(u_small, img0 + d * 6.5 * spx).rgb;
      }
      bg = grade(b / 25.0, img0);
    } else {
      bg = texture2D(u_bg, u_bgRect.xy + img0 * u_bgRect.zw).rgb;
    }
    c = mix(bg, c, m);
  }
  gl_FragColor = vec4(c, 1.0);
}
"""
}
