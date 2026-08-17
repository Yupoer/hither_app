import ExpoModulesCore
import UIKit

final class HitherMenuView: ExpoView {
  let button = UIButton(type: .custom)
  let onSelect = EventDispatcher()
  var items: [[String: String]] = [] {
    didSet { rebuildMenu() }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    button.backgroundColor = .clear
    button.showsMenuAsPrimaryAction = true
    button.changesSelectionAsPrimaryAction = false
    addSubview(button)
    button.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      button.leadingAnchor.constraint(equalTo: leadingAnchor),
      button.trailingAnchor.constraint(equalTo: trailingAnchor),
      button.topAnchor.constraint(equalTo: topAnchor),
      button.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    bringSubviewToFront(button)
  }

  private func rebuildMenu() {
    let actions = items.compactMap { item -> UIAction? in
      guard let id = item["id"], let title = item["title"] else { return nil }
      return UIAction(title: title, identifier: UIAction.Identifier(id)) { [weak self] _ in
        self?.onSelect(["id": id])
      }
    }
    button.menu = UIMenu(title: "", options: [], children: actions)
  }
}

public class HitherMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HitherMenu")

    View(HitherMenuView.self) {
      Events("onSelect")
      Prop("items") { (view: HitherMenuView, items: [[String: String]]) in
        view.items = items
      }
    }
  }
}
