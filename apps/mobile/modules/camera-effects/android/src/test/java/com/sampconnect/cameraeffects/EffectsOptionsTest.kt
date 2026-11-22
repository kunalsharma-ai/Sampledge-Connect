package com.sampconnect.cameraeffects

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EffectsOptionsTest {
  @Test
  fun offByDefault() {
    val o = EffectsOptions.parse("""{"background":{"mode":"off"},"look":null,"face":{"slim":0,"eyes":0,"nose":0}}""")
    assertFalse(o.active)
    assertEquals(BackgroundMode.OFF, o.mode)
  }

  @Test
  fun readsAnImageBackgroundAndTheLook() {
    val o =
      EffectsOptions.parse(
        """{"background":{"mode":"image","uri":"file:///data/bg.jpg"},"look":{"brightness":0.25,"grayscale":1,"smoothing":0.45},"face":{"slim":0.5,"eyes":2,"nose":-1}}""",
      )
    assertEquals(BackgroundMode.IMAGE, o.mode)
    assertEquals("file:///data/bg.jpg", o.imageUri)
    assertEquals(0.25f, o.look!!.brightness, 1e-6f)
    assertEquals(1f, o.look!!.grayscale, 1e-6f)
    assertEquals(0f, o.look!!.contrast, 1e-6f)
    // Face sliders are kept to 0..1.
    assertEquals(0.5f, o.slim, 1e-6f)
    assertEquals(1f, o.eyes, 1e-6f)
    assertEquals(0f, o.nose, 1e-6f)
    assertTrue(o.shaping && o.active)
  }

  @Test
  fun aMissingPictureBlursInstead() {
    val o = EffectsOptions.parse("""{"background":{"mode":"image"}}""")
    assertEquals(BackgroundMode.BLUR, o.mode)
    assertNull(o.look)
  }
}
