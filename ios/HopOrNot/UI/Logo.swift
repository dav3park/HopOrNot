import SwiftUI

/// 로고: 버스 옆모습. 창문 하나하나가 좌석이고, 승객 머리가 보이는 창문은 찬 자리, 불이 들어온 호박색 창문이 빈자리다.
/// 앞 위쪽의 호박색 띠는 행선지 전광판이다.
struct BusMark: View {
    var bodyColor: Color = Brand.red
    var windows = 4
    /// 빈자리 창문 (0부터). nil이면 모두 찬 자리
    var freeWindow: Int? = 2
    /// 불이 들어온(승객 또는 빈자리가 보이는) 창문 수. 애니메이션에서 하나씩 늘린다
    var lit: Double = 99
    var showGlow = true

    var body: some View {
        Canvas { ctx, size in
            let s = size.width / 200
            func r(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> CGRect { CGRect(x: x * s, y: y * s, width: w * s, height: h * s) }
            let dark = Color(hex: 0x0E1116)

            // 차체: 앞(오른쪽) 위가 크게 둥글다
            let bodyRect = r(0, 6, 200, 74)
            let bodyPath = Path(roundedRect: bodyRect, cornerRadii: .init(topLeading: 16 * s, bottomLeading: 10 * s, bottomTrailing: 10 * s, topTrailing: 36 * s))
            ctx.fill(bodyPath, with: .color(bodyColor))
            ctx.fill(Path(r(0, 58, 200, 4)), with: .color(.white.opacity(0.28)))   // 띠

            // 행선지 전광판
            ctx.fill(Path(roundedRect: r(158, 10, 34, 8), cornerRadius: 2 * s), with: .color(Brand.led))

            // 창문(좌석)
            let count = max(windows, 1)
            let gap = 5.0, bandX = 12.0, bandW = 138.0
            let w = (bandW - gap * Double(count - 1)) / Double(count)
            for i in 0..<count {
                let x = bandX + Double(i) * (w + gap)
                let window = r(x, 22, w, 30)
                let shape = Path(roundedRect: window, cornerRadius: 6 * s)
                let on = Double(i) < lit
                if on, i == freeWindow {
                    if showGlow {
                        ctx.drawLayer { layer in
                            layer.addFilter(.blur(radius: 7 * s))
                            layer.fill(Path(roundedRect: window.insetBy(dx: -2 * s, dy: -2 * s), cornerRadius: 8 * s), with: .color(Brand.led.opacity(0.85)))
                        }
                    }
                    ctx.fill(shape, with: .color(Brand.led))
                } else {
                    ctx.fill(shape, with: .color(dark))
                    if on {   // 승객: 머리와 어깨
                        let cx = x + w / 2
                        let passenger = Color(hex: 0x4A5263)
                        ctx.fill(Path(ellipseIn: r(cx - 5.5, 26, 11, 11)), with: .color(passenger))
                        ctx.fill(Path(roundedRect: r(cx - 10, 38, 20, 14), cornerRadius: 6 * s), with: .color(passenger))
                    }
                }
            }

            // 앞유리
            let windshield = Path(roundedRect: r(156, 22, 36, 34), cornerRadii: .init(topLeading: 6 * s, bottomLeading: 6 * s, bottomTrailing: 6 * s, topTrailing: 22 * s))
            ctx.fill(windshield, with: .color(dark))
            var shine = Path()
            shine.move(to: CGPoint(x: 166 * s, y: 56 * s)); shine.addLine(to: CGPoint(x: 182 * s, y: 22 * s))
            shine.addLine(to: CGPoint(x: 188 * s, y: 22 * s)); shine.addLine(to: CGPoint(x: 172 * s, y: 56 * s)); shine.closeSubpath()
            ctx.fill(shine, with: .color(.white.opacity(0.10)))

            // 전조등
            ctx.fill(Path(ellipseIn: r(192, 62, 8, 8)), with: .color(Brand.led))

            // 바퀴
            for cx in [44.0, 152.0] {
                ctx.fill(Path(ellipseIn: r(cx - 17, 65, 34, 34)), with: .color(dark))
                ctx.fill(Path(ellipseIn: r(cx - 12, 70, 24, 24)), with: .color(Color(hex: 0x232833)))
                ctx.fill(Path(ellipseIn: r(cx - 5, 77, 10, 10)), with: .color(Color(hex: 0xC9CDD4)))
            }
        }
        .aspectRatio(2, contentMode: .fit)
        .accessibilityHidden(true)
    }
}

/// 글자 로고: "탈래"는 검정, "말래"는 빨강 (탈까 말까 두 박자)
struct Wordmark: View {
    var size: CGFloat = 28
    var color: Color = Brand.ink
    var accent: Color = Brand.red

