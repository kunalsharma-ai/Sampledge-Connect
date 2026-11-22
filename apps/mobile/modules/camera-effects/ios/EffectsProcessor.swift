import CoreVideo
import Foundation
import LiveKitWebRTC
import Metal
import MetalPerformanceShaders
import Vision
import livekit_react_native_webrtc

/// What JavaScript sets, and the processor WebRTC runs on every camera frame.
final class CameraEffects {
  static let processorName = "sampconnect-camera-effects"
  static let shared = CameraEffects()

  private let lock = NSLock()
  private var current = EffectsOptions.off
  private var processor: EffectsProcessor?

  var options: EffectsOptions {
    lock.lock()
    defer { lock.unlock() }
    return current
  }

  func install() {
    lock.lock()
    defer { lock.unlock() }
    if processor == nil {
      let p = EffectsProcessor()
      LKRNProcessorProvider.addProcessor(p, forName: CameraEffects.processorName)
      processor = p
    }
  }

  func setOptions(json: String) {
    let parsed = EffectsOptions.parse(json)
    lock.lock()
    current = parsed
    lock.unlock()
  }
}

/**
 Runs for every camera frame on the capture queue: the look and face shaping, then the
 background, on the GPU, into a new frame that WebRTC sends and shows instead of the raw one.
 Any problem sends the raw frame, so the camera never stops.
 */
final class EffectsProcessor: NSObject, LKRNVideoFrameProcessorDelegate {
  private lazy var gpu: EffectsGpu? = EffectsGpu()

  func capturer(_ capturer: LKRTCVideoCapturer, didCapture frame: LKRTCVideoFrame) -> LKRTCVideoFrame {
    let o = CameraEffects.shared.options
    guard o.active, let gpu = self.gpu, let buffer = frame.buffer as? LKRTCCVPixelBuffer else { return frame }
    let degrees: Int
    switch frame.rotation {
    case ._90: degrees = 90
    case ._180: degrees = 180
    case ._270: degrees = 270
    default: degrees = 0
    }
    guard let out = gpu.render(buffer.pixelBuffer, rotation: degrees, options: o) else { return frame }
    return LKRTCVideoFrame(
      buffer: LKRTCCVPixelBuffer(pixelBuffer: out), rotation: ._0, timeStampNs: frame.timeStampNs)
  }
}

private let paramCount = 72

final class EffectsGpu {
  private let device: MTLDevice
  private let queue: MTLCommandQueue
  private let smallPipeline: MTLComputePipelineState
  private let mainPipeline: MTLComputePipelineState
  private let nv12Pipeline: MTLComputePipelineState
  private var cache: CVMetalTextureCache?
  private let blur: MPSImageGaussianBlur
  private let vision = VisionRunner()
  private let blank: MTLTexture

  private var outPool: CVPixelBufferPool?
  private var outSize = (0, 0)
  private var smallPool: CVPixelBufferPool?
  private var smallSize = (0, 0)
  private var rgbTex: MTLTexture?
  private var blurTex: MTLTexture?
  private var maskTex: MTLTexture?
  private var hasMask = false

  // Background pictures load off the capture queue; the newest finished one is uploaded here.
  private let loader = DispatchQueue(label: "camera-effects-bg")
  private let loadLock = NSLock()
  private var loaded: (String, CGImage)?
  private var requestedKey: String?
  private var bgKey: String?
  private var bgTex: MTLTexture?

