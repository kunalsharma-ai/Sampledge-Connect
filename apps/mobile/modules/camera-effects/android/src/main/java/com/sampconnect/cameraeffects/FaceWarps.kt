package com.sampconnect.cameraeffects

import kotlin.math.hypot

/** A point in the frame. Landmarks are normalized 0..1; warps are in pixels. */
data class Pt(val x: Float, val y: Float)

/**
 * Face shaping as small local warps, the same math as the web app (apps/web/lib/camera-look.ts):
 * jaw points move toward the nose tip, nose sides toward the middle, and the eyes are magnified.
 */
class Warps(
  /** [cx, cy, dx, dy] per moved point. */
  val shifts: FloatArray,
  val radii: FloatArray,
  /** [cx, cy, r] per eye. */
  val eyes: FloatArray,
  val eyeScale: Float,
) {
  val shiftCount get() = minOf(MAX_SHIFTS, radii.size)
  val eyeCount get() = eyes.size / 3
}

/** At most this many points are moved (jaw and nose sides). */
const val MAX_SHIFTS = 8

// MediaPipe face mesh landmark numbers (the same model the web app uses).
const val CHEEK_LEFT = 234
const val CHEEK_RIGHT = 454
const val NOSE_TIP = 1
const val NOSE_MID = 4
val JAW = intArrayOf(132, 58, 172, 361, 288, 397)
val EYE_LEFT = intArrayOf(33, 133)
val EYE_RIGHT = intArrayOf(362, 263)
val NOSE_SIDES = intArrayOf(64, 294)

/** Every landmark the warps read (smoothed between frames). */
val FACE_POINTS: IntArray =
  intArrayOf(CHEEK_LEFT, CHEEK_RIGHT, NOSE_TIP, NOSE_MID) + JAW + EYE_LEFT + EYE_RIGHT + NOSE_SIDES

private fun dist(a: Pt, b: Pt) = hypot(a.x - b.x, a.y - b.y)

/**
 * Turns face landmarks (normalized, keyed by landmark number) into warps for a w x h frame.
 * slim, eyes and nose are 0..1 (the sliders divided by 100).
 */
fun faceWarps(lm: Map<Int, Pt>, w: Float, h: Float, slim: Float, eyes: Float, nose: Float): Warps? {
  fun px(i: Int): Pt? = lm[i]?.let { Pt(it.x * w, it.y * h) }
  val l = px(CHEEK_LEFT) ?: return null
  val r = px(CHEEK_RIGHT) ?: return null
  val tip = px(NOSE_TIP) ?: return null
  val width = dist(l, r)
  if (width < 20f) return null

  val shifts = ArrayList<Float>()
  val radii = ArrayList<Float>()
  if (slim > 0f) {
    for (i in JAW) {
      val p = px(i) ?: continue
      val dx = tip.x - p.x
      val dy = (tip.y - p.y) * 0.3f
      val len = hypot(dx, dy).takeIf { it > 0f } ?: 1f
      val m = width * 0.04f * slim
      shifts += listOf(p.x, p.y, dx / len * m, dy / len * m)
      radii += width * 0.28f
    }
  }

  val mid = px(NOSE_MID)
  val sides = NOSE_SIDES.map { px(it) }
  val s0 = sides[0]
  val s1 = sides[1]
  if (nose > 0f && mid != null && s0 != null && s1 != null) {
    val rr = dist(s0, s1) * 0.6f
    for (p in listOf(s0, s1)) {
      shifts += listOf(p.x, p.y, (mid.x - p.x) * 0.18f * nose, 0f)
      radii += rr
    }
  }

  val eyeList = ArrayList<Float>()
  if (eyes > 0f) {
    for (pair in listOf(EYE_LEFT, EYE_RIGHT)) {
      val p = px(pair[0]) ?: continue
      val q = px(pair[1]) ?: continue
      eyeList += listOf((p.x + q.x) / 2f, (p.y + q.y) / 2f, dist(p, q) * 1.1f)
    }
  }
  return Warps(shifts.toFloatArray(), radii.toFloatArray(), eyeList.toFloatArray(), eyes * 0.14f)
}

/**
 * Keeps the face points steady between detections (each new detection is blended 55/45 with the
 * last), and forgets the face when none was seen for 700 ms, as the web app does.
 */
class FaceSmoother {
  private val points = HashMap<Int, Pt>()
  private var lastSeen = Long.MIN_VALUE / 2

  /** A detection: normalized points keyed by landmark number (null when no face was found). */
  @Synchronized
  fun update(found: Map<Int, Pt>?, nowMs: Long) {
    if (found == null) return
    for (i in FACE_POINTS) {
      val p = found[i] ?: continue
      val prev = points[i]
      points[i] = if (prev == null) p else Pt(prev.x * 0.45f + p.x * 0.55f, prev.y * 0.45f + p.y * 0.55f)
    }
    lastSeen = nowMs
  }

  /** The face now, or null when it has been gone for a moment. */
  @Synchronized
  fun current(nowMs: Long): Map<Int, Pt>? {
    if (nowMs - lastSeen > 700) {
      points.clear()
      return null
    }
    return if (points.isEmpty()) null else HashMap(points)
  }

  @Synchronized
  fun clear() {
    points.clear()
    lastSeen = Long.MIN_VALUE / 2
  }
}

/** How a background image covers the frame without stretching: [offsetX, offsetY, scaleX, scaleY]. */
fun coverRect(imageW: Int, imageH: Int, frameW: Int, frameH: Int): FloatArray {
  if (imageW <= 0 || imageH <= 0 || frameW <= 0 || frameH <= 0) return floatArrayOf(0f, 0f, 1f, 1f)
  val ia = imageW.toFloat() / imageH
  val fa = frameW.toFloat() / frameH
  return if (ia > fa) {
    val sx = fa / ia
    floatArrayOf((1f - sx) / 2f, 0f, sx, 1f)
  } else {
    val sy = ia / fa
    floatArrayOf(0f, (1f - sy) / 2f, 1f, sy)
  }
}

/** The size to look at a frame for segmentation and face finding: longest side `maxSide`. */
fun analysisSize(w: Int, h: Int, maxSide: Int = 384): Pair<Int, Int> {
  if (w <= 0 || h <= 0) return Pair(maxSide, maxSide)
  val s = minOf(1f, maxSide.toFloat() / maxOf(w, h))
  // Even sizes keep row reads aligned.
  fun even(v: Float) = maxOf(2, (Math.round(v) / 2) * 2)
  return Pair(even(w * s), even(h * s))
}
