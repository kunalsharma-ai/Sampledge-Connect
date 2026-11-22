package com.sampconnect.cameraeffects

import android.graphics.Color
import org.json.JSONObject

/** The look's shader numbers (from lookParams in @sampledge/contracts, so web and phone match). */
data class Look(
  val brightness: Float = 0f,
  val contrast: Float = 0f,
  val saturation: Float = 0f,
  val warmth: Float = 0f,
  val grayscale: Float = 0f,
  val sepia: Float = 0f,
  val glow: Float = 0f,
  val vignette: Float = 0f,
  val lowLight: Float = 0f,
  val sharpness: Float = 0f,
  val smoothing: Float = 0f,
)

/** The company background: brand colors, logo and name, drawn on the phone like on web. */
data class Brand(val primary: Int, val secondary: Int, val name: String, val logoUri: String?)

enum class BackgroundMode { OFF, BLUR, IMAGE, BRAND }

/** What the camera should do. Set from JavaScript as JSON; read by the processor every frame. */
data class EffectsOptions(
  val mode: BackgroundMode = BackgroundMode.OFF,
  val imageUri: String? = null,
  val brand: Brand? = null,
  /** Null when the look changes nothing. */
  val look: Look? = null,
  val slim: Float = 0f,
  val eyes: Float = 0f,
  val nose: Float = 0f,
) {
  val shaping get() = slim > 0f || eyes > 0f || nose > 0f
  val active get() = mode != BackgroundMode.OFF || look != null || shaping

  companion object {
    val OFF = EffectsOptions()

    fun parse(json: String): EffectsOptions {
      val o = JSONObject(json)
      val bg = o.optJSONObject("background")
      val mode =
        when (bg?.optString("mode")) {
          "blur" -> BackgroundMode.BLUR
          "image" -> BackgroundMode.IMAGE
          "brand" -> BackgroundMode.BRAND
          else -> BackgroundMode.OFF
        }
      val brand =
        if (mode == BackgroundMode.BRAND && bg != null)
          Brand(
            primary = color(bg.optString("primary"), 0xFF1F3A5F.toInt()),
            secondary = color(bg.optString("secondary"), 0xFFC9A227.toInt()),
            name = bg.optString("name", ""),
            logoUri = bg.optString("logoUri").takeIf { it.isNotEmpty() && !bg.isNull("logoUri") },
          )
        else null
      val imageUri =
        if (mode == BackgroundMode.IMAGE) bg?.optString("uri")?.takeIf { it.isNotEmpty() } else null
      val l = o.optJSONObject("look")
      val look =
        l?.let {
          fun f(k: String) = it.optDouble(k, 0.0).toFloat()
          Look(
            brightness = f("brightness"),
            contrast = f("contrast"),
            saturation = f("saturation"),
            warmth = f("warmth"),
            grayscale = f("grayscale"),
            sepia = f("sepia"),
            glow = f("glow"),
            vignette = f("vignette"),
            lowLight = f("lowLight"),
            sharpness = f("sharpness"),
            smoothing = f("smoothing"),
          )
        }
      val face = o.optJSONObject("face")
      fun s(k: String) = (face?.optDouble(k, 0.0) ?: 0.0).toFloat().coerceIn(0f, 1f)
      return EffectsOptions(
        // An image that is missing falls back to blur, so the room behind you stays private.
        mode = if (mode == BackgroundMode.IMAGE && imageUri == null) BackgroundMode.BLUR else mode,
        imageUri = imageUri,
        brand = brand,
        look = look,
        slim = s("slim"),
        eyes = s("eyes"),
        nose = s("nose"),
      )
    }

    private fun color(hex: String?, fallback: Int): Int =
      try {
        if (hex != null && Regex("^#[0-9a-fA-F]{6}$").matches(hex)) Color.parseColor(hex) else fallback
      } catch (_: IllegalArgumentException) {
        fallback
      }
  }
}
