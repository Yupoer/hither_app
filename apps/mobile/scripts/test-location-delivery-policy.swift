import Foundation

@main
struct LocationDeliveryPolicyTests {
  static func main() {
    assert(!LocationDeliveryPolicy.usesFitness(journey: true, accuracyCode: 4))
    assert(LocationDeliveryPolicy.usesFitness(journey: true, accuracyCode: 5))
    assert(!LocationDeliveryPolicy.usesFitness(journey: false, accuracyCode: 5))
    // A short moving route and an unchanged stationary location both remain
    // eligible once the passive time budget is due; distance cannot starve it.
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 149.99, minimumInterval: 150, thermalLevel: 0))
    assert(LocationDeliveryPolicy.shouldDeliver(elapsed: 150, minimumInterval: 150, thermalLevel: 0))
    assert(LocationDeliveryPolicy.shouldDeliver(elapsed: 370, minimumInterval: 150, thermalLevel: 0))
    // Stationary callbacks obey the same budget instead of bypassing cadence.
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 1, minimumInterval: 150, thermalLevel: 0))
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 0, minimumInterval: 5, thermalLevel: 0))
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: -1, minimumInterval: 5, thermalLevel: 0))
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 4.99, minimumInterval: 5, thermalLevel: 0))
    assert(LocationDeliveryPolicy.shouldDeliver(elapsed: 5, minimumInterval: 5, thermalLevel: 0))
    // Thermal pressure reduces native-to-JS work without adding a GPS timer.
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 15, minimumInterval: 5, thermalLevel: 2))
    assert(LocationDeliveryPolicy.shouldDeliver(elapsed: 30, minimumInterval: 5, thermalLevel: 2))
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 59.99, minimumInterval: 5, thermalLevel: 3))
    assert(LocationDeliveryPolicy.shouldDeliver(elapsed: 60, minimumInterval: 5, thermalLevel: 3))
    assert(!LocationDeliveryPolicy.shouldDeliver(elapsed: 60, minimumInterval: 150, thermalLevel: 3))
    print("LocationDeliveryPolicy: 16 behavior checks passed")
  }
}
