// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "VideoLibraryMac",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "VideoLibrary", targets: ["VideoLibraryApp"])
    ],
    targets: [
        .executableTarget(
            name: "VideoLibraryApp",
            path: "Sources/VideoLibraryApp",
            resources: [
                .process("Resources")
            ]
        )
    ]
)
