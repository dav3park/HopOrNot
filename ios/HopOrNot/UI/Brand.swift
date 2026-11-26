import SwiftUI

/// HopOrNot 디자인 기초: 따뜻한 종이색 바탕, 버스 전광판 같은 검정·호박색(LED), 노선 빨강, 표지판 숫자(DIN).
/// 기본 iOS 모양(회색 묶음 목록, 시스템 파랑, 시스템 상단바)을 쓰지 않고 이 값들로 모든 화면을 그린다.
enum Brand {
    // 바탕과 글자
    static let paper = Color(hex: 0xF4F0E8)
    static let card = Color.white
    static let ink = Color(hex: 0x12151C)
    static let inkSoft = Color(hex: 0x5E6573)
    static let inkFaint = Color(hex: 0x9AA0AB)
    static let line = Color(hex: 0xE3DDD2)
    static let chip = Color(hex: 0xEDE8DE)

    // 전광판 (스플래시, AI 판단 카드)
    static let board = Color(hex: 0x0E1116)
    static let boardRaised = Color(hex: 0x181C24)
    static let boardLine = Color(hex: 0x2A303B)
    static let led = Color(hex: 0xFFB321)
    static let ledDim = Color(hex: 0x2B2615)

    // 노선
    static let red = Color(hex: 0xE5332A)

    // 확률 색 (밝은 바탕용 / 어두운 전광판용)
    static func probability(_ p: Double) -> Color {
        p >= 0.7 ? Color(hex: 0x1F5FBF) : p >= 0.4 ? Color(hex: 0x4A6FA5) : Color(hex: 0xB4570A)
    }

    static func probabilityOnBoard(_ p: Double) -> Color {
        p >= 0.7 ? Color(hex: 0x6CB0FF) : p >= 0.4 ? Color(hex: 0xA9C4EE) : Color(hex: 0xFFB321)
    }

    // 글꼴: 숫자와 로고는 도로 표지판 같은 DIN, 한글은 시스템 글꼴
    static func number(_ size: CGFloat) -> Font { .custom("DINAlternate-Bold", size: size) }
    static func signage(_ size: CGFloat) -> Font { .custom("DINCondensed-Bold", size: size) }
    static func title(_ size: CGFloat) -> Font { .system(size: size, weight: .heavy) }
    static func body(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }

    // 모양
    static let radius: CGFloat = 20
    static let pad: CGFloat = 16
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

/// 흰 카드: 얇은 테두리와 옅은 그림자 (기본 iOS의 회색 묶음 카드가 아니다)
struct CardStyle: ViewModifier {
    var padding: CGFloat = Brand.pad
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Brand.card, in: RoundedRectangle(cornerRadius: Brand.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Brand.radius, style: .continuous).stroke(Brand.line, lineWidth: 1))
            .shadow(color: Brand.ink.opacity(0.05), radius: 10, y: 3)
    }
}

extension View {
    func card(padding: CGFloat = Brand.pad) -> some View { modifier(CardStyle(padding: padding)) }
}

/// 작은 대문자 라벨 (구역 제목)
struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text)
            .font(Brand.signage(15))
            .tracking(1.2)
            .foregroundStyle(Brand.inkSoft)
    }
}
