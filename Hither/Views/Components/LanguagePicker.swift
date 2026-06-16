//
//  LanguagePicker.swift
//  Hither
//
//  Created by Claude on 2025/7/29.
//

import SwiftUI

struct LanguagePicker: View {
    @ObservedObject var languageService: LanguageService
    @State private var showingLanguageSheet = false
    
    var body: some View {
        Button(action: {
            showingLanguageSheet = true
        }) {
            Image(systemName: "globe")
                .font(.title2)
                .foregroundColor(.blue)
        }
        .actionSheet(isPresented: $showingLanguageSheet) {
            ActionSheet(
                title: Text("language".localized),
                buttons: languageButtons + [.cancel()]
            )
        }
    }
    
    private var languageButtons: [ActionSheet.Button] {
        AppLanguage.allCases.map { language in
            .default(Text(language.displayName)) {
                languageService.setLanguage(language)
            }
        }
    }
}

struct LanguagePickerCompact: View {
    @ObservedObject var languageService: LanguageService
    @State private var showingLanguageSheet = false
    
    var body: some View {
        Button(action: {
            showingLanguageSheet = true
        }) {
            HStack(spacing: 4) {
                Image(systemName: "globe")
                    .font(.caption)
                Text(languageService.currentLanguage.displayName)
                    .font(.caption)
            }
            .foregroundColor(.blue)
        }
        .actionSheet(isPresented: $showingLanguageSheet) {
            ActionSheet(
                title: Text("language".localized),
                buttons: languageButtons + [.cancel()]
            )
        }
    }
    
    private var languageButtons: [ActionSheet.Button] {
        AppLanguage.allCases.map { language in
            .default(Text(language.displayName)) {
                languageService.setLanguage(language)
            }
        }
    }
}