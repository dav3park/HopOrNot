import SwiftUI

/// 화면들이 쓰는 색 이름. 값은 Brand 에서 온다 (노선 색, 확률 색, 잔여석 색).
enum Theme {
    static func route(_ route: Route?) -> Color {
        route == .m5107 ? Color(hex: 0xB4123C) : Brand.red
    }

    static func routeSoft(_ route: Route?) -> Color {
        route == .m5107 ? Color(hex: 0xF8E6EB) : Color(hex: 0xFDECEB)
    }

    /// 70% 이상 / 40–69% / 40% 미만
    static func fill(_ p: Double) -> Color {
        p >= 0.7 ? Color(hex: 0x1F5FBF) : p >= 0.4 ? Color(hex: 0x7FA6DD) : Color(hex: 0xF0A04B)
    }

    static func text(_ p: Double) -> Color { Brand.probability(p) }

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
        default: Brand.ink
        }
    }

    static let accent = Color(hex: 0x1F5FBF)
    static let live = Color(hex: 0x2FB86B)
    static let hairline = Brand.line
    static let background = Brand.paper
    static let card = Brand.card
}

/// 노선 번호(DIN) + 종류 뱃지
struct RouteBadge: View {
    let route: Route
    var size: CGFloat = 26

    var body: some View {
        HStack(spacing: 8) {
            Text(route.rawValue)
                .font(Brand.number(size))
                .foregroundStyle(Brand.ink)
            Text(route.kind)
                .font(Brand.body(11, .heavy))
                .padding(.horizontal, 7).padding(.vertical, 3)
                .foregroundStyle(.white)
                .background(Theme.route(route), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
    }
}

/// 확률 범례
struct ProbabilityLegend: View {
    var title = "확률"

    var body: some View {
        HStack(spacing: 10) {
            Text(title).fontWeight(.semibold)
            item(0.8, "70% 이상")
            item(0.5, "40–69%")
            item(0.2, "40% 미만")
        }
        .font(Brand.body(11))
        .foregroundStyle(Brand.inkSoft)
    }

    private func item(_ p: Double, _ label: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(Theme.fill(p)).frame(width: 9, height: 9)
            Text(label)
        }
    }
}

/// 실시간 점 + 글자
struct LiveDot: View {
    let label: String
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(Theme.live).frame(width: 7, height: 7)
            Text(label)
        }
        .font(Brand.body(12, .medium))
        .foregroundStyle(Brand.inkSoft)
    }
}
