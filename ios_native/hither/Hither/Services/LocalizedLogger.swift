//
//  LocalizedLogger.swift
//  Hither
//
//  Created by Claude on 2025/8/9.
//

import Foundation
import os.log

/// Unified logging service that provides structured logging with different log levels
struct LocalizedLogger {
    
    /// Log levels for categorizing different types of messages
    enum LogLevel: String, CaseIterable {
        case debug = "DEBUG"
        case info = "INFO"
        case warning = "WARNING"
        case error = "ERROR"
    }
    
    /// Private logger instance using os.log for better performance
    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.hither.app", category: "HitherApp")
    
    /// Date formatter for consistent timestamp formatting
    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        formatter.locale = Locale.current
        return formatter
    }()
    
    // MARK: - Unified Logging Methods
    
    /// Log debug messages (only in DEBUG builds, using os.log only)
    /// - Parameters:
    ///   - message: The debug message
    ///   - module: The module/class name (optional)
    static func debug(_ message: String, module: String = #file) {
        #if DEBUG
        let moduleName = extractModuleName(from: module)
        let timestamp = dateFormatter.string(from: Date())
        let logMessage = "[\(timestamp)] [\(LogLevel.debug.rawValue)] [\(moduleName)] \(message)"
        logger.debug("\(logMessage, privacy: .public)")
        #endif
    }
    
    /// Log informational messages (using os.log only)
    /// - Parameters:
    ///   - message: The informational message
    ///   - module: The module/class name (optional)
    static func info(_ message: String, module: String = #file) {
        #if DEBUG
        let moduleName = extractModuleName(from: module)
        let timestamp = dateFormatter.string(from: Date())
        let logMessage = "[\(timestamp)] [\(LogLevel.info.rawValue)] [\(moduleName)] \(message)"
        logger.info("\(logMessage, privacy: .public)")
        #else
        let moduleName = extractModuleName(from: module)
        logger.info("[\(moduleName)] \(message, privacy: .public)")
        #endif
    }
    
    /// Log warning messages (using os.log only)
    /// - Parameters:
    ///   - message: The warning message
    ///   - module: The module/class name (optional)
    static func warning(_ message: String, module: String = #file) {
        let moduleName = extractModuleName(from: module)
        let timestamp = dateFormatter.string(from: Date())
        let logMessage = "[\(timestamp)] [\(LogLevel.warning.rawValue)] [\(moduleName)] \(message)"
        logger.warning("\(logMessage, privacy: .public)")
    }
    
    /// Log error messages (using os.log only)
    /// - Parameters:
    ///   - message: The error message
    ///   - module: The module/class name (optional)
    static func error(_ message: String, module: String = #file) {
        let moduleName = extractModuleName(from: module)
        let timestamp = dateFormatter.string(from: Date())
        let logMessage = "[\(timestamp)] [\(LogLevel.error.rawValue)] [\(moduleName)] \(message)"
        logger.error("\(logMessage, privacy: .public)")
    }
    
    /// Extract module name from file path
    /// - Parameter filePath: The file path from #file
    /// - Returns: Clean module name
    private static func extractModuleName(from filePath: String) -> String {
        let fileName = (filePath as NSString).lastPathComponent
        return (fileName as NSString).deletingPathExtension
    }
    
    // MARK: - Legacy Localized Logging (maintained for backward compatibility)
    
    static func log(_ key: String, _ args: CVarArg...) {
#if DEBUG
        let localizedMessage = NSLocalizedString(key, comment: "")
        let formattedMessage = String(format: localizedMessage, arguments: args)
        info(formattedMessage)
#endif
    }
    
    // MARK: - Specific Logging Methods for Common Scenarios
    
    static func logFoundCurrentWaypoint(_ name: String, inProgress: Bool) {
        log("console_found_current_waypoint", name, inProgress ? "true" : "false")
    }
    
    static func logStartedMonitoring(_ destination: String) {
        log("console_started_monitoring", destination)
    }
    
    static func logDistanceToDestination(_ destination: String, distance: Double) {
        log("console_distance_to_destination", destination, distance)
    }
    
    static func logNoLiveActivityToStop() {
        log("console_no_live_activity_to_stop")
    }
    
    static func logStoppedMonitoring() {
        log("console_stopped_monitoring")
    }
    
    static func logItineraryUpdated(action: String, waypoint: String, updatedBy: String) {
        log("console_itinerary_updated", action, waypoint, updatedBy)
    }
    
    static func logLiveActivitiesNotEnabled() {
        log("console_live_activities_not_enabled")
    }
    
    static func logSkippingSimulator() {
        log("console_skipping_simulator")
    }
    
    static func logLiveActivityWouldShow(_ groupName: String, memberCount: Int) {
        log("console_live_activity_would_show", groupName, memberCount)
    }
    
    static func logStartingLiveActivity(_ groupName: String) {
        log("console_starting_live_activity", groupName)
    }
    
    static func logSuccessfullyStarted(_ groupName: String) {
        log("console_successfully_started", groupName)
    }
    
    static func logActivityId(_ activityId: String) {
        log("console_activity_id", activityId)
    }
    
    static func logLiveActivityError(_ error: String) {
        log("console_live_activity_error", error)
    }
    
    static func logSuccessfullyStopped() {
        log("console_successfully_stopped")
    }
    
    static func logStopError(_ error: String) {
        log("console_stop_error", error)
    }
    
    static func logLocationUpdate(distance: Double) {
        log("console_location_update", distance)
    }
    
    static func logUpdateError(_ error: String) {
        log("console_update_error", error)
    }
    
    static func logPermissionCheck() {
        log("console_permission_check")
    }
    
    static func logActivitiesEnabled(_ enabled: Bool) {
        log("console_activities_enabled", enabled ? "true" : "false")
    }
    
    static func logIOSVersion(_ version: String) {
        log("console_ios_version", version)
    }
    
    static func logDeviceModel(_ model: String) {
        log("console_device_model", model)
    }
    
    static func logIsSimulator(_ isSimulator: Bool) {
        log("console_is_simulator", isSimulator ? "true" : "false")
    }
    
    static func logNotSupportedSimulator() {
        log("console_not_supported_simulator")
    }
    
    static func logNotSupportedDisabled() {
        log("console_not_supported_disabled")
    }
    
    static func logSupportedEnabled() {
        log("console_supported_enabled")
    }
}