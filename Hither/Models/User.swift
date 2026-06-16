//
//  User.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import Foundation
import FirebaseAuth

struct HitherUser: Identifiable, Codable, Equatable {
    let id: String
    let email: String?
    let displayName: String
    let photoURL: String?
    
    init(from firebaseUser: FirebaseAuth.User) {
        self.id = firebaseUser.uid
        self.email = firebaseUser.email
        // Use email prefix as fallback if no display name
        let emailName = firebaseUser.email?.components(separatedBy: "@").first ?? "User"
        self.displayName = firebaseUser.displayName ?? emailName
        self.photoURL = firebaseUser.photoURL?.absoluteString
    }
    
    init(id: String, email: String?, displayName: String, photoURL: String? = nil) {
        self.id = id
        self.email = email
        self.displayName = displayName
        self.photoURL = photoURL
    }
}
