import Foundation

@main
struct LocationDeliveryPolicyTests {
  static func main() {
    // A short moving route and an unchanged stationary location both remain
    // eligible once the passive time budget is due; distance cannot starve it.
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 599.99, minimumInterval: 600, thermalLevel: 0))
    assert(LocationDeliveryPolicy.shouldDeliver(elapsed: 600, minimumInterval: 600, thermalLevel: 0))
    assert(LocationDeliveryPolicy.shouldDeliver(elapsed: 970, minimumInterval: 600, thermalLevel: 0))
    // Stationary callbacks obey the same budget instead of bypassing cadence.
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 1, minimumInterval: 600, thermalLevel: 0))
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 0, minimumInterval: 15, thermalLevel: 0))
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: -1, minimumInterval: 15, thermalLevel: 0))
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 14.99, minimumInterval: 15, thermalLevel: 0))
    assert(LocationDeliveryPolicy.shouldDeliver(elapsed: 15, minimumInterval: 15, thermalLevel: 0))
    // Thermal pressure reduces native-to-JS work without adding a GPS timer.
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 15, minimumInterval: 15, thermalLevel: 2))
    assert(LocationDeliveryPolicy.shouldDeliver(elapsed: 30, minimumInterval: 15, thermalLevel: 2))
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 59.99, minimumInterval: 15, thermalLevel: 3))
    assert(LocationDeliveryPolicy.shouldDeliver(elapsed: 60, minimumInterval: 15, thermalLevel: 3))
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 60, minimumInterval: 600, thermalLevel: 3))
    print("LocationDeliveryPolicy: 13 behavior checks passed")
  }
}
