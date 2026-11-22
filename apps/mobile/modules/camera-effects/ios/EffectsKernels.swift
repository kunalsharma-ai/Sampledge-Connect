/**
 Metal kernels for the camera, compiled on the phone when the first frame arrives. The look is a
 port of the web shader (apps/web/lib/camera-effects.ts) and the Android one (Shaders.kt), with
 the same numbers, so a look is the same everywhere.

 "img" coordinates are the upright picture, 0..1 with the origin top left. The camera's buffer
 may be turned (the frame's rotation), so camUV() maps an upright point into the buffer.
 */
let effectsKernelSource = """
#include <metal_stdlib>
using namespace metal;

// Indices into the parameter array (EffectsProcessor.swift fills it).
constant int P_RES = 0;        // w, h
constant int P_BRIGHT = 2;
constant int P_CONTRAST = 3;
constant int P_SAT = 4;
constant int P_WARM = 5;
constant int P_GRAY = 6;
constant int P_SEPIA = 7;
constant int P_GLOW = 8;
constant int P_VIG = 9;
constant int P_LOW = 10;
constant int P_SHARP = 11;
constant int P_SMOOTH = 12;
constant int P_ROT = 13;       // 0, 90, 180, 270
constant int P_FULL = 14;      // 1 when the camera gives full-range YCbCr
constant int P_SHIFTN = 15;
constant int P_EYEN = 16;
constant int P_EYEK = 17;
constant int P_BGMODE = 18;    // 0 none, 1 blur, 2 image
constant int P_HASMASK = 19;
constant int P_BGRECT = 22;    // offset x, y, scale x, y
constant int P_SHIFT = 26;     // 8 x (cx, cy, dx, dy)
constant int P_RADII = 58;     // 8
constant int P_EYES = 66;      // 2 x (cx, cy, r)

constexpr sampler lin(coord::normalized, filter::linear, address::clamp_to_edge);
constant float3 LUM = float3(0.299, 0.587, 0.114);

float2 camUV(float2 img, int rot) {
  if (rot == 90) return float2(img.y, 1.0 - img.x);
  if (rot == 180) return float2(1.0 - img.x, 1.0 - img.y);
  if (rot == 270) return float2(1.0 - img.y, img.x);
  return img;
}

float3 cam(texture2d<float, access::sample> y, texture2d<float, access::sample> cbcr,
           float2 img, int rot, bool full) {
  float2 uv = camUV(img, rot);
  float Y = y.sample(lin, uv).r;
  float2 c = cbcr.sample(lin, uv).rg - 0.5;
  if (!full) {
    Y = (Y - 16.0 / 255.0) * 1.164;
    return float3(Y + 1.596 * c.y, Y - 0.392 * c.x - 0.813 * c.y, Y + 2.017 * c.x);
  }
  return float3(Y + 1.402 * c.y, Y - 0.344 * c.x - 0.714 * c.y, Y + 1.772 * c.x);
}

float2 magnify(float2 p, float2 c, float r, float k) {
  float2 d = p - c;
  float t = length(d) / r;
  if (t >= 1.0) return p;
  return c + d * (1.0 - k * (1.0 - t * t));
}

float3 grade(float3 c, float2 img, constant float *P) {
  c = clamp(c, 0.0, 1.0);
  if (P[P_LOW] > 0.0) c = pow(c, float3(1.0 / (1.0 + P[P_LOW] * 0.8)));
  c += P[P_BRIGHT] * 0.25;
  c = (c - 0.5) * (1.0 + P[P_CONTRAST] * 0.6) + 0.5;
  c += float3(0.08, 0.02, -0.08) * P[P_WARM];
  c = mix(float3(dot(c, LUM)), c, 1.0 + P[P_SAT]);
  c = mix(c, float3(dot(c, LUM)), P[P_GRAY]);
  float3 sepia = float3(dot(c, float3(0.393, 0.769, 0.189)),
                        dot(c, float3(0.349, 0.686, 0.168)),
                        dot(c, float3(0.272, 0.534, 0.131)));
  c = mix(c, sepia, P[P_SEPIA]);
  c *= 1.0 - P[P_VIG] * 0.6 * smoothstep(0.3, 0.8, length(img - 0.5));
  return clamp(c, 0.0, 1.0);
}

// A small upright copy, for Vision and for the blurred background.
kernel void smallCopy(texture2d<float, access::sample> y [[texture(0)]],
                      texture2d<float, access::sample> cbcr [[texture(1)]],
                      texture2d<float, access::write> out [[texture(2)]],
                      constant float *P [[buffer(0)]],
                      uint2 gid [[thread_position_in_grid]]) {
  if (gid.x >= out.get_width() || gid.y >= out.get_height()) return;
  float2 img = (float2(gid) + 0.5) / float2(out.get_width(), out.get_height());
  out.write(float4(cam(y, cbcr, img, int(P[P_ROT]), P[P_FULL] > 0.5), 1.0), gid);
}

kernel void effects(texture2d<float, access::sample> y [[texture(0)]],
                    texture2d<float, access::sample> cbcr [[texture(1)]],
                    texture2d<float, access::write> out [[texture(2)]],
                    texture2d<float, access::sample> mask [[texture(3)]],
                    texture2d<float, access::sample> blurred [[texture(4)]],
                    texture2d<float, access::sample> bg [[texture(5)]],
                    constant float *P [[buffer(0)]],
                    uint2 gid [[thread_position_in_grid]]) {
  if (gid.x >= out.get_width() || gid.y >= out.get_height()) return;
  int rot = int(P[P_ROT]);
  bool full = P[P_FULL] > 0.5;
  float2 res = float2(P[P_RES], P[P_RES + 1]);
  float2 img0 = (float2(gid) + 0.5) / res;
  float2 p = img0 * res;

  float2 move = float2(0.0);
  float weight = 0.0;
  int shiftN = int(P[P_SHIFTN]);
  for (int i = 0; i < 8; i++) {
    if (i >= shiftN) break;
    float2 c = float2(P[P_SHIFT + i * 4], P[P_SHIFT + i * 4 + 1]);
    float t = length(p - c) / P[P_RADII + i];
    if (t >= 1.0) continue;
    float w = (1.0 - t * t) * (1.0 - t * t);
    move += w * float2(P[P_SHIFT + i * 4 + 2], P[P_SHIFT + i * 4 + 3]);
    weight += w;
  }
  p -= move / max(1.0, weight);
  int eyeN = int(P[P_EYEN]);
  for (int i = 0; i < 2; i++) {
    if (i >= eyeN) break;
    p = magnify(p, float2(P[P_EYES + i * 3], P[P_EYES + i * 3 + 1]), P[P_EYES + i * 3 + 2], P[P_EYEK]);
  }
  float2 img = clamp(p / res, float2(0.0), float2(1.0));
  float3 c0 = cam(y, cbcr, img, rot, full);
  float3 c = c0;

  float sm = P[P_SMOOTH];
  float sh = P[P_SHARP];
  float gl = P[P_GLOW];
  if (sm > 0.0 || sh > 0.0 || gl > 0.0) {
    float2 px = max(1.0, res.y / 720.0) / res;
    float3 sum = c0;
    float ws = 1.0;
    float3 nearSum = float3(0.0);
    float3 allSum = float3(0.0);
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 0.7854 + (i >= 8 ? 0.3927 : 0.0);
      float rad = i < 8 ? 2.5 : 5.5;
      float3 s = cam(y, cbcr, img + float2(cos(a), sin(a)) * rad * px, rot, full);
      if (i < 8) nearSum += s;
      allSum += s;
      float3 diff = s - c0;
      float w = exp(-dot(diff, diff) * 70.0);
      sum += s * w;
      ws += w;
    }
    if (sm > 0.0) {
      float cb = 0.5 - 0.168736 * c0.r - 0.331264 * c0.g + 0.5 * c0.b;
      float cr = 0.5 + 0.5 * c0.r - 0.418688 * c0.g - 0.081312 * c0.b;
      float skin = (1.0 - smoothstep(0.08, 0.13, abs(cb - 0.40)))
                 * (1.0 - smoothstep(0.06, 0.11, abs(cr - 0.60)));
      c = mix(c0, sum / ws, sm * mix(0.15, 1.0, skin));
    }
    if (sh > 0.0) c += (c0 - nearSum / 8.0) * sh * 1.6;
    if (gl > 0.0) c = 1.0 - (1.0 - c) * (1.0 - allSum / 16.0 * gl * 0.55);
  }
  c = grade(c, img0, P);

  int bgMode = int(P[P_BGMODE]);
  if (bgMode > 0) {
    // Until the first mask is ready the background covers everything, so the room never shows.
    float m = P[P_HASMASK] > 0.5 ? smoothstep(0.3, 0.75, mask.sample(lin, img0).r) : 0.0;
    float3 b;
    if (bgMode == 1) {
      b = grade(blurred.sample(lin, img0).rgb, img0, P);
    } else {
      float2 r = float2(P[P_BGRECT], P[P_BGRECT + 1]) + img0 * float2(P[P_BGRECT + 2], P[P_BGRECT + 3]);
      b = bg.sample(lin, r).rgb;
    }
    c = mix(b, c, m);
  }
  out.write(float4(c, 1.0), gid);
}
// The finished picture into the NV12 buffer WebRTC sends (full-range BT.601), one 2x2 block each.
kernel void toNV12(texture2d<float, access::read> rgb [[texture(0)]],
                   texture2d<float, access::write> yOut [[texture(1)]],
                   texture2d<float, access::write> cOut [[texture(2)]],
                   uint2 gid [[thread_position_in_grid]]) {
  if (gid.x >= cOut.get_width() || gid.y >= cOut.get_height()) return;
  float3 sum = float3(0.0);
  for (uint dy = 0; dy < 2; dy++) {
    for (uint dx = 0; dx < 2; dx++) {
      uint2 q = min(gid * 2 + uint2(dx, dy), uint2(rgb.get_width() - 1, rgb.get_height() - 1));
      float3 c = rgb.read(q).rgb;
      yOut.write(float4(dot(c, LUM), 0.0, 0.0, 1.0), gid * 2 + uint2(dx, dy));
      sum += c;
    }
  }
  float3 c = sum / 4.0;
  float Y = dot(c, LUM);
  cOut.write(float4((c.b - Y) * 0.564 + 0.5, (c.r - Y) * 0.713 + 0.5, 0.0, 1.0), gid);
}
"""
