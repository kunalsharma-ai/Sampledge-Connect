package com.sampconnect.cameraeffects

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.opengl.EGL14
import android.opengl.EGLContext
import android.opengl.GLES20
import android.opengl.GLUtils
import android.os.Handler
import android.util.Log
import io.livekit.reactnative.webrtc.videoEffects.ProcessorProvider
import io.livekit.reactnative.webrtc.videoEffects.VideoFrameProcessor
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import livekit.org.webrtc.GlTextureFrameBuffer
import livekit.org.webrtc.SurfaceTextureHelper
import livekit.org.webrtc.TextureBufferImpl
import livekit.org.webrtc.VideoFrame
import livekit.org.webrtc.VideoFrameDrawer
import livekit.org.webrtc.YuvConverter

/** What JavaScript sets, and the processor WebRTC runs on every camera frame. */
object CameraEffects {
  const val PROCESSOR_NAME = "sampconnect-camera-effects"

  @Volatile
  var options: EffectsOptions = EffectsOptions.OFF
    private set

  @Volatile internal var context: Context? = null
  private var installed = false

  @Synchronized
  fun install(ctx: Context?) {
    if (ctx != null) context = ctx.applicationContext
    if (!installed) {
      ProcessorProvider.addProcessor(PROCESSOR_NAME) { EffectsProcessor() }
      installed = true
    }
  }

  fun setOptions(json: String) {
    options = EffectsOptions.parse(json)
  }
}

/**
 * Runs on the camera's own GL thread for every frame: the look and face shaping, then the
 * background, drawn in one pass into a texture that WebRTC sends and shows instead of the raw
 * frame. Any problem sends the raw frame, so the camera never stops.
 */
internal class EffectsProcessor : VideoFrameProcessor {
  private var gl: GlState? = null

  override fun process(frame: VideoFrame, textureHelper: SurfaceTextureHelper): VideoFrame {
    val o = CameraEffects.options
    val ctx = CameraEffects.context
    val egl = EGL14.eglGetCurrentContext()
    if (!o.active || ctx == null || egl == EGL14.EGL_NO_CONTEXT) return passThrough(frame)
    return try {
      var state = gl
      if (state == null || state.egl != egl) {
        // A new camera session: its GL objects belong to its own thread, so start fresh there
        // and let the old thread free the old ones.
        state?.releaseOn(state.handler)
        state = GlState(ctx, egl, textureHelper.handler)
        gl = state
      }
      state.render(frame, o) ?: passThrough(frame)
    } catch (t: Throwable) {
      Log.w(Vision.TAG, "Camera effects skipped a frame", t)
      passThrough(frame)
    }
  }

  /** The caller releases what we return, so the original frame needs one more hold. */
  private fun passThrough(frame: VideoFrame): VideoFrame {
    frame.retain()
    return frame
  }
}

private class OutputSlot {
  val fb = GlTextureFrameBuffer(GLES20.GL_RGBA)
  val inUse = AtomicBoolean(false)
}

private val FLIP_VERTICAL =
  Matrix().apply {
    preTranslate(0.5f, 0.5f)
    preScale(1f, -1f)
    preTranslate(-0.5f, -0.5f)
  }

/** Everything GL for one camera session. Created and used only on that session's GL thread. */
private class GlState(context: Context, val egl: EGLContext, val handler: Handler) {
  private val frameDrawer = VideoFrameDrawer()
  private val copyDrawer = EffectsDrawer(copy = true)
  private val mainDrawer = EffectsDrawer(copy = false)
  private val yuvConverter = YuvConverter()
  private val small = GlTextureFrameBuffer(GLES20.GL_RGBA)
  private val maskTex = Texture2D()
  private val bgTex = Texture2D()
  private val slots = ArrayList<OutputSlot>()
  private val vision = Vision(context)
  private val appContext = context

  private var hasMask = false

  // Background pictures load off the camera thread; the newest finished one is uploaded here.
  private val loader = Executors.newSingleThreadExecutor { r -> Thread(r, "camera-effects-bg") }
  @Volatile private var loaded: Pair<String, Bitmap>? = null
  private var requestedKey: String? = null
  private var uploadedKey: String? = null
  private var bgW = 0
  private var bgH = 0

