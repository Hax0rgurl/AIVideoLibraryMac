import AppKit
import Foundation

struct IconSpec {
  let filename: String
  let pixels: Int
}

let specs = [
  IconSpec(filename: "icon_16x16.png", pixels: 16),
  IconSpec(filename: "icon_16x16@2x.png", pixels: 32),
  IconSpec(filename: "icon_32x32.png", pixels: 32),
  IconSpec(filename: "icon_32x32@2x.png", pixels: 64),
  IconSpec(filename: "icon_128x128.png", pixels: 128),
  IconSpec(filename: "icon_128x128@2x.png", pixels: 256),
  IconSpec(filename: "icon_256x256.png", pixels: 256),
  IconSpec(filename: "icon_256x256@2x.png", pixels: 512),
  IconSpec(filename: "icon_512x512.png", pixels: 512),
  IconSpec(filename: "icon_512x512@2x.png", pixels: 1024)
]

func color(_ hex: Int, alpha: CGFloat = 1) -> NSColor {
  let r = CGFloat((hex >> 16) & 0xff) / 255
  let g = CGFloat((hex >> 8) & 0xff) / 255
  let b = CGFloat(hex & 0xff) / 255
  return NSColor(calibratedRed: r, green: g, blue: b, alpha: alpha)
}

func rounded(_ rect: CGRect, _ radius: CGFloat) -> NSBezierPath {
  NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
}

func fillRounded(_ rect: CGRect, _ radius: CGFloat, _ fill: NSColor) {
  fill.setFill()
  rounded(rect, radius).fill()
}

func strokeRounded(_ rect: CGRect, _ radius: CGFloat, _ stroke: NSColor, _ width: CGFloat) {
  let path = rounded(rect.insetBy(dx: width / 2, dy: width / 2), radius)
  path.lineWidth = width
  stroke.setStroke()
  path.stroke()
}

func drawTriangle(points: [CGPoint], fill: NSColor) {
  guard let first = points.first else { return }
  let path = NSBezierPath()
  path.move(to: first)
  for point in points.dropFirst() {
    path.line(to: point)
  }
  path.close()
  fill.setFill()
  path.fill()
}

func drawSpark(center: CGPoint, radius: CGFloat, fill: NSColor) {
  let path = NSBezierPath()
  let points = 16
  for index in 0..<points {
    let angle = CGFloat(index) * (.pi * 2) / CGFloat(points) - .pi / 2
    let r = index.isMultiple(of: 2) ? radius : radius * 0.34
    let point = CGPoint(x: center.x + cos(angle) * r, y: center.y + sin(angle) * r)
    if index == 0 { path.move(to: point) } else { path.line(to: point) }
  }
  path.close()
  fill.setFill()
  path.fill()
}

func pngData(size pixels: Int) throws -> Data {
  guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: pixels,
    pixelsHigh: pixels,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    throw NSError(domain: "VideoLibraryIcon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not create bitmap"])
  }

  rep.size = NSSize(width: pixels, height: pixels)
  guard let context = NSGraphicsContext(bitmapImageRep: rep) else {
    throw NSError(domain: "VideoLibraryIcon", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not create graphics context"])
  }

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  context.imageInterpolation = .high

  let scale = CGFloat(pixels) / 1024
  context.cgContext.scaleBy(x: scale, y: scale)
  context.cgContext.clear(CGRect(x: 0, y: 0, width: 1024, height: 1024))

  context.cgContext.setShadow(offset: CGSize(width: 0, height: -28), blur: 48, color: color(0x000000, alpha: 0.38).cgColor)
  let outer = rounded(CGRect(x: 58, y: 58, width: 908, height: 908), 214)
  NSGradient(colors: [color(0x17212b), color(0x090d12)])?.draw(in: outer, angle: -42)

  context.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
  strokeRounded(CGRect(x: 58, y: 58, width: 908, height: 908), 214, color(0x33424f, alpha: 0.62), 8)

  context.cgContext.setShadow(offset: CGSize(width: 0, height: -18), blur: 26, color: color(0x000000, alpha: 0.32).cgColor)
  fillRounded(CGRect(x: 220, y: 282, width: 518, height: 500), 78, color(0x1d2b36, alpha: 0.86))
  strokeRounded(CGRect(x: 220, y: 282, width: 518, height: 500), 78, color(0x4a6477, alpha: 0.36), 7)

  fillRounded(CGRect(x: 286, y: 332, width: 518, height: 500), 78, color(0x12364a, alpha: 0.86))
  strokeRounded(CGRect(x: 286, y: 332, width: 518, height: 500), 78, color(0x5ad7ff, alpha: 0.28), 7)

  let front = rounded(CGRect(x: 188, y: 188, width: 648, height: 596), 96)
  NSGradient(colors: [color(0x28f1df), color(0x4aa7ff)])?.draw(in: front, angle: 28)
  strokeRounded(CGRect(x: 188, y: 188, width: 648, height: 596), 96, color(0xc9fffb, alpha: 0.55), 7)

  context.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
  fillRounded(CGRect(x: 284, y: 310, width: 456, height: 340), 58, color(0x071015, alpha: 0.91))
  strokeRounded(CGRect(x: 284, y: 310, width: 456, height: 340), 58, color(0xd8ffff, alpha: 0.18), 5)

  for y in stride(from: CGFloat(338), through: CGFloat(590), by: CGFloat(42)) {
    fillRounded(CGRect(x: 226, y: y, width: 34, height: 22), 8, color(0x071015, alpha: 0.56))
    fillRounded(CGRect(x: 764, y: y, width: 34, height: 22), 8, color(0x071015, alpha: 0.56))
  }

  drawTriangle(
    points: [
      CGPoint(x: 464, y: 402),
      CGPoint(x: 464, y: 558),
      CGPoint(x: 606, y: 480)
    ],
    fill: color(0xdffdfa)
  )

  fillRounded(CGRect(x: 332, y: 690, width: 224, height: 28), 14, color(0x071015, alpha: 0.42))
  fillRounded(CGRect(x: 586, y: 690, width: 118, height: 28), 14, color(0x071015, alpha: 0.28))
  fillRounded(CGRect(x: 332, y: 246, width: 116, height: 30), 15, color(0x071015, alpha: 0.42))
  fillRounded(CGRect(x: 470, y: 246, width: 178, height: 30), 15, color(0x071015, alpha: 0.28))

  context.cgContext.setShadow(offset: CGSize(width: 0, height: 0), blur: 18, color: color(0x22fff1, alpha: 0.42).cgColor)
  drawSpark(center: CGPoint(x: 742, y: 744), radius: 52, fill: color(0xf2fffd))
  drawSpark(center: CGPoint(x: 674, y: 720), radius: 22, fill: color(0xbefefa, alpha: 0.92))

  NSGraphicsContext.restoreGraphicsState()

  guard let data = rep.representation(using: .png, properties: [:]) else {
    throw NSError(domain: "VideoLibraryIcon", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not encode PNG"])
  }
  return data
}

let outputDirectory = CommandLine.arguments.dropFirst().first.map(URL.init(fileURLWithPath:)) ??
  URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("AppIcon.iconset")

try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
for spec in specs {
  let data = try pngData(size: spec.pixels)
  try data.write(to: outputDirectory.appendingPathComponent(spec.filename), options: .atomic)
}

