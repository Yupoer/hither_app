import Foundation
import CoreGraphics

@main
struct HitherPaneGeometryTests {
  static func main() {
    for width: CGFloat in [320, 393, 430, 768] {
      for maximum: CGFloat in [360, 620, 900] {
        for direction in [1, -1] {
          for height in stride(from: CGFloat(100), through: maximum, by: 0.5) {
            let pane = HitherPaneGeometry(width: width, maximumHeight: maximum, height: height,
              closed: 100, grabberHeight: 24, direction: direction)
            precondition(pane.visible.width == width)
            precondition(pane.body.height == height - 100)
            precondition(pane.grabber.height == 24)
            if direction == 1 {
              precondition(pane.header == CGRect(x: 0, y: 0, width: width, height: 76))
              precondition(pane.body.minY == pane.header.maxY)
              precondition(pane.body.maxY == pane.grabber.minY)
              precondition(pane.grabber.maxY == height)
            } else {
              precondition(pane.visible.maxY == maximum)
              precondition(pane.grabber.minY == maximum - height)
              precondition(pane.body.minY == pane.grabber.maxY)
              precondition(pane.body.maxY == pane.footer.minY)
              precondition(pane.footer.maxY == maximum)
            }
          }
        }
      }
    }
    for invalid: CGFloat in [-100, .nan, .infinity, -.infinity] {
      let pane = HitherPaneGeometry(width: 393, maximumHeight: 620, height: invalid,
        closed: 100, grabberHeight: 24, direction: -1)
      precondition(pane.visible.height == 100 && pane.body.height == 0)
    }
    let over = HitherPaneGeometry(width: 393, maximumHeight: 620, height: 900,
      closed: 100, grabberHeight: 24, direction: 1)
    precondition(over.visible.height == 620)
    let small = HitherPaneGeometry(width: 320, maximumHeight: 80, height: 100,
      closed: 100, grabberHeight: 24, direction: -1)
    precondition(small.visible.height == 80 && small.body.height == 0)
    precondition(HitherPaneGeometry.pixelAligned(104.1, scale: 3) == 104)
    precondition(HitherPaneGeometry.pixelAligned(104.2, scale: 3) == 104 + 1.0 / 3.0)
    precondition(HitherPaneGeometry.pixelAligned(104.2, scale: 2) == 104)
    precondition(HitherPaneGeometry.pixelAligned(104.3, scale: 2) == 104.5)
    precondition(HitherPaneGeometry.pixelAligned(.infinity, scale: 3).isInfinite)
    print("HitherPaneGeometry: anchors, intermediate frames, clamping and viewport sizes passed")
  }
}
