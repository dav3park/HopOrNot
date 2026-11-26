import SwiftUI

// MARK: 로딩

/// 자리 표시용 막대. 모든 막대가 같은 시계로 반짝여서 한 덩어리로 보인다.
struct SkeletonBlock: View {
    var width: CGFloat? = nil
    var height: CGFloat = 14
    var radius: CGFloat = 7

    var body: some View {
        TimelineView(.animation) { timeline in
            let phase = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.5) / 1.5
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(Brand.chip)
                .overlay(
                    GeometryReader { geo in
                        LinearGradient(colors: [.clear, .white.opacity(0.75), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: geo.size.width * 0.7)
                            .offset(x: (phase * 2 - 0.7) * geo.size.width)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                )
        }
        .frame(width: width, height: height)
        .accessibilityHidden(true)
    }
}

/// 처음 불러올 때: 버스가 점선 길을 달린다
struct RoadLoader: View {
    var text = "버스 위치를 불러오는 중"
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 14) {
            GeometryReader { geo in
                TimelineView(.animation) { timeline in
                    let t = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                    let travel = geo.size.width + 90
                    let x = (t * 90).truncatingRemainder(dividingBy: travel) - 60
                    ZStack(alignment: .topLeading) {
                        Path { p in p.move(to: CGPoint(x: 0, y: 46)); p.addLine(to: CGPoint(x: geo.size.width, y: 46)) }
                            .stroke(Brand.line, style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [10, 9], dashPhase: -t * 90))
                        BusMark(windows: 4, freeWindow: 2)
                            .frame(width: 64)
                            .offset(x: reduceMotion ? geo.size.width / 2 - 32 : x, y: 10)
                    }
                }
            }
            .frame(height: 56)
            Text(text)
                .font(Brand.body(14, .semibold))
                .foregroundStyle(Brand.inkSoft)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }
}

// MARK: 오류

/// 데이터가 하나도 없을 때의 오류 (전체 영역)
struct ErrorState: View {
    let error: AppError
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: error.symbol)
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(Brand.inkSoft)
                .frame(width: 64, height: 64)
                .background(Brand.chip, in: Circle())
            VStack(spacing: 6) {
                Text(error.title).font(Brand.title(19)).foregroundStyle(Brand.ink)
                Text(error.message).font(Brand.body(14)).foregroundStyle(Brand.inkSoft).multilineTextAlignment(.center)
            }
            if error.isRetryable, let retry {
                Button(action: retry) {
                    Text("다시 시도")
                        .font(Brand.body(15, .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 22).padding(.vertical, 11)
                        .background(Brand.ink, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 28).padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
        .card(padding: 0)
        .accessibilityElement(children: .combine)
    }
}

/// 데이터는 있는데 새로고침이 실패했을 때: 마지막 데이터는 그대로 두고 얇게 알린다
struct StaleBanner: View {
    let error: AppError
    var since: Date?
    var retry: (() -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(Brand.led).frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 1) {
                Text(error.title).font(Brand.body(13, .bold)).foregroundStyle(Color(hex: 0x5A3E00))
                Text(since.map { "\(Format.time.string(from: $0)) 데이터를 보여 주고 있어요" } ?? error.message)
                    .font(Brand.body(12)).foregroundStyle(Color(hex: 0x7A5A12))
            }
            Spacer(minLength: 6)
            if error.isRetryable, let retry {
                Button("다시 시도", action: retry)
                    .font(Brand.body(13, .bold))
                    .foregroundStyle(Color(hex: 0x5A3E00))
                    .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Color(hex: 0xFFF3D9), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color(hex: 0xF1D79F), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}