  fun render(frame: VideoFrame, o: EffectsOptions): VideoFrame? {
    val w = frame.rotatedWidth
    val h = frame.rotatedHeight
    if (w <= 0 || h <= 0) return null

    // A mask kept from an earlier background would flash an old outline when one is turned on.
    if (o.mode == BackgroundMode.OFF) hasMask = false
    if (!o.shaping) vision.face.clear()

    val wantMask = o.mode != BackgroundMode.OFF && !vision.segmenterFailed
    val wantFace = o.shaping && !vision.faceFailed
    val (sw, sh) = analysisSize(w, h)
    if (wantMask || wantFace || o.mode == BackgroundMode.BLUR) {
      small.setSize(sw, sh)
      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, small.frameBufferId)
      frameDrawer.drawFrame(frame, copyDrawer, FLIP_VERTICAL, 0, 0, sw, sh)
      if ((wantMask || wantFace) && vision.idle) {
        val buf = vision.inputBuffer(sw * sh * 4)
        GLES20.glReadPixels(0, 0, sw, sh, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, buf)
        vision.submit(sw, sh, wantMask, wantFace, frame.timestampNs / 1_000_000)
      }
      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    }

    vision.takeMask()?.let { m ->
      GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 1)
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, maskTex.id)
      GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_LUMINANCE, m.width, m.height, 0, GLES20.GL_LUMINANCE, GLES20.GL_UNSIGNED_BYTE, m.bytes)
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0)
      GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 4)
      if (o.mode != BackgroundMode.OFF) hasMask = true
    }

    val picture = o.mode == BackgroundMode.IMAGE || o.mode == BackgroundMode.BRAND
    val bgReady = picture && backgroundReady(o, w, h)
    // Without a person mask on this phone, show the camera as it is rather than nothing.
    val bgMode =
      when {
        vision.segmenterFailed -> 0
        o.mode == BackgroundMode.BLUR -> 1
        picture && bgReady -> 2
        picture -> 1 // blurred while the picture loads
        else -> 0
      }

    val slot = acquire(w, h) ?: return null
    val warps =
      if (o.shaping) vision.face.current(android.os.SystemClock.elapsedRealtime())?.let {
        faceWarps(it, w.toFloat(), h.toFloat(), o.slim, o.eyes, o.nose)
      } else null
    val look = o.look ?: Look()
    val bgRect = coverRect(bgW, bgH, w, h)
    mainDrawer.prepare = { p ->
      GLES20.glUniform2f(p.u("u_res"), w.toFloat(), h.toFloat())
      GLES20.glUniform1f(p.u("u_bright"), look.brightness)
      GLES20.glUniform1f(p.u("u_contrast"), look.contrast)
      GLES20.glUniform1f(p.u("u_sat"), look.saturation)
      GLES20.glUniform1f(p.u("u_warm"), look.warmth)
      GLES20.glUniform1f(p.u("u_gray"), look.grayscale)
      GLES20.glUniform1f(p.u("u_sepia"), look.sepia)
      GLES20.glUniform1f(p.u("u_glow"), look.glow)
      GLES20.glUniform1f(p.u("u_vig"), look.vignette)
      GLES20.glUniform1f(p.u("u_low"), look.lowLight)
      GLES20.glUniform1f(p.u("u_sharp"), look.sharpness)
      GLES20.glUniform1f(p.u("u_smooth"), look.smoothing)
      val shiftN = warps?.shiftCount ?: 0
      val eyeN = warps?.eyeCount ?: 0
      GLES20.glUniform1i(p.u("u_shiftN"), shiftN)
      GLES20.glUniform1i(p.u("u_eyeN"), eyeN)
      if (warps != null && shiftN > 0) {
        GLES20.glUniform4fv(p.u("u_shift"), MAX_SHIFTS, pad(warps.shifts, MAX_SHIFTS * 4), 0)
        GLES20.glUniform1fv(p.u("u_shiftR"), MAX_SHIFTS, pad(warps.radii, MAX_SHIFTS), 0)
      }
      if (warps != null && eyeN > 0) {
        GLES20.glUniform3fv(p.u("u_eye"), 2, pad(warps.eyes, 6), 0)
        GLES20.glUniform1f(p.u("u_eyeK"), warps.eyeScale)
      }
      GLES20.glUniform1i(p.u("u_bgMode"), bgMode)
      GLES20.glUniform1f(p.u("u_hasMask"), if (hasMask) 1f else 0f)
      bind(3, maskTex.id, p.u("u_mask"))
      bind(4, small.textureId, p.u("u_small"))
      GLES20.glUniform2f(p.u("u_smallRes"), sw.toFloat(), sh.toFloat())
      bind(5, bgTex.id, p.u("u_bg"))
      GLES20.glUniform4f(p.u("u_bgRect"), bgRect[0], bgRect[1], bgRect[2], bgRect[3])
    }
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, slot.fb.frameBufferId)
    frameDrawer.drawFrame(frame, mainDrawer, null, 0, 0, w, h)
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    for (unit in 3..5) {
      GLES20.glActiveTexture(GLES20.GL_TEXTURE0 + unit)
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0)
    }
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    // The encoder reads this texture on another thread.
    GLES20.glFinish()

    val buffer =
      TextureBufferImpl(w, h, VideoFrame.TextureBuffer.Type.RGB, slot.fb.textureId, Matrix(), handler, yuvConverter) {
        slot.inUse.set(false)
      }
    return VideoFrame(buffer, 0, frame.timestampNs)
  }

  private fun bind(unit: Int, tex: Int, loc: Int) {
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0 + unit)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex)
    GLES20.glUniform1i(loc, unit)
  }

  /** A free output texture of this size (a few are in flight to the encoder at once). */
  private fun acquire(w: Int, h: Int): OutputSlot? {
    val free = slots.firstOrNull { it.inUse.compareAndSet(false, true) }
      ?: if (slots.size < 4) OutputSlot().also {
        it.inUse.set(true)
        slots += it
      } else return null
    free.fb.setSize(w, h)
    return free
  }

  /** Starts loading the picture for these options if needed; true once it is on the GPU. */
  private fun backgroundReady(o: EffectsOptions, w: Int, h: Int): Boolean {
    val key =
      when (o.mode) {
        BackgroundMode.IMAGE -> "image|${o.imageUri}"
        BackgroundMode.BRAND -> o.brand?.let { "brand|${it.primary}|${it.secondary}|${it.name}|${it.logoUri}|${h > w}" }
        else -> null
      } ?: return false
    if (key != requestedKey) {
      requestedKey = key
      val brand = o.brand
      val uri = o.imageUri
      loader.execute {
        val bmp =
          try {
            if (brand != null && o.mode == BackgroundMode.BRAND) {
              val logo = brand.logoUri?.let { Backgrounds.load(appContext, it) }
              Backgrounds.brand(brand, logo, w, h)
            } else uri?.let { Backgrounds.load(appContext, it) }
          } catch (t: Throwable) {
            Log.w(Vision.TAG, "Could not load the call background", t)
            null
          }
        if (bmp != null) loaded = Pair(key, bmp)
      }
    }
    val l = loaded
    if (l != null && l.first == key && uploadedKey != key) {
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, bgTex.id)
      GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, l.second, 0)
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0)
      bgW = l.second.width
      bgH = l.second.height
      uploadedKey = key
      loaded = null
    }
    return uploadedKey == key
  }

  fun releaseOn(h: Handler) {
    vision.close()
    loader.shutdown()
    h.post {
      try {
        frameDrawer.release()
        copyDrawer.release()
        mainDrawer.release()
        yuvConverter.release()
        small.release()
        maskTex.release()
        bgTex.release()
        slots.forEach { it.fb.release() }
      } catch (_: Throwable) {
        // That camera's GL context is already gone, and its objects with it.
      }
    }
  }
}

private fun pad(v: FloatArray, n: Int): FloatArray {
  val out = FloatArray(n)
  System.arraycopy(v, 0, out, 0, minOf(n, v.size))
  return out
}
