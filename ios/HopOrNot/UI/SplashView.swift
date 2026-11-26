import SwiftUI

/// 첫 화면: 전광판에 HOP OR NOT 이 한 줄씩 켜지고, 버스가 들어와 서면 창문(좌석)에 불이 하나씩 들어온다.
/// 마지막에 호박색으로 켜지는 창문이 빈자리다. 화면을 누르면 건너뛴다.
struct SplashView: View {
    let onFinish: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()
    @State private var fading = false
    @State private var finished = false

    private let duration = 2.5

    /// 개발용: -splashAt 1.2 로 그 시각의 장면에 멈춘다 (캡처용)
    private var frozenAt: Double? {
        #if DEBUG
        let launch = ProcessInfo.processInfo.arguments
        if let i = launch.firstIndex(of: "-splashAt"), i + 1 < launch.count { return Double(launch[i + 1]) }
        #endif
        return nil
    }

    var body: some View {
        GeometryReader { geo in
            if let frozen = frozenAt {
                scene(t: frozen, size: geo.size)
            } else if reduceMotion {
                scene(t: duration, size: geo.size)
            } else {
                TimelineView(.animation) { timeline in
                    scene(t: timeline.date.timeIntervalSince(start), size: geo.size)
                }
            }
        }
        .ignoresSafeArea()
        .opacity(fading ? 0 : 1)
        .contentShape(Rectangle())
        .onTapGesture { finish() }
        .task {
            guard frozenAt == nil else { return }
            start = Date()
            try? await Task.sleep(for: .seconds(reduceMotion ? 0.9 : duration))
            finish()
        }
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        withAnimation(.easeIn(duration: 0.3)) { fading = true }
        Task {
            try? await Task.sleep(for: .seconds(0.3))
            onFinish()
        }
    }

    // MARK: 장면

    private func clamp(_ x: Double) -> Double { min(max(x, 0), 1) }
    private func easeOut(_ x: Double) -> Double { 1 - pow(1 - clamp(x), 3) }

    private func scene(t: Double, size: CGSize) -> some View {
        let board = easeOut((t - 0.25) / 1.1)
        let drive = easeOut((t - 0.15) / 1.25)
        let windows = max(0, (t - 1.15) / 0.14)
        let tagline = clamp((t - 1.55) / 0.45)
        let busWidth = min(size.width * 0.62, 260)
        let roadY = size.height * 0.66

        return ZStack {
            LinearGradient(colors: [Color(hex: 0x0A0D12), Color(hex: 0x151A22)], startPoint: .top, endPoint: .bottom)

            // 전광판
            VStack(spacing: 22) {
                KoreanLED(text: "탈래말래", progress: board)
                    .padding(.horizontal, 18).padding(.vertical, 22)
                    .background(Brand.boardRaised, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Brand.boardLine, lineWidth: 1.5))
                    .padding(.horizontal, 20)
                .shadow(color: Brand.led.opacity(0.10 * board), radius: 30)

                VStack(spacing: 6) {
                    Text("탈까, 보낼까.")
                        .font(Brand.title(26))
                        .foregroundStyle(.white)
                    Text("광역버스 도착 좌석을 확률로")
                        .font(Brand.body(14, .medium))
                        .foregroundStyle(Brand.inkFaint)
                }
                .opacity(tagline)
                .offset(y: (1 - tagline) * 8)
            }
            .position(x: size.width / 2, y: size.height * 0.33)

            // 길과 버스
            Path { p in
                p.move(to: CGPoint(x: 0, y: roadY + 50)); p.addLine(to: CGPoint(x: size.width, y: roadY + 50))
            }
            .stroke(Color(hex: 0x39404C), style: StrokeStyle(lineWidth: 3, dash: [16, 14], dashPhase: -t * 160 * (1 - drive)))

            BusMark(windows: 4, freeWindow: 2, lit: windows)
                .frame(width: busWidth)
                .position(x: size.width / 2 - (1 - drive) * (size.width / 2 + busWidth), y: roadY)
                .shadow(color: Brand.led.opacity(0.25 * clamp(windows - 2)), radius: 24)

            Text("5100 · 1112 · M5107")
                .font(Brand.signage(15)).tracking(2)
                .foregroundStyle(Brand.inkFaint.opacity(0.7))
                .position(x: size.width / 2, y: size.height - 52)
        }
    }
}

/// 한글 전광판 글자: 굵은 호박색 글씨에 도트 격자를 씌우고 왼쪽부터 켜진다
struct KoreanLED: View {
    let text: String
    var progress: Double

    var body: some View {
        let glyph = Text(text).font(.system(size: 76, weight: .black)).tracking(6)
        ZStack {
            glyph.foregroundStyle(Brand.led.opacity(0.35)).blur(radius: 14)
            glyph.foregroundStyle(Brand.led)
                .mask(
                    Canvas { ctx, size in
                        let pitch: CGFloat = 5
                        var y: CGFloat = 1
                        while y < size.height { var x: CGFloat = 1
                            while x < size.width { ctx.fill(Path(ellipseIn: CGRect(x: x, y: y, width: pitch * 0.78, height: pitch * 0.78)), with: .color(.white)); x += pitch }
                            y += pitch }
                    }
                )
        }
        .mask(
            GeometryReader { geo in
                Rectangle().frame(width: geo.size.width * progress, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        )
        .frame(maxWidth: .infinity)
        .accessibilityLabel(text)
    }
}
