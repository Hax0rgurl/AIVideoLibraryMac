// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "SoraLibraryMac",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "SoraLibrary", targets: ["SoraLibraryApp"])
    ],
    targets: [
        .executableTarget(
            name: "SoraLibraryApp",
            resources: [
                .process("Resources")
            ]
        )
    ]
)
