//
//  LanguageService.swift
//  Hither
//
//  Created by Claude on 2025/7/29.
//

import Foundation
import SwiftUI

enum AppLanguage: String, CaseIterable {
    case english = "en"
    case traditionalChinese = "zh-Hant"
    
    var displayName: String {
        switch self {
        case .english:
            return "English"
        case .traditionalChinese:
            return "繁體中文"
        }
    }
    
    var localizedDisplayName: String {
        switch self {
        case .english:
            return NSLocalizedString("English", comment: "")
        case .traditionalChinese:
            return NSLocalizedString("繁體中文", comment: "")
        }
    }
}

class LanguageService: ObservableObject {
    @Published var currentLanguage: AppLanguage = .english
    
    private let languageKey = "AppLanguage"
    
    init() {
        loadSavedLanguage()
    }
    
    func setLanguage(_ language: AppLanguage) {
        currentLanguage = language
        UserDefaults.standard.set(language.rawValue, forKey: languageKey)
        
        // Update app language
        UserDefaults.standard.set([language.rawValue], forKey: "AppleLanguages")
        UserDefaults.standard.synchronize()
        
        // Notify the app to refresh
        objectWillChange.send()
    }
    
    private func loadSavedLanguage() {
        if let languageCode = UserDefaults.standard.string(forKey: languageKey),
           let language = AppLanguage(rawValue: languageCode) {
            currentLanguage = language
        }
    }
}

// Extension to make localization easier
extension String {
    var localized: String {
        // Get the current language from the shared LanguageService
        let languageCode = UserDefaults.standard.string(forKey: "AppLanguage") ?? "en"
        
        // Load the appropriate bundle
        guard let path = Bundle.main.path(forResource: languageCode, ofType: "lproj"),
              let bundle = Bundle(path: path) else {
            // Fallback to main bundle if specific language bundle not found
            return NSLocalizedString(self, comment: "")
        }
        
        return NSLocalizedString(self, bundle: bundle, comment: "")
    }
    
    func localized(with arguments: CVarArg...) -> String {
        let localizedFormat = self.localized
        return String(format: localizedFormat, arguments: arguments)
    }
}