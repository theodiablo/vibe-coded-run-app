import Foundation
import Capacitor
import HealthKit

// The iOS mirror of the Android WatchImportPlugin + the pianissimo Health
// Connect HR reads, folded into one local plugin (HealthKit serves both roles):
//   - readHeartRate: continuous HR samples over a time window (post-run HR for
//     a phone-tracked run — src/hr/healthkit.ts fetchRange).
//   - readWorkouts: finished workouts with distance/duration/elevation/HR
//     aggregates (watch run import — src/healthkit/import.ts).
// Everything returned is RAW (metres, seconds, activity-type raw values, ISO
// instants) so all interpretation lives in the pure, unit-tested TS mapping
// layer (src/healthkit/mapping.ts), exactly like WatchSessionRaw.
//
// Authorization gotcha (differs from Health Connect): HealthKit deliberately
// never reveals READ authorization status — authorizationStatus() only covers
// writes, and there is no trustworthy "is read granted?" probe. So this plugin
// exposes no checkPermissions: requestPermissions resolves granted:true when
// the request flow completes (re-invoking it is a no-op once decided), and an
// empty read result means "no data", never "revoked". The TS side keeps a local
// auth marker set after the request flow and clears it only on
// checkAvailability = NotSupported — see hasHealthKitAuthorization.
@objc(HealthKitBridgePlugin)
public class HealthKitBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitBridgePlugin"
    public let jsName = "HealthKitBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkAvailability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readHeartRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readWorkouts", returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()
    private let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    private let bpmUnit = HKUnit.count().unitDivided(by: .minute())

    // Accept ISO instants with or without fractional seconds (the TS side sends
    // Date.toISOString(), which has them).
    private func parseIso(_ value: String?) -> Date? {
        guard let value = value else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: value) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: value)
    }

    private func isoString(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }

    private func window(_ call: CAPPluginCall) -> (Date, Date)? {
        guard let start = parseIso(call.getString("startTime")),
              let end = parseIso(call.getString("endTime")),
              end > start else { return nil }
        return (start, end)
    }

    @objc func checkAvailability(_ call: CAPPluginCall) {
        call.resolve(["availability": HKHealthStore.isHealthDataAvailable() ? "Available" : "NotSupported"])
    }

    // CAPPlugin itself declares requestPermissions(_:), so this is an override
    // (public, to match the superclass's accessibility).
    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false])
            return
        }
        let readTypes: Set<HKObjectType> = [
            heartRateType,
            HKObjectType.workoutType(),
            HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!,
        ]
        // Read-only: toShare is nil, matching the Info.plist promise that we
        // never write to Apple Health.
        store.requestAuthorization(toShare: nil, read: readTypes) { success, _ in
            // `success` means the request flow completed (sheet shown or already
            // decided) — NOT that read access was granted; HealthKit hides that.
            call.resolve(["granted": success])
        }
    }

    // Heart-rate samples in [startTime, endTime] → {samples: [{bpm, t(ms epoch)}]}.
    // A time-window predicate is correct here by design (it mirrors Health
    // Connect fetchRange over the phone-tracked run's own window).
    @objc func readHeartRate(_ call: CAPPluginCall) {
        guard let (start, end) = window(call) else {
            call.reject("startTime/endTime must be ISO instants with endTime > startTime")
            return
        }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
        let query = HKSampleQuery(sampleType: heartRateType, predicate: predicate,
                                  limit: HKObjectQueryNoLimit, sortDescriptors: sort) { _, results, error in
            if let error = error {
                call.reject("HealthKit heart-rate query failed: \(error.localizedDescription)")
                return
            }
            let samples: [[String: Any]] = (results as? [HKQuantitySample] ?? []).map { s in
                [
                    "bpm": s.quantity.doubleValue(for: self.bpmUnit),
                    "t": s.startDate.timeIntervalSince1970 * 1000,
                ]
            }
            call.resolve(["samples": samples])
        }
        store.execute(query)
    }

    // Finished workouts in [startTime, endTime] → {sessions: [...]} with raw
    // aggregates. Distance/duration come off the HKWorkout itself; HR statistics
    // are computed per workout with predicateForObjects(from:) — never a bare
    // time window — so another app's overlapping samples (or a concurrent
    // session) can't contaminate a workout's own numbers. This is the HealthKit
    // equivalent of the Android side's per-dataOrigin aggregate filtering.
    @objc func readWorkouts(_ call: CAPPluginCall) {
        guard let (start, end) = window(call) else {
            call.reject("startTime/endTime must be ISO instants with endTime > startTime")
            return
        }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate,
                                  limit: HKObjectQueryNoLimit, sortDescriptors: sort) { _, results, error in
            if let error = error {
                call.reject("HealthKit workout query failed: \(error.localizedDescription)")
                return
            }
            let workouts = results as? [HKWorkout] ?? []
            var sessions = [[String: Any]](repeating: [:], count: workouts.count)
            let group = DispatchGroup()
            // HKStatisticsQuery result handlers fire on arbitrary background
            // queues; funnel every write to `sessions` through one serial queue
            // so concurrent per-workout callbacks can't race the array.
            let resultQueue = DispatchQueue(label: "run.camboulive.healthkit-bridge.workouts")
            for (i, workout) in workouts.enumerated() {
                var session: [String: Any] = [
                    "id": workout.uuid.uuidString,
                    "sourceBundleId": workout.sourceRevision.source.bundleIdentifier,
                    "sourceName": workout.sourceRevision.source.name,
                    "startTime": self.isoString(workout.startDate),
                    "endTime": self.isoString(workout.endDate),
                    // HKWorkoutActivityType raw value (running=37, walking=52, …);
                    // mapped to a run type in TS so the list stays testable.
                    "activityType": workout.workoutActivityType.rawValue,
                    // workout.duration already excludes pauses — the analogue of
                    // Health Connect's EXERCISE_DURATION_TOTAL.
                    "activeSec": workout.duration,
                ]
                if let distance = workout.totalDistance {
                    session["distanceM"] = distance.doubleValue(for: .meter())
                }
                if let elevation = workout.metadata?[HKMetadataKeyElevationAscended] as? HKQuantity {
                    session["elevationGainM"] = elevation.doubleValue(for: .meter())
                }
                group.enter()
                let hrStats = HKStatisticsQuery(
                    quantityType: self.heartRateType,
                    quantitySamplePredicate: HKQuery.predicateForObjects(from: workout),
                    options: [.discreteAverage, .discreteMax]
                ) { _, stats, _ in
                    resultQueue.async {
                        if let avg = stats?.averageQuantity() {
                            session["hrAvg"] = avg.doubleValue(for: self.bpmUnit)
                        }
                        if let max = stats?.maximumQuantity() {
                            session["hrMax"] = max.doubleValue(for: self.bpmUnit)
                        }
                        sessions[i] = session
                        group.leave()
                    }
                }
                self.store.execute(hrStats)
            }
            group.notify(queue: resultQueue) {
                call.resolve(["sessions": sessions])
            }
        }
        store.execute(query)
    }
}
