import CoreGraphics
import Foundation

/// The look's shader numbers (from lookParams in @sampledge/contracts, so web and phone match).
struct Look {
  var brightness: Float = 0
  var contrast: Float = 0
  var saturation: Float = 0
  var warmth: Float = 0
  var grayscale: Float = 0
  var sepia: Float = 0
  var glow: Float = 0
  var vignette: Float = 0
  var lowLight: Float = 0
  var sharpness: Float = 0
  var smoothing: Float = 0
}

/// The company background: brand colors, logo and name, drawn on the phone like on web.
struct Brand: Equatable {
  var primary: UInt32
  var secondary: UInt32
  var name: String
  var logoUri: String?
}

enum BackgroundMode { case off, blur, image, brand }

/// What the camera should do. Set from JavaScript as JSON; read by the processor every frame.
struct EffectsOptions {
  var mode: BackgroundMode = .off
  var imageUri: String?
  var brand: Brand?
  /// Nil when the look changes nothing.
  var look: Look?
  var slim: Float = 0
  var eyes: Float = 0
  var nose: Float = 0

  var shaping: Bool { slim > 0 || eyes > 0 || nose > 0 }
  var active: Bool { mode != .off || look != nil || shaping }

  static let off = EffectsOptions()

  static func parse(_ json: String) -> EffectsOptions {
    guard let data = json.data(using: .utf8),
      let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { return .off }
    func num(_ d: [String: Any]?, _ k: String) -> Float { Float((d?[k] as? NSNumber)?.doubleValue ?? 0) }
    var out = EffectsOptions()
    let bg = o["background"] as? [String: Any]
    switch bg?["mode"] as? String {
    case "blur": out.mode = .blur
    case "image": out.mode = .image
    case "brand": out.mode = .brand
    default: out.mode = .off
    }
    if out.mode == .image {
      out.imageUri = (bg?["uri"] as? String).flatMap { $0.isEmpty ? nil : $0 }
      // A missing picture falls back to blur, so the room behind you stays private.
      if out.imageUri == nil { out.mode = .blur }
    }
    if out.mode == .brand {
      out.brand = Brand(
        primary: color(bg?["primary"] as? String) ?? 0x1F3A5F,
        secondary: color(bg?["secondary"] as? String) ?? 0xC9A227,
        name: bg?["name"] as? String ?? "",
        logoUri: (bg?["logoUri"] as? String).flatMap { $0.isEmpty ? nil : $0 })
    }
    if let l = o["look"] as? [String: Any] {
      out.look = Look(
        brightness: num(l, "brightness"), contrast: num(l, "contrast"),
        saturation: num(l, "saturation"), warmth: num(l, "warmth"), grayscale: num(l, "grayscale"),
        sepia: num(l, "sepia"), glow: num(l, "glow"), vignette: num(l, "vignette"),
        lowLight: num(l, "lowLight"), sharpness: num(l, "sharpness"), smoothing: num(l, "smoothing"))
    }
    let face = o["face"] as? [String: Any]
    out.slim = min(1, max(0, num(face, "slim")))
    out.eyes = min(1, max(0, num(face, "eyes")))
    out.nose = min(1, max(0, num(face, "nose")))
    return out
  }

  private static func color(_ hex: String?) -> UInt32? {
    guard let hex, hex.count == 7, hex.hasPrefix("#") else { return nil }
    return UInt32(hex.dropFirst(), radix: 16)
  }
}
