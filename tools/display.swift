// Reads and configures external displays. Used to force the TV into its highest
// native refresh rate and to break the mirroring macOS re-enables on every replug.

import CoreGraphics
import Foundation

func onlineDisplays() -> [CGDirectDisplayID] {
    var count: UInt32 = 0
    CGGetOnlineDisplayList(0, nil, &count)
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    CGGetOnlineDisplayList(count, &ids, &count)
    return ids
}

func externalDisplay() -> CGDirectDisplayID? {
    onlineDisplays().first { CGDisplayIsBuiltin($0) == 0 }
}

func modes(_ id: CGDirectDisplayID) -> [CGDisplayMode] {
    let opts = [kCGDisplayShowDuplicateLowResolutionModes as String: true] as CFDictionary
    return (CGDisplayCopyAllDisplayModes(id, opts) as? [CGDisplayMode]) ?? []
}

func describe(_ m: CGDisplayMode) -> [String: Any] {
    [
        "width": m.pixelWidth,
        "height": m.pixelHeight,
        "refresh": m.refreshRate,
        "hidpi": m.pixelWidth != m.width
    ]
}

func emit(_ obj: Any) {
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted])
    print(String(data: data, encoding: .utf8)!)
}

let args = CommandLine.arguments
let command = args.count > 1 ? args[1] : "info"

guard let tv = externalDisplay() else {
    emit(["ok": false, "error": "no-external-display"])
    exit(2)
}

let bounds = CGDisplayBounds(tv)
let mirrored = CGDisplayIsInMirrorSet(tv) != 0 && CGDisplayMirrorsDisplay(tv) != kCGNullDirectDisplay

switch command {

case "info":
    let current = CGDisplayCopyDisplayMode(tv)
    emit([
        "ok": true,
        "id": tv,
        "mirrored": mirrored,
        "bounds": ["x": bounds.origin.x, "y": bounds.origin.y, "w": bounds.width, "h": bounds.height],
        "current": current.map(describe) ?? [:],
        "modes": modes(tv).map(describe)
    ])

case "apply":
    let wantWidth = args.count > 2 ? Int(args[2]) ?? 1920 : 1920
    let wantHeight = args.count > 3 ? Int(args[3]) ?? 1080 : 1080
    let maxRefresh = args.count > 4 ? Double(args[4]) ?? 240 : 240

    let candidates = modes(tv)
        .filter { $0.pixelWidth == wantWidth && $0.pixelHeight == wantHeight }
        .filter { $0.pixelWidth == $0.width }
        .filter { $0.refreshRate <= maxRefresh }
        .sorted { $0.refreshRate > $1.refreshRate }

    guard let target = candidates.first else {
        emit(["ok": false, "error": "no-native-mode", "requested": "\(wantWidth)x\(wantHeight)"])
        exit(3)
    }

    var config: CGDisplayConfigRef?
    CGBeginDisplayConfiguration(&config)
    if mirrored {
        CGConfigureDisplayMirrorOfDisplay(config, tv, kCGNullDirectDisplay)
    }
    CGConfigureDisplayWithDisplayMode(config, tv, target, nil)
    let err = CGCompleteDisplayConfiguration(config, .permanently)

    let after = CGDisplayBounds(tv)
    emit([
        "ok": err == .success,
        "error": err == .success ? "" : "cgerror-\(err.rawValue)",
        "unmirrored": mirrored,
        "applied": describe(target),
        "bounds": ["x": after.origin.x, "y": after.origin.y, "w": after.width, "h": after.height]
    ])
    if err != .success { exit(4) }

default:
    emit(["ok": false, "error": "unknown-command"])
    exit(1)
}
