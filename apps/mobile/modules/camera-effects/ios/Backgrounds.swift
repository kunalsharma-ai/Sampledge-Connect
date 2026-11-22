import UIKit

/// Background pictures for the camera: a chosen image, or the company background drawn here.
enum Backgrounds {
  /// Reads a picture from a file:// address or a plain path.
  static func load(_ uri: String) -> CGImage? {
    let path = uri.hasPrefix("file://") ? (URL(string: uri)?.path ?? "") : uri
    guard !path.isEmpty, let image = UIImage(contentsOfFile: path) else { return nil }
    return upright(image)
  }

  private static func upright(_ image: UIImage) -> CGImage? {
    if image.imageOrientation == .up, let cg = image.cgImage { return cg }
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: image.size))
    }.cgImage
  }

  private static func ui(_ rgb: UInt32, _ a: CGFloat = 1) -> UIColor {
    UIColor(
      red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255,
      blue: CGFloat(rgb & 255) / 255, alpha: a)
  }

  /// Darkens (negative) or lightens (positive) a color, as the web app does.
  static func shade(_ rgb: UInt32, _ amt: CGFloat) -> UInt32 {
    func ch(_ v: UInt32) -> UInt32 {
      let f = CGFloat(v)
      return UInt32(max(0, min(255, (amt < 0 ? f * (1 + amt) : f + (255 - f) * amt).rounded())))
    }
    return (ch((rgb >> 16) & 255) << 16) | (ch((rgb >> 8) & 255) << 8) | ch(rgb & 255)
  }

  /**
   The company background, as the web app draws it: brand gradient, soft glows, fine diagonal
   lines, an accent band, and the logo and name. Drawn in the frame's own shape so the logo stays
   in view on a phone held upright.
   */
  static func brand(_ brand: Brand, portrait: Bool) -> CGImage? {
    let w: CGFloat = portrait ? 720 : 1280
    let h: CGFloat = portrait ? 1280 : 720
    let k = min(w, h) / 720
    let logo = brand.logoUri.flatMap { load($0) }
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let img = UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: format).image { ctx in
      let g = ctx.cgContext
      let space = CGColorSpaceCreateDeviceRGB()
      if let lin = CGGradient(
        colorsSpace: space,
        colors: [ui(shade(brand.primary, -0.55)).cgColor, ui(shade(brand.primary, -0.25)).cgColor] as CFArray,
        locations: [0, 1])
      {
        g.drawLinearGradient(lin, start: .zero, end: CGPoint(x: w, y: h), options: [])
      }
      func glow(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ color: UInt32, _ a: CGFloat) {
        guard let rg = CGGradient(
          colorsSpace: space, colors: [ui(color, a).cgColor, ui(color, 0).cgColor] as CFArray,
          locations: [0, 1])
        else { return }
        g.drawRadialGradient(
          rg, startCenter: CGPoint(x: x, y: y), startRadius: 0, endCenter: CGPoint(x: x, y: y),
          endRadius: r, options: [])
      }
      glow(w * 0.85, h * 0.15, 520 * k, brand.primary, 0.45)
      glow(w * 0.1, h * 0.95, 480 * k, brand.secondary, 0.25)

      g.setStrokeColor(UIColor(white: 1, alpha: 0.035).cgColor)
      g.setLineWidth(2)
      var x = -h
      while x < w {
        g.move(to: CGPoint(x: x, y: h))
        g.addLine(to: CGPoint(x: x + h, y: 0))
        x += 28
      }
      g.strokePath()
      g.setFillColor(ui(brand.secondary, 0.85).cgColor)
      g.fill(CGRect(x: 0, y: h - 10 * k, width: w, height: 10 * k))

      let right = w * (portrait ? 0.9 : 0.77)
      var y = 44 * k
      if let logo, logo.width > 0, logo.height > 0 {
        let s = min(200 * k / CGFloat(logo.width), 84 * k / CGFloat(logo.height))
        let lw = CGFloat(logo.width) * s
        let lh = CGFloat(logo.height) * s
        let pad = 16 * k
        UIColor(white: 1, alpha: 0.94).setFill()
        UIBezierPath(
          roundedRect: CGRect(x: right - lw - 2 * pad, y: y, width: lw + 2 * pad, height: lh + 28 * k),
          cornerRadius: 14 * k
        ).fill()
        UIImage(cgImage: logo).draw(in: CGRect(x: right - lw - pad, y: y + 14 * k, width: lw, height: lh))
        y += lh + 28 * k + 14 * k
      }
      if !brand.name.isEmpty {
        let para = NSMutableParagraphStyle()
        para.alignment = .right
        let attrs: [NSAttributedString.Key: Any] = [
          .font: UIFont.systemFont(ofSize: 26 * k, weight: .semibold),
          .foregroundColor: UIColor(white: 1, alpha: 0.9),
          .paragraphStyle: para,
        ]
        (brand.name as NSString).draw(
          in: CGRect(x: 0, y: y, width: right, height: 40 * k), withAttributes: attrs)
      }
    }
    return img.cgImage
  }
}
