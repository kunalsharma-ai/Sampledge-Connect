Pod::Spec.new do |s|
  s.name           = 'CameraEffects'
  s.version        = '0.1.0'
  s.summary        = 'Applies the call background and look to the phone camera, on the device'
  s.description    = 'SampConnect: person segmentation and face landmarks (Apple Vision) and a Metal shader for looks, run on every outgoing camera frame.'
  s.author         = 'SampConnect'
  s.homepage       = 'https://github.com/kunalsharma-ai/sampledge-connect'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # The camera track and its frame-processor hook (LKRNProcessorProvider).
  s.dependency 'livekit-react-native-webrtc'
  s.dependency 'LiveKitWebRTC'
  s.frameworks = 'Metal', 'MetalPerformanceShaders', 'CoreVideo', 'Vision', 'UIKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
