import ExpoModulesCore

/**
 JavaScript sets what the camera should do (background and look) as JSON; the call screen then
 turns the processor on for the camera track with track._setVideoEffects([processorName]).
 */
public class CameraEffectsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SampCameraEffects")

    OnCreate {
      CameraEffects.shared.install()
    }

    Function("processorName") { () -> String in
      CameraEffects.processorName
    }

    Function("setOptions") { (json: String) -> Bool in
      CameraEffects.shared.install()
      CameraEffects.shared.setOptions(json: json)
      return true
    }
  }
}
