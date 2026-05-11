import Foundation
import Capacitor
import HealthKit

@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin {
    private let healthStore = HKHealthStore()

    private var readTypes: Set<HKObjectType> {
        guard HKHealthStore.isHealthDataAvailable() else { return [] }
        var types = Set<HKObjectType>()
        if let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) {
            types.insert(stepType)
        }
        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            types.insert(sleepType)
        }
        types.insert(HKObjectType.workoutType())
        return types
    }

    @objc public override func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve()
            return
        }
        healthStore.requestAuthorization(toShare: nil, read: readTypes) { _, _ in
            call.resolve()
        }
    }

    @objc func syncActivity(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["steps": [], "workouts": [], "sleep": []])
            return
        }

        let group = DispatchGroup()
        var stepsResult: [[String: Any]] = []
        var workoutsResult: [[String: Any]] = []
        var sleepResult: [[String: Any]] = []

        group.enter()
        readDailySteps { data in stepsResult = data; group.leave() }

        group.enter()
        readRecentWorkouts { data in workoutsResult = data; group.leave() }

        group.enter()
        readRecentSleep { data in sleepResult = data; group.leave() }

        group.notify(queue: .main) {
            call.resolve(["steps": stepsResult, "workouts": workoutsResult, "sleep": sleepResult])
        }
    }

    private func readDailySteps(completion: @escaping ([[String: Any]]) -> Void) {
        guard let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) else {
            completion([]); return
        }
        let calendar = Calendar.current
        let now = Date()
        let startDate = calendar.date(byAdding: .day, value: -7, to: calendar.startOfDay(for: now))!
        let query = HKStatisticsCollectionQuery(
            quantityType: stepType,
            quantitySamplePredicate: HKQuery.predicateForSamples(withStart: startDate, end: now),
            options: .cumulativeSum,
            anchorDate: calendar.startOfDay(for: now),
            intervalComponents: DateComponents(day: 1)
        )
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone.current

        query.initialResultsHandler = { _, results, error in
            guard let results = results, error == nil else { completion([]); return }
            var stepData: [[String: Any]] = []
            results.enumerateStatistics(from: startDate, to: now) { statistics, _ in
                let steps = Int(statistics.sumQuantity()?.doubleValue(for: .count()) ?? 0)
                if steps > 0 {
                    stepData.append(["date": formatter.string(from: statistics.startDate), "steps": steps])
                }
            }
            completion(stepData)
        }
        healthStore.execute(query)
    }

    private func readRecentWorkouts(completion: @escaping ([[String: Any]]) -> Void) {
        let startDate = Calendar.current.date(byAdding: .day, value: -30, to: Date())!
        let query = HKSampleQuery(
            sampleType: HKObjectType.workoutType(),
            predicate: HKQuery.predicateForSamples(withStart: startDate, end: Date()),
            limit: 20,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]
        ) { _, samples, error in
            guard let workouts = samples as? [HKWorkout], error == nil else { completion([]); return }
            let data: [[String: Any]] = workouts.map { workout in
                var entry: [String: Any] = [
                    "startTs": workout.startDate.timeIntervalSince1970 * 1000,
                    "endTs": workout.endDate.timeIntervalSince1970 * 1000,
                    "durationMin": Int(workout.duration / 60),
                    "type": workout.workoutActivityType.simpleName,
                ]
                if let kcal = workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()), kcal > 0 {
                    entry["activeCalories"] = Int(kcal)
                }
                return entry
            }
            completion(data)
        }
        healthStore.execute(query)
    }

    private func readRecentSleep(completion: @escaping ([[String: Any]]) -> Void) {
        guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            completion([]); return
        }
        // Read 8 days so we have full context for 7 nights (sleep spans midnight)
        let startDate = Calendar.current.date(byAdding: .day, value: -8, to: Date())!
        let query = HKSampleQuery(
            sampleType: sleepType,
            predicate: HKQuery.predicateForSamples(withStart: startDate, end: Date()),
            limit: HKObjectQueryNoLimit,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
        ) { _, samples, error in
            guard let sleepSamples = samples as? [HKCategorySample], error == nil else {
                completion([]); return
            }

            // Keep only actual sleep — exclude inBed (0) and awake (2, iOS 16+)
            let actualSleep = sleepSamples.filter { sample in
                if sample.value == HKCategoryValueSleepAnalysis.inBed.rawValue { return false }
                if #available(iOS 16.0, *) {
                    if sample.value == HKCategoryValueSleepAnalysis.awake.rawValue { return false }
                }
                return true
            }

            // Group intervals by wake-up date, then merge overlapping to avoid double-counting
            // (iPhone + Watch can both record sleep for the same window)
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            formatter.timeZone = TimeZone.current

            var intervalsByDate: [String: [(Date, Date)]] = [:]
            for sample in actualSleep {
                let dateKey = formatter.string(from: sample.endDate)
                intervalsByDate[dateKey, default: []].append((sample.startDate, sample.endDate))
            }

            let result: [[String: Any]] = intervalsByDate.compactMap { date, intervals in
                let hours = self.mergedHours(intervals)
                guard hours > 0 else { return nil }
                return ["date": date, "hours": (hours * 10).rounded() / 10]
            }
            completion(result)
        }
        healthStore.execute(query)
    }

    // Merge overlapping intervals and return total duration in hours
    private func mergedHours(_ intervals: [(Date, Date)]) -> Double {
        let sorted = intervals.sorted { $0.0 < $1.0 }
        var total = 0.0
        var curStart: Date? = nil
        var curEnd: Date? = nil
        for (start, end) in sorted {
            if let cs = curStart, let ce = curEnd {
                if start <= ce {
                    curEnd = max(ce, end)
                } else {
                    total += ce.timeIntervalSince(cs)
                    curStart = start; curEnd = end
                }
            } else {
                curStart = start; curEnd = end
            }
        }
        if let cs = curStart, let ce = curEnd { total += ce.timeIntervalSince(cs) }
        return min(total / 3600, 12) // cap at 12h to guard against bad data
    }
}

extension HKWorkoutActivityType {
    var simpleName: String {
        switch self {
        case .running: return "running"
        case .cycling: return "cycling"
        case .walking: return "walking"
        case .swimming: return "swimming"
        case .yoga: return "yoga"
        case .functionalStrengthTraining, .traditionalStrengthTraining: return "strength"
        case .highIntensityIntervalTraining: return "hiit"
        case .soccer, .basketball, .tennis, .volleyball, .baseball: return "sport"
        case .hiking: return "hiking"
        case .elliptical: return "elliptical"
        case .rowing: return "rowing"
        case .pilates: return "pilates"
        case .crossTraining: return "cross_training"
        default: return "workout"
        }
    }
}