  init?() {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
      return nil
    }
    do {
      let library = try device.makeLibrary(source: effectsKernelSource, options: nil)
      func pipe(_ name: String) throws -> MTLComputePipelineState {
        guard let f = library.makeFunction(name: name) else {
          throw NSError(domain: "CameraEffects", code: 1)
        }
        return try device.makeComputePipelineState(function: f)
      }
      smallPipeline = try pipe("smallCopy")
      mainPipeline = try pipe("effects")
      nv12Pipeline = try pipe("toNV12")
    } catch {
      NSLog("SampCameraEffects: the camera shader could not start: \(error)")
      return nil
    }
    self.device = device
    self.queue = queue
    blur = MPSImageGaussianBlur(device: device, sigma: 6)
    blur.edgeMode = .clamp
    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: 1, height: 1, mipmapped: false)
    guard let b = device.makeTexture(descriptor: d) else { return nil }
    var px: UInt32 = 0xFF00_0000
    b.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: &px, bytesPerRow: 4)
    blank = b
    CVMetalTextureCacheCreate(nil, nil, device, nil, &cache)
  }

  func render(_ pb: CVPixelBuffer, rotation: Int, options o: EffectsOptions) -> CVPixelBuffer? {
    let fmt = CVPixelBufferGetPixelFormatType(pb)
    let full = fmt == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
    guard full || fmt == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, let cache = self.cache else { return nil }
    let bw = CVPixelBufferGetWidth(pb)
    let bh = CVPixelBufferGetHeight(pb)
    let turned = rotation == 90 || rotation == 270
    let w = (turned ? bh : bw) & ~1
    let h = (turned ? bw : bh) & ~1
    guard w > 0, h > 0 else { return nil }

    var keep: [CVMetalTexture] = []
    guard let yTex = texture(pb, plane: 0, format: .r8Unorm, cache: cache, keep: &keep),
      let cTex = texture(pb, plane: 1, format: .rg8Unorm, cache: cache, keep: &keep),
      let cmd = queue.makeCommandBuffer()
    else { return nil }

    if o.mode == .off { hasMask = false }
    if !o.shaping { vision.face.clear() }
    let wantMask = o.mode != .off && !vision.segmentationFailed
    let wantFace = o.shaping && !vision.faceFailed
    let picture = o.mode == .image || o.mode == .brand
    let bgReady = picture && backgroundReady(o, portrait: h > w)
    let bgMode: Float =
      vision.segmentationFailed ? 0 : o.mode == .blur ? 1 : picture ? (bgReady ? 2 : 1) : 0

    var P = [Float](repeating: 0, count: paramCount)
    P[0] = Float(w)
    P[1] = Float(h)
    let look = o.look ?? Look()
    P[2] = look.brightness
    P[3] = look.contrast
    P[4] = look.saturation
    P[5] = look.warmth
    P[6] = look.grayscale
    P[7] = look.sepia
    P[8] = look.glow
    P[9] = look.vignette
    P[10] = look.lowLight
    P[11] = look.sharpness
    P[12] = look.smoothing
    P[13] = Float(rotation)
    P[14] = full ? 1 : 0

    // The small upright copy: read by Vision, and blurred for the blur background.
    var smallBuffer: CVPixelBuffer?
    var blurred: MTLTexture = blank
    let (sw, sh) = analysisSize(w: w, h: h)
    if wantMask || wantFace || bgMode == 1 {
      if smallPool == nil || smallSize != (sw, sh) {
        smallPool = makePool(sw, sh, kCVPixelFormatType_32BGRA)
        smallSize = (sw, sh)
        blurTex = makeTexture(sw, sh, .bgra8Unorm)
      }
      if let pool = smallPool, let sb = buffer(from: pool),
        let sTex = texture(sb, plane: -1, format: .bgra8Unorm, cache: cache, keep: &keep),
        let enc = cmd.makeComputeCommandEncoder()
      {
        enc.setComputePipelineState(smallPipeline)
        enc.setTexture(yTex, index: 0)
        enc.setTexture(cTex, index: 1)
        enc.setTexture(sTex, index: 2)
        enc.setBytes(P, length: paramCount * 4, index: 0)
        dispatch(enc, smallPipeline, sw, sh)
        enc.endEncoding()
        smallBuffer = sb
        if bgMode == 1, let bt = blurTex {
          blur.encode(commandBuffer: cmd, sourceTexture: sTex, destinationTexture: bt)
          blurred = bt
        }
      }
    }

    if let m = vision.takeMask() {
      if maskTex == nil || maskTex!.width != m.width || maskTex!.height != m.height {
        maskTex = makeTexture(m.width, m.height, .r8Unorm)
      }
      m.bytes.withUnsafeBytes { raw in
        if let base = raw.baseAddress {
          maskTex?.replace(
            region: MTLRegionMake2D(0, 0, m.width, m.height), mipmapLevel: 0, withBytes: base,
            bytesPerRow: m.width)
        }
      }
      if o.mode != .off { hasMask = true }
    }

    if o.shaping, let points = vision.face.current(now: ProcessInfo.processInfo.systemUptime),
      let warps = faceWarps(points, w: Float(w), h: Float(h), slim: o.slim, eyes: o.eyes, nose: o.nose)
    {
      P[15] = Float(warps.shiftCount)
      P[16] = Float(warps.eyeCount)
      P[17] = warps.eyeScale
      for i in 0..<min(32, warps.shifts.count) { P[26 + i] = warps.shifts[i] }
      for i in 0..<min(8, warps.radii.count) { P[58 + i] = warps.radii[i] }
      for i in 0..<min(6, warps.eyes.count) { P[66 + i] = warps.eyes[i] }
    }
    P[18] = bgMode
    P[19] = hasMask ? 1 : 0
    if let bg = bgTex, bgReady {
      let r = coverRect(imageW: bg.width, imageH: bg.height, frameW: w, frameH: h)
      for i in 0..<4 { P[22 + i] = r[i] }
    }

    if outPool == nil || outSize != (w, h) {
      outPool = makePool(w, h, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange)
      outSize = (w, h)
      rgbTex = makeTexture(w, h, .rgba8Unorm)
    }
    guard let pool = outPool, let out = buffer(from: pool), let rgb = rgbTex,
      let oy = texture(out, plane: 0, format: .r8Unorm, cache: cache, keep: &keep),
      let oc = texture(out, plane: 1, format: .rg8Unorm, cache: cache, keep: &keep),
      let enc = cmd.makeComputeCommandEncoder()
    else { return nil }
    enc.setComputePipelineState(mainPipeline)
    enc.setTexture(yTex, index: 0)
    enc.setTexture(cTex, index: 1)
    enc.setTexture(rgb, index: 2)
    enc.setTexture(maskTex ?? blank, index: 3)
    enc.setTexture(blurred, index: 4)
    enc.setTexture(bgReady ? (bgTex ?? blank) : blank, index: 5)
    enc.setBytes(P, length: paramCount * 4, index: 0)
    dispatch(enc, mainPipeline, w, h)
    enc.setComputePipelineState(nv12Pipeline)
    enc.setTexture(rgb, index: 0)
    enc.setTexture(oy, index: 1)
    enc.setTexture(oc, index: 2)
    dispatch(enc, nv12Pipeline, w / 2, h / 2)
    enc.endEncoding()
    cmd.commit()
    cmd.waitUntilCompleted()
    _ = keep
    if cmd.status != .completed { return nil }

    if let sb = smallBuffer, wantMask || wantFace {
      vision.submit(sb, wantMask: wantMask, wantFace: wantFace)
    }
    return out
  }

  // MARK: - helpers

  private func dispatch(_ enc: MTLComputeCommandEncoder, _ p: MTLComputePipelineState, _ w: Int, _ h: Int) {
    let tw = p.threadExecutionWidth
    let th = max(1, p.maxTotalThreadsPerThreadgroup / tw)
    let group = MTLSize(width: tw, height: th, depth: 1)
    let grid = MTLSize(width: (w + tw - 1) / tw, height: (h + th - 1) / th, depth: 1)
    enc.dispatchThreadgroups(grid, threadsPerThreadgroup: group)
  }

  /// A Metal view of one plane of a pixel buffer (plane -1: a buffer with one plane).
  private func texture(
    _ pb: CVPixelBuffer, plane: Int, format: MTLPixelFormat, cache: CVMetalTextureCache,
    keep: inout [CVMetalTexture]
  ) -> MTLTexture? {
    let w = plane < 0 ? CVPixelBufferGetWidth(pb) : CVPixelBufferGetWidthOfPlane(pb, plane)
    let h = plane < 0 ? CVPixelBufferGetHeight(pb) : CVPixelBufferGetHeightOfPlane(pb, plane)
    var t: CVMetalTexture?
    // Read and write: the camera planes are read, our own buffers are written.
    let attrs = [kCVMetalTextureUsage as String: MTLTextureUsage([.shaderRead, .shaderWrite]).rawValue] as CFDictionary
    let r = CVMetalTextureCacheCreateTextureFromImage(nil, cache, pb, attrs, format, w, h, max(0, plane), &t)
    guard r == kCVReturnSuccess, let t, let tex = CVMetalTextureGetTexture(t) else { return nil }
    keep.append(t)
    return tex
  }

  private func makePool(_ w: Int, _ h: Int, _ format: OSType) -> CVPixelBufferPool? {
    let attrs: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: format,
      kCVPixelBufferWidthKey as String: w,
      kCVPixelBufferHeightKey as String: h,
      kCVPixelBufferMetalCompatibilityKey as String: true,
      kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
    ]
    var pool: CVPixelBufferPool?
    CVPixelBufferPoolCreate(nil, nil, attrs as CFDictionary, &pool)
    return pool
  }

  private func buffer(from pool: CVPixelBufferPool) -> CVPixelBuffer? {
    var pb: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
    return pb
  }

  private func makeTexture(_ w: Int, _ h: Int, _ format: MTLPixelFormat) -> MTLTexture? {
    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: format, width: w, height: h, mipmapped: false)
    d.usage = [.shaderRead, .shaderWrite]
    return device.makeTexture(descriptor: d)
  }

  /// Starts loading the picture for these options if needed; true once it is on the GPU.
  private func backgroundReady(_ o: EffectsOptions, portrait: Bool) -> Bool {
    let key: String
    if o.mode == .image, let uri = o.imageUri {
      key = "image|\(uri)"
    } else if o.mode == .brand, let b = o.brand {
      key = "brand|\(b.primary)|\(b.secondary)|\(b.name)|\(b.logoUri ?? "")|\(portrait)"
    } else {
      return false
    }
    if key != requestedKey {
      requestedKey = key
      let uri = o.imageUri
      let brand = o.mode == .brand ? o.brand : nil
      loader.async { [weak self] in
        let img = brand.map { Backgrounds.brand($0, portrait: portrait) } ?? uri.flatMap { Backgrounds.load($0) }
        guard let self, let img else { return }
        self.loadLock.lock()
        self.loaded = (key, img)
        self.loadLock.unlock()
      }
    }
    loadLock.lock()
    let l = loaded
    loadLock.unlock()
    if let l, l.0 == key, bgKey != key, let tex = upload(l.1) {
      bgTex = tex
      bgKey = key
    }
    return bgKey == key
  }

  /// A picture as a Metal texture (rows from the top, like the camera and the masks).
  private func upload(_ image: CGImage) -> MTLTexture? {
    let w = image.width
    let h = image.height
    var bytes = [UInt8](repeating: 0, count: w * h * 4)
    let info = CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    guard let ctx = CGContext(
      data: &bytes, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: info)
    else { return nil }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: w, height: h, mipmapped: false)
    d.usage = [.shaderRead]
    guard let tex = device.makeTexture(descriptor: d) else { return nil }
    tex.replace(region: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0, withBytes: bytes, bytesPerRow: w * 4)
    return tex
  }
}

