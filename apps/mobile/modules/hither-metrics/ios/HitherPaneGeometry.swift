import Foundation
import CoreGraphics

struct HitherPaneGeometry: Equatable {
  let visible: CGRect
  let header: CGRect
  let body: CGRect
  let grabber: CGRect
  let footer: CGRect

  static func pixelAligned(_ height: CGFloat, scale: CGFloat) -> CGFloat {
    guard height.isFinite else { return height }
    let scale = scale.isFinite ? max(1, scale) : 1
    return (height * scale).rounded() / scale
  }

  init(width: CGFloat, maximumHeight: CGFloat, height: CGFloat, closed: CGFloat, grabberHeight: CGFloat, direction: Int) {
    let maximum = max(0, maximumHeight)
    let minimum = min(maximum, max(0, closed))
    let current = min(maximum, max(minimum, height.isFinite ? height : minimum))
    let grab = min(minimum, max(0, grabberHeight))
    let fixed = minimum - grab
    let top = direction == -1 ? maximum - current : 0
    visible = CGRect(x: 0, y: top, width: width, height: current)
    header = CGRect(x: 0, y: top, width: width, height: direction == 1 ? fixed : 0)
    body = CGRect(x: 0, y: top + (direction == 1 ? fixed : grab), width: width, height: current - minimum)
    grabber = CGRect(x: 0, y: direction == 1 ? current - grab : top, width: width, height: grab)
    footer = CGRect(x: 0, y: maximum - fixed, width: width, height: direction == -1 ? fixed : 0)
  }
}
