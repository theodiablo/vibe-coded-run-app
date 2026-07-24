import WidgetKit
import SwiftUI

// Widget-extension entry point. The extension's deployment target is 16.2
// (Live Activities floor), so no availability gating is needed inside it — on
// older iOS the system simply never loads the extension, and the app (target
// 15.0) runs without the card.
@main
struct LiveActivityWidgetBundle: WidgetBundle {
    var body: some Widget {
        RunLiveActivityWidget()
    }
}
