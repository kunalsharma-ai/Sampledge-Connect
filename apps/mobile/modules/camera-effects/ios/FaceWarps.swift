import CoreGraphics
import Foundation

/// The same face-shaping math as the web app (apps/web/lib/camera-look.ts) and the Android
/// processor (FaceWarps.kt): jaw points move toward the nose tip, nose sides toward the middle,
/// and the eyes are magnified. Points are keyed by MediaPipe face-mesh numbers.
struct Warps {
  var shifts: [Float]  // [cx, cy, dx, dy] per moved point
  var radii: [Float]
  var eyes: [Float]  // [cx, cy, r] per eye
  var eyeScale: Float
  var shiftCount: Int { min(maxShifts, radii.count) }
  var eyeCount: Int { eyes.count / 3 }
}

let maxShifts = 8
let cheekLeft = 234
let cheekRight = 454
let noseTip = 1
let noseMid = 4
let jaw = [132, 58, 172, 361, 288, 397]
let eyeLeft = [33, 133]
let eyeRight = [362, 263]
let noseSides = [64, 294]
let facePoints = [cheekLeft, cheekRight, noseTip, noseMid] + jaw + eyeLeft + eyeRight + noseSides

private func dist(_ a: CGPoint, _ b: CGPoint) -> Float { Float(hypot(a.x - b.x, a.y - b.y)) }

/// Landmarks are normalized 0..1 (top left origin); slim, eyes and nose are 0..1.
func faceWarps(_ lm: [Int: CGPoint], w: Float, h: Float, slim: Float, eyes: Float, nose: Float) -> Warps? {
  func px(_ i: Int) -> CGPoint? {
    guard let p = lm[i] else { return nil }
    return CGPoint(x: p.x * CGFloat(w), y: p.y * CGFloat(h))
  }
  guard let l = px(cheekLeft), let r = px(cheekRight), let tip = px(noseTip) else { return nil }
  let width = dist(l, r)
  if width < 20 { return nil }

  var shifts: [Float] = []
  var radii: [Float] = []
  if slim > 0 {
    for i in jaw {
      guard let p = px(i) else { continue }
      let dx = Float(tip.x - p.x)
      let dy = Float(tip.y - p.y) * 0.3
      let full = hypot(dx, dy)
      let len = full > 0 ? full : 1
      let m = width * 0.04 * slim
      shifts += [Float(p.x), Float(p.y), dx / len * m, dy / len * m]
      radii.append(width * 0.28)
    }
  }
  if nose > 0, let mid = px(noseMid), let s0 = px(noseSides[0]), let s1 = px(noseSides[1]) {
    let rr = dist(s0, s1) * 0.6
    for p in [s0, s1] {
      shifts += [Float(p.x), Float(p.y), Float(mid.x - p.x) * 0.18 * nose, 0]
      radii.append(rr)
    }
  }
  var eyeList: [Float] = []
  if eyes > 0 {
    for pair in [eyeLeft, eyeRight] {
      guard let p = px(pair[0]), let q = px(pair[1]) else { continue }
      eyeList += [Float(p.x + q.x) / 2, Float(p.y + q.y) / 2, dist(p, q) * 1.1]
    }
  }
  return Warps(shifts: shifts, radii: radii, eyes: eyeList, eyeScale: eyes * 0.14)
}

/// Keeps the face steady between detections (55/45 blend), and forgets it after 700 ms.
final class FaceSmoother {
  private var points: [Int: CGPoint] = [:]
  private var lastSeen: TimeInterval = -1_000
  private let lock = NSLock()

  func update(_ found: [Int: CGPoint]?, now: TimeInterval) {
    guard let found else { return }
    lock.lock()
    defer { lock.unlock() }
    for i in facePoints {
      guard let p = found[i] else { continue }
      if let prev = points[i] {
        points[i] = CGPoint(x: prev.x * 0.45 + p.x * 0.55, y: prev.y * 0.45 + p.y * 0.55)
      } else {
        points[i] = p
      }
    }
    lastSeen = now
  }