    var body: some View {
        HStack(spacing: size * 0.04) {
            Text("탈래").foregroundStyle(color)
            Text("말래").foregroundStyle(accent)
        }
        .font(.system(size: size, weight: .heavy))
        .tracking(-size * 0.03)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("탈래말래")
    }
}

/// 로고 + 글자 (홈 왼쪽 위)
struct LogoLockup: View {
    var height: CGFloat = 34
    var body: some View {
        HStack(spacing: 10) {
            BusMark().frame(width: height * 1.45)
            Wordmark(size: height * 0.72)
        }
    }
}

/// 좌석 아이콘 (정면): 머리받이가 둥근 등받이와 방석
struct SeatGlyph: View {
    var color: Color = Brand.ink
    var body: some View {
        Canvas { ctx, size in
            let s = size.width / 24
            ctx.fill(Path(roundedRect: CGRect(x: 4 * s, y: 0, width: 16 * s, height: 19 * s), cornerRadius: 7 * s), with: .color(color))
            ctx.fill(Path(roundedRect: CGRect(x: 0, y: 14 * s, width: 24 * s, height: 10 * s), cornerRadius: 5 * s), with: .color(color.opacity(0.8)))
            ctx.fill(Path(roundedRect: CGRect(x: 6 * s, y: 4 * s, width: 12 * s, height: 8 * s), cornerRadius: 4 * s), with: .color(.white.opacity(0.18)))
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
}

/// 목록·카드에 쓰는 작은 버스 (정면): 노선 색 타일 위에 앞유리와 전조등
struct BusFront: View {
    var color: Color = Brand.red
    var body: some View {
        Canvas { ctx, size in
            let s = size.width / 24
            let dark = Color(hex: 0x0E1116)
            ctx.fill(Path(roundedRect: CGRect(x: 3 * s, y: 2 * s, width: 18 * s, height: 19 * s), cornerRadius: 5 * s), with: .color(.white))
            ctx.fill(Path(roundedRect: CGRect(x: 5.5 * s, y: 4.5 * s, width: 13 * s, height: 8 * s), cornerRadius: 2 * s), with: .color(color))
            ctx.fill(Path(roundedRect: CGRect(x: 7 * s, y: 6 * s, width: 10 * s, height: 5 * s), cornerRadius: 1.5 * s), with: .color(dark))
            ctx.fill(Path(ellipseIn: CGRect(x: 6 * s, y: 15 * s, width: 3 * s, height: 3 * s)), with: .color(Brand.led))
            ctx.fill(Path(ellipseIn: CGRect(x: 15 * s, y: 15 * s, width: 3 * s, height: 3 * s)), with: .color(Brand.led))
            ctx.fill(Path(roundedRect: CGRect(x: 5 * s, y: 21 * s, width: 3 * s, height: 2.5 * s), cornerRadius: 1 * s), with: .color(.white))
            ctx.fill(Path(roundedRect: CGRect(x: 16 * s, y: 21 * s, width: 3 * s, height: 2.5 * s), cornerRadius: 1 * s), with: .color(.white))
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
}

/// 노선 색 정사각 타일에 작은 버스 (목록의 버스 표시)
struct BusTile: View {
    var color: Color = Brand.red
    var size: CGFloat = 28
    var dimmed = false
    var body: some View {
        BusFront(color: dimmed ? Color(hex: 0xB8BCC4) : color)
            .padding(size * 0.14)
            .frame(width: size, height: size)
            .background(dimmed ? Color(hex: 0xD5D8DD) : color, in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: size * 0.3, style: .continuous).stroke(.white, lineWidth: 1.5))
            .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
    }
}
