package expo.modules.hithermenu

import android.content.Context
import android.view.Gravity
import android.widget.PopupMenu
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HitherMenuView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var items: List<Map<String, String>> = emptyList()
  private val onSelect by EventDispatcher()

  init {
    isClickable = true
    setOnClickListener {
      val popup = PopupMenu(context, this, Gravity.START)
      items.forEachIndexed { index, item ->
        popup.menu.add(0, index, index, item["title"] ?: "")
      }
      popup.setOnMenuItemClickListener { menuItem ->
        val id = items.getOrNull(menuItem.itemId)?.get("id") ?: return@setOnMenuItemClickListener false
        onSelect(mapOf("id" to id))
        true
      }
      popup.show()
    }
  }
}

class HitherMenuModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HitherMenu")

    View(HitherMenuView::class) {
      Events("onSelect")
      Prop("items") { view: HitherMenuView, items: List<Map<String, String>> ->
        view.items = items
      }
    }
  }
}
