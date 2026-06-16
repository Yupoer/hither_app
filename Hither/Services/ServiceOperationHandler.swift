//
//  ServiceOperationHandler.swift
//  Hither
//
//  Service operation consolidation utility for consistent error handling,
//  loading states, and logging across all services.
//

import Foundation
import FirebaseFirestore

/// Consolidates common service operation patterns across all services
/// to reduce duplicate code while maintaining exact functionality
@MainActor
final class ServiceOperationHandler {
    
    // MARK: - Performance Monitoring
    private static var performanceMetrics: [String: (totalTime: TimeInterval, queryCount: Int, callCount: Int)] = [:]
    private static let performanceQueue = DispatchQueue(label: "com.hither.performance", qos: .utility)
    
    /// Records performance metrics for operations
    private static func recordPerformance(operationName: String, duration: TimeInterval, queryCount: Int = 1) {
        performanceQueue.async {
            if var existing = performanceMetrics[operationName] {
                existing.totalTime += duration
                existing.queryCount += queryCount
                existing.callCount += 1
                performanceMetrics[operationName] = existing
            } else {
                performanceMetrics[operationName] = (duration, queryCount, 1)
            }
            
            // Log performance warnings for slow operations
            if duration > 3.0 {
                LocalizedLogger.warning("PERFORMANCE: \(operationName) took \(String(format: "%.2f", duration))s (\(queryCount) queries)")
            }
        }
    }
    
    /// Gets performance metrics for debugging
    static func getPerformanceMetrics() -> [String: (avgTime: TimeInterval, totalQueries: Int, callCount: Int)] {
        return performanceQueue.sync {
            return performanceMetrics.mapValues { metrics in
                (avgTime: metrics.totalTime / Double(metrics.callCount), 
                 totalQueries: metrics.queryCount, 
                 callCount: metrics.callCount)
            }
        }
    }
    
    /// Clears performance metrics
    static func clearPerformanceMetrics() {
        performanceQueue.async {
            performanceMetrics.removeAll()
        }
    }
    
    /// Executes an async operation with standardized loading state management,
    /// error handling, logging patterns, and performance monitoring
    static func executeOperation<T>(
        loadingBinding: @escaping (Bool) -> Void,
        errorBinding: @escaping (String?) -> Void,
        operationName: String,
        queryCount: Int = 1,
        operation: () async throws -> T
    ) async -> T? {
        loadingBinding(true)
        errorBinding(nil)
        
        let startTime = CFAbsoluteTimeGetCurrent()
        
        do {
            let result = try await operation()
            let duration = CFAbsoluteTimeGetCurrent() - startTime
            
            // Record performance metrics
            recordPerformance(operationName: operationName, duration: duration, queryCount: queryCount)
            
            loadingBinding(false)
            return result
        } catch {
            let duration = CFAbsoluteTimeGetCurrent() - startTime
            let errorMsg = "Failed to \(operationName): \(error.localizedDescription)"
            
            // Record failed operation metrics
            recordPerformance(operationName: "\(operationName)_failed", duration: duration, queryCount: queryCount)
            
            errorBinding(errorMsg)
            LocalizedLogger.error(errorMsg)
            loadingBinding(false)
            return nil
        }
    }
    
    /// Executes an async operation without return value, maintaining the same
    /// standardized patterns used across services with performance monitoring
    static func executeVoidOperation(
        loadingBinding: @escaping (Bool) -> Void,
        errorBinding: @escaping (String?) -> Void,
        operationName: String,
        queryCount: Int = 1,
        operation: () async throws -> Void
    ) async -> Bool {
        loadingBinding(true)
        errorBinding(nil)
        
        let startTime = CFAbsoluteTimeGetCurrent()
        
        do {
            try await operation()
            let duration = CFAbsoluteTimeGetCurrent() - startTime
            
            // Record performance metrics
            recordPerformance(operationName: operationName, duration: duration, queryCount: queryCount)
            
            loadingBinding(false)
            return true
        } catch {
            let duration = CFAbsoluteTimeGetCurrent() - startTime
            let errorMsg = "Failed to \(operationName): \(error.localizedDescription)"
            
            // Record failed operation metrics
            recordPerformance(operationName: "\(operationName)_failed", duration: duration, queryCount: queryCount)
            
            errorBinding(errorMsg)
            LocalizedLogger.error(errorMsg)
            loadingBinding(false)
            return false
        }
    }
    
    /// Simple error logging and message setting without loading state management
    /// for operations that handle loading state differently
    static func handleError(
        _ error: Error,
        operationName: String,
        errorBinding: @escaping (String?) -> Void
    ) {
        let errorMsg = "Failed to \(operationName): \(error.localizedDescription)"
        errorBinding(errorMsg)
        LocalizedLogger.error(errorMsg)
    }
}