/// A person mask: one byte per pixel, 255 = person, rows from the top.
struct Mask {
  let bytes: [UInt8]
  let width: Int
  let height: Int
}

/**
 Finds the person (for backgrounds) and the face (for face shaping) in the small upright copy,
 on its own queue, with Apple's Vision framework. Nothing leaves the phone.
 */
final class VisionRunner {
  private let queue = DispatchQueue(label: "camera-effects-vision")
  private let lock = NSLock()
  private var busy = false
  private var pending: Mask?
  private var tick = 0
  private let sequence = VNSequenceRequestHandler()
  private lazy var segmentation: VNGeneratePersonSegmentationRequest = {
    let r = VNGeneratePersonSegmentationRequest()
    r.qualityLevel = .balanced
    r.outputPixelFormat = kCVPixelFormatType_OneComponent8
    return r
  }()
  private let landmarks = VNDetectFaceLandmarksRequest()
  private(set) var segmentationFailed = false
  private(set) var faceFailed = false
  let face = FaceSmoother()

  func takeMask() -> Mask? {
    lock.lock()
    defer { lock.unlock() }
    let m = pending
    pending = nil
    return m
  }

  func submit(_ pb: CVPixelBuffer, wantMask: Bool, wantFace: Bool) {
    lock.lock()
    if busy {
      lock.unlock()
      return
    }
    busy = true
    lock.unlock()
    queue.async { [self] in
      defer {
        lock.lock()
        busy = false
        lock.unlock()
      }
      // The face moves less than the edges of a person: every third look is enough.
      let lookForFace = wantFace && tick % 3 == 0
      tick += 1
      var requests: [VNRequest] = []
      if wantMask { requests.append(segmentation) }
      if lookForFace { requests.append(landmarks) }
      if requests.isEmpty { return }
      do {
        try sequence.perform(requests, on: pb, orientation: .up)
      } catch {
        NSLog("SampCameraEffects: Vision failed: \(error)")
        if wantMask { segmentationFailed = true }
        if lookForFace { faceFailed = true }
        return
      }
      if wantMask, let obs = segmentation.results?.first {
        let m = obs.pixelBuffer
        CVPixelBufferLockBaseAddress(m, .readOnly)
        let mw = CVPixelBufferGetWidth(m)
        let mh = CVPixelBufferGetHeight(m)
        let row = CVPixelBufferGetBytesPerRow(m)
        var bytes = [UInt8](repeating: 0, count: mw * mh)
        if let base = CVPixelBufferGetBaseAddress(m)?.assumingMemoryBound(to: UInt8.self) {
          for y in 0..<mh {
            for x in 0..<mw { bytes[y * mw + x] = base[y * row + x] }
          }
        }
        CVPixelBufferUnlockBaseAddress(m, .readOnly)
        lock.lock()
        pending = Mask(bytes: bytes, width: mw, height: mh)
        lock.unlock()
      }
      if lookForFace {
        let now = ProcessInfo.processInfo.systemUptime
        guard let obs = landmarks.results?.first, let lm = obs.landmarks else {
          face.update(nil, now: now)
          return
        }
        let size = CGSize(width: CVPixelBufferGetWidth(pb), height: CVPixelBufferGetHeight(pb))
        // Vision's points start bottom left; ours top left, 0..1.
        func pts(_ r: VNFaceLandmarkRegion2D?) -> [CGPoint] {
          (r?.pointsInImage(imageSize: size) ?? []).map {
            CGPoint(x: $0.x / size.width, y: 1 - $0.y / size.height)
          }
        }
        let points = mediaPipePoints(
          contour: pts(lm.faceContour), crest: pts(lm.noseCrest), nose: pts(lm.nose),
          leftEye: pts(lm.leftEye), rightEye: pts(lm.rightEye))
        face.update(points, now: now)
      }
    }
  }
}
