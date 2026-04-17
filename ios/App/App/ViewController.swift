import UIKit
import Capacitor
import RevenuecatPurchasesCapacitor

class ViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PurchasesPlugin())
    }
}
