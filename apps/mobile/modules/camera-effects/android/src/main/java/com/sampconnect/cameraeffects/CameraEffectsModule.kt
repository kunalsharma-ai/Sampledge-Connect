package com.sampconnect.cameraeffects

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JavaScript sets what the camera should do (background and look) as JSON; the call screen then
 * turns the processor on for the camera track with track._setVideoEffects([processorName]).
 */
class CameraEffectsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SampCameraEffects")

    OnCreate { CameraEffects.install(appContext.reactContext) }

    Function("processorName") { CameraEffects.PROCESSOR_NAME }

    Function("setOptions") { json: String ->
      CameraEffects.install(appContext.reactContext)
      CameraEffects.setOptions(json)
      true
    }
  }
}
