package com.sampconnect.cameraeffects

import android.opengl.GLES11Ext
import android.opengl.GLES20
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import livekit.org.webrtc.RendererCommon

internal class Program(vertex: String, fragment: String) {
  val id: Int
  private val uniforms = HashMap<String, Int>()

  init {
    val vs = compile(GLES20.GL_VERTEX_SHADER, vertex)
    val fs = compile(GLES20.GL_FRAGMENT_SHADER, fragment)
    id = GLES20.glCreateProgram()
    GLES20.glAttachShader(id, vs)
    GLES20.glAttachShader(id, fs)
    GLES20.glLinkProgram(id)
    val ok = IntArray(1)
    GLES20.glGetProgramiv(id, GLES20.GL_LINK_STATUS, ok, 0)
    GLES20.glDeleteShader(vs)
    GLES20.glDeleteShader(fs)
    if (ok[0] != GLES20.GL_TRUE) {
      val log = GLES20.glGetProgramInfoLog(id)
      GLES20.glDeleteProgram(id)
      throw IllegalStateException("Camera effects program failed: $log")
    }
  }

  fun u(name: String): Int = uniforms.getOrPut(name) { GLES20.glGetUniformLocation(id, name) }

  fun attr(name: String): Int = GLES20.glGetAttribLocation(id, name)

  fun release() = GLES20.glDeleteProgram(id)

  private fun compile(type: Int, src: String): Int {
    val s = GLES20.glCreateShader(type)
    GLES20.glShaderSource(s, src)
    GLES20.glCompileShader(s)
    val ok = IntArray(1)
    GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0)
    if (ok[0] != GLES20.GL_TRUE) {
      val log = GLES20.glGetShaderInfoLog(s)
      GLES20.glDeleteShader(s)
      throw IllegalStateException("Camera effects shader failed: $log")
    }
    return s
  }
}

private fun floats(vararg v: Float): FloatBuffer =
  ByteBuffer.allocateDirect(v.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
    put(v)
    position(0)
  }

/**
 * Draws a camera frame with one of our shaders. WebRTC's VideoFrameDrawer calls it with the
 * frame's texture(s) and the matrix that turns it upright, whatever the camera gave us.
 */
internal class EffectsDrawer(private val copy: Boolean) : RendererCommon.GlDrawer {
  private val programs = HashMap<Shaders.Input, Program>()
  /** Sets this pass's own uniforms and textures (units 3 and up) before drawing. */
  var prepare: ((Program) -> Unit)? = null

  private val positions = floats(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
  private val texCoords = floats(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f)

  private fun program(input: Shaders.Input): Program =
    programs.getOrPut(input) {
      Program(Shaders.VERTEX, if (copy) Shaders.copy(input) else Shaders.main(input))
    }

  override fun drawOes(
    oesTextureId: Int,
    texMatrix: FloatArray,
    frameWidth: Int,
    frameHeight: Int,
    viewportX: Int,
    viewportY: Int,
    viewportWidth: Int,
    viewportHeight: Int,
  ) {
    val p = program(Shaders.Input.OES)
    GLES20.glUseProgram(p.id)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTextureId)
    GLES20.glUniform1i(p.u("u_tex"), 0)
    draw(p, texMatrix, viewportX, viewportY, viewportWidth, viewportHeight)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, 0)
  }

  override fun drawRgb(
    textureId: Int,
    texMatrix: FloatArray,
    frameWidth: Int,
    frameHeight: Int,
    viewportX: Int,
    viewportY: Int,
    viewportWidth: Int,
    viewportHeight: Int,
  ) {
    val p = program(Shaders.Input.RGB)
    GLES20.glUseProgram(p.id)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
    GLES20.glUniform1i(p.u("u_tex"), 0)
    draw(p, texMatrix, viewportX, viewportY, viewportWidth, viewportHeight)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0)
  }

  override fun drawYuv(
    yuvTextures: IntArray,
    texMatrix: FloatArray,
    frameWidth: Int,
    frameHeight: Int,
    viewportX: Int,
    viewportY: Int,
    viewportWidth: Int,
    viewportHeight: Int,
  ) {
    val p = program(Shaders.Input.YUV)
    GLES20.glUseProgram(p.id)
    val names = arrayOf("u_tex", "u_texU", "u_texV")
    for (i in 0 until 3) {
      GLES20.glActiveTexture(GLES20.GL_TEXTURE0 + i)
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, yuvTextures[i])
      GLES20.glUniform1i(p.u(names[i]), i)
    }
    draw(p, texMatrix, viewportX, viewportY, viewportWidth, viewportHeight)
    for (i in 0 until 3) {
      GLES20.glActiveTexture(GLES20.GL_TEXTURE0 + i)
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0)
    }
  }

  private fun draw(p: Program, texMatrix: FloatArray, x: Int, y: Int, w: Int, h: Int) {
    GLES20.glViewport(x, y, w, h)
    GLES20.glUniformMatrix4fv(p.u("tex_mat"), 1, false, texMatrix, 0)
    prepare?.invoke(p)
    val pos = p.attr("in_pos")
    val tc = p.attr("in_tc")
    GLES20.glEnableVertexAttribArray(pos)
    GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, positions)
    GLES20.glEnableVertexAttribArray(tc)
    GLES20.glVertexAttribPointer(tc, 2, GLES20.GL_FLOAT, false, 0, texCoords)
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    GLES20.glDisableVertexAttribArray(pos)
    GLES20.glDisableVertexAttribArray(tc)
    GLES20.glUseProgram(0)
  }

  override fun release() {
    programs.values.forEach { it.release() }
    programs.clear()
  }
}

/** A plain 2D texture we upload pictures into (mask, background). */
internal class Texture2D {
  val id: Int

  init {
    val t = IntArray(1)
    GLES20.glGenTextures(1, t, 0)
    id = t[0]
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, id)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0)
  }

  fun release() = GLES20.glDeleteTextures(1, intArrayOf(id), 0)
}
