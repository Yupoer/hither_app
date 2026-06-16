//
//  Command.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import Foundation

enum CommandType: String, CaseIterable, Codable {
    // Leader commands
    case gather = "gather"
    case depart = "depart"
    case rest = "rest"
    case beCareful = "be_careful"
    case goLeft = "go_left"
    case goRight = "go_right"
    case stop = "stop"
    case hurryUp = "hurry_up"
    case custom = "custom"
    
    // Follower request commands
    case needRestroom = "need_restroom"
    case needBreak = "need_break"
    case needHelp = "need_help"
    case foundSomething = "found_something"
    
    var displayName: String {
        switch self {
        case .gather: return "command_gather".localized
        case .depart: return "command_depart".localized
        case .rest: return "command_rest".localized
        case .beCareful: return "command_be_careful".localized
        case .goLeft: return "command_go_left".localized
        case .goRight: return "command_go_right".localized
        case .stop: return "command_stop".localized
        case .hurryUp: return "command_hurry_up".localized
        case .custom: return "command_custom".localized
        case .needRestroom: return "command_need_restroom".localized
        case .needBreak: return "command_need_break".localized
        case .needHelp: return "command_need_help".localized
        case .foundSomething: return "command_found_something".localized
        }
    }
    
    var icon: String {
        switch self {
        case .gather: return "person.2.circle"
        case .depart: return "arrow.forward.circle"
        case .rest: return "pause.circle"
        case .beCareful: return "exclamationmark.triangle"
        case .goLeft: return "arrow.left.circle"
        case .goRight: return "arrow.right.circle"
        case .stop: return "stop.circle"
        case .hurryUp: return "forward.circle"
        case .custom: return "text.bubble"
        case .needRestroom: return "figure.walk.diamond"
        case .needBreak: return "hand.raised"
        case .needHelp: return "exclamationmark.circle"
        case .foundSomething: return "eye.circle"
        }
    }
    
    var defaultMessage: String {
        switch self {
        case .gather: return "message_gather".localized
        case .depart: return "message_depart".localized
        case .rest: return "message_rest".localized
        case .beCareful: return "message_be_careful".localized
        case .goLeft: return "message_go_left".localized
        case .goRight: return "message_go_right".localized
        case .stop: return "message_stop".localized
        case .hurryUp: return "message_hurry_up".localized
        case .custom: return ""
        case .needRestroom: return "message_need_restroom".localized
        case .needBreak: return "message_need_break".localized
        case .needHelp: return "message_need_help".localized
        case .foundSomething: return "message_found_something".localized
        }
    }
    
    var isLeaderCommand: Bool {
        switch self {
        case .gather, .depart, .rest, .beCareful, .goLeft, .goRight, .stop, .hurryUp, .custom:
            return true
        case .needRestroom, .needBreak, .needHelp, .foundSomething:
            return false
        }
    }
    
    var isFollowerRequest: Bool {
        return !isLeaderCommand
    }
    
    static var leaderCommands: [CommandType] {
        return allCases.filter { $0.isLeaderCommand }
    }
    
    static var followerRequests: [CommandType] {
        return allCases.filter { $0.isFollowerRequest }
    }
}

struct GroupCommand: Identifiable, Codable {
    let id: String
    let groupId: String
    let senderId: String
    let senderName: String
    let type: CommandType
    let message: String
    let timestamp: Date
    let location: GeoPoint?
    
    init(groupId: String, senderId: String, senderName: String, type: CommandType, message: String? = nil, location: GeoPoint? = nil) {
        self.id = UUID().uuidString
        self.groupId = groupId
        self.senderId = senderId
        self.senderName = senderName
        self.type = type
        self.message = message ?? type.defaultMessage
        self.timestamp = Date()
        self.location = location
    }
    
    init(id: String, groupId: String, senderId: String, senderName: String, type: CommandType, message: String, timestamp: Date, location: GeoPoint? = nil) {
        self.id = id
        self.groupId = groupId
        self.senderId = senderId
        self.senderName = senderName
        self.type = type
        self.message = message
        self.timestamp = timestamp
        self.location = location
    }
}

struct CommandNotification: Codable {
    let commandId: String
    let groupId: String
    let groupName: String
    let senderName: String
    let message: String
    let type: CommandType
    let timestamp: Date
}