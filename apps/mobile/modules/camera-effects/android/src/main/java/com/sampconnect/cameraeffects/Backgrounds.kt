package com.sampconnect.cameraeffects

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import java.io.InputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Background pictures for the camera: a chosen image, or the company background drawn here. */
internal object Backgrounds {
  /** Reads a picture from a file:// or content:// address, at most 1920 pixels across. */
  fun load(context: Context, uri: String): Bitmap? {
    fun open(): InputStream? =
      when {
        uri.startsWith("file://") -> Uri.parse(uri).path?.let { java.io.FileInputStream(it) }
        uri.startsWith("/") -> java.io.FileInputStream(uri)
        else -> context.contentResolver.openInputStream(Uri.parse(uri))
      }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    open()?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: return null
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 1920) sample *= 2
    val opts = BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    return open()?.use { BitmapFactory.decodeStream(it, null, opts) }
  }

  /**
   * The company background, as the web app draws it: brand gradient, soft glows, fine diagonal
   * lines, an accent band, and the logo and name. Drawn in the frame's own shape so the logo
   * stays in view on a phone held upright.
   */
  fun brand(brand: Brand, logo: Bitmap?, width: Int, height: Int): Bitmap {
    val portrait = height > width
    val w = if (portrait) 720 else 1280
    val h = if (portrait) 1280 else 720
    val k = min(w, h) / 720f
    val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val g = Canvas(out)
    val p = Paint(Paint.ANTI_ALIAS_FLAG)
    p.shader =
      LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), shade(brand.primary, -0.55f), shade(brand.primary, -0.25f), Shader.TileMode.CLAMP)
    g.drawRect(0f, 0f, w.toFloat(), h.toFloat(), p)
    fun glow(x: Float, y: Float, r: Float, color: Int, a: Float) {
      p.shader = RadialGradient(x, y, r, withAlpha(color, a), withAlpha(color, 0f), Shader.TileMode.CLAMP)
      g.drawRect(0f, 0f, w.toFloat(), h.toFloat(), p)
    }
    glow(w * 0.85f, h * 0.15f, 520f * k, brand.primary, 0.45f)
    glow(w * 0.1f, h * 0.95f, 480f * k, brand.secondary, 0.25f)
    p.shader = null

    p.color = Color.argb((0.035f * 255).roundToInt(), 255, 255, 255)
    p.strokeWidth = 2f
    var x = -h.toFloat()
    while (x < w) {
      g.drawLine(x, h.toFloat(), x + h, 0f, p)
      x += 28f
    }
    p.color = withAlpha(brand.secondary, 0.85f)
    g.drawRect(0f, h - 10f * k, w.toFloat(), h.toFloat(), p)

    val right = w * (if (portrait) 0.9f else 0.77f)
    var y = 44f * k
    if (logo != null && logo.width > 0 && logo.height > 0) {
      val s = min(200f * k / logo.width, 84f * k / logo.height)
      val lw = logo.width * s
      val lh = logo.height * s
      val pad = 16f * k
      p.color = Color.argb((0.94f * 255).roundToInt(), 255, 255, 255)
      g.drawRoundRect(RectF(right - lw - 2 * pad, y, right, y + lh + 28f * k), 14f * k, 14f * k, p)
      g.drawBitmap(logo, null, RectF(right - lw - pad, y + 14f * k, right - pad, y + 14f * k + lh), Paint(Paint.FILTER_BITMAP_FLAG))
      y += lh + 28f * k + 14f * k
    }
    if (brand.name.isNotEmpty()) {
      p.color = Color.argb((0.9f * 255).roundToInt(), 255, 255, 255)
      p.textSize = 26f * k
      p.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      p.textAlign = Paint.Align.RIGHT
      g.drawText(brand.name, right, y - p.ascent(), p)
    }
    return out
  }

  /** Darkens (negative) or lightens (positive) a color, as the web app does. */
  fun shade(color: Int, amt: Float): Int {
    fun ch(v: Int) = (if (amt < 0) v * (1 + amt) else v + (255 - v) * amt).roundToInt().coerceIn(0, 255)
    return Color.rgb(ch(Color.red(color)), ch(Color.green(color)), ch(Color.blue(color)))
  }

  private fun withAlpha(color: Int, a: Float) =
    Color.argb((a * 255).roundToInt().coerceIn(0, 255), Color.red(color), Color.green(color), Color.blue(color))
}
