import SwiftUI

/// design/ 프로토타입의 색과 모양 (노선 색, 확률 3단계 색, 흰 카드 + 회색 배경)
enum Theme {
    static func route(_ route: Route?) -> Color {
        route == .m5107 ? Color(hex: 0xB4123C) : Color(hex: 0xE5332A)
    }

    static func routeSoft(_ route: Route?) -> Color {
        route == .m5107 ? Color(hex: 0xF8E6EB) : Color(hex: 0xFDECEB)
    }

    /// 70% 이상 / 40–69% / 40% 미만
    static func fill(_ p: Double) -> Color {
        p >= 0.7 ? Color(hex: 0x1F5FBF) : p >= 0.4 ? Color(hex: 0x7FA6DD) : Color(hex: 0xF0A04B)
    }

    static func text(_ p: Double) -> Color {
        p >= 0.7 ? Color(hex: 0x1F5FBF) : p >= 0.4 ? Color(hex: 0x4A6FA5) : Color(hex: 0xB4570A)
    }

    static func tint(_ p: Double) -> Color {
        p >= 0.7 ? Color(hex: 0xEAF1FB) : p >= 0.4 ? Color(hex: 0xEEF2F8) : Color(hex: 0xFDF1E4)
    }

    /// 고속도로 구간 (정류장 목록·노선도·지도)
    static let highway = Color(hex: 0x9A9AA0)
    static let highwayText = Color(hex: 0x6E6E73)

    /// 잔여석 색: 0석 빨강, 1–9석 주황, 10–19석 연한 파랑, 20석 이상 파랑
    static func seats(_ seats: Double) -> Color {
        switch seats {
        case ..<0.5: Color(hex: 0xD93025)
        case ..<10: Color(hex: 0xF0A04B)
        case ..<20: Color(hex: 0x7FA6DD)
        default: Color(hex: 0x1F5FBF)
        }
    }

    /// 잔여석 글자색 (0석 빨강, 1–9석 진한 주황, 그 밖은 기본)
    static func seatText(_ seats: Int) -> Color {
        switch seats {
        case ..<1: Color(hex: 0xD93025)
        case ..<10: Color(hex: 0xB4570A)
        default: .primary
        }
    }

    static let accent = Color(hex: 0x1F5FBF)
    static let live = Color(hex: 0x34C759)
    static let hairline = Color(.separator)
    static let background = Color(.systemGroupedBackground)
    static let card = Color(.secondarySystemGroupedBackground)
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

extension View {
    func card() -> some View { modifier(CardStyle()) }
}

/// 노선 번호 + 종류 뱃지
struct RouteBadge: View {
    let route: Route
    var size: CGFloat = 26

    var body: some View {
        HStack(spacing: 8) {
            Text(route.rawValue)
                .font(.system(size: size, weight: .heavy))
                .tracking(-0.4)
            Text(route.kind)
                .font(.system(size: 11, weight: .bold))
                .padding(.horizontal, 7).padding(.vertical, 3)
                .foregroundStyle(Theme.route(route))
                .background(Theme.routeSoft(route), in: RoundedRectangle(cornerRadius: 6))
        }
    }
}

/// 확률 범례 (프로토타입 하단과 같다)
struct ProbabilityLegend: View {
    var title = "확률"

    var body: some View {
        HStack(spacing: 10) {
            Text(title).fontWeight(.semibold)
            item(0.8, "70% 이상")
            item(0.5, "40–69%")
            item(0.2, "40% 미만")
        }
        .font(.system(size: 11))
        .foregroundStyle(.secondary)
    }

    private func item(_ p: Double, _ label: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(Theme.fill(p)).frame(width: 9, height: 9)
            Text(label)
        }
    }
}

struct LiveDot: View {
    let label: String
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(Theme.live).frame(width: 7, height: 7)
            Text(label)
        }
        .font(.system(size: 12))
        .foregroundStyle(.secondary)
    }
}
