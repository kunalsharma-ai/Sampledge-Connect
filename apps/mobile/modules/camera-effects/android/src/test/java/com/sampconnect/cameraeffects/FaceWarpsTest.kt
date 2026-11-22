package com.sampconnect.cameraeffects

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FaceWarpsTest {
  /** The same face as the web test (apps/web/lib/camera-look.test.ts). */
  private fun face(): Map<Int, Pt> {
    val lm = HashMap<Int, Pt>()
    fun set(i: Int, x: Float, y: Float) {
      lm[i] = Pt(x, y)
    }
    set(234, 0.35f, 0.45f)
    set(454, 0.65f, 0.45f)
    set(1, 0.5f, 0.5f)
    set(4, 0.5f, 0.48f)
    for ((i, x) in listOf(132 to 0.37f, 58 to 0.39f, 172 to 0.41f, 361 to 0.63f, 288 to 0.61f, 397 to 0.59f)) set(i, x, 0.6f)
    set(33, 0.4f, 0.4f)
    set(133, 0.46f, 0.4f)
    set(362, 0.54f, 0.4f)
    set(263, 0.6f, 0.4f)
    set(64, 0.47f, 0.52f)
    set(294, 0.53f, 0.52f)
    return lm
  }

  @Test
  fun matchesTheWebAppNumbers() {
    val w = faceWarps(face(), 1280f, 720f, slim = 1f, eyes = 0.5f, nose = 0.5f)!!
    // Printed from the web app's faceWarps for the same face and sliders.
    val web =
      floatArrayOf(
        473.6f, 432f, 15.2322f, -1.9773f, 499.2f, 432f, 15.1824f, -2.3291f, 524.8f, 432f, 15.0969f, -2.8307f,
        806.4f, 432f, -15.2322f, -1.9773f, 780.8f, 432f, -15.1824f, -2.3291f, 755.2f, 432f, -15.0969f, -2.8307f,
        601.6f, 374.4f, 3.456f, 0f, 678.4f, 374.4f, -3.456f, 0f,
      )
    assertArrayEquals(web, w.shifts, 0.01f)
    assertArrayEquals(floatArrayOf(107.52f, 107.52f, 107.52f, 107.52f, 107.52f, 107.52f, 46.08f, 46.08f), w.radii, 0.01f)
    assertArrayEquals(floatArrayOf(550.4f, 288f, 84.48f, 729.6f, 288f, 84.48f), w.eyes, 0.01f)
    assertEquals(0.07f, w.eyeScale, 1e-5f)
    assertEquals(8, w.shiftCount)
    assertEquals(2, w.eyeCount)
  }

  @Test
  fun noMovesNeverFoldThePicture() {
    val w = faceWarps(face(), 1280f, 720f, 1f, 1f, 1f)!!
    for (i in 0 until w.radii.size) {
      val len = Math.hypot(w.shifts[i * 4 + 2].toDouble(), w.shifts[i * 4 + 3].toDouble())
      assertTrue(len * 1.54 < w.radii[i])
    }
  }

  @Test
  fun slidersAtZeroMoveNothingAndNoFaceMeansNoWarps() {
    val none = faceWarps(face(), 1280f, 720f, 0f, 0f, 0f)!!
    assertEquals(0, none.shifts.size)
    assertEquals(0, none.eyes.size)
    assertNull(faceWarps(emptyMap(), 1280f, 720f, 0.5f, 0f, 0f))
    // A face only a few pixels wide is too far away to shape.
    assertNull(faceWarps(face(), 40f, 30f, 1f, 0f, 0f))
  }

  @Test
  fun smoothsDetectionsAndForgetsALostFace() {
    val s = FaceSmoother()
    s.update(mapOf(NOSE_TIP to Pt(0.5f, 0.5f)), 1000)
    s.update(mapOf(NOSE_TIP to Pt(0.6f, 0.5f)), 1100)
    val p = s.current(1100)!![NOSE_TIP]!!
    assertEquals(0.5f * 0.45f + 0.6f * 0.55f, p.x, 1e-6f)
    // No face found: keep the last points for a moment, then drop them.
    s.update(null, 1200)
    assertNotNull(s.current(1700))
    assertNull(s.current(1801))
  }

  @Test
  fun coversTheFrameWithoutStretching() {
    // A 16:9 picture behind a phone held upright: the middle strip is used.
    val r = coverRect(1280, 720, 720, 1280)
    assertEquals(0.31640625f, r[2], 1e-5f)
    assertEquals((1f - r[2]) / 2f, r[0], 1e-6f)
    assertArrayEquals(floatArrayOf(0f, 0f, 1f, 1f), coverRect(1280, 720, 1280, 720), 1e-6f)
    // A tall picture behind a wide frame: the middle band is used.
    val t = coverRect(720, 1280, 1280, 720)
    assertEquals(0f, t[0], 0f)
    assertTrue(t[3] < 1f)
  }

  @Test
  fun looksAtSmallEvenSizedCopies() {
    assertEquals(Pair(384, 216), analysisSize(1280, 720))
    assertEquals(Pair(216, 384), analysisSize(720, 1280))
    assertEquals(Pair(320, 240), analysisSize(320, 240))
  }
}
