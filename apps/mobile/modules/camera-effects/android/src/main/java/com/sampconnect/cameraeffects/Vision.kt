package com.sampconnect.cameraeffects

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.google.mediapipe.framework.image.ByteBufferExtractor
import com.google.mediapipe.framework.image.ByteBufferImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenter
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** A person mask: one byte per pixel, 255 = person, rows from the top of the picture. */
internal class Mask(val bytes: ByteBuffer, val width: Int, val height: Int)

/**
 * Finds the person (for backgrounds) and the face (for face shaping) in small upright copies of
 * the frames, on its own thread, with the same MediaPipe models the web app uses. The models are
 * bundled with the app; nothing leaves the phone.
 */
internal class Vision(private val context: Context) {
  private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "camera-effects-vision") }
  private val busy = AtomicBoolean(false)
  private var input: ByteBuffer? = null
  private var segmenter: ImageSegmenter? = null
  private var landmarker: FaceLandmarker? = null
  @Volatile var segmenterFailed = false
    private set
  @Volatile var faceFailed = false
    private set
  private var lastTs = 0L
  private var tick = 0

  /** The newest mask not yet uploaded, if any. */
  @Volatile private var pending: Mask? = null
  val face = FaceSmoother()

  val idle get() = !busy.get()

  /** A buffer to read the small frame into (only while idle). */
  fun inputBuffer(bytes: Int): ByteBuffer {
    val b = input
    if (b != null && b.capacity() == bytes) return b.also { it.clear() }
    return ByteBuffer.allocateDirect(bytes).order(ByteOrder.nativeOrder()).also { input = it }
  }

  fun takeMask(): Mask? {
    val m = pending
    pending = null
    return m
  }

  /** Looks at the frame now in the input buffer. Returns at once; results arrive later. */
  fun submit(width: Int, height: Int, wantMask: Boolean, wantFace: Boolean, frameMs: Long) {
    val buf = input ?: return
    if (!busy.compareAndSet(false, true)) return
    val ts = maxOf(lastTs + 1, frameMs).also { lastTs = it }
    executor.execute {
      try {
        buf.position(0)
        val image = ByteBufferImageBuilder(buf, width, height, MPImage.IMAGE_FORMAT_RGBA).build()
        if (wantMask) segment(image, ts)
        // The face moves less than the edges of a person: every third look is enough.
        if (wantFace && tick++ % 3 == 0) findFace(image, ts)
      } catch (t: Throwable) {
        Log.w(TAG, "Camera effects could not look at a frame", t)
      } finally {
        busy.set(false)
      }
    }
  }

  private fun segment(image: MPImage, ts: Long) {
    val s = segmenter ?: if (segmenterFailed) return else createSegmenter() ?: return
    val result = s.segmentForVideo(image, ts)
    val masks = result.confidenceMasks()
    if (!masks.isPresent || masks.get().isEmpty()) return
    val m = masks.get()[0]
    val floats = ByteBufferExtractor.extract(m).order(ByteOrder.nativeOrder()).asFloatBuffer()
    val n = m.width * m.height
    val out = ByteBuffer.allocateDirect(n)
    for (i in 0 until n) {
      val v = floats.get(i)
      out.put(i, (v.coerceIn(0f, 1f) * 255f + 0.5f).toInt().toByte())
    }
    out.position(0)
    pending = Mask(out, m.width, m.height)
  }

  private fun findFace(image: MPImage, ts: Long) {
    val l = landmarker ?: if (faceFailed) return else createLandmarker() ?: return
    val faces = l.detectForVideo(image, ts).faceLandmarks()
    val first = faces.firstOrNull()
    val now = SystemClock.elapsedRealtime()
    if (first == null) {
      face.update(null, now)
      return
    }
    val points = HashMap<Int, Pt>()
    for (i in FACE_POINTS) if (i < first.size) points[i] = Pt(first[i].x(), first[i].y())
    face.update(points, now)
  }

  private fun createSegmenter(): ImageSegmenter? =
    try {
      ImageSegmenter.createFromOptions(
          context,
          ImageSegmenter.ImageSegmenterOptions.builder()
            .setBaseOptions(base("selfie_segmenter.tflite"))
            .setRunningMode(RunningMode.VIDEO)
            .setOutputConfidenceMasks(true)
            .setOutputCategoryMask(false)
            .build(),
        )
        .also { segmenter = it }
    } catch (t: Throwable) {
      segmenterFailed = true
      Log.w(TAG, "Backgrounds can't run on this phone", t)
      null
    }

  private fun createLandmarker(): FaceLandmarker? =
    try {
      FaceLandmarker.createFromOptions(
          context,
          FaceLandmarker.FaceLandmarkerOptions.builder()
            .setBaseOptions(base("face_landmarker.task"))
            .setRunningMode(RunningMode.VIDEO)
            .setNumFaces(1)
            .build(),
        )
        .also { landmarker = it }
    } catch (t: Throwable) {
      faceFailed = true
      Log.w(TAG, "Face shaping can't run on this phone", t)
      null
    }

  // The CPU path works the same on every phone (as on web, where the GPU path misses faces on
  // some drivers); the frames are small.
  private fun base(model: String) =
    BaseOptions.builder().setModelAssetPath(model).setDelegate(Delegate.CPU).build()

  fun close() {
    executor.execute {
      segmenter?.close()
      landmarker?.close()
      segmenter = null
      landmarker = null
    }
    executor.shutdown()
  }

  companion object {
    const val TAG = "SampCameraEffects"
  }
}