  func current(now: TimeInterval) -> [Int: CGPoint]? {
    lock.lock()
    defer { lock.unlock() }
    if now - lastSeen > 0.7 {
      points.removeAll()
      return nil
    }
    return points.isEmpty ? nil : points
  }

  func clear() {
    lock.lock()
    points.removeAll()
    lastSeen = -1_000
    lock.unlock()
  }
}

/**
 Apple Vision finds the face with its own points; this picks the ones the shaping reads and files
 them under the MediaPipe numbers. All points are normalized with a top left origin.
 */
func mediaPipePoints(
  contour: [CGPoint], crest: [CGPoint], nose: [CGPoint], leftEye: [CGPoint], rightEye: [CGPoint]
) -> [Int: CGPoint]? {
  guard contour.count >= 5, let tip = crest.max(by: { $0.y < $1.y }) else { return nil }
  var out: [Int: CGPoint] = [:]
  out[noseTip] = tip
  // The crest point just above the tip.
  let above = crest.filter { $0.y < tip.y }.max(by: { $0.y < $1.y })
  out[noseMid] = above ?? tip
  guard let l = contour.min(by: { $0.x < $1.x }), let r = contour.max(by: { $0.x < $1.x }) else {
    return nil
  }
  out[cheekLeft] = l
  out[cheekRight] = r
  // Jaw: below the nose tip on each side, a quarter, half and three quarters of the way down.
  func picks(_ side: [CGPoint]) -> [CGPoint] {
    let s = side.sorted { $0.y < $1.y }
    guard !s.isEmpty else { return [] }
    return [0.25, 0.5, 0.75].map { s[min(s.count - 1, Int(Double(s.count - 1) * $0 + 0.5))] }
  }
  let below = contour.filter { $0.y > tip.y }
  let leftJaw = picks(below.filter { $0.x < tip.x })
  let rightJaw = picks(below.filter { $0.x >= tip.x })
  for (i, p) in zip(jaw[0..<3], leftJaw) { out[i] = p }
  for (i, p) in zip(jaw[3..<6], rightJaw) { out[i] = p }
  if let a = nose.min(by: { $0.x < $1.x }), let b = nose.max(by: { $0.x < $1.x }) {
    out[noseSides[0]] = a
    out[noseSides[1]] = b
  }
  // Eyes: the one further left in the picture is MediaPipe's "left" set.
  let eyesSorted = [leftEye, rightEye].filter { !$0.isEmpty }.sorted {
    ($0.map(\.x).reduce(0, +) / CGFloat($0.count)) < ($1.map(\.x).reduce(0, +) / CGFloat($1.count))
  }
  if eyesSorted.count == 2 {
    let a = eyesSorted[0]
    let b = eyesSorted[1]
    out[eyeLeft[0]] = a.min(by: { $0.x < $1.x })
    out[eyeLeft[1]] = a.max(by: { $0.x < $1.x })
    out[eyeRight[0]] = b.min(by: { $0.x < $1.x })
    out[eyeRight[1]] = b.max(by: { $0.x < $1.x })
  }
  return out
}

/// How a background picture covers the frame without stretching: offset x/y, scale x/y.
func coverRect(imageW: Int, imageH: Int, frameW: Int, frameH: Int) -> [Float] {
  guard imageW > 0, imageH > 0, frameW > 0, frameH > 0 else { return [0, 0, 1, 1] }
  let ia = Float(imageW) / Float(imageH)
  let fa = Float(frameW) / Float(frameH)
  if ia > fa {
    let sx = fa / ia
    return [(1 - sx) / 2, 0, sx, 1]
  }
  let sy = ia / fa
  return [0, (1 - sy) / 2, 1, sy]
}

/// The size to look at a frame for segmentation and face finding (longest side 384, even).
func analysisSize(w: Int, h: Int, maxSide: Int = 384) -> (Int, Int) {
  guard w > 0, h > 0 else { return (maxSide, maxSide) }
  let s = min(1, Float(maxSide) / Float(max(w, h)))
  func even(_ v: Float) -> Int { max(2, (Int(v.rounded()) / 2) * 2) }
  return (even(Float(w) * s), even(Float(h) * s))
}
